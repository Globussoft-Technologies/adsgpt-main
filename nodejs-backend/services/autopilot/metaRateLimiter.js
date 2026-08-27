/**
 * metaRateLimiter — self-throttle against Meta's rate limits by reading the
 * usage headers Meta returns on every response.
 *
 * PORTED FROM `mcps/meta/src/meta/rate-limiter.ts`, which already runs this
 * logic in production against these same ad accounts. Kept deliberately close
 * to the original so fixes can move between them; the differences are
 * mechanical (TypeScript -> CommonJS, `Headers.get()` -> plain-object lookup).
 *
 * WHY FIVE HEADERS AND NOT ONE. Meta meters Marketing API traffic in several
 * independent buckets, and being throttled on any one of them fails the call:
 *
 *   x-app-usage                      platform limits, per token
 *   x-business-use-case-usage        BUC, per business x use-case type
 *   x-fb-ads-insights-throttle       INSIGHTS-specific app + account load
 *   x-ad-account-usage               ad-account quota
 *   x-fb-ads-insights-reach-throttle reach + breakdowns cap
 *
 * The insights one matters most here: the Autopilot audit is almost entirely
 * insights queries, and that bucket is separate from BUC. Watching BUC alone
 * can report "plenty of headroom" while the insights meter is what actually
 * throttles you — and none of these appear on the App Dashboard's
 * Application-Level Rate Limiting page, which is why that page can read 100%
 * remaining during an outage.
 *
 * WHY A STAIRCASE AND NOT A BINARY SKIP. Meta throttles at 100%. Waiting until
 * then means the request that discovers the limit is also the one that fails.
 * Slowing down from 75% costs a little latency and avoids the failure
 * entirely; past 95% the delay grows sharply because at that point the next
 * call is likely to be refused.
 *
 * Buckets are scoped per (token, account, type) so one hot account never
 * slows its siblings — an agency with many accounts must not be held up by
 * whichever one is busiest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Buckets older than this are stale — Meta's windows are rolling, so an
// untouched bucket tells us nothing about current load.
const BUCKET_TTL_MS = 60 * 60 * 1000;

function safeParse(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function bucketKey(...parts) {
  return parts.filter((p) => p !== undefined && p !== null).join(":");
}

/**
 * Delay for a given usage percentage.
 *
 *   < 75%   no delay at all — normal operation must not pay for this
 *   75-95%  linear 100ms -> 2s
 *   95-100% 5s -> 60s, because a call here will probably be refused
 */
function staircaseDelay(usagePct) {
  if (!Number.isFinite(usagePct) || usagePct < 75) return 0;
  if (usagePct < 95) {
    const ratio = (usagePct - 75) / 20;
    return Math.round(100 + ratio * 1900);
  }
  const ratio = Math.min(1, (usagePct - 95) / 5);
  return Math.round(5000 + ratio * 55000);
}

class MetaRateLimiter {
  constructor() {
    /** @type {Map<string, Object>} */
    this.buckets = new Map();
    // Ad-account ids we have actually made requests for. Used to decide
    // whether a BUC bucket's scope id is "another account" (so it must not
    // apply here) or something unrecognised like a business id (so it should
    // apply broadly, erring toward more throttling rather than less).
    /** @type {Set<string>} */
    this._knownAccountIds = new Set();
  }

