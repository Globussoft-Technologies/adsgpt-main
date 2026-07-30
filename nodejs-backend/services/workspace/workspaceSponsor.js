const UserProfile = require("../../Module/user/userProfileModel");
const { workspaceError } = require("./workspaceConfig");

function planIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function expiryTime(value) {
  if (!value) return Number.NaN;
  const raw = String(value);
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return Date.UTC(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
      23,
      59,
      59,
      999,
    );
  }
  return new Date(value).getTime();
}

function evaluateSponsor(profile, {
  now = Date.now(),
  allowedPlanIds = process.env.WORKSPACE_SPONSOR_PLAN_IDS,
  excludedPlanIds = process.env.WORKSPACE_NON_SPONSOR_PLAN_IDS,
} = {}) {
  if (!profile || profile.is_deleted) return { eligible: false, reason: "profile_missing" };

  const allowed = planIds(allowedPlanIds);
  const excluded = planIds(excludedPlanIds);
  const subscriptions =
    profile.subscriptions && typeof profile.subscriptions === "object"
      ? profile.subscriptions
      : {};

  const active = Object.entries(subscriptions).find(([id, expiry]) => {
    const planId = String(id);
    if (excluded.has(planId)) return false;
    if (allowed.size && !allowed.has(planId)) return false;
    return expiryTime(expiry) >= Number(now);
  });

  return active
    ? { eligible: true, planId: String(active[0]), reason: null }
    : { eligible: false, planId: null, reason: "active_paid_plan_required" };
}

async function requireSponsor(userId, dependencies = {}) {
  const Profile = dependencies.UserProfile || UserProfile;
  const profile = await Profile.findOne({
    user_id: String(userId || "").trim(),
    is_deleted: { $ne: true },
  }).lean();
  const eligibility = evaluateSponsor(profile, dependencies);
  if (!eligibility.eligible) {
    throw workspaceError(
      "WORKSPACE_SPONSOR_PLAN_REQUIRED",
      "An active subscription is required to manage workspace members",
      403,
    );
  }
  return { profile, ...eligibility };
}

module.exports = { evaluateSponsor, expiryTime, planIds, requireSponsor };
