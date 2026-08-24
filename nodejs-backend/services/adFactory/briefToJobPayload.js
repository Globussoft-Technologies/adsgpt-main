/**
 * briefToJobPayload — brief → the body of `POST /ads-factory/autopilot/jobs`.
 *
 * PURE. No DB, no SDK, no network.
 *
 * This is the seam between Ad Factory 2.0's input model and the automation
 * engine that already works. The engine is unchanged: the same
 * `AdsFactoryJob` document, the same orchestrator, the same queue. A job
 * created from a brief must be indistinguishable from one created by the v1
 * schedule form, which is what keeps pause / resume / run-now / history working
 * for both front doors from day one.
 *
 * The template is emitted as a `synthesize` request rather than a saved
 * template id — Phase 1's `templateSynthesizer` builds the real payload
 * server-side from the objective's own wizardSchema cell. That is what makes
 * "keep these coming" a single toggle instead of a trip to Ads Manager.
 *
 * Its output is validated against the LIVE `createJobSchema` in the test file,
 * importing the real schema rather than a copy, so any drift between the two
 * breaks the build instead of production.
 */

// Frequency presets a brief can express.
//
// `does_not_repeat` is the one deliberate omission: a brief that isn't
// repeating has no business creating a scheduled job at all.
//
// `custom` USED to be omitted too, because the API requires a `customFrequency`
// block alongside it (repeatEvery / repeatUnit / repeatOnDays) and the brief
// model had nowhere to hold those — emitting the word without the block is a
// 400 at activation. `delivery.frequency.custom` now exists, so the cadence a
// user actually wants ("every 2 weeks on Tuesdays") is expressible instead of
// being silently downgraded to weekly.
const FREQUENCY_PRESETS = Object.freeze([
  "daily",
  "weekly",
  "monthly",
  "every_weekday",
  "every_weekend",
  "custom",
]);

// Short form keys → the API's snake_case, mirroring the mapping the v1
// schedule form applies on its way out.
const FREQUENCY_ALIASES = Object.freeze({
  weekday: "every_weekday",
  weekend: "every_weekend",
});

const { getCell, isCellImplemented } = require("../../config/wizardSchema");
const { normalizeCustom } = require("./customCadence");

const DEFAULT_FREQUENCY = "weekly";
const DEFAULT_HOUR = 9;
const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_PAIRS = 3;

class BriefJobPayloadError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "BriefJobPayloadError";
    this.code = "BRIEF_JOB_PAYLOAD_INVALID";
    this.field = field;
  }
}

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== "") : []);

// `YYYY-MM-DD` in the given zone. Avoids the toISOString trap where local
// midnight in any UTC+N zone rolls back to the previous day.
function todayISO(timezone) {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through to UTC */
  }
  return now.toISOString().slice(0, 10);
}

/**
 * Pass a CTA through only when the chosen cell actually allows it.
 *
 * The mapper resolves a CTA against the cell it picked, so a freshly inferred
 * brief is always consistent. But a user can edit the objective afterwards
 * without touching the CTA — leaving, say, SHOP_NOW on a Leads brief, which
 * Meta rejects. Dropping it here lets the synthesizer apply that cell's own
 * default instead of failing at activation, hours later, in a cron worker.
 */
function ctaValidForCell(button, objective, conversionLocation) {
  if (!button) return null;
  try {
    if (!isCellImplemented(objective, conversionLocation)) return null;
    const cell = getCell(objective, conversionLocation);
    return cell?.ctas?.allowed?.includes(button) ? button : null;
  } catch {
    return null;
  }
}

function resolveFrequency(preset) {
  const raw = String(preset || "").trim();
  if (!raw) return DEFAULT_FREQUENCY;
  const aliased = FREQUENCY_ALIASES[raw] || raw;
  return FREQUENCY_PRESETS.includes(aliased) ? aliased : DEFAULT_FREQUENCY;
}

/**
 * @param {object} brief
 * @param {object} connection  the Meta connection this job posts through
 * @param {string} connection.facebookId
 * @param {string} connection.connectionId  24-char hex FBUsers _id
 * @param {string} connection.adAccountId
 * @param {string} [connection.pageId]
 * @param {string} [connection.instagramUserId]
 * @param {object} [opts]
 * @param {Date}   [opts.now]  injected for deterministic tests
 * @returns {object} body for POST /ads-factory/autopilot/jobs
 * @throws  {BriefJobPayloadError}
 */