  /**
   * Read every usage header off one response.
   *
   * @param {Object} headers  plain object, lowercase keys
   * @param {Object} context  { tokenHash, accountId }
   */
  updateFromHeaders(headers, context = {}) {
    if (!headers) return;
    const now = Date.now();
    const get = (k) => headers[k] ?? headers[k.toLowerCase()];
    const tokenHash = context.tokenHash || "_";
    const accountId = context.accountId
      ? String(context.accountId).replace(/^act_/, "")
      : null;
    if (accountId) this._knownAccountIds.add(accountId);

    // ── x-app-usage ────────────────────────────────────────
    const app = safeParse(get("x-app-usage"));
    if (app) {
      this._write({
        kind: "app",
        key: bucketKey("app", tokenHash),
        callCount: app.call_count || 0,
        cpuTime: app.total_cputime || 0,
        totalTime: app.total_time || 0,
        regainMs: 0,
        updatedAt: now,
      });
    }

    // ── x-business-use-case-usage ──────────────────────────
    // Shape: { "<business_or_account_id>": [ { type, ...meters } ] } — one
    // entry per use-case type, each metered independently.
    const buc = safeParse(get("x-business-use-case-usage"));
    if (buc && typeof buc === "object") {
      for (const [bizId, entries] of Object.entries(buc)) {
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
          const type = e.type || "unknown";
          this._write({
            kind: "buc",
            key: bucketKey("buc", tokenHash, bizId, type),
            callCount: e.call_count || 0,
            cpuTime: e.total_cputime || 0,
            totalTime: e.total_time || 0,
            // Meta reports this in MINUTES.
            regainMs: (e.estimated_time_to_regain_access || 0) * 60 * 1000,
            tier: e.ads_api_access_tier,
            updatedAt: now,
          });
        }
      }
    }

    // ── x-fb-ads-insights-throttle ─────────────────────────
    // The one that usually bites an insights-heavy workload. Two independent
    // percentages: app-wide and account-scoped.
    const ins = safeParse(get("x-fb-ads-insights-throttle"));
    if (ins) {
      this._write({
        kind: "insights",
        key: bucketKey("insights", tokenHash, "app"),
        callCount: ins.app_id_util_pct || 0,
        cpuTime: 0,
        totalTime: 0,
        regainMs: 0,
        tier: ins.ads_api_access_tier,
        updatedAt: now,
      });
      if (accountId) {
        this._write({
          kind: "insights",
          key: bucketKey("insights", tokenHash, "acc", accountId),
          callCount: ins.acc_id_util_pct || 0,
          cpuTime: 0,
          totalTime: 0,
          regainMs: 0,
          tier: ins.ads_api_access_tier,
          updatedAt: now,
        });
      }
    }

    // ── x-ad-account-usage ─────────────────────────────────
    const acc = safeParse(get("x-ad-account-usage"));
    if (acc && accountId) {
      this._write({
        kind: "acc",
        key: bucketKey("acc", tokenHash, accountId),
        callCount: acc.acc_id_util_pct || 0,
        cpuTime: 0,
        totalTime: 0,
        // This one is SECONDS, unlike BUC's minutes.
        regainMs: (acc.reset_time_duration || 0) * 1000,
        tier: acc.ads_api_access_tier,
        updatedAt: now,
      });
    }

