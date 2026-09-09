/**
 * runTimelineSerializer — `runHistory[]` → the delivery timeline.
 *
 * PURE. No DB, no SDK, no network.
 *
 * This is what replaces the canvas as Quick setup's monitoring surface. The
 * data was always the right shape for it: `runHistory[]` is an append-only log
 * carrying per-run status, the creatives produced, the ad ids created, the
 * per-platform context needed to deep-link into Meta or Google, and the error
 * string when something failed. The v1 canvas could only turn a node red.
 *
 * Additive by design
 * ------------------
 * This does NOT change `getRunHistory` or `getJobActivity`. Both are consumed
 * by v1's AutomationHistoryPanel and PublishedAdsModal, and reshaping either
 * would break Full control — which is a permanently supported mode, not legacy.
 * The timeline gets its own endpoint reading the same documents.
 *
 * Ordering: newest first, with the next scheduled run projected on top so the
 * answer to "when does this happen again" is the first thing on screen.
 */

// Meta and Google both accept a deep link into their manager UI scoped to a
// specific entity. Same URL shape AutopilotActionLog already uses.
const META_ADS_MANAGER = "https://adsmanager.facebook.com/adsmanager/manage/";
const GOOGLE_ADS = "https://ads.google.com/aw/ads";

// ─── What a failed cycle says to the person who scheduled it ────────────────
//
// `runHistory[].error` is an engineering string: it names the service that
// refused ("Python API rejected"), the HTTP status it refused with, or the
// field a payload was missing. That is exactly right in a log, and useless on
// the timeline — "Request failed with status code 422" tells the user neither
// what broke nor whether they can do anything about it.
//
// So each raw error is matched to a sentence that says what happened and what
// to do next, and the original is kept alongside as `errorDetail` for support
// and for anyone reading the API directly. Nothing is thrown away; only what
// leads is different.
//
// Order matters — the first match wins, so the specific patterns come before
// the general ones. An unmatched error falls through to a generic sentence
// rather than leaking the raw text, because the raw text is the thing this
// exists to stop showing.
const ERROR_MESSAGES = [
  // The image/copy generator. Two flavours worth separating: a 4xx means the
  // brief it was handed was rejected, a 5xx/timeout means the service itself
  // is unwell, and only one of those is worth the user retrying immediately.
  // 408 and 429 are 4xx but say "try again", not "your brief is wrong", so they
  // fall through to the softer sentence below.
  {
    match: /python api rejected.*\b4(?!08\b|29\b)\d{2}\b/i,
    text: "We couldn't generate the creatives for this cycle — the brief was turned down by our image service. Check the brand details and prompt on this brief, then retry.",
  },
  {
    match: /python api rejected|generation timed out|campaign generation failed/i,
    text: "Our creative generator didn't finish this cycle. Nothing was charged for the ads it didn't make — retry when you're ready.",
  },
  { match: /no valid creatives/i, text: "This cycle produced no usable images, so there was nothing to post. Retry to generate a fresh set." },

  // Money and limits — the user CAN act on these, and the action is specific.
  { match: /insufficient credits/i, text: "Not enough credits to run this cycle. Top up and retry, and we'll pick up where this left off." },
  { match: /credit freeze failed/i, text: "We couldn't hold the credits for this cycle, so it didn't run. Check your balance and retry." },
  { match: /campaign limit|limit reached/i, text: "Your ad account has hit a campaign limit, so this cycle couldn't create anything. Clear some space in the account, then retry." },

  // The connection. Almost always an expired token or a revoked app.
  {
    match: /access token|no facebook account linked|oauth|unauthor/i,
    text: "We've lost access to your ad account. Reconnect it in this brief's launch panel, then retry.",
  },

  // A misconfigured destination. The launch panel is where every one of these
  // is fixed, so all three point at the same place.
  {
    match: /template payload is missing|no template configured|missing finalurl|missing adaccountid/i,
    text: "This brief's publishing setup is incomplete. Open the launch panel, re-pick the account, campaign and destination, then retry.",
  },
  { match: /did not return a created ad id|did not return a campaignid|did not return an adgroupid/i, text: "The ad platform accepted the request but didn't confirm what it created. Check the ad account before retrying, so nothing gets posted twice." },
  { match: /requires at least \d+ unique (headlines|descriptions)/i, text: "The copy for this cycle was too short for the ad format. Retry to generate a longer set." },
  { match: /destination.*not.*(reach|work)/i, text: "The destination URL on this brief isn't reachable, and the ad platform refuses ads that point at it. Check the link, then retry." },
];

