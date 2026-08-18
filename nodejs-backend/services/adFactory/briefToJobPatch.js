/**
 * briefToJobPatch — brief → the body of `PATCH /ads-factory/autopilot/jobs/:id`.
 *
 * PURE. No DB, no network.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `updateBrief` re-materialises the campaign, so brand / offer / creative edits
 * reach the next run — the orchestrator generates from the campaign. But the
 * cadence, the pairs-per-run and the image model live on the JOB, and nothing
 * wrote to it. Change the schedule on a live brief and the API saved it, the UI
 * showed it, and the job carried on running the old one.
 *
 * That is worse than a missing feature. A control that does nothing but looks
 * like it worked is the one failure mode a user cannot detect.
 *
 * WHY A DIFF AND NOT A DUMP
 *
 * `updateJob` REBUILDS THE QUEUE ENTRY whenever `schedule` is present — it
 * recomputes the cron and reschedules, so `nextRunAt` can move. A brief PATCH
 * fires on every inline field edit (the Adjust panel saves per field), so
 * echoing an unchanged schedule back on each of them would churn the queue and
 * silently drag the next run around while the user edits their headline.
 *
 * So this emits ONLY what actually differs from the job, and `{}` when nothing
 * does — which the caller reads as "don't call updateJob at all", also avoiding
 * the schema's `.min(1)` 400.
 *
 * THE TEMPLATE FIELDS
 *
 * Budget, CTA and destination link live inside
 * `targets.meta.template.payload`, not at the top level. `updateJob` accepts
 * exactly six keys there (EDITABLE_META_PAYLOAD_FIELDS) and REJECTS BY NAME any
 * other field that differs from what is saved — so the patch sends only the
 * editable keys that actually changed, never the whole payload back.
 *
 * The budget key is `adSetBudget`, not `dailyBudget`. That is deliberate in the
 * synthesizer: a root `dailyBudget` is copied to the campaign without the
 * major→minor conversion, which would send ₹800 to Meta as ₹8.
 *
 * WHAT IS STILL NOT SYNCED
 *
 *   • targets / connection — changing the ad account under a running job is
 *     what Stop is for.
 *   • the LIVE Meta campaign's budget. `updateJob` pushes budget changes
 *     straight through to an already-created campaign for Google only; Meta has
 *     no equivalent in v1 either. The saved template is what every run builds
 *     its ad set from, so a budget change here takes effect on the NEXT run
 *     rather than retroactively. That is a real limit, and the UI says so
 *     ("changes apply from the next run") rather than implying otherwise.
 */

const { _internals: payloadInternals } = require("./briefToJobPayload");

// Same mappings the create path uses. Sharing them is what stops Quick setup
// producing values `createJob` accepts but `updateJob` rejects.
const { resolveFrequency, ctaValidForCell } = payloadInternals;

// Shared with the create path so a custom cadence cannot mean one thing at
// activation and another at the next edit.
const { normalizeCustom, sameCustom } = require("./customCadence");

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});

// Dates arrive as Date objects from Mongo and ISO strings from JSON. Compare on
// the day, because that is the resolution the schedule actually has — anything
// finer reports a change every time a Date round-trips through the API.
const day = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * @param {object} brief  the brief AFTER the edit has been applied
 * @param {object} job    the live AdsFactoryJob
 * @returns {{ patch: object, changed: string[] }}
 *          `patch` is a valid `updateJobSchema` body, or `{}` when the job
 *          already matches the brief. `changed` names the fields for logging
 *          and for telling the user what did or didn't take.
 */