    // ── x-fb-ads-insights-reach-throttle ───────────────────
    const reach = safeParse(get("x-fb-ads-insights-reach-throttle"));
    if (reach && accountId) {
      this._write({
        kind: "reach",
        key: bucketKey("reach", tokenHash, accountId),
        callCount: reach.call_count || 0,
        cpuTime: 0,
        totalTime: 0,
        regainMs: (reach.reset_time_duration || 0) * 1000,
        updatedAt: now,
      });
    }
  }

  /**
   * Record a retry-after learned from an error body, for when headers lag.
   * Always account-scoped so one account's block never stalls its siblings.
   */
  markRetryAfter(context = {}, type = "unknown", retryAfterMs = 0) {
    const tokenHash = context.tokenHash || "_";
    const scope = context.accountId
      ? String(context.accountId).replace(/^act_/, "")
      : "_";
    this._write({
      kind: "local_retry",
      key: bucketKey("local_retry", tokenHash, scope, type),
      callCount: 0,
      cpuTime: 0,
      totalTime: 0,
      regainMs: retryAfterMs,
      updatedAt: Date.now(),
    });
  }

  /** How long to wait before the next request in this context, in ms. */
  getThrottleDelay(context = {}) {
    const now = Date.now();
    let maxDelay = 0;
    for (const b of this.buckets.values()) {
      if (now - b.updatedAt > BUCKET_TTL_MS) continue;
      if (!this._applies(b, context)) continue;

      // An explicit "regain access at" beats any heuristic — Meta has told us
      // the answer. Decay it by however long we've already waited.
      const explicit = Math.max(0, b.regainMs - (now - b.updatedAt));
      if (explicit > 0) {
        maxDelay = Math.max(maxDelay, explicit);
        continue;
      }
      const usage = Math.max(b.callCount, b.cpuTime, b.totalTime);
      maxDelay = Math.max(maxDelay, staircaseDelay(usage));
    }
    return maxDelay;
  }

  /** Sleep if any bucket says we should. */
  async waitIfNeeded(context = {}, logger = null) {
    const delay = this.getThrottleDelay(context);
    if (delay <= 0) return 0;
    if (logger && typeof logger.warn === "function") {
      logger.warn(
        `[meta rate] self-throttling ${delay}ms before request` +
          (context.accountId ? ` for ${context.accountId}` : ""),
      );
    }
    await new Promise((r) => setTimeout(r, delay));
    return delay;
  }

  /**
   * Every live bucket that applies to this context, worst first.
   *
   * `worstFor` alone hid the thing we most needed: when every meter reads 1%,
   * it names whichever bucket happens to win the tie and says nothing about
   * which buckets were even PRESENT. An app-level failure with all per-account
   * meters idle is exactly the case where "which headers did Meta actually
   * return" is the whole question — a missing `x-app-usage` looks identical to
   * a healthy one if you only print the maximum.
   */
  allFor(context = {}) {
    const now = Date.now();
    const out = [];
    for (const b of this.buckets.values()) {
      if (now - b.updatedAt > BUCKET_TTL_MS) continue;
      if (!this._applies(b, context)) continue;
      out.push({
        kind: b.kind,
        key: b.key,
        usage: Math.max(b.callCount, b.cpuTime, b.totalTime),
        callCount: b.callCount,
        cpuTime: b.cpuTime,
        totalTime: b.totalTime,
        blockedMs: Math.max(0, b.regainMs - (now - b.updatedAt)),
        tier: b.tier,
      });
    }
    return out.sort((a, b) => b.usage - a.usage);
  }

  /** Worst live bucket for a context — for logging and skip decisions. */
  worstFor(context = {}) {
    const now = Date.now();
    let worst = null;
    for (const b of this.buckets.values()) {
      if (now - b.updatedAt > BUCKET_TTL_MS) continue;
      if (!this._applies(b, context)) continue;
      const usage = Math.max(b.callCount, b.cpuTime, b.totalTime);
      const blocked = Math.max(0, b.regainMs - (now - b.updatedAt));
      if (!worst || usage > worst.usage || blocked > worst.blockedMs) {
        worst = {
          kind: b.kind,
          key: b.key,
          usage,
          callCount: b.callCount,
          cpuTime: b.cpuTime,
          totalTime: b.totalTime,
          blockedMs: blocked,
          tier: b.tier,
        };
      }
    }
    return worst;
  }

  snapshot() {
    return Array.from(this.buckets.values()).map((b) => ({ ...b }));
  }

  reset() {
    this.buckets.clear();
  }

  _write(bucket) {
    this.buckets.set(bucket.key, bucket);
  }

  _applies(bucket, context) {
    const tokenHash = context.tokenHash || "_";
    const accountId = context.accountId
      ? String(context.accountId).replace(/^act_/, "")
      : null;
    if (!bucket.key.includes(tokenHash)) return false;

    if (bucket.kind === "acc" || bucket.kind === "reach") {
      return !!accountId && bucket.key.endsWith(`:${accountId}`);
    }
    if (bucket.kind === "insights") {
      // `:app` applies to every request on this token; `:acc:<id>` only to
      // requests against that account.
      if (bucket.key.endsWith(":app")) return true;
      return !!accountId && bucket.key.endsWith(`:${accountId}`);
    }
    if (bucket.kind === "local_retry") {
      const scope = accountId || "_";
      return bucket.key.startsWith(
        bucketKey("local_retry", tokenHash, scope) + ":",
      );
    }
    if (bucket.kind === "buc") {
      // BUC buckets are keyed `buc:<token>:<id>:<type>`, where `<id>` is
      // whatever Meta put in the header — for ad-account calls that is the ad
      // account id. Treating them as token-wide (which the upstream MCP does)
      // means one account's usage throttles every sibling, and every account's
      // log line repeats every bucket seen so far. Both are wrong, and the
      // second is how it was noticed.
      //
      // But we cannot assume the key IS an ad account id — Meta documents it
      // as a business id, and if it ever is one, scoping strictly would match
      // nothing and silently disable BUC throttling altogether. So: when the
      // bucket names THIS account, it applies; when it names some OTHER
      // account we know about, it does not; when it names something we can't
      // place, fall back to applying broadly, which is the safe direction.
      if (!accountId) return true;
      const parts = bucket.key.split(":");
      const scopeId = parts.length >= 4 ? parts[2] : null;
      if (!scopeId) return true;
      if (scopeId === accountId) return true;
      return !this._knownAccountIds.has(scopeId);
    }
    // app is genuinely token-wide.
    return true;
  }
}