const GENERIC_ERROR =
  "This cycle didn't finish. Retry it, and if it keeps failing our team can look at the details.";

/**
 * The sentence a failed cycle shows. `null` in, `null` out — a run that did not
 * fail has nothing to say.
 */
function friendlyRunError(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  const hit = ERROR_MESSAGES.find((e) => e.match.test(text));
  return hit ? hit.text : GENERIC_ERROR;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v);

// Mongo Maps deserialise as Map, plain object, or array-of-pairs depending on
// whether the document came through .lean(). Normalise all three.
function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (Array.isArray(value)) return Object.fromEntries(value);
  if (typeof value === "object") return { ...value };
  return {};
}

/**
 * Deep link into Meta Ads Manager for the ad this run created.
 * Needs both the ad account and the entity — without either, no link (a
 * half-built URL lands the user on an empty manager view, which is worse than
 * no link at all).
 */
function metaAdLink(adAccountId, adId) {
  if (!adAccountId || !adId) return null;
  const acct = String(adAccountId).replace(/^act_/, "");
  return `${META_ADS_MANAGER}?act=${acct}&selected_ad_ids=${adId}`;
}

function googleAdLink(customerId) {
  if (!customerId) return null;
  return `${GOOGLE_ADS}?__e=${String(customerId).replace(/-/g, "")}`;
}

/**
 * One run → one timeline row.
 */
function serializeRun(run, index, context = {}) {
  const r = plain(run) || {};
  const creatives = arr(r.automationCreatives).map(plain);
  const platformAdIds = mapToObject(r.platformAdIds);
  const platformContext = plain(r.platformContext) || {};

  // How many ads actually went live this run. Prefer the per-creative
  // `postedAdIds` — it's the only source that survives a partial run
  // accurately, since `metaAdId` records just one.
  const postedPerCreative = creatives.map((c) => Object.keys(mapToObject(c.postedAdIds)).length);
  const liveCount =
    postedPerCreative.reduce((sum, n) => sum + n, 0) ||
    [r.metaAdId, r.googleAdId, ...Object.values(platformAdIds)].filter(Boolean).length;

  // A creative that produced no ad id on a run that otherwise succeeded is a
  // partial failure. Surfacing the count is what stops a half-failed run
  // looking like the plan.
  const failedCount =
    r.status === "partial"
      ? postedPerCreative.filter((n) => n === 0).length || 1
      : r.status === "failed"
        ? Math.max(1, creatives.length)
        : 0;

  const links = [];
  const metaLink = metaAdLink(context.metaAdAccountId, r.metaAdId);
  if (metaLink) links.push({ platform: "meta", label: "View on Meta", url: metaLink });
  const googleLink = googleAdLink(context.googleCustomerId);
  if (r.googleAdId && googleLink) {
    links.push({ platform: "google", label: "View on Google", url: googleLink });
  }

  return {
    runId: r.runId || `run-${index}`,
    // Cycle numbers count from the oldest run, so a given cycle keeps its
    // number as new ones arrive on top.
    cycle: context.cycleNumber ?? null,
    status: r.status || "failed",
    startedAt: r.startedAt || null,
    completedAt: r.completedAt || null,
    liveCount,
    failedCount,
    // What the user reads, and — unchanged — what an engineer needs.
    error: friendlyRunError(r.error),
    errorDetail: r.error || null,
    creatives: creatives.map((c) => {
      const postedAdIds = mapToObject(c.postedAdIds);
      return {
        creativeId: c.creativeId,
        imageUrl: c.imageUrl || "",
        headline: c.headline || c.platformText?.google?.headline || c.platformText?.meta?.headline || c.title || "",
        message: c.message || c.platformText?.google?.message || c.platformText?.meta?.message || c.body || c.description || "",
        platform: c.platform || "",
        postedAdIds,
        // Per-ad outcome and deep links, so a published-ads view can show WHICH
        // creative went live rather than a run-level count. The run-level
        // `links` above are built from `metaAdId`, which records only ONE ad —
        // on a 3-pair run it deep-links to the first and says nothing about the
        // rest, and on a partial run it cannot show which one failed.
        posted: Object.keys(postedAdIds).length > 0,
        adLinks: Object.entries(postedAdIds)
          .map(([platform, adId]) => {
            const url =
              platform === "meta"
                ? metaAdLink(context.metaAdAccountId, adId)
                : platform === "google"
                  ? googleAdLink(context.googleCustomerId)
                  : null;
            return url ? { platform, adId: String(adId), url } : null;
          })
          .filter(Boolean),
      };
    }),
    links,
    platformContext,
    scheduled: false,
  };
}

