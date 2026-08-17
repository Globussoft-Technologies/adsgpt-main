/**
 * briefCreditEstimate — what one generation run will cost, before it runs.
 *
 * PURE. The per-model price is INJECTED rather than imported, so this module
 * has no DB, no controller and no registry dependency, and its test can state
 * prices as fixtures instead of tracking whatever the live registry says today.
 *
 * Why it reuses the campaign projection
 * -------------------------------------
 * `controllers/adFactory.validateCredits` is what actually freezes the hold,
 * and it prices a campaign's `services.servicesSelected`:
 *
 *   text  qty x deduction("ADSGPT-TEXT")
 *   image qty x deduction(imageModel)
 *   video qty x deduction(videoModel)
 *
 * A brief projects into exactly that shape via `briefToCampaignDoc`, so this
 * estimator prices the projection rather than re-deriving anything from the
 * brief. That is deliberate: a second pricing path would drift from the one
 * that charges, and an estimate that disagrees with the invoice is worse than
 * no estimate at all. If the two ever need to differ, that is a bug in one of
 * them, not a feature.
 *
 * The number is an ESTIMATE and the UI must say so. The real charge is settled
 * against what Python actually delivered — a run where two of three images fail
 * is charged for two.
 */

const { briefToCampaignDoc, BriefProjectionError } = require("./briefToCampaignDoc");

// The text model is fixed for Ad Factory generation, matching validateCredits.
const TEXT_MODEL_KEY = "ADSGPT-TEXT";

/**
 * @param {object}   brief         An AdFactoryBrief document or plain object.
 * @param {Function} getDeduction  (modelKey) => credits per unit. Pass
 *                                 `UnifiedCreditController.getModelDeduction`.
 * @returns {{ total, text, image, counts } | null}
 *          null when the brief cannot be priced — a brief too incomplete to
 *          project is also too incomplete to quote, and showing "0 credits"
 *          for it would read as free rather than unknown.
 */
function estimateBriefCredits(brief, getDeduction) {
  if (typeof getDeduction !== "function") return null;

  let selected;
  try {
    selected = briefToCampaignDoc(brief).services.servicesSelected;
  } catch (err) {
    if (err instanceof BriefProjectionError) return null;
    throw err;
  }

  const find = (name) => selected.find((s) => s.serviceName === name);
  const qtyOf = (name) => Number(find(name)?.serviceParams?.quantity) || 0;

  const textQty = qtyOf("text");
  const imageQty = qtyOf("image");
  const imageModel = find("image")?.serviceParams?.model || null;

  const price = (model) => {
    const n = Number(getDeduction(model));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const text = textQty * price(TEXT_MODEL_KEY);
  const image = imageQty * price(imageModel);

  return {
    total: text + image,
    text,
    image,
    counts: { text: textQty, image: imageQty },
  };
}

module.exports = { estimateBriefCredits, TEXT_MODEL_KEY };