/** Short, non-reversible token identifier for bucket keys. */
function hashToken(token) {
  if (!token) return "_";
  let h = 0;
  for (let i = 0; i < token.length; i += 1) {
    h = (h * 31 + token.charCodeAt(i)) | 0;
  }
  return `t${(h >>> 0).toString(36)}`;
}

/** Process-wide instance — buckets must persist across audits to be useful. */
const sharedRateLimiter = new MetaRateLimiter();

function formatWorst(worst) {
  if (!worst) return "usage unknown";
  const parts = [`${worst.kind} ${worst.usage}%`];
  if (worst.cpuTime) parts.push(`cpu ${worst.cpuTime}%`);
  if (worst.callCount) parts.push(`calls ${worst.callCount}%`);
  if (worst.totalTime) parts.push(`time ${worst.totalTime}%`);
  if (worst.blockedMs > 0) {
    parts.push(`BLOCKED ${Math.ceil(worst.blockedMs / 60000)}min`);
  }
  if (worst.tier) parts.push(worst.tier);
  return parts.join(" · ");
}

/**
 * Every bucket on one line, plus an explicit note for the ones Meta did NOT
 * return.
 *
 * The absence matters as much as the values. "Application request limit
 * reached" is an APP-LEVEL failure (error code 4), so if `x-app-usage` never
 * arrives on Marketing API responses we are blind to the only meter that
 * could have predicted it — and that blindness must be visible in the log
 * rather than inferred from a suspiciously tidy set of 1%s.
 */
const EXPECTED_KINDS = ["app", "buc", "insights", "acc"];

function formatAll(buckets) {
  if (!buckets || buckets.length === 0) return "no usage headers seen";
  const shown = buckets
    .map((b) => {
      const meters = [];
      if (b.cpuTime) meters.push(`cpu ${b.cpuTime}%`);
      if (b.callCount) meters.push(`calls ${b.callCount}%`);
      if (b.totalTime) meters.push(`time ${b.totalTime}%`);
      const detail = meters.length ? ` (${meters.join(" ")})` : "";
      const blocked =
        b.blockedMs > 0 ? ` BLOCKED ${Math.ceil(b.blockedMs / 60000)}min` : "";
      // `insights:...:app` vs `:acc:<id>` is a meaningful distinction.
      const scope = b.key.endsWith(":app") ? ":app" : "";
      return `${b.kind}${scope} ${b.usage}%${detail}${blocked}`;
    })
    .join(" | ");
  const seen = new Set(buckets.map((b) => b.kind));
  const missing = EXPECTED_KINDS.filter((k) => !seen.has(k));
  return shown + (missing.length ? ` | absent: ${missing.join(",")}` : "");
}

module.exports = {
  MetaRateLimiter,
  sharedRateLimiter,
  hashToken,
  staircaseDelay,
  bucketKey,
  formatWorst,
  formatAll,
  DAY_MS,
  BUCKET_TTL_MS,
};
