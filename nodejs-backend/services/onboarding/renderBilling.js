/**
 * renderBilling — what an onboarding clip costs, and who pays for it.
 *
 * Onboarding is free right up to the last step. The brand research, the
 * template matches, the storyboards and their keyframes all run without a plan
 * gate or a credit check (see `Router/onboarding/onboardingRoutes.js`). This
 * module owns the one place money changes hands: rendering a concept into a
 * clip.
 *
 * Two things make that different from every other paid render in this backend,
 * and both are why this file exists rather than a few lines inside
 * `videoClient`:
 *
 *   1. THE FIRST ONE IS FREE. One render per user, for their lifetime — the
 *      promise the "Make your first impression free" banner makes. The claim
 *      has to be atomic, because two tabs pressing Generate at the same moment
 *      must not both come away thinking they got the freebie.
 *
 *   2. WE DO NOT KNOW THE PRICE WHEN WE HAVE TO CHARGE IT. The user picks no
 *      model, no quality and no duration; `videoClient` sends none of those
 *      upstream. Python decides, and tells us what it decided in `meta` on the
 *      202 — which arrives AFTER the point where we must already have secured
 *      payment. So the sequence is: freeze a ceiling, POST, then true the hold
 *      down to what was actually rendered.
 *
 * See ONBOARDING_ENTRY_EXIT_CREDITS.md §6 for the full design.
 */

const UnifiedCreditController = require("../../controllers/UnifiedCreditController");
const UserProfile = require("../../Module/user/userProfileModel");
const logger = require("../../utils/logger");

/**
 * DS's model strings, mapped to the keys `aiModelConfiguration` actually holds.
 *
 * This map is a BRIDGE, and it is load-bearing. Python reports models as
 * `veo-3.1-fast-generate-preview`; our configuration knows that model as
 * `veo-3.1-fast`, whose only alias is the display string "Veo 3.1 fast".
 * Nothing resolves the one to the other, so `getModelDeduction()` handed the
 * DS string returns **0** — and a paid render priced from that would charge the
 * user nothing, silently, forever. That is the failure this map prevents.
 *
 * It belongs in `aliases` on the configuration documents, not in code, and
 * should be moved there — at which point this shrinks to a safety net. Until
 * then, a DS model missing from here is caught by `priceFor` below rather than
 * being quietly worth nothing.
 */
const DS_MODEL_TO_CONFIG_KEY = Object.freeze({
  "veo-3.1-fast-generate-preview": "veo-3.1-fast",
  "veo-3.0-fast-generate-preview": "veo-3.1-fast",
  "veo-3.0-generate-preview": "veo",
  "veo-3.1-generate-preview": "veo",
});

// What we freeze before the POST, when we still have no idea what Python will
// pick. It has to cover the dearest thing the map above can resolve to —
// erring high only ever means refunding, while erring low means eating the
// difference on every render.
//
// `duration_s` has the same problem: DS's documented default is 8s and every
// clip observed has been 8s, but nothing promises that, so the ceiling assumes
// the longest we would expect rather than the shortest.
const CEILING_DURATION_S = 8;

/**
 * Per-second credit rate for one DS model string, or 0 if unknown.
 *
 * DS sends the canonical key alongside their own, pipe-separated:
 *
 *     "veo-3.1-fast-generate-preview|veo-3.1-fast"
 *
 * That second half is the answer — it is OUR configuration key, chosen by the
 * people who know which model actually ran. Reading it means a model DS adds
 * tomorrow prices correctly today, with no map to update and no release.
 *
 * The map below stays as the fallback for a bare DS string, which is what the
 * older payloads carry. Neither path is allowed to invent a price: an
 * unrecognised model returns 0, and `priceFor` turns that into "hold at the
 * ceiling and shout", never into a free render.
 */
function rateFor(dsModel) {
  const raw = String(dsModel || "").trim();
  if (!raw) return 0;

  // The canonical half, when DS supplied one. Last segment rather than [1], so
  // a string that grows a third field does not silently start pricing wrong.
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  const canonical = parts.length > 1 ? parts[parts.length - 1] : "";

  // Three shapes reach this, and all three are real:
  //
  //   "veo-3.1-fast-generate-preview|veo-3.1-fast"  DS's string + the canonical
  //   "veo-3.1-fast"                                the canonical key alone
  //   "veo-3.1-fast-generate-preview"               DS's string alone (older)
  //
  // The second was the one this missed: with no pipe there is no `canonical`,
  // and DS's own key is not in the map because the map is keyed on DS strings.
  // The result was rate 0 on a paid render — observed in the logs as "unpriced
  // model from DS" for a model our configuration knew perfectly well.
  //
  // So try the value AS a configuration key before falling back to the map. A
  // key that does not resolve costs one cache lookup and returns 0, which the
  // caller already handles.
  const direct = canonical || parts[0];
  const rate = Number(UnifiedCreditController.getModelDeduction(direct)) || 0;
  if (rate) return rate;

  const mapped = DS_MODEL_TO_CONFIG_KEY[parts[0]];
  if (!mapped) return 0;
  return Number(UnifiedCreditController.getModelDeduction(mapped)) || 0;
}

