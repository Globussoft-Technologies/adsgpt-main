/**
 * billingReconciliation.js — grant renewed credits without waiting for a login.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Credit refill has only ever been triggered from the login path
 * (syncUserProfile → UnifiedCreditController.refreshBillingCycle). That means a
 * user whose subscription rebills in aMember gets nothing until they next sign
 * in. Combined with the old drifting-clock bug that produced a real incident:
 * a paying customer sat at 6 credits for days after a successful rebill.
 *
 * The controller fix stops the drift, but the login dependency remains — a user
 * who renews and doesn't log in for a fortnight is still un-credited that whole
 * time, and any generation they do attempt is charged against the previous
 * cycle's remainder. This job closes that gap by reconciling against aMember on
 * a schedule instead of on user activity.
 *
 * ─── Why it must call aMember ────────────────────────────────────────────────
 * It would be cheaper to read subscription_expiry off the local profile, but
 * that field is ALSO only written at login. For exactly the users this job is
 * meant to catch it still holds the pre-renewal expiry, so a local-only check
 * would be blind to the very renewals it is looking for. aMember is the only
 * source that knows a rebill happened.
 *
 * ─── Scope: same-plan renewals only ──────────────────────────────────────────
 * If aMember's active product differs from the stored plan, this job skips the
 * user and leaves them to the login path. Plan changes carry rollover rules
 * (upgrade / downgrade / resubscribe-after-lapse) that syncUserProfile resolves
 * with more context than a nightly sweep has; guessing here could grant the
 * wrong allocation. Renewal of the same plan is unambiguous, so that is all we
 * take responsibility for.
 */

require("dotenv").config();
const axios = require("axios");

const logger = require("../utils/logger");
const UserProfile = require("../Module/user/userProfileModel");
const CreditReservation = require("../Module/credit/creditReservationModel");
const UnifiedCreditController = require("../controllers/UnifiedCreditController");

const AMEMBER_URL = process.env.AMEMBER_BASE_API_URL;
const AMEMBER_KEY = process.env.AMEMBER_API_KEY;
const TOPUP_PLAN_ID = String(process.env.topUpPlanID || "18");

const DAY_MS = 24 * 60 * 60 * 1000;
// Mirrors CYCLE_ANCHOR_TOLERANCE_MS in UnifiedCreditController so this job and
// the login path agree on what counts as "a new cycle started".
const ANCHOR_TOLERANCE_MS = DAY_MS;
const PAGE_SIZE = 100;
// aMember has a few thousand access rows; this only bounds a runaway loop.
const MAX_PAGES = 200;

/** Parse an aMember "YYYY-MM-DD" as UTC midnight. Returns null if unusable. */
function parseAmemberDate(value) {
  if (!value || typeof value !== "string") return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** aMember returns records under numeric keys alongside `_`-prefixed metadata. */
function extractRecords(payload) {
  return Object.entries(payload || {})
    .filter(
      ([k, v]) => !k.startsWith("_") && typeof v === "object" && v !== null,
    )
    .map(([, v]) => v);
}

/**
 * Pull every access record from aMember, one page at a time.
 * One bulk read per run beats N per-user calls across a few thousand rows.
 */
async function fetchAllAccess() {
  if (!AMEMBER_URL || !AMEMBER_KEY) {
    throw new Error(
      "AMEMBER_BASE_API_URL / AMEMBER_API_KEY not configured — cannot reconcile",
    );
  }

  const all = [];
  let total = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${AMEMBER_URL}/access?_key=${AMEMBER_KEY}` +
      `&_count=${PAGE_SIZE}&_page=${page}`;
    const { data } = await axios.get(url, { timeout: 30000 });

    if (data?.error === true || data?.ok === false) {
      throw new Error(
        `aMember /access returned an error body: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    if (page === 0 && Number.isFinite(Number(data?._total))) {
      total = Number(data._total);
    }

    const records = extractRecords(data);
    all.push(...records);

    // Stop on a short page as well as on the count — aMember's _total can drift
    // mid-pagination if rows are written while we read.
    if (records.length < PAGE_SIZE) break;
    if (total !== null && all.length >= total) break;
  }

  return all;
}

/**
 * The user's current base-plan access: not a top-up, not expired, latest expiry.
 * aMember keeps one row per billing period, so a renewing user accumulates a
 * chain and only the newest describes the cycle they are in now.
 */
function pickActiveBaseAccess(records, now = new Date()) {
  let best = null;
  let bestExpiry = -Infinity;

  for (const r of records || []) {
    if (String(r.product_id) === TOPUP_PLAN_ID) continue;

    const expire = parseAmemberDate(r.expire_date);
    if (!expire) continue;

    // aMember access runs through the end of the expiry day.
    const expiresAt = expire.getTime() + DAY_MS - 1;
    if (expiresAt < now.getTime()) continue;

    if (expiresAt > bestExpiry) {
      bestExpiry = expiresAt;
      best = r;
    }
  }

  return best;
}

/**
 * The cycle start aMember believes the user is in.
 * begin_date is authoritative — it is the actual period boundary. Falling back
 * to expire - durationDays only matters for rows missing a begin_date.
 */
function resolveAnchor(access, durationDays) {
  const begin = parseAmemberDate(access.begin_date);
  if (begin) return begin;

  const expire = parseAmemberDate(access.expire_date);
  if (expire && Number.isFinite(durationDays) && durationDays > 0) {
    return new Date(expire.getTime() - durationDays * DAY_MS);
  }
  return null;
}

