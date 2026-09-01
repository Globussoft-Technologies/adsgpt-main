/**
 * metaUsageRecorder — accumulate Meta API usage in memory, flush it to Mongo
 * on a timer.
 *
 * WHY NOT WRITE PER CALL. One Autopilot cycle makes hundreds of Meta calls in
 * a burst. A write per call would add a database round-trip to every one of
 * them, inside a cron tick that already holds a run lock — turning telemetry
 * into the slowest part of the thing it measures. Instead every call touches
 * a Map, and one bulk upsert per flush window covers all of them.
 *
 * WHY IT CAN NEVER THROW. This module observes; it must not participate. It
 * sits inside the wrapper around `api.call`, so an exception here would
 * surface as a failed Meta request — telemetry breaking production is the one
 * outcome that would make this worse than no telemetry at all. Every public
 * entry point is wrapped, and a flush that loses its batch logs and moves on
 * rather than retrying: a missing hour of usage data costs an investigation
 * some resolution, a retry storm during a Mongo outage costs the whole app.
 *
 * WHY $inc AND $max, NEVER read-modify-write. Multiple workers (and multiple
 * PM2 instances) write the same hourly bucket concurrently. `$inc` composes
 * for counters and `$max` composes for peaks, so the database resolves the
 * race and the process never has to. This is also what makes losing a flush
 * survivable — the next flush is not attempting to reconstruct a total, only
 * to add its own share.
 */
const logger = require("../../utils/logger");

let MetaApiUsage = null;
try {
  MetaApiUsage = require("../../Module/metaUsage/metaApiUsage");
} catch {
  // Model missing (partial deploy, a trimmed test env) disables recording
  // rather than crashing whatever required us.
  MetaApiUsage = null;
}

let MetaAdAccountName = null;
try {
  MetaAdAccountName = require("../../Module/metaUsage/metaAdAccountName");
} catch {
  MetaAdAccountName = null;
}

const FLUSH_MS = Number(process.env.META_USAGE_FLUSH_MS) || 30000;

// A hard ceiling on distinct buckets held in memory. Reaching it means either
// an unusual fan-out or a flush that has been failing for a while; either way
// the answer is to flush now rather than grow without bound.
const MAX_PENDING = 5000;

// Explicit off-switch. Recording is on by default because the collection it
// writes to is TTL'd and small, and because the whole point is to already
// have the data when someone asks.
function enabled() {
  return (
    MetaApiUsage !== null &&
    String(process.env.META_USAGE_TRACKING || "on").toLowerCase() !== "off"
  );
}

/** Top of the hour containing `d`, UTC. */
function hourStart(d = new Date()) {
  const t = new Date(d);
  t.setUTCMinutes(0, 0, 0);
  return t;
}

function normalizeAccountId(id) {
  if (!id) return null;
  return String(id).replace(/^act_/, "") || null;
}

/**
 * Which `peak.*` field one of `MetaRateLimiter.allFor()`'s buckets maps to.
 *
 * The insights header carries two independent percentages under one bucket
 * kind — app-wide and account-scoped — and they are told apart by the key
 * shape the limiter built (`insights:<token>:app` vs
 * `insights:<token>:acc:<id>`). Collapsing them would merge the meter every
 * account shares with the one only this account can fill, which is precisely
 * the distinction an investigation needs.
 */
function peakFieldFor(bucket) {
  switch (bucket.kind) {
    case "app":
      return "app";
    case "buc":
      return "buc";
    case "acc":
      return "acc";
    case "reach":
      return "reach";
    case "insights":
      return String(bucket.key || "").includes(":acc:")
        ? "insightsAcc"
        : "insightsApp";
    default:
      // `local_retry` and anything the limiter grows later: reflected through
      // maxBlockedMs, but not a Meta-reported percentage, so no peak field.
      return null;
  }
}

class MetaUsageRecorder {
  constructor() {
    /** @type {Map<string, Object>} */
    this.pending = new Map();
    // accountId -> { name, userId }. Names are learned far more often than
    // they change, so this is deduped in memory and only written when the
    // value is one we have not already flushed this process.
    /** @type {Map<string, Object>} */
    this.pendingNames = new Map();
    /** @type {Map<string, string>} */
    this.knownNames = new Map();
    this.timer = null;
    this.flushing = false;
    // Diagnostics for the admin page itself — if `droppedBatches` is climbing,
    // the numbers on that page are incomplete and it should say so.
    this.stats = { flushed: 0, droppedBatches: 0, lastFlushAt: null };
  }

  _key(userId, adAccountId, source, hour) {
    return `${userId || "_"}|${adAccountId || "_"}|${source}|${hour.getTime()}`;
  }

  _bucket({ userId, adAccountId, source }) {
    const hour = hourStart();
    const acct = normalizeAccountId(adAccountId);
    const src = source || "unknown";
    const key = this._key(userId, acct, src, hour);
    let b = this.pending.get(key);
    if (!b) {
      b = {
        userId: userId ? String(userId) : null,
        adAccountId: acct,
        source: src,
        hourStart: hour,
        calls: 0,
        failures: 0,
        throttles: 0,
        peak: {},
        maxBlockedMs: 0,
        tier: null,
      };
      this.pending.set(key, b);
    }
    return b;
  }

  /** One request made. */
  recordCall(ctx = {}) {
    if (!enabled()) return;
    try {
      this._bucket(ctx).calls += 1;
      this._maybeFlush();
    } catch (err) {
      this._swallow(err, "recordCall");
    }
  }

