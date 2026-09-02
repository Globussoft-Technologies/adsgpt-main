/**
 * MongoDB monitoring endpoints for the admin dashboard.
 *
 * WHY EVERY QUERY SHAPE IS REDACTED. `currentOp` and the profiler return the
 * actual command that is running, filter values included — an email being
 * looked up, a token being matched, a user's prompt text. That is production
 * user data, and a monitoring page has no business displaying it. So every
 * command that leaves this controller is passed through redactShape(), which
 * keeps field names and operators (the part that explains why a query is slow
 * and whether an index could serve it) and replaces every leaf value with its
 * type. `{ email: "<string>", createdAt: { $gte: "<date>" } }` answers the
 * operational question without carrying the data.
 *
 * WHY THIS SURFACE IS READ-ONLY. The admin panel describes itself as
 * read-only access, and every command used here is a read. Killing an
 * operation and turning the profiler on both change how the database behaves
 * for every user, so they stay in mongosh where they belong; the profiler
 * endpoint reports its state and says how to change it rather than changing
 * it.
 *
 * DEGRADING, NOT FAILING. serverStatus and currentOp need the clusterMonitor
 * role, dbStats does not. A user without it should still get storage metrics
 * and pool health rather than a page of errors, so each section reports its
 * own availability and the page renders what it has.
 */
const mongoose = require("mongoose");
const monitor = require("../../services/mongoMonitor");

// Collection stats mean a round trip per collection, and there are dozens of
// models. A page polling every few seconds must not turn into dozens of
// aggregations per second, so results are held briefly.
const STATS_CACHE_MS = 30_000;
const statsCache = new Map();

const MAX_SHAPE_DEPTH = 5;
const MAX_SHAPE_KEYS = 30;

/**
 * Replace every leaf value with a type marker, keeping structure and keys.
 * See the file header for why this is not optional.
 */
function redactShape(value, depth = 0) {
  if (value === null) return "<null>";
  if (value === undefined) return "<undefined>";
  if (depth >= MAX_SHAPE_DEPTH) return "<...>";

  if (Array.isArray(value)) {
    if (!value.length) return [];
    // One element is enough to show the shape; the length is the useful part.
    return [redactShape(value[0], depth + 1), `<${value.length} items>`];
  }

  const type = typeof value;
  if (type === "string") return "<string>";
  if (type === "number") return "<number>";
  if (type === "boolean") return "<bool>";
  if (type === "bigint") return "<bigint>";
  if (type === "function") return "<function>";

  if (value instanceof Date) return "<date>";
  // BSON types arrive as class instances; _bsontype is how the driver tags them.
  if (value._bsontype) return `<${String(value._bsontype).toLowerCase()}>`;
  if (Buffer.isBuffer(value)) return "<binary>";

  const out = {};
  const keys = Object.keys(value).slice(0, MAX_SHAPE_KEYS);
  for (const key of keys) {
    out[key] = redactShape(value[key], depth + 1);
  }
  if (Object.keys(value).length > keys.length) {
    out["<truncated>"] = `${Object.keys(value).length - keys.length} more fields`;
  }
  return out;
}