/**
 * Build the full timeline for a job.
 *
 * @param {object} job     an AdsFactoryJob document (lean or hydrated)
 * @param {object} [opts]
 * @param {number} [opts.limit]  cap the number of completed runs returned
 * @returns {{ rows: object[], summary: object }}
 */
function serializeRunTimeline(job, opts = {}) {
  const j = plain(job) || {};
  const history = arr(j.runHistory).map(plain);
  const schedule = plain(j.schedule) || {};

  const metaTarget = plain(j.targets?.meta) || {};
  const googleTarget = plain(j.targets?.google) || {};
  const metaTemplate = plain(metaTarget.template) || {};
  const context = {
    // `adAccountId` lives at template.payload.adAccountId when the user picked
    // a saved template, and directly at template.adAccountId on the synthesize
    // path (briefToJobPayload.js line 307). Check both so links always work.
    metaAdAccountId:
      metaTemplate?.payload?.adAccountId ||
      metaTemplate?.adAccountId ||
      null,
    googleCustomerId:
      plain(googleTarget.template)?.customerId ||
      plain(googleTarget.template)?.payload?.customerId ||
      null,
  };

  // Cycle numbers are assigned oldest-first so they stay stable, then the list
  // is reversed for display.
  const numbered = history.map((run, i) =>
    serializeRun(run, i, { ...context, cycleNumber: i + 1 }),
  );

  const rows = numbered.slice().reverse();

  // Project the next run on top. `nextRunAt` is maintained by the orchestrator;
  // an active job without one is between schedules, so nothing is invented.
  const isActive = j.status === "active";
  if (isActive && schedule.nextRunAt) {
    rows.unshift({
      runId: "scheduled-next",
      cycle: numbered.length + 1,
      status: "scheduled",
      startedAt: schedule.nextRunAt,
      completedAt: null,
      liveCount: 0,
      failedCount: 0,
      error: null,
      creatives: [],
      links: [],
      platformContext: {},
      scheduled: true,
    });
  }

  const limit = Number(opts.limit);
  const capped = Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows;

  const totalRuns = Number(j.totalRuns) || history.length;
  const failedRuns = Number(j.failedRuns) || 0;

  return {
    rows: capped,
    summary: {
      status: j.status || "unknown",
      totalRuns,
      failedRuns,
      successfulRuns: Math.max(0, totalRuns - failedRuns),
      // Every ad this job has ever put live, across all runs.
      adsPublished: numbered.reduce((sum, row) => sum + row.liveCount, 0),
      frequency: schedule.frequency || null,
      hour: Number.isInteger(schedule.hour) ? schedule.hour : null,
      timezone: schedule.timezone || null,
      nextRunAt: isActive ? schedule.nextRunAt || null : null,
      lastRunAt: schedule.lastRunAt || null,
      pairsPerCycle: Number(j.pairsPerCycle) || null,
    },
  };
}

module.exports = {
  serializeRunTimeline,
  friendlyRunError,
  _internals: { serializeRun, metaAdLink, googleAdLink, mapToObject, ERROR_MESSAGES },
};