/**
 * The ceiling hold: the dearest model this map knows, for the longest duration
 * we expect. Computed rather than hardcoded so that adding a pricier model to
 * the map cannot leave the ceiling silently too low.
 */
function ceilingAmount() {
  const rates = Object.keys(DS_MODEL_TO_CONFIG_KEY).map(rateFor);
  const dearest = rates.length ? Math.max(...rates) : 0;
  return dearest * CEILING_DURATION_S;
}

/**
 * What a render actually cost, from the `meta` Python returned on the 202.
 *
 * Returns 0 only when the model is genuinely unknown to us — never as a
 * shrug. The caller treats 0 as "keep the ceiling", because a render that is
 * already running must not become free just because our configuration is
 * behind.
 */
function priceFor(meta) {
  const model = meta?.model;
  const rate = rateFor(model);
  if (!rate) {
    logger.error(
      "[onboarding][credits] unpriced model from DS — holding at ceiling. " +
        `Add "${model}" to DS_MODEL_TO_CONFIG_KEY (or as an alias in ` +
        "aiModelConfiguration) or every render of it is mispriced.",
    );
    return 0;
  }
  const seconds = Number(meta?.duration_s) || CEILING_DURATION_S;
  const count = Number(meta?.count) || 1;
  return rate * seconds * count;
}

/**
 * Claims this user's one free render, if it is still going.
 *
 * The `null` match IS the lock: Mongo applies the update to one document
 * atomically, so of any number of simultaneous callers exactly one sees a
 * document come back. There is no window in which two tabs both believe they
 * won.
 */
async function claimFreeRender(userId, sessionId) {
  const claimed = await UserProfile.findOneAndUpdate(
    {
      user_id: userId,
      onboarding_free_render_used_at: null,
      // Enrolment is part of the CLAIM, not just of what the UI offers. An
      // account that predates onboarding is never shown the bar or the
      // redirect, but it can still reach `/onboarding` by typing the URL, and
      // the free render must not be reachable that way. The gate belongs on
      // the write for the same reason ownership checks do: the screen it was
      // hidden from is not a security boundary.
      onboarding_offer_enrolled_at: { $exists: true, $ne: null },
    },
    {
      $set: {
        onboarding_free_render_used_at: new Date(),
        onboarding_free_render_session_id: sessionId || "",
      },
    },
    { new: true },
  )
    .select("user_id")
    .lean();

  return Boolean(claimed);
}

/**
 * Gives the free render back.
 *
 * Called when the render the claim paid for never happened — upstream refused
 * the job, or it failed. A user whose one freebie died to someone else's 500
 * has received nothing, and burning it anyway is the worst possible first
 * impression of the product.
 *
 * Scoped to the session that claimed it so a late failure from an old run
 * cannot un-claim a render the user has since successfully made.
 */
async function returnFreeRender(userId, sessionId) {
  const res = await UserProfile.updateOne(
    { user_id: userId, onboarding_free_render_session_id: sessionId || "" },
    {
      $set: {
        onboarding_free_render_used_at: null,
        onboarding_free_render_session_id: "",
      },
    },
  );
  if (res.modifiedCount) {
    logger.info(
      `[onboarding][credits] returned unused free render to user=${userId} session=${sessionId}`,
    );
  }
  return Boolean(res.modifiedCount);
}

/**
 * Secures payment for one render, BEFORE the upstream call.
 *
 * Returns `{ ok: true, free, renderId, amount }` when the render may proceed,
 * or `{ ok: false, reason }` when it may not — `reason` being the freeze's own
 * ("NO_BASE_PLAN", "INSUFFICIENT"), which the controller turns into a status
 * code.
 *
 * `renderId` is ours, minted here rather than taken from Python, because the
 * hold has to have a name before the call that would give us a job id. It is
 * stored on the board so the webhook can find this reservation from a job id
 * later. A retry mints a fresh one, so it can never collide with a hold still
 * open from the previous attempt.
 */
