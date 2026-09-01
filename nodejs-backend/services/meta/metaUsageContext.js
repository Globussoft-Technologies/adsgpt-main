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

function matchPrefix(urlPath) {
  for (const prefix of SORTED_PREFIXES) {
    if (urlPath === prefix || urlPath.startsWith(`${prefix}/`)) {
      return ROUTE_SOURCES[prefix];
    }
  }
  return null;
}

/**
 * Map a request path to the product surface that owns it.
 *
 * THE MOUNT PREFIX IS WHY THIS RETRIES. The whole router is mounted at
 * `/adsgpt` (index.js), so `req.originalUrl` reads `/adsgpt/meta-ads/...` and
 * a naive prefix test against `/meta-ads` matches nothing — which is exactly
 * what happened: every request in the first deploy was labelled "http".
 * Callers pass `req.url`, which Express has already made mount-relative, but
 * dropping one leading segment and retrying makes this correct under either
 * value and under a future mount point nobody remembered to update here.
 */
function sourceForPath(urlPath) {
  if (!urlPath) return "http";
  // Query strings and hashes are not part of the routing decision.
  const clean = String(urlPath).split(/[?#]/)[0];

  const direct = matchPrefix(clean);
  if (direct) return direct;

  // Retry once without the mount segment: "/adsgpt/meta-ads/x" → "/meta-ads/x".
  const withoutMount = clean.replace(/^\/[^/]+/, "");
  if (withoutMount && withoutMount !== clean) {
    const nested = matchPrefix(withoutMount);
    if (nested) return nested;
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

/**
 * The context for the currently-running operation, or an empty object.
 *
 * THE USER IS RESOLVED HERE, NOT AT MIDDLEWARE TIME. This middleware is
 * mounted before the routes, and the routes are what apply `authenticateJWT`
 * — so `req.user` does not exist yet when the context is created. Reading it
 * eagerly is why the first deploy recorded every request with a null user.
 * Holding the request and reading `req.user` at CALL time works because a
 * Meta call always happens after the route's auth has run.
 */
function currentUsageContext() {
  const store = storage.getStore();
  if (!store) return {};
  if (store.userId) return store;

  const req = store.req;
  if (!req) return store;
  const userId = req.user?.user_id || req.user?.userId || null;
  // Cache it: auth cannot change mid-request, and a request can make
  // hundreds of Meta calls.
  if (userId) store.userId = userId;
  return store;
}

/**
 * Express middleware: label every request with its user and product surface.
 *
 * Mounted once, before the routes. Reads `req.user.user_id` where an auth
 * middleware has already run and tolerates its absence — an unauthenticated
 * or partner request is still traffic worth counting.
 */
function metaUsageContextMiddleware(req, _res, next) {
  let ctx;
  try {
    ctx = {
      // Deliberately null here — resolved from `req` on first read, once the
      // route's auth middleware has actually run. See currentUsageContext.
      userId: null,
      req,
      // `req.url` is mount-relative; sourceForPath also copes with the full
      // `/adsgpt/...` form in case a caller passes originalUrl.
      source: sourceForPath(req.url || req.originalUrl),
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
