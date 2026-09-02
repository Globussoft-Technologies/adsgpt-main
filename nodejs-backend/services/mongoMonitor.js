/**
 * In-process MongoDB monitoring for the admin dashboard.
 *
 * WHY A SAMPLER EXISTS AT ALL. `serverStatus` reports opcounters, network
 * bytes and latency as totals accumulated since mongod started. Handing those
 * to a chart draws a line that only ever goes up and says nothing about now.
 * What an operator actually wants is the rate — writes per second, average
 * latency over the last ten seconds — and a rate needs two readings. So this
 * module keeps its own ring buffer of readings and hands the admin API the
 * differences between them.
 *
 * WHY THE SAMPLER IS LAZY. Nobody watches the monitoring page most of the
 * time. Polling mongod forever for readings no one reads is pure cost, so the
 * interval starts on the first admin request and stops itself two minutes
 * after the last one. The buffer survives the stop, so a page reopened inside
 * that window still has history to draw.
 *
 * WHAT THE POOL NUMBERS DO AND DO NOT COVER. Pool counters come from the
 * driver's CMAP events, which are per Node process. Under a multi-instance
 * deployment (pm2 cluster, several containers) this reports THIS process's
 * pool against THIS process's maxPoolSize, while `serverStatus.connections`
 * reports every client the server has, including other instances, scripts and
 * mongosh sessions. The two disagreeing is normal and expected; the API
 * labels each so the page can say which is which.
 */
const mongoose = require("mongoose");

const SAMPLE_INTERVAL_MS = 10_000;
// 30 minutes of history at one sample per 10s. Each sample is a small flat
// object, so the whole buffer is a few tens of KB.
const MAX_SAMPLES = 180;
const IDLE_STOP_MS = 120_000;

// Process-local pool accounting, derived from CMAP events. Counters are
// monotonic; the interesting numbers (open, inUse, waiting) are differences
// between them.
const pool = {
  attached: false,
  since: null,
  created: 0,
  closed: 0,
  checkOutStarted: 0,
  checkedOut: 0,
  checkedIn: 0,
  checkOutFailed: 0,
  poolCleared: 0,
  lastClearedAt: null,
  lastCheckOutFailAt: null,
};

const state = {
  samples: [],
  lastRaw: null,
  timer: null,
  quickTimer: null,
  lastRequestAt: 0,
  // Set false the first time serverStatus is refused, so we stop asking and
  // the page can explain why half the metrics are missing.
  privileged: null,
  privilegeError: null,
};

/**
 * Attach CMAP listeners to the live MongoClient. Called once from db/mongo.js
 * after the initial connect, because a listener registered later would count
 * check-ins for check-outs it never saw and report a negative in-use count.
 */
function attachPoolMonitor(connection = mongoose.connection) {
  if (pool.attached) return;
  let client;
  try {
    client = connection.getClient();
  } catch {
    client = null;
  }
  if (!client || typeof client.on !== "function") return;

  client.on("connectionCreated", () => {
    pool.created += 1;
  });
  client.on("connectionClosed", () => {
    pool.closed += 1;
  });
  client.on("connectionCheckOutStarted", () => {
    pool.checkOutStarted += 1;
  });
  client.on("connectionCheckedOut", () => {
    pool.checkedOut += 1;
  });
  client.on("connectionCheckedIn", () => {
    pool.checkedIn += 1;
  });
  client.on("connectionCheckOutFailed", () => {
    pool.checkOutFailed += 1;
    pool.lastCheckOutFailAt = new Date().toISOString();
  });
  client.on("connectionPoolCleared", () => {
    pool.poolCleared += 1;
    pool.lastClearedAt = new Date().toISOString();
  });

  pool.attached = true;
  pool.since = new Date().toISOString();
}

function maxPoolSize() {
  try {
    const client = mongoose.connection.getClient();
    const size = client?.options?.maxPoolSize ?? client?.s?.options?.maxPoolSize;
    if (Number.isFinite(size)) return size;
  } catch {
    /* fall through to the documented default */
  }
  // Mirrors db/mongo.js. Only reached if the driver stops exposing options.
  return 10;
}