/**
 * Reconcile every active subscriber's local billing cycle against aMember.
 *
 * @param {object}  opts
 * @param {boolean} opts.dryRun  Report what would change without writing.
 * @returns {Promise<object>} counters + the per-user actions taken
 */
async function reconcileBillingCycles({ dryRun = true } = {}) {
  const startedAt = Date.now();
  const stats = {
    scanned: 0,
    refilled: 0,
    alreadyCurrent: 0,
    noActiveAccess: 0,
    planMismatch: 0,
    skippedFrozen: 0,
    unresolvableAnchor: 0,
    errors: 0,
  };
  const actions = [];

  const access = await fetchAllAccess();
  const byUser = new Map();
  for (const r of access) {
    const key = String(r.user_id);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(r);
  }
  logger.info(
    `[billing-reconcile] pulled ${access.length} access rows for ${byUser.size} aMember users`,
  );

  const profiles = await UserProfile.find({
    subscription_plan_id: { $nin: ["", null] },
    billing_cycle_start: { $ne: null },
    is_deleted: { $ne: true },
  }).lean();

  const now = new Date();

  for (const profile of profiles) {
    stats.scanned++;
    try {
      const amemberId = String(
        profile.amember_user_id || profile.user_id.replace(/^GPT-/, ""),
      );
      const activeAccess = pickActiveBaseAccess(byUser.get(amemberId), now);

      if (!activeAccess) {
        // Lapsed or cancelled. Not our business — the login path handles the
        // "plan disappeared" transition and its credit-preservation rules.
        stats.noActiveAccess++;
        continue;
      }

      const planId = String(profile.subscription_plan_id);
      if (String(activeAccess.product_id) !== planId) {
        stats.planMismatch++;
        logger.info(
          `[billing-reconcile] ${profile.user_id}: aMember plan ` +
            `${activeAccess.product_id} != stored ${planId} — leaving to login path`,
        );
        continue;
      }

      const durationDays = profile.plan_snapshot?.durationDays;
      const anchor = resolveAnchor(activeAccess, durationDays);
      if (!anchor) {
        stats.unresolvableAnchor++;
        logger.warn(
          `[billing-reconcile] ${profile.user_id}: cannot resolve cycle anchor from access ` +
            `${activeAccess.access_id}`,
        );
        continue;
      }

      const storedStart = new Date(profile.billing_cycle_start);
      if (anchor.getTime() - storedStart.getTime() <= ANCHOR_TOLERANCE_MS) {
        stats.alreadyCurrent++;
        continue;
      }

      // refreshBillingCycle zeroes used_*, but a frozen reservation will later
      // decrement those same counters on release — rewriting underneath a live
      // freeze double-refunds. Leave them; the next run picks them up.
      const frozen = await CreditReservation.countDocuments({
        user_id: profile.user_id,
      });
      if (frozen > 0) {
        stats.skippedFrozen++;
        logger.warn(
          `[billing-reconcile] ${profile.user_id}: ${frozen} in-flight reservation(s) — ` +
            `deferring refill to the next run`,
        );
        continue;
      }

      const action = {
        user_id: profile.user_id,
        login: profile.login,
        plan_id: planId,
        from: storedStart.toISOString(),
        to: anchor.toISOString(),
        drift_days: Number(
          ((anchor - storedStart) / DAY_MS).toFixed(2),
        ),
      };

      if (dryRun) {
        actions.push({ ...action, applied: false });
        logger.info(
          `[billing-reconcile] WOULD refill ${profile.user_id} (${profile.login}): ` +
            `cycle ${action.from} → ${action.to}`,
        );
        stats.refilled++;
        continue;
      }

      await UnifiedCreditController.refreshBillingCycle(
        profile.user_id,
        planId,
        anchor,
      );

      // Keep the mirrored subscription window honest too, so the profile isn't
      // showing a pre-renewal expiry until the user next signs in.
      const expire = parseAmemberDate(activeAccess.expire_date);
      if (expire) {
        await UserProfile.updateOne(
          { user_id: profile.user_id },
          {
            $set: {
              subscription_expiry: expire,
              [`subscriptions.${planId}`]: activeAccess.expire_date,
            },
          },
        );
      }

      actions.push({ ...action, applied: true });
      stats.refilled++;
      logger.info(
        `[billing-reconcile] refilled ${profile.user_id} (${profile.login}): ` +
          `cycle ${action.from} → ${action.to}`,
      );
    } catch (err) {
      stats.errors++;
      logger.error(
        `[billing-reconcile] ${profile.user_id} failed: ${err.message}`,
      );
    }
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  logger.info(
    `[billing-reconcile] ${dryRun ? "DRY RUN " : ""}done in ${seconds}s — ` +
      `scanned ${stats.scanned}, ${dryRun ? "would refill" : "refilled"} ${stats.refilled}, ` +
      `current ${stats.alreadyCurrent}, no-access ${stats.noActiveAccess}, ` +
      `plan-mismatch ${stats.planMismatch}, frozen-skip ${stats.skippedFrozen}, ` +
      `bad-anchor ${stats.unresolvableAnchor}, errors ${stats.errors}`,
  );

  if (dryRun && stats.refilled > 0) {
    logger.warn(
      `[billing-reconcile] DRY RUN — ${stats.refilled} user(s) are owed a refill and ` +
        `nothing was written. Set BILLING_RECONCILE_DRY_RUN=false to apply.`,
    );
  }

  return { stats, actions, dryRun };
}

module.exports = {
  reconcileBillingCycles,
  // exported for tests
  fetchAllAccess,
  pickActiveBaseAccess,
  resolveAnchor,
  parseAmemberDate,
};
