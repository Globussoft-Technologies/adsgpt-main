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
 * WHAT IS DELIBERATELY NOT SYNCED
 *
 *   • budget — lives in `targets.meta.template.payload`, and updateJob only
 *     pushes budget changes through to an already-created campaign for GOOGLE
 *     (see adsFactoryAutoController.updateJob). Meta has no such sync in v1
 *     either, so leaving it out is parity, not a regression. Wiring it means
 *     deciding what to do about the live Meta campaign, which is its own change.
 *   • targets / connection — changing the ad account under a running job is
 *     what Stop is for.
 *   • alerts — the brief has no field to carry them yet.
 */

const { _internals: payloadInternals } = require("./briefToJobPayload");

// Same mapping the create path uses. Sharing it is what stops Quick setup
// producing a frequency `createJob` accepts but `updateJob` rejects.
const { resolveFrequency } = payloadInternals;

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

  if (scheduleDiff.length) {
    patch.schedule = {
      frequency: wantFrequency,
      ...(Number.isInteger(wantHour) ? { hour: wantHour } : {}),
      ...(wantTimezone ? { timezone: wantTimezone } : {}),
      ...(keepStart ? { startDate: keepStart } : {}),
      ...(wantEnd ? { endDate: wantEnd } : {}),
    };
    changed.push(...scheduleDiff.map((f) => `schedule.${f}`));
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

  return { patch, changed };
}

module.exports = { briefToJobPatch, _internals: { day } };
