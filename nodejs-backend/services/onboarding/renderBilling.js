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
 * The model onboarding renders with, every time.
 *
 * The ceiling USED TO be "the dearest model in the map", which came out at
 * `veo` 5/s x 8s = 40. That number is now unaffordable by the people it has to
 * work for: a free-plan user is granted 35 credits, so a 40-credit hold failed
 * INSUFFICIENT on the one render the banner had just called free, even though
 * the render only ever costs 32.
 *
 * Onboarding picks no model — Python does, from a fixed server-side config, and
 * that config is Veo 3.1 fast. So the ceiling is priced from THAT rather than
 * from the worst case the map can express. If Python ever returns something
 * dearer, `trueUp` already catches it: it holds at the ceiling and logs
 * "actual EXCEEDS ceiling", which is the signal to raise this.
 */
const ONBOARDING_MODEL_KEY = "veo-3.1-fast";

/**
 * The ceiling hold: onboarding's fixed model, for the longest duration we
 * expect. 4/s x 8s = 32, which fits inside a free plan's 35-credit grant.
 */
function ceilingAmount() {
  return rateFor(ONBOARDING_MODEL_KEY) * CEILING_DURATION_S;
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
 * Is this user on the free plan?
 *
 * The free plan is the one case where "your first render is free" stops being
 * literally true. Those users are ALREADY being given something free — the 35
 * credits in their grant — and the first render is presented as free on top of
 * that while still being paid for out of the grant. Every other plan keeps the
 * genuine freebie.
 *
 * Keyed on `FREE_PLAN_ID`, the same env var `scheduleFreePlanDrip` uses
 * (`controllers/newsletter.controller.js`), so there is one answer to "is this
 * a free user" in the backend rather than two that can drift.
 *
 * If the var is unset we answer NO, which means the render stays genuinely
 * free. That is the safe direction to fail: a missing config gives a render
 * away, it never charges someone who should not have been charged.
 */
async function isFreePlanUser(userId) {
  const freePlanId = String(process.env.FREE_PLAN_ID || "").trim();
  if (!freePlanId) {
    logger.warn(
      "[onboarding][credits] FREE_PLAN_ID is not set — treating every user as " +
        "paid-plan, so onboarding's first render stays free for everyone.",
    );
    return false;
  }
  const profile = await UserProfile.findOne(
    { user_id: userId },
    { subscription_plan_id: 1 },
  ).lean();
  return String(profile?.subscription_plan_id || "") === freePlanId;
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
async function securePayment({ userId, sessionId, boardId, renderId, maxWalletCredits }) {
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

  // ── The allowance first, then the wallet for the rest ──────────────────
  //
  // Split on the CEILING, not on the eventual actual, because this is the only
  // number that exists before the upstream call.
  //
  // Partial since ONB-010. It used to be all-or-nothing: a user holding 25 with
  // a 32-credit render kept the 25 forever and paid 32 in cash. The budget now
  // pays its 25 and the wallet covers 7 — and the user is shown exactly that
  // before any of it is taken.
  const { fromAllowance, fromWallet } = await splitCharge(userId, amount);

  if (fromWallet === 0) {
    logger.info(
      `[onboarding][credits] covered by allowance ${fromAllowance} user=${userId} ` +
        `session=${sessionId} board=${boardId}`,
    );
    // `free: true` is what every downstream reader keys on for "no wallet hold
    // exists". `allowanceSpent` is what a failed render gives back.
    return { ok: true, free: true, allowanceSpent: fromAllowance, renderId, amount: 0 };
  }

  // ── The quote guard ────────────────────────────────────────────────────
  //
  // `maxWalletCredits` is the wallet number the user was SHOWN and agreed to.
  // Between that screen and this line another tab can spend the budget, which
  // would silently make the wallet's share bigger than the one they accepted.
  // Rather than charge more than was agreed, hand the budget back untouched and
  // let the caller re-ask with the real number.
  //
  // Absent means no quote was made (the free-plan path, which has no allowance
  // to shift under it) and the check does not apply.
  if (maxWalletCredits != null && fromWallet > Number(maxWalletCredits)) {
    if (fromAllowance) await returnAllowance(userId, fromAllowance);
    logger.info(
      `[onboarding][credits] quote stale user=${userId} board=${boardId} ` +
        `quoted=${maxWalletCredits} now=${fromWallet} — refusing`,
    );
    return {
      ok: false,
      reason: "price_changed",
      walletAmount: fromWallet,
      allowanceAmount: fromAllowance,
      total: amount,
    };
  }

  const freeze = await UnifiedCreditController.freezeCredits({
    userId,
    reservationKey: renderId,
    amount: fromWallet,
    meta: {
      service_type: "ad_video",
      surface: "onboarding",
      sessionId,
      boardId,
      ceiling: true,
    },
  });

  if (!freeze.ok) {
    // The budget was already drawn a few lines up. Nothing is rendering, so it
    // has to go back — otherwise a user who could not afford the wallet half
    // loses the allowance half for nothing.
    if (fromAllowance) await returnAllowance(userId, fromAllowance);
    // The SHAPE of the refusal, not just the fact of it. "You cannot afford
    // this" is useless to someone holding 25 of onboarding budget: what they
    // need to know is that 25 was covered, 7 was wanted from the wallet, and
    // the wallet had 2. `remaining` is what `freezeCredits` saw.
    return {
      ok: false,
      reason: freeze.reason,
      total: amount,
      allowanceAvailable: fromAllowance,
      walletNeeded: fromWallet,
      walletBalance: Number(freeze.remaining) || 0,
    };
  }

  logger.info(
    `[onboarding][credits] froze ${fromWallet} (+${fromAllowance} allowance, ceiling ${amount}) ` +
      `user=${userId} render=${renderId}`,
  );
  return { ok: true, free: false, allowanceSpent: fromAllowance, renderId, amount: fromWallet };
}

/**
 * Trues the hold down to what Python said it was actually rendering.
 *
 * Runs immediately after the 202, so the user gets the difference back within
 * seconds rather than at settlement. A free render has no hold to adjust, and
 * an unpriceable model keeps the ceiling (see `priceFor`).
 */
async function trueUp({ free, renderId, frozenAmount, allowanceSpent = 0, meta }) {
  if (free || !renderId) return frozenAmount;

  // WHAT THE RENDER COST THE USER IN TOTAL, not just the wallet's share. With a
  // split hold the wallet may be holding 7 of a 32-credit render, and comparing
  // DS's 32 against that 7 would read as "actual exceeds ceiling" on every
  // single split render — a false alarm on the one log line that is supposed to
  // mean something is wrong.
  const held = frozenAmount + (Number(allowanceSpent) || 0);

  const actual = priceFor(meta);
  if (!actual || actual >= held) {
    if (actual > held) {
      // The render is already queued; cancelling it would cost the user their
      // clip to fix our accounting. Settle at the ceiling and shout — the
      // ceiling is what needs raising.
      logger.error(
        `[onboarding][credits] actual ${actual} EXCEEDS ceiling ${held} ` +
          `(model=${meta?.model}) — holding at ceiling, raise CEILING or the model map.`,
      );
    }
    return frozenAmount;
  }

  // WALLET FIRST. The refund comes off the user's real credits before it comes
  // off the budget: allowance is worthless outside onboarding, so giving back a
  // credit is worth more to them than giving back a credit of budget. The
  // allowance keeps what it spent and the wallet drops to the remainder.
  const newWallet = Math.max(0, actual - (Number(allowanceSpent) || 0));
  if (newWallet >= frozenAmount) return frozenAmount;

  await UnifiedCreditController.releasePartial(renderId, newWallet);
  logger.info(
    `[onboarding][credits] trued up render=${renderId} wallet ${frozenAmount} -> ${newWallet} ` +
      `(actual ${actual}, allowance ${allowanceSpent}, model=${meta?.model})`,
  );
  return newWallet;
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

  // THE BUDGET COMES BACK FIRST, and independently of the wallet hold. Since
  // ONB-010 a render can be paid for by BOTH, so this can no longer live inside
  // the `billing.free` branch below — a split render that failed would have
  // returned its wallet hold and quietly kept the allowance.
  if (!succeeded && billing.allowanceSpent) {
    await returnAllowance(userId, billing.allowanceSpent);
  }

  if (billing.free) {
    if (succeeded) {
      logger.info(
        `[onboarding][credits] allowance render delivered user=${userId} board=${boardId}`,
      );
      return true;
    }
    // The budget bought nothing — already handed back above.
    //
    // `allowanceSpent` is absent on boards rendered before the allowance
    // existed: those were the genuinely free lifetime render, and the claim is
    // what has to be released instead. Old rows must keep behaving the way they
    // were written.
    if (billing.allowanceSpent) return true;
    return returnFreeRender(userId, sessionId);
  }

  // Legacy only: a board written under ONB-006, where a free-plan user spent
  // the lifetime claim AND paid. Nothing writes `freeClaimed` any more, but
  // rows that carry it still have to be settled the way they were made.
  if (!succeeded && billing.freeClaimed) {
    await returnFreeRender(userId, sessionId);
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

/**
 * Undoes payment when the render never started.
 *
 * Both forms of payment are undone independently, because a free-plan user's
 * first render takes both: the lifetime claim AND a credit hold.
 */
async function refund({ free, freeClaimed, allowanceSpent, userId, sessionId, renderId }) {
  // Whatever was actually taken comes back. Only one of these can be true for
  // any one render, but all three are checked because rows written by three
  // different versions of this file are still out there.
  if (allowanceSpent) await returnAllowance(userId, allowanceSpent);
  else if (free || freeClaimed) await returnFreeRender(userId, sessionId);

  if (free || !renderId) return true;
  await UnifiedCreditController.releaseCredits(renderId);
  return true;
}

/* ── The onboarding allowance ────────────────────────────────────────────────
   Supersedes the free-render claim (ONB-001/006). Design:
   `docs/ai/modules/onboarding/ONBOARDING_ALLOWANCE.md`.

   A budget in credits that only onboarding can spend. Not credits: nothing is
   added to the wallet and nothing here is spendable anywhere else.

   PAID PLANS ONLY, and that is not a detail. A free-plan user already holds 35
   real credits from their signup grant and spends those normally — in
   onboarding and everywhere else. Granting them an allowance on top would hand
   out the same 35 twice.                                                      */

/**
 * Can this user hold an allowance at all?
 *
 * Requires POSITIVE proof of a paid plan, which is why this does not simply
 * invert `isFreePlanUser`. That function answers "no" when `FREE_PLAN_ID` is
 * unset, because for the old free-render logic the safe direction was to give
 * a render away. Here the same answer is the expensive one: every free-plan
 * user would look paid and collect 35 on top of the 35 they already have.
 *
 * So an unconfigured `FREE_PLAN_ID` means NOBODY gets an allowance, and
 * everybody is charged normally. That fails towards the behaviour we already
 * had rather than towards giving money away, and it is loud in the log.
 */
let warnedNoFreePlanId = false;

async function canHoldAllowance(userId) {
  if (!userId) return false;
  if (!process.env.FREE_PLAN_ID) {
    // Once per process. `/eligibility` runs on every app boot for every user,
    // so an unthrottled error here would bury itself in its own repetition.
    if (!warnedNoFreePlanId) {
      warnedNoFreePlanId = true;
      logger.error(
        "[onboarding][credits] FREE_PLAN_ID is not set — refusing to grant the onboarding " +
          "allowance to anyone. Every render is charged normally until it is configured.",
      );
    }
    return false;
  }
  return !(await isFreePlanUser(userId));
}

/**
 * What is left of this user's allowance, in credits.
 *
 * `.lean()` deliberately: a hydrated document fills the schema default in, so
 * every profile that predates the field would report a full 35. That absence is
 * the whole migration (ONBOARDING_ALLOWANCE.md D5), and hydrating it away would
 * silently hand the allowance to every existing account.
 */
async function allowanceRemaining(userId) {
  if (!(await canHoldAllowance(userId))) return 0;
  const profile = await UserProfile.findOne(
    { user_id: userId },
    { onboarding_allowance_total: 1, onboarding_allowance_used: 1 },
  ).lean();
  if (!profile) return 0;
  const total = Number(profile.onboarding_allowance_total) || 0;
  const used = Number(profile.onboarding_allowance_used) || 0;
  return Math.max(total - used, 0);
}

/**
 * Spend `amount` from the allowance, all or nothing.
 *
 * ATOMIC, and it has to be: two tabs pressing Generate in the same moment must
 * not both be told the budget covered them. The `$expr` guard means the write
 * only lands while enough remains, so the second caller matches nothing and
 * falls through to the wallet — the same discipline the free-render claim used.
 *
 * Returns how much the allowance actually paid — 0 when it paid nothing.
 *
 * PARTIAL BY DESIGN (ONB-010, supersedes D1). It takes whatever it can up to
 * `max` and leaves the caller to fund the rest. The rule it replaces was all-
 * or-nothing, and it existed to stop a user being told "free" and then charged
 * the remainder. That risk is now handled where it belongs — the user is shown
 * the split and confirms it BEFORE anything is taken — so the budget no longer
 * has to rot just because it cannot cover a whole render on its own.
 *
 * Read-then-write, so it retries: the amount to take depends on what remains,
 * and the `$expr` guard only lets the write land while that much is still
 * there. A losing racer re-reads and takes the smaller share rather than
 * overdrawing. Three attempts, then it gives up and funds nothing from the
 * budget — a wallet charge is recoverable, a negative allowance is not.
 */
async function drawAllowance(userId, max) {
  if (!max || max <= 0) return 0;
  if (!(await canHoldAllowance(userId))) return 0;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const remaining = await allowanceRemaining(userId);
    const take = Math.min(remaining, max);
    if (take <= 0) return 0;

    // eslint-disable-next-line no-await-in-loop
    const spent = await UserProfile.findOneAndUpdate(
      {
        user_id: userId,
        $expr: {
          $gte: [
            {
              $subtract: [
                { $ifNull: ["$onboarding_allowance_total", 0] },
                { $ifNull: ["$onboarding_allowance_used", 0] },
              ],
            },
            take,
          ],
        },
      },
      { $inc: { onboarding_allowance_used: take } },
      { new: true, projection: { onboarding_allowance_total: 1, onboarding_allowance_used: 1 } },
    ).lean();

    if (!spent) continue; // somebody else got there first; re-read and retry

    const left =
      (Number(spent.onboarding_allowance_total) || 0) -
      (Number(spent.onboarding_allowance_used) || 0);
    logger.info(
      `[onboarding][credits] allowance drew ${take}/${max} user=${userId} remaining=${left}`,
    );
    return take;
  }

  logger.warn(
    `[onboarding][credits] allowance draw contended out user=${userId} max=${max} — wallet funds all of it`,
  );
  return 0;
}

/**
 * How one render is paid for: some budget, the rest wallet.
 *
 * The single place that decides the split, so the quote the user is shown and
 * the charge that is taken cannot drift apart in their arithmetic.
 */
async function splitCharge(userId, amount) {
  const fromAllowance = await drawAllowance(userId, amount);
  return { fromAllowance, fromWallet: Math.max(0, amount - fromAllowance) };
}

/**
 * Back-compat wrapper: "did the budget cover the WHOLE thing".
 *
 * Kept because it reads well at call sites that genuinely mean all-or-nothing,
 * and because it is exported. It draws partially like everything else now, so
 * it returns what it could not use.
 */
async function spendAllowance(userId, amount) {
  const { fromAllowance, fromWallet } = await splitCharge(userId, amount);
  if (fromWallet === 0 && fromAllowance > 0) return true;
  if (fromAllowance > 0) await returnAllowance(userId, fromAllowance);
  return false;
}

/**
 * Give allowance back — the render it paid for never happened.
 *
 * Floored at zero rather than trusted to balance, because a double-return is a
 * bug that would otherwise mint budget out of nothing.
 */
async function returnAllowance(userId, amount) {
  if (!amount || amount <= 0) return false;
  await UserProfile.updateOne(
    { user_id: userId, onboarding_allowance_used: { $gte: amount } },
    { $inc: { onboarding_allowance_used: -amount } },
  );
  logger.info(`[onboarding][credits] allowance returned ${amount} user=${userId}`);
  return true;
}


/* ── Template-ad billing (Recreate) ──────────────────────────────────────────
   A recreate is a SEPARATE purchase from the onboarding storyboard render, and
   keeping it separate is the whole point of this section rather than a flag on
   `securePayment`.

   `securePayment` claims the one lifetime FREE render (`claimFreeRender`). A
   recreate must never do that: the free render is the promise the entry banner
   makes about a first onboarding clip, and spending it on a template recreate
   would retire that banner for a render the user never asked to be free. So
   this path freezes and settles like any ordinary paid action, and never
   touches the claim.

   Contract: `/TEMPLATE_AD_GENERATION_API_CONTRACT.md`.                        */

// The image model and quality tier a recreate renders at. Fixed server-side,
// like everything else in onboarding (ONB-004) — there is no picker.
//
// The model is sent ON THE REQUEST, not left to the deployment default, and
// that is deliberate: the image route documents `meta.model` as "the request's
// model override, OR EMPTY for the configured default". An empty string prices
// at 0, which `priceFor` turns into "unpriced model, hold at the ceiling" —
// a silent mis-charge. Naming it makes the render and the charge the same model
// by construction, and `meta.model` echoes it back as proof.
const TEMPLATE_AD_IMAGE_MODEL = "gemini-3.1-flash-image";

// Low tier — Nano Banana 2 is priced low 1 / medium 2 / high 3 / ultra_high 4
// in the admin registry, so a recreate costs ONE credit.
//
// Worth knowing before anyone changes this: the tier is OUR pricing dimension
// only. The from-template route takes no `quality` field — its nearest knob is
// `resolution` ("1K", "2K"), which we do not send, so DS renders at whatever
// the deployment defaults to. Charging the low tier does not make DS render
// cheaply; if that is the intent, it is a `resolution` on the request, not this
// constant.
const TEMPLATE_AD_IMAGE_QUALITY = "low";

/**
 * Per-image credit rate for the recreate image model, at its quality tier.
 *
 * Quality-aware, because image models are priced per tier in the admin registry
 * (Nano Banana 2: low 1 / medium 2 / high 3 / ultra_high 4) and the flat
 * `getModelDeduction` would read the model's headline rate instead of the tier
 * we actually render at.
 */
function imageRateFor(model) {
  const key = String(model || "").trim() || TEMPLATE_AD_IMAGE_MODEL;
  return (
    Number(
      UnifiedCreditController.getModelDeductionByQuality(key, TEMPLATE_AD_IMAGE_QUALITY),
    ) || 0
  );
}

/**
 * What one recreate costs, from the `meta` DS returned on the 202.
 *
 * ── Why this is not `priceFor` ──────────────────────────────────────────────
 * `priceFor` is a per-SECOND video formula: `rate x duration_s x count`. The
 * image route's meta is `{template_id, model, variations}` — no `duration_s`,
 * no `count`. Every field it reads is absent and every fallback happens to be
 * wrong for an image, so a 3-credit image would price as 3 x 8 x 1 = 24.
 * Eight times over, with no error anywhere.
 *
 * Images are priced PER IMAGE (the admin registry says so: "4 / image"), so
 * the only multiplier is how many takes were rendered.
 */
function priceForTemplateAd(kind, meta) {
  const variations = Math.max(Number(meta?.variations) || 1, 1);

  if (kind === "image") {
    const rate = imageRateFor(meta?.model);
    if (!rate) {
      logger.error(
        "[onboarding][credits] unpriced IMAGE model from DS — holding at ceiling. " +
          `model="${meta?.model}" quality="${TEMPLATE_AD_IMAGE_QUALITY}". ` +
          "Add it to the admin AI Models registry or every recreate is mispriced.",
      );
      return 0;
    }
    return rate * variations;
  }

  // Video: the same per-second shape the storyboard render uses, with
  // `variations` where that one reads `count` — the two contracts name the
  // same idea differently.
  const rate = rateFor(meta?.model);
  if (!rate) {
    logger.error(
      `[onboarding][credits] unpriced VIDEO model from DS — holding at ceiling. model="${meta?.model}"`,
    );
    return 0;
  }
  const seconds = Number(meta?.duration_s) || CEILING_DURATION_S;
  return rate * seconds * variations;
}

/**
 * The hold taken BEFORE the call, when we do not yet know what DS will report.
 *
 * Erring high is the safe direction: it can only ever refund. For images that
 * is the tier we render at times one take; for video it is onboarding's own
 * existing ceiling (`veo-3.1-fast` x 8s = 32), unchanged.
 */
function templateAdCeiling(kind) {
  if (kind === "image") return imageRateFor(TEMPLATE_AD_IMAGE_MODEL);
  return ceilingAmount();
}

/**
 * Freeze for one recreate. No free claim, ever — see the section header.
 *
 * Returns `{ ok: true, renderId, amount }` or `{ ok: false, reason }`.
 */
async function secureTemplateAdPayment({
  userId,
  sessionId,
  templateId,
  renderId,
  kind,
  maxWalletCredits,
}) {
  const amount = templateAdCeiling(kind);
  if (!amount) {
    // A rate of zero means the configuration is missing, not that this is free.
    // Charging nothing is never a safe default for a paid render.
    logger.error(
      `[onboarding][credits] template-ad ceiling computed as 0 (kind=${kind}) — ` +
        "model configuration missing. Refusing to render.",
    );
    return { ok: false, reason: "not_configured" };
  }

  // Same rule as a storyboard render: the budget pays what it can and the
  // wallet covers the rest (ONB-010).
  const { fromAllowance, fromWallet } = await splitCharge(userId, amount);

  if (fromWallet === 0) {
    logger.info(
      `[onboarding][credits] recreate covered by allowance ${fromAllowance} user=${userId} ` +
        `template=${templateId} kind=${kind}`,
    );
    return {
      ok: true,
      renderId,
      amount: 0,
      total: amount,
      allowanceSpent: fromAllowance,
      coveredByAllowance: true,
    };
  }

  // The wallet's share grew between the quote and now — see `securePayment`.
  if (maxWalletCredits != null && fromWallet > Number(maxWalletCredits)) {
    if (fromAllowance) await returnAllowance(userId, fromAllowance);
    logger.info(
      `[onboarding][credits] recreate quote stale user=${userId} template=${templateId} ` +
        `quoted=${maxWalletCredits} now=${fromWallet} — refusing`,
    );
    return {
      ok: false,
      reason: "price_changed",
      walletAmount: fromWallet,
      allowanceAmount: fromAllowance,
      total: amount,
    };
  }

  const freeze = await UnifiedCreditController.freezeCredits({
    userId,
    reservationKey: renderId,
    amount: fromWallet,
    meta: {
      service_type: kind === "image" ? "ad_creative" : "ad_video",
      surface: "onboarding_recreate",
      sessionId,
      templateId,
      ceiling: true,
    },
  });

  if (!freeze.ok) {
    // The budget was drawn above and nothing is rendering, so it goes back.
    if (fromAllowance) await returnAllowance(userId, fromAllowance);
    return {
      ok: false,
      reason: freeze.reason === "NO_BASE_PLAN" ? "no_plan" : "insufficient_credits",
    };
  }

  logger.info(
    `[onboarding][credits] recreate hold ${fromWallet} (+${fromAllowance} allowance, ` +
      `ceiling ${amount}) user=${userId} session=${sessionId} template=${templateId} ` +
      `kind=${kind} render=${renderId}`,
  );
  return {
    ok: true,
    renderId,
    amount: fromWallet,
    total: amount,
    allowanceSpent: fromAllowance,
    coveredByAllowance: false,
  };
}

/**
 * Hand back the unused part of the hold as soon as DS says what it is rendering.
 *
 * Same discipline as `trueUp`: an actual ABOVE the ceiling is never charged —
 * the render is already queued and cancelling it would cost the user their ad
 * to fix our accounting — it is held at the ceiling and logged loudly.
 */
async function trueUpTemplateAd({ renderId, frozenAmount, allowanceSpent = 0, meta, kind }) {
  if (!renderId) return frozenAmount;

  // Total held across both purses — see `trueUp` for why the wallet's share
  // alone is the wrong thing to compare DS's number against.
  const held = frozenAmount + (Number(allowanceSpent) || 0);

  const actual = priceForTemplateAd(kind, meta);
  if (!actual || actual >= held) {
    if (actual > held) {
      logger.error(
        `[onboarding][credits] recreate actual ${actual} EXCEEDS ceiling ${held} ` +
          `(kind=${kind} model=${meta?.model}) — holding at ceiling.`,
      );
    }
    return frozenAmount;
  }

  // Wallet first — the user's real credits come back before their budget does.
  const newWallet = Math.max(0, actual - (Number(allowanceSpent) || 0));
  if (newWallet >= frozenAmount) return frozenAmount;

  await UnifiedCreditController.releasePartial(renderId, newWallet);
  logger.info(
    `[onboarding][credits] recreate trued up render=${renderId} wallet ${frozenAmount} -> ` +
      `${newWallet} (actual ${actual}, allowance ${allowanceSpent})`,
  );
  return newWallet;
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
  isFreePlanUser,
  // The onboarding allowance
  allowanceRemaining,
  spendAllowance,
  drawAllowance,
  splitCharge,
  returnAllowance,
  canHoldAllowance,
  // Recreate (template ad) — a separate purchase; never claims the free render.
  secureTemplateAdPayment,
  trueUpTemplateAd,
  priceForTemplateAd,
  templateAdCeiling,
  TEMPLATE_AD_IMAGE_MODEL,
  _internals: {
    DS_MODEL_TO_CONFIG_KEY,
    rateFor,
    CEILING_DURATION_S,
    ONBOARDING_MODEL_KEY,
    imageRateFor,
    TEMPLATE_AD_IMAGE_QUALITY,
  },
};
