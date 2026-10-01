/**
 * watermarkPolicy — "does this user's generated media carry the AdsGPT logo?"
 *
 * One answer, because it is a commercial rule and five request bodies across
 * two product surfaces (Ad Studio template images, onboarding clips, onboarding
 * template ads) have to agree on it. Written inline at each call site it would
 * be the same rule copied five times, and "paid users get the logo too" would
 * one day be a five-file change with one file forgotten.
 *
 * The rule (product decision 2026-10-01): FREE plan renders are watermarked,
 * every paid plan's are clean.
 *
 * ── Who sends this, and to whom ───────────────────────────────────────────
 * DS added a `watermark` boolean to its generation endpoints in v1.2.10 (see
 * API_UPDATES.md). It burns the mark in during a finishing pass and returns a
 * single URL. That is NOT how the older AdVideo surface works
 * (controllers/videoController.js), where DS returns both `url` and
 * `watermarkUrl` and the controller picks one by plan. Those two mechanisms are
 * unrelated; this file is only about the new request flag.
 *
 * ── Why this does not call renderBilling.isFreePlanUser ───────────────────
 * It answers the same question from the same two inputs — `FREE_PLAN_ID` and
 * the profile's `subscription_plan_id` — so the two cannot disagree about WHICH
 * plan is free. They deliberately disagree about one thing: what to do when
 * `FREE_PLAN_ID` is not configured.
 *
 *   billing  → "not free", so a missing env var gives a render away and never
 *              overcharges anyone. Right direction for money.
 *   watermark → "free", so a missing env var MARKS the output.
 *
 * Inverting that here matters because `FREE_PLAN_ID` is a placeholder in
 * example.env and setting it in prod is still an open checklist item. Borrowing
 * billing's direction would mean one unset variable silently shipping clean,
 * unbranded assets to the entire free tier — the one failure nobody would
 * notice from the inside.
 */

const UserProfile = require("../Module/user/userProfileModel");
const logger = require("./logger");

/**
 * @param {string} userId
 * @returns {Promise<boolean>} true when the render should carry the logo.
 *
 * Never throws: a watermark decision must not be the reason a paid-for
 * generation fails to start. A Mongo hiccup marks the output (the recoverable
 * direction — a paid user complains and we fix it; the other way round we have
 * given away unbranded media and will never hear about it).
 */
async function shouldWatermark(userId) {
  const freePlanId = String(process.env.FREE_PLAN_ID || "").trim();
  if (!freePlanId) {
    logger.warn(
      "[watermark] FREE_PLAN_ID is not set — watermarking every render, " +
        "including paid plans. Set it to stop marking paying customers' media.",
    );
    return true;
  }

  try {
    const profile = await UserProfile.findOne(
      { user_id: userId },
      { subscription_plan_id: 1 },
    ).lean();
    const planId = String(profile?.subscription_plan_id || "").trim();
    // No profile, or a profile carrying no plan, is not a PAYING customer —
    // mark it. Only a plan id we can read and that is not the free one buys a
    // clean render. (Such a user is normally refused earlier anyway: Ad Studio's
    // freeze answers NO_BASE_PLAN. This is the belt, not the braces.)
    if (!planId) return true;
    return planId === freePlanId;
  } catch (error) {
    logger.warn("[watermark] plan lookup failed — marking this render", {
      userId,
      message: error?.message,
    });
    return true;
  }
}

module.exports = { shouldWatermark };