function bytesToMb(bytes) {
  return Number.isFinite(bytes) ? Math.round((bytes / 1048576) * 100) / 100 : null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function requireConnection(res) {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({
    success: false,
    message: "MongoDB is not connected",
    connection: monitor.connectionInfo(),
  });
  return false;
}

/**
 * GET /adsgpt/admin/db/health
 *
 * The live strip at the top of the page plus the sample history behind its
 * charts. Safe to poll every few seconds: the pool numbers are read from
 * in-process counters and the server numbers come from the sampler's buffer,
 * so polling faster than the sample interval costs nothing extra.
 */
exports.health = async (req, res) => {
  try {
    monitor.touch();

    const raw = monitor.getLatestRaw();
    const samples = monitor.getSamples();
    const latest = samples[samples.length - 1] || null;

    return res.json({
      success: true,
      connection: monitor.connectionInfo(),
      pool: monitor.poolSnapshot(),
      server: raw
        ? {
            version: raw.version,
            storageEngine: raw.storageEngine,
            uptimeSec: raw.uptimeSec,
            connections: raw.connections,
            memMb: { resident: raw.mem?.resident ?? null, virtual: raw.mem?.virtual ?? null },
            wiredTigerCache: raw.wiredTigerCache,
          }
        : null,
      rates: latest?.rates || null,
      samples,
      sampler: monitor.samplerInfo(),
      // Which Node process answered. Under a clustered deployment the pool
      // block above describes this one only.
      process: {
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        heapUsedMb: bytesToMb(process.memoryUsage().heapUsed),
        rssMb: bytesToMb(process.memoryUsage().rss),
      },
    });
  } catch (error) {
    console.error("DB monitor health error:", error);
    return res.status(500).json({ success: false, message: "Failed to read database health" });
  }
};

/**
 * GET /adsgpt/admin/db/stats?indexes=1
 *
 * Storage: how big the database is, and which collections and indexes made it
 * that way. `indexes=1` additionally reports per-index usage counts, which is
 * the only reliable way to find an index nothing has queried since the server
 * last restarted — it costs one more round trip per collection, so it is off
 * by default and the page requests it on demand.
 */
exports.stats = async (req, res) => {
  if (!requireConnection(res)) return;
  try {
    monitor.touch();
    const withIndexes = req.query.indexes === "1" || req.query.indexes === "true";
    const cacheKey = withIndexes ? "stats+indexes" : "stats";
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < STATS_CACHE_MS) {
      return res.json({ ...cached.payload, cached: true });
    }

    const db = mongoose.connection.db;
    const dbStats = await db.command({ dbStats: 1 });

    const listed = await db.listCollections({ type: "collection" }, { nameOnly: true }).toArray();
    const names = listed
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("system."))
      .sort();

    const collections = await mapWithConcurrency(
      names,
      5,
      async (name) => {
        try {
          const [doc] = await db
            .collection(name)
            .aggregate([{ $collStats: { storageStats: {}, latencyStats: {} } }])
            .toArray();
          const storage = doc?.storageStats || {};
          const reads = doc?.latencyStats?.reads;
          const writes = doc?.latencyStats?.writes;

          const entry = {
            name,
            documents: storage.count ?? null,
            dataMb: bytesToMb(storage.size),
            storageMb: bytesToMb(storage.storageSize),
            indexMb: bytesToMb(storage.totalIndexSize),
            avgObjSize: storage.avgObjSize ?? null,
            indexCount: storage.nindexes ?? null,
            indexSizes: storage.indexSizes || {},
            // Averages since the server started, in ms. Useful as a ranking
            // of which collections are expensive, not as a live latency.
            avgReadMs: reads?.ops > 0 ? Math.round(reads.latency / reads.ops / 10) / 100 : null,
            avgWriteMs: writes?.ops > 0 ? Math.round(writes.latency / writes.ops / 10) / 100 : null,
          };

          if (withIndexes) {
            const usage = await db.collection(name).aggregate([{ $indexStats: {} }]).toArray();
            entry.indexes = usage
              .map((idx) => ({
                name: idx.name,
                accesses: idx.accesses?.ops ?? 0,
                since: idx.accesses?.since || null,
                sizeMb: bytesToMb(storage.indexSizes?.[idx.name]),
                key: idx.key || null,
              }))
              .sort((a, b) => a.accesses - b.accesses);
          }
          return entry;
        } catch (error) {
          // A view, a collection dropped mid-scan, or a permission gap on one
          // namespace should not lose the other thirty-nine.
          return { name, error: error?.message || "stats unavailable" };
        }
      },
    );

    collections.sort((a, b) => (b.storageMb || 0) - (a.storageMb || 0));

    const payload = {
      success: true,
      database: {
        name: dbStats.db,
        collections: dbStats.collections,
        documents: dbStats.objects,
        dataMb: bytesToMb(dbStats.dataSize),
        storageMb: bytesToMb(dbStats.storageSize),
        indexMb: bytesToMb(dbStats.indexSize),
        indexes: dbStats.indexes,
        avgObjSize: dbStats.avgObjSize ? Math.round(dbStats.avgObjSize) : null,
        fsUsedMb: bytesToMb(dbStats.fsUsedSize),
        fsTotalMb: bytesToMb(dbStats.fsTotalSize),
      },
      collections,
      includesIndexUsage: withIndexes,
      generatedAt: new Date().toISOString(),
    };

    statsCache.set(cacheKey, { at: Date.now(), payload });
    return res.json(payload);
  } catch (error) {
    console.error("DB monitor stats error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to read database stats",
    });
  }
};

// Ops the server always has running (replication waits, oplog tailing, the
// currentOp call itself). Listing them buries the one query that matters.
function isInternalOp(op) {
  if (!op) return true;
  const ns = op.ns || "";
  if (!op.op || op.op === "none") return true;
  if (ns.startsWith("local.")) return true;
  if (ns === "admin.$cmd" && op.command?.currentOp) return true;
  if (op.desc && /^(conn)?(WT|Repl|TTL|Oplog|Session|Periodic)/i.test(op.desc)) return true;
  return false;
}

/**
 * GET /adsgpt/admin/db/ops?minSecs=0
 *
 * What the database is doing right now. The reason to look here is a request
 * that will not finish: sort by how long an operation has been running and
 * the offender is at the top, with its query shape and plan summary next to
 * it. A COLLSCAN in planSummary on a large collection is usually the answer.
 */
