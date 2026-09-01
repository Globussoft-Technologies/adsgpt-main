/**
 * metaUsageContext — carry "whose traffic is this" down to the Meta SDK
 * without threading a parameter through every call site.
 *
 * WHY ASYNC-LOCAL STORAGE AND NOT A PARAMETER. The ad account a request
 * touches is recoverable from the call path, but the USER and the FEATURE are
 * not — nothing in `GET /act_123/insights` says whether an admin, a cron, or
 * a customer's dashboard asked for it. Passing that down would mean editing
 * 47 call sites across 12 files and then editing the 48th when someone adds
 * it, and a missed one attributes its traffic to nobody, silently.
 *
 * `AsyncLocalStorage` propagates through every `await` in the same logical
 * operation, so one `run()` at the edge — an Express middleware, a cron tick
 * — covers everything downstream including code written later.
 *
 * WHAT HAPPENS WITHOUT A CONTEXT. Nothing breaks. Calls are recorded with a
 * null user and source "unknown". That is the deliberate choice: an
 * unattributed call still counts toward the account's total, and totals that
 * reconcile are worth more than totals that are tidy.
 */
const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();

// Route prefix → the name the admin page shows. Ordered longest-first at
// match time so `/partner-api/v1/meta-ads` is not swallowed by `/meta-ads`.
//
// These are product surfaces, not modules: the question the page has to
// answer is "was this a scheduled job or a person clicking", and that split
// is what the names encode.
const ROUTE_SOURCES = {
  "/meta-ads/autopilot": "autopilot",
  "/partner-api/v1/meta-ads": "partner-api",
  "/ads-factory/autopilot": "ad-factory",
  "/ad-factory": "ad-factory",
  "/meta-ads": "ads-manager",
  "/ad-posting": "ad-posting",
  "/campaign": "ad-posting",
  "/admin": "admin",
};

const SORTED_PREFIXES = Object.keys(ROUTE_SOURCES).sort(
  (a, b) => b.length - a.length,
);

function sourceForPath(urlPath) {
  if (!urlPath) return "http";
  for (const prefix of SORTED_PREFIXES) {
    if (urlPath === prefix || urlPath.startsWith(`${prefix}/`)) {
      return ROUTE_SOURCES[prefix];
    }
  }
  return "http";
}

/**
 * Run `fn` with a usage context attached to it and everything it awaits.
 *
 * @param {Object}   ctx           { userId, source, throttle }
 * @param {Function} fn
 */
function runWithUsageContext(ctx, fn) {
  return storage.run({ ...ctx }, fn);
}

/** The context for the currently-running operation, or an empty object. */
function currentUsageContext() {
  return storage.getStore() || {};
}

/**
 * Express middleware: label every request with its user and product surface.
 *
 * Mounted once, before the routes. Reads `req.user.user_id` where an auth
 * middleware has already run and tolerates its absence — an unauthenticated
 * or partner request is still traffic worth counting.
 */
function metaUsageContextMiddleware(req, res, next) {
  let ctx;
  try {
    ctx = {
      userId: req.user?.user_id || req.user?.userId || null,
      source: sourceForPath(req.originalUrl || req.url),
      // Interactive requests are never made to wait on a rate-limit bucket;
      // see attachUsageTracking. Someone is watching a spinner.
      throttle: false,
    };
  } catch {
    ctx = { userId: null, source: "http", throttle: false };
  }
  return runWithUsageContext(ctx, () => next());
}

module.exports = {
  runWithUsageContext,
  currentUsageContext,
  metaUsageContextMiddleware,
  _internals: { sourceForPath, ROUTE_SOURCES },
};