  /**
   * One request that failed. `throttled` marks the rate-limit kind, which is
   * the only failure that says anything about capacity.
   */
  recordFailure(ctx = {}, { throttled = false } = {}) {
    if (!enabled()) return;
    try {
      const b = this._bucket(ctx);
      b.failures += 1;
      if (throttled) b.throttles += 1;
      this._maybeFlush();
    } catch (err) {
      this._swallow(err, "recordFailure");
    }
  }

  /**
   * Meta's own meters, as returned by `MetaRateLimiter.allFor(context)`.
   *
   * Called after every response rather than only when hot: a bucket reading
   * 2% is evidence too. "Every meter was idle when the app-level call failed"
   * is a finding, and it is only available if the idle readings were kept.
   */
  recordHeaders(ctx = {}, buckets = []) {
    if (!enabled() || !Array.isArray(buckets) || buckets.length === 0) return;
    try {
      const b = this._bucket(ctx);
      for (const bucket of buckets) {
        const field = peakFieldFor(bucket);
        const usage = Number(bucket.usage) || 0;
        if (field && usage > (b.peak[field] || 0)) b.peak[field] = usage;

        const blocked = Number(bucket.blockedMs) || 0;
        if (blocked > b.maxBlockedMs) b.maxBlockedMs = blocked;

        if (bucket.tier && !b.tier) b.tier = String(bucket.tier);
      }
      this._maybeFlush();
    } catch (err) {
      this._swallow(err, "recordHeaders");
    }
  }

  /**
   * Note the human name behind an ad account id.
   *
   * Deduped against `knownNames` so the account-picker call every user makes
   * on page load does not turn into a write per request. A CHANGED name still
   * gets through — the guard compares values, not just presence.
   */
  rememberAccountName(adAccountId, name, userId = null) {
    if (!enabled() || !MetaAdAccountName) return;
    try {
      const id = normalizeAccountId(adAccountId);
      const clean = typeof name === "string" ? name.trim() : "";
      if (!id || !clean) return;
      if (this.knownNames.get(id) === clean) return;
      this.knownNames.set(id, clean);
      this.pendingNames.set(id, { name: clean, userId: userId || null });
      this._maybeFlush();
    } catch (err) {
      this._swallow(err, "rememberAccountName");
    }
  }

  _maybeFlush() {
    if (this.pending.size >= MAX_PENDING) {
      void this.flush();
      return;
    }
    this.start();
  }

  /** Idempotent — safe to call from every record path. */
  start() {
    if (this.timer || !enabled()) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    // Never hold the process open for telemetry.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Write everything accumulated so far.
   *
   * The pending map is swapped out BEFORE the await, so calls arriving during
   * the write land in a fresh map — they are neither lost to the swap nor
   * double-counted by it.
   */
  async flush() {
    if (this.flushing || !enabled()) return;
    if (this.pending.size === 0 && this.pendingNames.size === 0) return;
    this.flushing = true;
    const batch = this.pending;
    this.pending = new Map();
    const nameBatch = this.pendingNames;
    this.pendingNames = new Map();

    // Names are written on their own so a usage-write failure cannot lose
    // them and vice versa — they are independent facts.
    if (nameBatch.size > 0) {
      try {
        await MetaAdAccountName.bulkWrite(
          [...nameBatch.entries()].map(([adAccountId, v]) => ({
            updateOne: {
              filter: { adAccountId },
              update: {
                $set: { name: v.name, lastSeenUserId: v.userId },
              },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      } catch (err) {
        // Forget them so a later call re-learns and retries; a name is cheap
        // to observe again, unlike a count.
        for (const id of nameBatch.keys()) this.knownNames.delete(id);
        this._swallow(err, "flush names");
      }
    }

    try {
      const ops = [];
      for (const b of batch.values()) {
        const inc = {};
        if (b.calls) inc.calls = b.calls;
        if (b.failures) inc.failures = b.failures;
        if (b.throttles) inc.throttles = b.throttles;

        const max = {};
        for (const [field, value] of Object.entries(b.peak)) {
          if (value > 0) max[`peak.${field}`] = value;
        }
        if (b.maxBlockedMs > 0) max.maxBlockedMs = b.maxBlockedMs;

        const update = {};
        if (Object.keys(inc).length) update.$inc = inc;
        if (Object.keys(max).length) update.$max = max;
        // `tier` is set-on-insert only: it is a property of the app's access
        // level, not of the hour, so the first observation is as good as the
        // last and rewriting it on every flush would be a pointless write.
        if (b.tier) update.$setOnInsert = { tier: b.tier };
        if (!Object.keys(update).length) continue;

        ops.push({
          updateOne: {
            filter: {
              userId: b.userId,
              adAccountId: b.adAccountId,
              source: b.source,
              hourStart: b.hourStart,
            },
            update,
            upsert: true,
          },
        });
      }

      if (ops.length) {
        await MetaApiUsage.bulkWrite(ops, { ordered: false });
        this.stats.flushed += ops.length;
        this.stats.lastFlushAt = new Date();
      }
    } catch (err) {
      // Deliberately NOT re-queued. See the module header: during a Mongo
      // outage a retry turns a data gap into a memory leak plus a write storm
      // against a database that is already struggling.
      this.stats.droppedBatches += 1;
      this._swallow(err, `flush (dropped ${batch.size} buckets)`);
    } finally {
      this.flushing = false;
    }
  }

  snapshot() {
    return { ...this.stats, pending: this.pending.size, enabled: enabled() };
  }

  _swallow(err, where) {
    try {
      logger.warn(`[meta usage] ${where} failed: ${err && err.message}`);
    } catch {
      /* logging must not be the thing that throws */
    }
  }
}

const sharedUsageRecorder = new MetaUsageRecorder();

module.exports = {
  sharedUsageRecorder,
  MetaUsageRecorder,
  _internals: { hourStart, peakFieldFor, normalizeAccountId },
};