exports.ops = async (req, res) => {
  if (!requireConnection(res)) return;
  try {
    monitor.touch();
    const minSecs = Math.max(0, Math.min(Number(req.query.minSecs) || 0, 86_400));
    const admin = mongoose.connection.db.admin();

    let inprog = [];
    try {
      const result = await admin.command({ currentOp: 1, active: true });
      inprog = result?.inprog || [];
    } catch (error) {
      if (error?.codeName === "Unauthorized" || error?.code === 13) {
        return res.json({
          success: true,
          available: false,
          message:
            "Listing in-flight operations needs the clusterMonitor role on the MongoDB user.",
          ops: [],
        });
      }
      // currentOp as a command is deprecated; the aggregation stage is the
      // supported form on newer servers.
      try {
        const cursor = mongoose.connection
          .getClient()
          .db("admin")
          .aggregate([{ $currentOp: { allUsers: true, idleConnections: false } }]);
        inprog = await cursor.toArray();
      } catch (fallbackError) {
        if (fallbackError?.codeName === "Unauthorized" || fallbackError?.code === 13) {
          return res.json({
            success: true,
            available: false,
            message: "Listing in-flight operations needs the clusterMonitor role on the MongoDB user.",
            ops: [],
          });
        }
        throw fallbackError;
      }
    }

    const ops = inprog
      .filter((op) => !isInternalOp(op))
      .map((op) => ({
        opid: String(op.opid ?? ""),
        type: op.type || null,
        op: op.op || null,
        ns: op.ns || null,
        secsRunning: op.secs_running ?? (op.microsecs_running ? op.microsecs_running / 1e6 : 0),
        planSummary: op.planSummary || null,
        waitingForLock: Boolean(op.waitingForLock),
        numYields: op.numYields ?? null,
        client: op.client || op.client_s || null,
        appName: op.appName || null,
        desc: op.desc || null,
        // Field names and operators only — never the values. See file header.
        command: redactShape(op.command || {}),
      }))
      .filter((op) => (op.secsRunning || 0) >= minSecs)
      .sort((a, b) => (b.secsRunning || 0) - (a.secsRunning || 0));

    return res.json({
      success: true,
      available: true,
      ops,
      totalActive: inprog.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("DB monitor ops error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to read in-flight operations",
    });
  }
};

/**
 * GET /adsgpt/admin/db/slow-queries?limit=50
 *
 * The profiler is off on a healthy production server, and this endpoint does
 * not turn it on — writing every slow op to a capped collection changes the
 * database's behaviour for every user, which is a decision for whoever runs
 * the server, not for a dashboard. When it is on, this reads what it recorded.
 */
exports.slowQueries = async (req, res) => {
  if (!requireConnection(res)) return;
  try {
    monitor.touch();
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const db = mongoose.connection.db;

    let profile;
    try {
      profile = await db.command({ profile: -1 });
    } catch (error) {
      return res.json({
        success: true,
        available: false,
        message: `Profiler status unavailable: ${error?.message || "permission denied"}`,
        entries: [],
      });
    }

    const level = profile?.was ?? 0;
    const slowms = profile?.slowms ?? null;

    if (!level) {
      return res.json({
        success: true,
        available: true,
        enabled: false,
        level,
        slowms,
        entries: [],
        // Deliberately an instruction rather than a button. See the header.
        hint: `Profiling is off. To record slow operations, run db.setProfilingLevel(1, { slowms: ${slowms || 100} }) in mongosh against this database. It writes to a capped system.profile collection and can be turned off again with db.setProfilingLevel(0).`,
      });
    }

    const docs = await db
      .collection("system.profile")
      .find({ ns: { $not: /system\.profile$/ } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();

    const entries = docs.map((doc) => ({
      ts: doc.ts,
      op: doc.op,
      ns: doc.ns,
      millis: doc.millis,
      planSummary: doc.planSummary || null,
      docsExamined: doc.docsExamined ?? null,
      keysExamined: doc.keysExamined ?? null,
      nreturned: doc.nreturned ?? null,
      nModified: doc.nModified ?? null,
      appName: doc.appName || null,
      // Same redaction as currentOp: a profiled query carries live user data.
      command: redactShape(doc.command || doc.query || {}),
    }));

    return res.json({
      success: true,
      available: true,
      enabled: true,
      level,
      slowms,
      entries,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("DB monitor slow queries error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to read slow queries",
    });
  }
};

// Exported for tests: the redaction rule is the security-relevant part of
// this file and deserves to be assertable on its own.
exports.redactShape = redactShape;
