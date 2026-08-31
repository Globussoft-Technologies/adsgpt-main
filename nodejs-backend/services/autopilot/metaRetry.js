/**
 * metaRetry — decide whether a failed Meta call is worth trying again, and do
 * it once if so.
 *
 * WHY RETRYING IS SAFE HERE. Every write the cron makes is IDEMPOTENT: pause
 * sets `status: "PAUSED"`, resume sets `"ACTIVE"`, and scaling sets an
 * ABSOLUTE `daily_budget` rather than a delta. Setting any of them twice is
 * indistinguishable from setting it once, so a retry cannot double-apply even
 * when the first attempt actually succeeded and only its response was lost.
 * That is what makes this a small helper instead of an idempotency-key system.
 * If a delta-based action is ever added, this assumption breaks and the caller
 * must not use `withRetry`.
 *
 * THREE OUTCOMES, NOT TWO. The important distinction is not
 * retryable/permanent but:
 *
 *   transient  — a blip. Retry immediately; the next attempt usually works.
 *   rate-limit — Meta is refusing on purpose, typically for MINUTES. Retrying
 *                inside a cron tick would just burn the tick sleeping, and
 *                sleeping is exactly what we must not do while holding the
 *                run lock. Record the wait so the limiter defers subsequent
 *                calls, fail this item, and let the next cycle pick it up.
 *   permanent  — invalid parameter, missing object, bad token. A retry is a
 *                second guaranteed failure plus a second entry in the rate
 *                budget.
 *
 * Conflating the last two is the common mistake: it turns one refused call
 * into several, which is how a throttle becomes a longer throttle.
 */

// Meta error codes that mean "try again shortly".
const TRANSIENT_CODES = new Set([
  1, // unknown / transient internal error
  2, // service temporarily unavailable
]);

// Meta error codes that mean "you are being throttled". These carry their own
// timing and must not be retried inline.
const RATE_LIMIT_CODES = new Set([
  4, // application request limit reached
  17, // user request limit reached
  32, // page-level throttle
  341, // feature temporarily blocked (often rate related)
  613, // calls to this api have exceeded the rate limit
  80000, 80001, 80002, 80003, 80004, 80005, 80006, // BUC per-product limits
]);

// Node/network level failures — never Meta's verdict, always worth one retry.
const TRANSIENT_NETWORK = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

/**
 * Pull Meta's error fields out of an SDK error.
 *
 * The facebook-nodejs-business-sdk flattens the response body straight onto
 * `err.response` — NOT `err.response.error`, which is where you would look by
 * habit and find nothing.
 */
function metaErrorParts(err) {
  const r = (err && err.response) || {};
  const nested = r.error || {};
  return {
    code: r.code ?? nested.code,
    subcode: r.error_subcode ?? nested.error_subcode,
    status: err?.status ?? err?.statusCode ?? r.status,
    // Present on some throttle responses; in MINUTES like the BUC header.
    regainMinutes:
      r.estimated_time_to_regain_access ??
      nested.estimated_time_to_regain_access,
    message: r.error_user_msg || nested.message || err?.message || "",
  };
}

/**
 * @returns {{kind: 'transient'|'rate-limit'|'permanent', retryable: boolean,
 *            retryAfterMs: number, code: any, reason: string}}
 */
function classifyMetaError(err) {
  const { code, subcode, status, regainMinutes, message } = metaErrorParts(err);

  const netCode = err?.code;
  if (typeof netCode === "string" && TRANSIENT_NETWORK.has(netCode)) {
    return {
      kind: "transient",
      retryable: true,
      retryAfterMs: 0,
      code: netCode,
      reason: `network ${netCode}`,
    };
  }
  if (/socket hang up|ECONNRESET|network timeout/i.test(message || "")) {
    return {
      kind: "transient",
      retryable: true,
      retryAfterMs: 0,
      code: netCode || null,
      reason: "network error",
    };
  }

  const numeric = Number(code);
  if (RATE_LIMIT_CODES.has(numeric)) {
    return {
      kind: "rate-limit",
      retryable: false, // not inline — see the module header
      retryAfterMs: Number(regainMinutes) > 0 ? regainMinutes * 60 * 1000 : 0,
      code: numeric,
      reason: `rate limit (code ${numeric}${subcode ? `/${subcode}` : ""})`,
    };
  }
  if (TRANSIENT_CODES.has(numeric)) {
    return {
      kind: "transient",
      retryable: true,
      retryAfterMs: 0,
      code: numeric,
      reason: `transient Meta error (code ${numeric})`,
    };
  }
  // 5xx is Meta's problem, not the payload's.
  if (Number(status) >= 500 && Number(status) < 600) {
    return {
      kind: "transient",
      retryable: true,
      retryAfterMs: 0,
      code: numeric ?? status,
      reason: `HTTP ${status}`,
    };
  }

  return {
    kind: "permanent",
    retryable: false,
    retryAfterMs: 0,
    code: numeric ?? null,
    reason: `permanent (code ${numeric ?? "n/a"}${subcode ? `/${subcode}` : ""})`,
  };
}

/**
 * Run `fn`, retrying once on a transient failure.
 *
 * Deliberately ONE retry, not an escalating ladder: inside a cron tick the
 * choice is between "this blip resolves in a second" and "this needs a later
 * cycle". Anything that survives one immediate retry is the second case, and
 * the next tick re-evaluates it anyway — every failure path leaves the
 * precondition intact, so nothing is lost by waiting.
 *
 * `onRateLimit(retryAfterMs, classification)` lets the caller feed Meta's
 * stated wait into the rate limiter; without it a throttle reported in an
 * error body (rather than a header) would be invisible.
 *
 * @param {Function} fn                 the call to make
 * @param {Object}   [opts]
 * @param {number}   [opts.attempts=2]  total attempts including the first
 * @param {number}   [opts.delayMs=800] pause before the retry
 * @param {Function} [opts.onRetry]     (err, classification, attempt) => void
 * @param {Function} [opts.onRateLimit] (retryAfterMs, classification) => void
 */
async function withRetry(fn, opts = {}) {
  const {
    attempts = 2,
    delayMs = 800,
    onRetry = null,
    onRateLimit = null,
  } = opts;

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const cls = classifyMetaError(err);

      if (cls.kind === "rate-limit") {
        if (onRateLimit) onRateLimit(cls.retryAfterMs, cls);
        throw err; // never retry a deliberate refusal inline
      }
      if (!cls.retryable || attempt >= attempts) throw err;

      if (onRetry) onRetry(err, cls, attempt);
      // Small jitter so a whole account's worth of simultaneous failures
      // doesn't retry in lockstep and recreate the burst that caused them.
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delayMs + jitter));
    }
  }
  throw lastErr;
}

module.exports = {
  withRetry,
  classifyMetaError,
  _internals: {
    metaErrorParts,
    TRANSIENT_CODES,
    RATE_LIMIT_CODES,
    TRANSIENT_NETWORK,
  },
};