function poolSnapshot() {
  const limit = maxPoolSize();
  const inUse = Math.max(0, pool.checkedOut - pool.checkedIn);
  return {
    attached: pool.attached,
    since: pool.since,
    pid: process.pid,
    maxPoolSize: limit,
    open: Math.max(0, pool.created - pool.closed),
    inUse,
    // A non-zero waiting count is the signal that maxPoolSize is the
    // bottleneck: requests are queued for a connection that does not exist.
    waiting: Math.max(0, pool.checkOutStarted - pool.checkedOut - pool.checkOutFailed),
    utilisation: limit > 0 ? Math.min(100, (inUse / limit) * 100) : 0,
    totalCreated: pool.created,
    checkOutFailed: pool.checkOutFailed,
    poolCleared: pool.poolCleared,
    lastClearedAt: pool.lastClearedAt,
    lastCheckOutFailAt: pool.lastCheckOutFailAt,
  };
}

const READY_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
  99: "uninitialized",
};

function connectionInfo() {
  const conn = mongoose.connection;
  return {
    stateCode: conn.readyState,
    state: READY_STATES[conn.readyState] || "unknown",
    // Host and database name only. The connection string carries credentials
    // and must never leave the process, not even for an authenticated admin.
    host: conn.host || null,
    port: conn.port || null,
    database: conn.name || null,
  };
}

async function readServerStatus() {
  if (state.privileged === false) return null;
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const raw = await mongoose.connection.db.admin().command({ serverStatus: 1 });
    state.privileged = true;
    state.privilegeError = null;
    return raw;
  } catch (error) {
    // Permission failures are stable, so stop retrying those. Transient
    // asking — everything that does not need the admin database still works.
    const unauthorized = error?.codeName === "Unauthorized" || error?.code === 13;
    state.privileged = unauthorized ? false : null;
    state.privilegeError = unauthorized
      ? "The MongoDB user lacks the clusterMonitor role, so server-wide metrics (op rates, connections, memory, latency) are unavailable. Pool and storage metrics are unaffected."
      : `serverStatus temporarily failed: ${error?.message || "unknown error"}`;
    return null;
  }
}

function toMb(bytes) {
  return Number.isFinite(bytes) ? Math.round((bytes / 1048576) * 10) / 10 : null;
}

/**
 * Turn two raw serverStatus readings into per-second rates.
 *
 * Returns null rather than zero when a delta comes back negative: that means
 * mongod restarted between readings and its counters reset, and a chart is
 * better off with a gap than with a fabricated spike.
 */
function diff(prev, next) {
  if (!prev || !next) return null;
  const seconds = (next.at - prev.at) / 1000;
  if (seconds <= 0) return null;

  const perSec = (a, b) => {
    const delta = b - a;
    if (!Number.isFinite(delta) || delta < 0) return null;
    return Math.round((delta / seconds) * 100) / 100;
  };

  const ops = {};
  for (const key of ["insert", "query", "update", "delete", "getmore", "command"]) {
    ops[key] = perSec(prev.opcounters?.[key] || 0, next.opcounters?.[key] || 0);
  }
  const total = Object.values(ops).reduce((sum, value) => sum + (value || 0), 0);

  // Average latency over the interval, not since server start: the deltas of
  // both the microsecond total and the op count, divided. Reported in ms.
  const latencyMs = {};
  for (const key of ["reads", "writes", "commands"]) {
    const dLatency = (next.opLatencies?.[key]?.latency || 0) - (prev.opLatencies?.[key]?.latency || 0);
    const dOps = (next.opLatencies?.[key]?.ops || 0) - (prev.opLatencies?.[key]?.ops || 0);
    latencyMs[key] = dOps > 0 && dLatency >= 0 ? Math.round(dLatency / dOps / 10) / 100 : null;
  }

  const kbPerSec = (a, b) => {
    const delta = b - a;
    if (!Number.isFinite(delta) || delta < 0) return null;
    return Math.round((delta / 1024 / seconds) * 10) / 10;
  };

  return {
    ops: { ...ops, total: Math.round(total * 100) / 100 },
    latencyMs,
    networkKbIn: kbPerSec(prev.network?.bytesIn || 0, next.network?.bytesIn || 0),
    networkKbOut: kbPerSec(prev.network?.bytesOut || 0, next.network?.bytesOut || 0),
  };
}