function briefToJobPayload(brief = {}, connection = {}, opts = {}) {
  const b = plain(brief);
  const offer = plain(b.offer);
  const delivery = plain(b.delivery);
  const generation = plain(b.generation);
  const budget = plain(delivery.budget);
  const cadenceOverride = plain(opts.cadenceOverride);
  const frequency = {
    ...plain(delivery.frequency),
    ...(cadenceOverride || {}),
    ...(cadenceOverride.frequency ? { preset: cadenceOverride.frequency } : {}),
  };

  // `AdsFactoryJob.campaignId` is `required` and `ref: "Campaign"`, and the
  // orchestrator reads that document to run generation. A brief owns its
  // campaign (`brief.campaignId`, materialised by
  // services/adFactory/briefService.materializeCampaign), so the id is normally
  // read straight off the brief; `opts.campaignId` exists for callers that have
  // just created the projection and hold a fresher reference than the document
  // they were handed.
  const campaignId = opts.campaignId
    ? String(opts.campaignId)
    : b.campaignId
      ? String(b.campaignId)
      : "";
  if (!/^[a-f\d]{24}$/i.test(campaignId)) {
    throw new BriefJobPayloadError(
      "Scheduling needs a Full control campaign to run against",
      "campaignId",
    );
  }

  if (!connection.facebookId) {
    throw new BriefJobPayloadError("Connect a Facebook account first", "facebookId");
  }
  if (!/^[a-f\d]{24}$/i.test(String(connection.connectionId || ""))) {
    throw new BriefJobPayloadError(
      "Connect a Facebook account first",
      "connectionId",
    );
  }
  if (!connection.adAccountId) {
    throw new BriefJobPayloadError("Select an ad account", "adAccountId");
  }

  // Budget is required and must be positive. A missing budget silently
  // becoming 0 would create a campaign that never delivers — worse than an
  // error, because it fails quietly and looks like it worked.
  const daily = Number(budget.daily);
  if (!Number.isFinite(daily) || daily <= 0) {
    throw new BriefJobPayloadError("Set a daily budget", "budget.daily");
  }

  const objective = offer.primaryObjective;
  const conversionLocation = offer.conversionLocation;
  const advertiserName = String(connection.pageName || b.brand?.name || "").trim();
  if (!objective || !conversionLocation) {
    throw new BriefJobPayloadError(
      "This brief has no advertising objective resolved yet",
      "offer.primaryObjective",
    );
  }

  const timezone = frequency.timezone || DEFAULT_TIMEZONE;
  const hour = Number.isInteger(frequency.hour) ? frequency.hour : DEFAULT_HOUR;

  const startDate = frequency.startDate
    ? new Date(frequency.startDate).toISOString().slice(0, 10)
    : todayISO(timezone);

  const rawPairsPerCycle = cadenceOverride.pairsPerCycle ?? delivery.pairsPerCycle;
  const pairsPerCycle = Number.isFinite(Number(rawPairsPerCycle))
    ? Math.max(1, Math.min(200, Math.round(Number(rawPairsPerCycle))))
    : DEFAULT_PAIRS;

  const resolvedFrequency = resolveFrequency(frequency.preset);

  const payload = {
    campaignId,
    schedule: {
      frequency: resolvedFrequency,
      startDate,
      hour,
      timezone,
      // Required by scheduleSchema when the frequency is custom, and meaningless
      // otherwise. Built by the same normaliser the edit path uses so a cadence
      // cannot mean one thing at creation and another at update.
      ...(resolvedFrequency === "custom"
        ? { customFrequency: normalizeCustom(frequency.custom) }
        : {}),
    },
    pairsPerCycle,
    targets: {
      meta: {
        facebookId: String(connection.facebookId),
        connectionId: String(connection.connectionId),
        // If the user picked a saved template (has name + payload), use it
        // directly — no synthesis needed. Otherwise fall back to the synthesize
        // path: send an intent and let the controller build the template.
        template: (connection.template?.name && connection.template?.payload)
          ? {
              name: connection.template.name,
              payload: connection.template.payload,
              objective: connection.template.objective || objective,
              conversionLocation: connection.template.conversionLocation || conversionLocation,
              ...(connection.template.source ? { source: connection.template.source } : {}),
            }
          : {
          synthesize: true,
          objective,
          conversionLocation,
          adAccountId: String(connection.adAccountId),
          // Major currency units — the orchestrator converts at the Meta
          // boundary. Never pre-multiply here.
          budget: daily,
          ...(connection.pageId ? { pageId: String(connection.pageId) } : {}),
          ...(advertiserName ? { dsaBeneficiary: advertiserName, dsaPayor: advertiserName } : {}),
          ...(connection.instagramUserId
            ? { instagramUserId: String(connection.instagramUserId) }
            : {}),
          ...(ctaValidForCell(offer.cta?.button, objective, conversionLocation)
            ? { callToAction: offer.cta.button }
            : {}),
          ...(offer.cta?.url ? { linkUrl: offer.cta.url } : {}),
          ...(b.brand?.name ? { campaignName: String(b.brand.name).slice(0, 120) } : {}),
        },
      },
    },
  };

  if (frequency.endDate) {
    payload.schedule.endDate = new Date(frequency.endDate).toISOString().slice(0, 10);
  }

  // The image model the brief carries. `auto` is our own sentinel, not a
  // provider the job understands, so it is omitted rather than sent.
  const model = generation.imageModel;
  if (model && model !== "auto") payload.model = String(model);

  const alertEmails = arr(b.alertEmails);
  if (alertEmails.length) payload.alerts = { emailTo: alertEmails.join(",") };

  return payload;
}

module.exports = {
  briefToJobPayload,
  BriefJobPayloadError,
  _internals: {
    resolveFrequency,
    ctaValidForCell,
    todayISO,
    FREQUENCY_PRESETS,
    FREQUENCY_ALIASES,
    DEFAULT_FREQUENCY,
    DEFAULT_HOUR,
    DEFAULT_PAIRS,
  },
};
