/**
 * resultSlots — pre-allocate the slots Python's callback writes into.
 *
 * PURE. Returns a Mongo update spec; the caller applies it.
 *
 * Why this has to exist
 * ---------------------
 * `controllers/adFactory.updateGenerationResult` does not APPEND results. It
 * fills an existing empty slot, positionally:
 *
 *   Campaign.findOneAndUpdate(
 *     { "metadata.campaignId": id, "results.text.status": null },
 *     { $set: { "results.text.$": entry } },
 *   )
 *
 * The `$` needs an array element already matching `status: null`. With no
 * pre-pushed slots the filter matches nothing, the callback answers
 * `404 Campaign not found` — which is a misleading message, because the
 * campaign is right there; it is the SLOT that is missing — and the generated
 * creatives are dropped on the floor.
 *
 * v1's orchestrator pushes these slots before every run. The Quick setup
 * generate path did not, so a run would reach Python, generate real ads, and
 * silently lose all of them at the callback. Verified against a live run before
 * this module existed: campaign present, results.text [], results.image [].
 *
 * One slot per requested item, which is why the count comes from the campaign's
 * own `servicesSelected` rather than from anything the caller passes — the same
 * source Python is told to generate from, so the two cannot disagree.
 */

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});

// The result kinds the Campaign schema stores and the callback accepts.
const KINDS = ["text", "image", "video"];

/**
 * @param {Array} servicesSelected  campaign.services.servicesSelected
 * @returns {{ update: object|null, counts: object }}
 *          `update` is null when nothing was requested — the caller must not
 *          issue an empty $push, and must not flip the campaign to
 *          "in-progress" for a run that will never produce anything.
 */
function buildResultSlotUpdate(servicesSelected) {
  const selected = (Array.isArray(servicesSelected) ? servicesSelected : []).map(plain);

  const push = {};
  const counts = {};

  for (const kind of KINDS) {
    const svc = selected.find((s) => s.serviceName === kind);
    const qty = Number(plain(svc?.serviceParams).quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const n = Math.floor(qty);
    counts[kind] = n;
    // Empty objects, so `status` is absent and therefore matches the
    // callback's `status: null` filter. An explicit `{ status: null }` would
    // also match, but the schema default would then coerce it — empty is what
    // the orchestrator pushes and what the callback expects.
    push[`results.${kind}`] = { $each: Array.from({ length: n }, () => ({})) };
  }

  if (Object.keys(push).length === 0) return { update: null, counts };

  return {
    update: {
      $push: push,
      // Both statuses move together. The orchestrator SKIPS a tick when it
      // reads either as "in-progress", which is what stops a second run
      // overlapping one already in flight.
      $set: { "results.status": "in-progress", status: "in-progress" },
    },
    counts,
  };
}

module.exports = { buildResultSlotUpdate, KINDS };
