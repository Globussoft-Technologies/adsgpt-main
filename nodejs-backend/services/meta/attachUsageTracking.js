/**
 * attachUsageTracking — make every Meta SDK call report what it cost, without
 * editing the places that make them.
 *
 * WHY A GLOBAL INSTALL RATHER THAN PER CALL SITE. The obvious plan was to
 * wrap the shared `initApiForUser` helper. It does not work: 47 call sites
 * across 12 files call `FacebookAdsApi.init(accessToken)` again immediately
 * afterwards and use THAT instance, discarding the wrapped one. Wiring the
 * helper would have produced a plausible-looking feature that recorded almost
 * nothing, and the gap would have shown up as "those accounts are cheap"
 * rather than as an error.
 *
 * So the wrap goes on `FacebookAdsApi.init` itself, once, at startup. Every
 * instance is born tracked — including the ones added next year by someone
 * who has never read this file. That property is the entire point; a
 * telemetry system you have to remember to opt into measures the code you
 * remembered about.
 *
 * WHERE THE ATTRIBUTION COMES FROM. Three sources, none of them a parameter:
 *   - the AD ACCOUNT from the request path (`act_<id>` is in every
 *     account-scoped call, as a path segment or inside a paging URL)
 *   - the USER and FEATURE from async-local context (see metaUsageContext)
 *   - everything else from the response headers Meta already sends
 *
 * OBSERVATION ONLY, BY DEFAULT. `throttle` is off unless the context asks for
 * it. Interactive requests have someone waiting on them, and making a
 * dashboard sleep because a cron ran hot is a product decision rather than a
 * telemetry one. The meters are still fed to the shared limiter either way,
 * so Autopilot — which DOES wait — now backs off knowing what the rest of the
 * product spent, instead of seeing only its own traffic.
 */
const {
  sharedRateLimiter,
  hashToken,
} = require("../autopilot/metaRateLimiter");
const { sharedUsageRecorder } = require("./metaUsageRecorder");
const { classifyMetaError } = require("../autopilot/metaRetry");
const { currentUsageContext } = require("./metaUsageContext");

// Marks an instance as wrapped, so a belt-and-braces explicit call after the
// global install cannot double-count.
const WRAPPED = Symbol.for("adsgpt.metaUsageTracking.wrapped");

// Marks an instance whose owner does its own accounting. Checked at CALL time
// rather than wrap time, because the opt-out is necessarily set after
// `init()` has already returned a wrapped instance.
const OPT_OUT = Symbol.for("adsgpt.metaUsageTracking.optOut");

const INSTALLED = Symbol.for("adsgpt.metaUsageTracking.installed");

function trackingEnabled() {
  return String(process.env.META_USAGE_TRACKING || "on").toLowerCase() !== "off";
}

/**
 * Pull `act_<id>` out of whatever the SDK was handed as a path.
 *
 * Returns null for calls that are not account-scoped (`/me/accounts`, a page
 * lookup). Those still count toward the app-level bucket, so they are
 * recorded with a null account rather than dropped — an uncounted call is
 * worse than an unattributed one, because then the totals stop reconciling.
 */
function extractAccountId(path) {
  if (!path) return null;
  const asString = Array.isArray(path) ? path.join("/") : String(path);
  const m = asString.match(/act_(\d+)/);
  return m ? m[1] : null;
}

/**
 * Declare that this api instance is accounted for elsewhere.
 *
 * `metaAuditService` wraps `api.call` itself, because it needs the limiter's
 * pre-flight delay and its own header handling. Letting the global wrapper
 * also run would double every count AND consume `response.headers` before the
 * audit's wrapper could read them — silently disabling its self-throttling.
 */
function optOutOfGlobalTracking(api) {
  if (api) api[OPT_OUT] = true;
  return api;
}

/**
 * Wrap one api instance in place.
 *
 * `userId` / `source` / `throttle` are resolved PER CALL rather than captured
 * here: one instance is frequently reused across requests, and binding the
 * first caller's identity to all of them would misattribute the rest.
 */
function attachUsageTracking(api, { accessToken, logger = null } = {}) {
  if (!api || typeof api.call !== "function") return api;
  if (api[WRAPPED]) return api;

  const tokenHash = accessToken ? hashToken(accessToken) : "_";
  api[WRAPPED] = true;
  try {
    api.setShowHeader(true);
  } catch {
    // An SDK without the toggle still yields call counts, just no meters.
  }

  const originalCall = api.call.bind(api);

  api.call = async (...args) => {
    if (api[OPT_OUT]) return originalCall(...args);

    const [, path] = args;
    const accountId = extractAccountId(path);
    const { userId = null, source, throttle = false } = currentUsageContext();

    // Rebuilt per call because one instance serves many accounts.
    const limiterCtx = { tokenHash, accountId };
    const usageCtx = {
      userId,
      adAccountId: accountId,
      source: source || "unknown",
    };

    if (throttle) {
      try {
        await sharedRateLimiter.waitIfNeeded(limiterCtx, logger);
      } catch {
        /* a limiter fault must not block a real request */
      }
    }

    sharedUsageRecorder.recordCall(usageCtx);

    let response;
    try {
      response = await originalCall(...args);
    } catch (err) {
      let throttled = false;
      try {
        throttled = classifyMetaError(err).kind === "rate-limit";
      } catch {
        /* classification is a nicety; never let it mask the real error */
      }
      sharedUsageRecorder.recordFailure(usageCtx, { throttled });
      throw err; // unchanged — this wrapper observes, it does not intervene
    }

    if (response && typeof response === "object" && response.headers) {
      try {
        sharedRateLimiter.updateFromHeaders(response.headers, limiterCtx);
        sharedUsageRecorder.recordHeaders(
          usageCtx,
          sharedRateLimiter.allFor(limiterCtx),
        );
      } catch {
        /* telemetry must never break the response */
      }
      // Restore the exact shape callers had before `setShowHeader(true)`.
      delete response.headers;
    }
    return response;
  };

  return api;
}

/**
 * Patch `FacebookAdsApi.init` so every instance it returns is tracked.
 *
 * Call once, at startup, before any Meta traffic. Idempotent, and a no-op
 * when tracking is switched off — with the flag off nothing is wrapped at
 * all, so `setShowHeader` is never turned on either and the SDK behaves
 * exactly as it did before this file existed.
 *
 * @returns {boolean} whether the patch was applied
 */
function installGlobalUsageTracking(bizSdk, { logger = null } = {}) {
  if (!trackingEnabled()) return false;
  const FacebookAdsApi = bizSdk && bizSdk.FacebookAdsApi;
  if (!FacebookAdsApi || typeof FacebookAdsApi.init !== "function") return false;
  if (FacebookAdsApi[INSTALLED]) return false;

  const originalInit = FacebookAdsApi.init.bind(FacebookAdsApi);
  FacebookAdsApi.init = function trackedInit(accessToken, ...rest) {
    const api = originalInit(accessToken, ...rest);
    try {
      attachUsageTracking(api, { accessToken, logger });
    } catch {
      // A failure to instrument must never stop an api from being created.
    }
    return api;
  };
  FacebookAdsApi[INSTALLED] = true;
  return true;
}

module.exports = {
  attachUsageTracking,
  installGlobalUsageTracking,
  optOutOfGlobalTracking,
  _internals: { extractAccountId, WRAPPED, OPT_OUT, INSTALLED },
};