function briefToJobPatch(brief = {}, job = {}) {
  const b = plain(brief);
  const j = plain(job);

  const delivery = plain(b.delivery);
  const generation = plain(b.generation);
  const frequency = plain(delivery.frequency);
  const jobSchedule = plain(j.schedule);

  const patch = {};
  const changed = [];

  // ─── schedule ──────────────────────────────────────────────────────────────
  //
  // `scheduleSchema` requires `frequency`, so the block goes as a whole or not
  // at all. Each field falls back to what the job already has rather than to a
  // constant — a brief that never set an hour must not reset a job whose hour
  // was chosen at activation.
  //
  // `resolveFrequency` maps anything unrecognised onto its default, which is
  // the right behaviour for the CREATE path — a job has to have a cadence — but
  // wrong here: with no preset on the brief and no frequency on the job it
  // would invent `weekly` and push it onto a job nobody scheduled. Nothing to
  // sync is not the same as sync the default, so the block is skipped outright
  // when neither side names one.
  const frequencySource = frequency.preset || jobSchedule.frequency;
  const wantFrequency = frequencySource ? resolveFrequency(frequencySource) : null;
  const wantHour = Number.isInteger(frequency.hour) ? frequency.hour : jobSchedule.hour;
  const wantTimezone = frequency.timezone || jobSchedule.timezone;
  // A brief with no end date means "not set", not "clear the job's" — the brief
  // has no control that can express deletion, so it cannot imply one.
  const wantEnd = day(frequency.endDate) || day(jobSchedule.endDate);
  // startDate is never moved from here. It is historical the moment the job
  // runs once, and rewriting it would re-anchor a weekly cadence onto a
  // different weekday.
  const keepStart = day(jobSchedule.startDate) || day(frequency.startDate);

  const scheduleDiff = !wantFrequency
    ? []
    : [
        wantFrequency !== jobSchedule.frequency && "frequency",
        Number.isInteger(wantHour) && wantHour !== jobSchedule.hour && "hour",
        wantTimezone && wantTimezone !== jobSchedule.timezone && "timezone",
        wantEnd !== day(jobSchedule.endDate) && "endDate",
      ].filter(Boolean);

  // `custom` carries its own block, and `scheduleSchema` REQUIRES it when the
  // frequency is custom — sending custom without it is a 400. Compared as a
  // whole because the three fields only mean anything together.
  const wantCustom =
    wantFrequency === "custom"
      ? normalizeCustom(frequency.custom, plain(jobSchedule.customFrequency))
      : null;
  const customChanged =
    wantCustom && !sameCustom(wantCustom, plain(jobSchedule.customFrequency));

  if (scheduleDiff.length || customChanged) {
    patch.schedule = {
      frequency: wantFrequency,
      ...(Number.isInteger(wantHour) ? { hour: wantHour } : {}),
      ...(wantTimezone ? { timezone: wantTimezone } : {}),
      ...(keepStart ? { startDate: keepStart } : {}),
      ...(wantEnd ? { endDate: wantEnd } : {}),
      ...(wantCustom ? { customFrequency: wantCustom } : {}),
    };
    changed.push(...scheduleDiff.map((f) => `schedule.${f}`));
    if (customChanged) changed.push("schedule.custom");
  }

  // ─── pairsPerCycle ─────────────────────────────────────────────────────────
  const pairs = Number(delivery.pairsPerCycle);
  if (Number.isFinite(pairs)) {
    const clamped = Math.max(1, Math.min(200, Math.round(pairs)));
    if (clamped !== Number(j.pairsPerCycle)) {
      patch.pairsPerCycle = clamped;
      changed.push("pairsPerCycle");
    }
  }

  // ─── model ─────────────────────────────────────────────────────────────────
  //
  // `auto` is our own sentinel for "we pick", not a provider the job knows, so
  // it is never sent — matching briefToJobPayload, which omits it at creation.
  const model = generation.imageModel;
  if (model && model !== "auto" && String(model) !== String(j.model || "")) {
    patch.model = String(model);
    changed.push("model");
  }

  // ─── alerts ────────────────────────────────────────────────────────────────
  //
  // Stored on the job as ONE comma-separated string, matching the Meta
  // Autopilot's own `autopilotSettings.alerts.emailTo` convention; the brief
  // holds an array because that is what a list control edits.
  //
  // An empty array is a real value here, unlike endDate: the brief has a
  // control that can express "no recipients", so clearing it must clear the
  // job. Only skipped when the brief has no alertEmails key at all.
  if (Array.isArray(b.alertEmails)) {
    const emailTo = b.alertEmails
      .map((e) => String(e || "").trim())
      .filter(Boolean)
      .join(",");
    if (emailTo !== String(plain(j.alerts).emailTo || "")) {
      patch.alerts = { emailTo };
      changed.push("alerts");
    }
  }

  // ─── the meta template's editable payload keys ─────────────────────────────
  //
  // Only budget, CTA and link. Every other key in the payload is rejected by
  // name if it differs, so nothing else is sent — and echoing the whole payload
  // back would be a request that fails the moment the synthesizer's output
  // changes shape.
  const offer = plain(b.offer);
  const metaTemplate = plain(plain(plain(j.targets).meta).template);
  const savedPayload = plain(metaTemplate.payload);
  const payloadDiff = {};

  // `adSetBudget`, not `dailyBudget` — see the header.
  const daily = Number(plain(delivery.budget).daily);
  if (Number.isFinite(daily) && daily > 0 && daily !== Number(savedPayload.adSetBudget)) {
    payloadDiff.adSetBudget = daily;
    changed.push("budget");
  }

  // A CTA is only sent when the CURRENT objective's wizardSchema cell allows
  // it. A user can change the objective without touching the CTA, leaving e.g.
  // SHOP_NOW on a Leads brief — pushing that onto the job would turn an edit
  // into a Meta rejection hours later inside a cron worker.
  const cta = plain(offer.cta);
  const validCta = ctaValidForCell(cta.button, offer.primaryObjective, offer.conversionLocation);
  if (validCta && validCta !== savedPayload.callToAction) {
    payloadDiff.callToAction = validCta;
    changed.push("cta");
  }

  if (cta.url && String(cta.url) !== String(savedPayload.linkUrl || "")) {
    payloadDiff.linkUrl = String(cta.url);
    changed.push("linkUrl");
  }

  // The schema requires the connection ids alongside a targets patch, and the
  // whole block is pointless without a template to patch into.
  const metaTarget = plain(plain(j.targets).meta);
  if (Object.keys(payloadDiff).length && metaTemplate.payload && metaTarget.facebookId) {
    patch.targets = {
      meta: {
        facebookId: String(metaTarget.facebookId),
        connectionId: String(metaTarget.connectionId),
        // `template.payload` is required by updateTargetsSchema; the controller
        // then copies across only the keys in its editable allowlist.
        template: { payload: payloadDiff },
      },
    };
  }

  return { patch, changed };
}

module.exports = { briefToJobPatch, _internals: { day } };