function normaliseRaw(raw) {
  if (!raw) return null;
  const cache = raw.wiredTiger?.cache;
  return {
    at: Date.now(),
    opcounters: raw.opcounters || {},
    opLatencies: raw.opLatencies || {},
    network: raw.network || {},
    connections: raw.connections || {},
    mem: raw.mem || {},
    uptimeSec: raw.uptime || null,
    version: raw.version || null,
    storageEngine: raw.storageEngine?.name || null,
    wiredTigerCache: cache
      ? {
          usedMb: toMb(cache["bytes currently in the cache"]),
          maxMb: toMb(cache["maximum bytes configured"]),
          dirtyMb: toMb(cache["tracked dirty bytes in the cache"]),
        }
      : null,
  };
}

/** Take one reading, append the derived sample, return it. */
async function sampleOnce() {
  const raw = normaliseRaw(await readServerStatus());
  const rates = diff(state.lastRaw, raw);
  if (raw) state.lastRaw = raw;

  const snapshot = poolSnapshot();
  const sample = {
    at: new Date().toISOString(),
    readyState: mongoose.connection.readyState,
    pool: { inUse: snapshot.inUse, open: snapshot.open, waiting: snapshot.waiting },
    rates,
    connections: raw?.connections
      ? {
          current: raw.connections.current,
          available: raw.connections.available,
          active: raw.connections.active,
        }
      : null,
    memMb: raw?.mem ? { resident: raw.mem.resident, virtual: raw.mem.virtual } : null,
  };

  state.samples.push(sample);
  if (state.samples.length > MAX_SAMPLES) {
    state.samples.splice(0, state.samples.length - MAX_SAMPLES);
  }
  return sample;
}

function stopSampler() {
  if (state.timer) clearInterval(state.timer);
  if (state.quickTimer) clearTimeout(state.quickTimer);
  state.timer = null;
  state.quickTimer = null;
}

/**
 * Mark that an admin is watching, starting the sampler if it is not running.
 * Called by every db-monitor endpoint; the idle check inside the interval is
 * what eventually shuts it back down.
 */
function touch() {
  state.lastRequestAt = Date.now();
  if (state.timer) return;

  // A baseline immediately and a second reading shortly after, so the first
  // page load shows real rates instead of ten seconds of dashes.
  sampleOnce().catch(() => {});
  state.quickTimer = setTimeout(() => {
    sampleOnce().catch(() => {});
  }, 1500);

  state.timer = setInterval(() => {
    if (Date.now() - state.lastRequestAt > IDLE_STOP_MS) {
      stopSampler();
      return;
    }
    sampleOnce().catch(() => {});
  }, SAMPLE_INTERVAL_MS);

  // Never hold the event loop open for a monitoring poll.
  if (typeof state.timer.unref === "function") state.timer.unref();
  if (typeof state.quickTimer.unref === "function") state.quickTimer.unref();
}

function samplerInfo() {
  return {
    running: Boolean(state.timer),
    intervalMs: SAMPLE_INTERVAL_MS,
    windowMinutes: Math.round((MAX_SAMPLES * SAMPLE_INTERVAL_MS) / 60000),
    privileged: state.privileged,
    warning: state.privilegeError,
  };
}

module.exports = {
  attachPoolMonitor,
  touch,
  sampleOnce,
  poolSnapshot,
  connectionInfo,
  samplerInfo,
  getSamples: () => state.samples.slice(),
  getLatestRaw: () => state.lastRaw,
  SAMPLE_INTERVAL_MS,
  diff,
  normaliseRaw,
};