async function securePayment({ userId, sessionId, boardId, renderId }) {
  // The free one first: if it is available, nothing is frozen at all.
  if (await claimFreeRender(userId, sessionId)) {
    logger.info(
      `[onboarding][credits] FREE render claimed user=${userId} session=${sessionId} board=${boardId}`,
    );
    return { ok: true, free: true, renderId, amount: 0 };
  }

  const amount = ceilingAmount();
  if (!amount) {
    // Every model in the map priced at zero means the configuration is not
    // loaded or not seeded. Charging nothing is not a safe default for a paid
    // render, so refuse and make the operator fix it.
    logger.error(
      "[onboarding][credits] ceiling computed as 0 — model configuration missing. Refusing to render.",
    );
    return { ok: false, reason: "not_configured" };
  }

  const freeze = await UnifiedCreditController.freezeCredits({
    userId,
    reservationKey: renderId,
    amount,
    meta: {
      service_type: "ad_video",
      surface: "onboarding",
      sessionId,
      boardId,
      ceiling: true,
    },
  });

  if (!freeze.ok) return { ok: false, reason: freeze.reason };

  logger.info(
    `[onboarding][credits] froze ceiling ${amount} user=${userId} render=${renderId}`,
  );
  return { ok: true, free: false, renderId, amount };
}

/**
 * Trues the hold down to what Python said it was actually rendering.
 *
 * Runs immediately after the 202, so the user gets the difference back within
 * seconds rather than at settlement. A free render has no hold to adjust, and
 * an unpriceable model keeps the ceiling (see `priceFor`).
 */
async function trueUp({ free, renderId, frozenAmount, meta }) {
  if (free || !renderId) return frozenAmount;

  const actual = priceFor(meta);
  if (!actual || actual >= frozenAmount) {
    if (actual > frozenAmount) {
      // The render is already queued; cancelling it would cost the user their
      // clip to fix our accounting. Settle at the ceiling and shout — the
      // ceiling is what needs raising.
      logger.error(
        `[onboarding][credits] actual ${actual} EXCEEDS ceiling ${frozenAmount} ` +
          `(model=${meta?.model}) — holding at ceiling, raise CEILING or the model map.`,
      );
    }
    return frozenAmount;
  }

  await UnifiedCreditController.releasePartial(renderId, actual);
  logger.info(
    `[onboarding][credits] trued up render=${renderId} ${frozenAmount} -> ${actual} (model=${meta?.model})`,
  );
  return actual;
}

/**
 * Closes out one board's payment, once its render has finished for good.
 *
 * This is the other end of `securePayment`, reached from the webhook rather
 * than from a request. The board entry carries the `billing` written when the
 * render started, which is the only route from a job id back to the hold it
 * opened.
 *
 * Succeeded → settle (the freeze WAS the deduction; settling just retires the
 * receipt). Failed → give it all back, because the user has no clip.
 *
 * Safe to call twice: `settleCredits` and `releaseCredits` on a receipt that is
 * already gone are no-ops, and the free-render un-claim is scoped to the
 * session that claimed it.
 */
async function settleBoard({ sessionId, userId, boardId, entry }) {
  const billing = entry?.billing;
  // A render started before this feature existed, or one whose billing was
  // lost. Nothing to settle; the sweeper handles any hold it left behind.
  if (!billing) return false;

  const succeeded = entry.status === "succeeded";

  if (billing.free) {
    if (succeeded) {
      logger.info(
        `[onboarding][credits] free render delivered user=${userId} board=${boardId}`,
      );
      return true;
    }
    // The freebie bought nothing. Hand it back.
    return returnFreeRender(userId, sessionId);
  }

  if (!billing.renderId) return false;

  if (succeeded) {
    await UnifiedCreditController.settleCredits(billing.renderId);
    logger.info(
      `[onboarding][credits] settled ${billing.amount} render=${billing.renderId} board=${boardId}`,
    );
  } else {
    await UnifiedCreditController.releaseCredits(billing.renderId);
    logger.info(
      `[onboarding][credits] released ${billing.amount} (render failed) render=${billing.renderId} board=${boardId}`,
    );
  }
  return true;
}

/** Undoes payment when the render never started. */
async function refund({ free, userId, sessionId, renderId }) {
  if (free) return returnFreeRender(userId, sessionId);
  if (!renderId) return false;
  await UnifiedCreditController.releaseCredits(renderId);
  return true;
}

module.exports = {
  securePayment,
  settleBoard,
  trueUp,
  refund,
  claimFreeRender,
  returnFreeRender,
  priceFor,
  ceilingAmount,
  _internals: { DS_MODEL_TO_CONFIG_KEY, rateFor, CEILING_DURATION_S },
};
