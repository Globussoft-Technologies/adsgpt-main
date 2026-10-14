// Account deletion with a cooling period (see DELETE.md).
//
// Deleting an account no longer wipes anything straight away. The profile is
// marked `is_deleted` with a `deletion_scheduled_at` timestamp, every login and
// every authenticated request is refused with ACCOUNT_PENDING_DELETION, and the
// user can restore the account until the cooling period runs out. After that the
// hourly purge cron removes the user from aMember, Firebase, S3 and MongoDB.
//
// "Pending deletion" means is_deleted AND deletion_scheduled_at. Profiles
// soft-deleted by the old flow have is_deleted but no deletion_scheduled_at:
// their aMember account is already gone, so they are neither restorable nor
// purged, and the signup paths keep reusing them as before.
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const UserProfile = require("../../Module/user/userProfileModel");
const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const { deleteFromS3 } = require("../../storage/s3");
const { sendDeletionReminderEmail } = require("./accountDeletionEmail");
const logger = require("../../utils/logger");

const PENDING_CODE = "ACCOUNT_PENDING_DELETION";
const REMINDER_DAYS_BEFORE = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const coolingDays = () => {
  const days = parseInt(process.env.ACCOUNT_DELETION_COOLING_DAYS || "15", 10);
  return Number.isFinite(days) && days > 0 ? days : 15;
};

const isPendingDeletion = (profile) =>
  Boolean(profile?.is_deleted && profile?.deletion_scheduled_at);

const purgeDateFor = (profile) =>
  new Date(new Date(profile.deletion_scheduled_at).getTime() + coolingDays() * DAY_MS);

// Body for the 403 every login endpoint returns for a pending account. Carries
// both `ok` and `success` because the mobile and web handlers use different keys.
const pendingDeletionBody = (profile) => {
  const purgeAt = purgeDateFor(profile);
  return {
    ok: false,
    success: false,
    statusCode: 403,
    code: PENDING_CODE,
    message: `Your account is scheduled for deletion on ${purgeAt.toDateString()}.`,
    error: `Your account is scheduled for deletion on ${purgeAt.toDateString()}.`,
    deletion_scheduled_at: profile.deletion_scheduled_at,
    purge_at: purgeAt,
    nextAction: "PROMPT_RESTORE_ACCOUNT",
  };
};

class AccountPendingDeletionError extends Error {
  constructor(profile) {
    super("Account is pending deletion");
    this.code = PENDING_CODE;
    this.status = 403;
    this.body = pendingDeletionBody(profile);
  }
}

// Looks a pending profile up by any identifier a login flow has to hand.
const findPendingDeletionProfile = async ({ userId, amemberUserId, email, firebaseUid, login } = {}) => {
  const numericId = (amemberUserId || userId)
    ? String(amemberUserId || userId).replace(/^(GPT|PAS)-/, "")
    : null;
  const conditions = [];
  if (numericId) conditions.push({ amember_user_id: numericId }, { user_id: `GPT-${numericId}` });
  if (email) conditions.push({ email: String(email).toLowerCase().trim() });
  if (firebaseUid) conditions.push({ firebase_uid: firebaseUid });
  if (login) conditions.push({ login });
  if (!conditions.length) return null;

  return UserProfile.findOne({
    $or: conditions,
    is_deleted: true,
    deletion_scheduled_at: { $ne: null },
  }).lean();
};

// Throws AccountPendingDeletionError when the identifiers match a pending account.
const assertNotPendingDeletion = async (identifiers) => {
  const pending = await findPendingDeletionProfile(identifiers);
  if (pending) throw new AccountPendingDeletionError(pending);
};

// ── Hot-path check for authenticateJWT / socket auth ────────────────────────
// Every authenticated request runs this, so results are cached briefly per
// process. Scheduling or restoring in this process clears the entry at once;
// another process sees the change within CACHE_TTL_MS.
const CACHE_TTL_MS = 30 * 1000;
const blockedCache = new Map();

const isUserIdPendingDeletion = async (userId) => {
  if (!userId) return false;
  const key = String(userId);
  const cached = blockedCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.blocked;

  const numericId = key.replace(/^(GPT|PAS)-/, "");
  const blocked = Boolean(
    await UserProfile.exists({
      $or: [{ user_id: key }, { amember_user_id: numericId }],
      is_deleted: true,
      deletion_scheduled_at: { $ne: null },
    }),
  );
  if (blockedCache.size > 50000) blockedCache.clear();
  blockedCache.set(key, { blocked, expires: Date.now() + CACHE_TTL_MS });
  return blocked;
};

const forgetCachedStatus = (profile) => {
  for (const id of [profile?.user_id, profile?.amember_user_id, `GPT-${profile?.amember_user_id}`]) {
    if (id) blockedCache.delete(String(id));
  }
};

// ── Schedule / restore ───────────────────────────────────────────────────────
// The aMember user is locked (inactive) for the whole cooling period, so the
// account can't be used through aMember directly either. Form-encoded, like
// every other aMember user update in this codebase.
const setAmemberLockStatus = async (amemberId, isLocked) => {
  if (!amemberId) return false;
  try {
    const url = `${process.env.AMEMBER_BASE_API_URL}/users/${amemberId}?_key=${process.env.AMEMBER_API_KEY}`;
    const params = new URLSearchParams({ is_locked: isLocked ? "1" : "0" });
    const resp = await axios.put(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = resp?.data;
    if (data?.error === true || data?.ok === false) {
      throw new Error(JSON.stringify(data));
    }
    logger.info(`[account-deletion] aMember user ${amemberId} is_locked=${isLocked ? 1 : 0}`);
    return true;
  } catch (err) {
    logger.error(`[account-deletion] failed to set is_locked=${isLocked ? 1 : 0} for aMember user ${amemberId}: ${err.message}`);
    return false;
  }
};

const amemberIdOf = (profile) =>
  String(profile?.amember_user_id || profile?.user_id || "").replace(/^(GPT|PAS)-/, "");

// aMember refuses check-access for a locked user, so a pending account's
// password can't be checked directly. Unlock, check, and lock again: the
// unlocked window is a single check-access call.
const checkPendingAccountPassword = async (pending, password) => {
  const amemberId = amemberIdOf(pending);
  const qs = new URLSearchParams({
    _key: process.env.AMEMBER_API_KEY,
    login: pending.login || pending.email,
    pass: password,
  });
  await setAmemberLockStatus(amemberId, false);
  try {
    const resp = await fetch(`${process.env.AMEMBER_BASE_API_URL}/check-access/by-login-pass?${qs}`);
    const data = await resp.json();
    return Boolean(data?.ok);
  } finally {
    await setAmemberLockStatus(amemberId, true);
  }
};

const scheduleAccountDeletion = async (profile, reason = "") => {
  profile.is_deleted = true;
  profile.deleted_at = new Date();
  profile.deletion_scheduled_at = new Date();
  profile.deletion_reminder_sent = false;
  profile.delete_reason = String(reason || "").slice(0, 500);
  await profile.save();
  forgetCachedStatus(profile);

  await setAmemberLockStatus(amemberIdOf(profile), true);

  return { deletion_scheduled_at: profile.deletion_scheduled_at, purge_at: purgeDateFor(profile) };
};

const restorePendingAccount = async (profile) => {
  const restored = await UserProfile.findOneAndUpdate(
    { _id: profile._id, is_deleted: true, deletion_scheduled_at: { $ne: null } },
    {
      $set: {
        is_deleted: false,
        deleted_at: null,
        deletion_scheduled_at: null,
        deletion_reminder_sent: false,
        delete_reason: "",
      },
    },
    { new: true },
  );
  forgetCachedStatus(profile);

  if (restored) await setAmemberLockStatus(amemberIdOf(restored), false);

  return restored;
};

// ── Purge ────────────────────────────────────────────────────────────────────
// The worker process only loads the models its crons require, so load every
// model file before the wipe; otherwise mongoose.models would miss most of them.
let modelsLoaded = false;
const loadAllModels = () => {
  if (modelsLoaded) return;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        try { require(full); } catch (err) {
          logger.warn(`[account-purge] could not load model file ${full}: ${err.message}`);
        }
      }
    }
  };
  walk(path.join(__dirname, "../../Module"));
  modelsLoaded = true;
};

// Kept for audit / Apple subscription lineage, never wiped by the purge.
const PRESERVED_MODELS = new Set(["UserProfile", "MobileStoreTransaction"]);

const mediaKey = (value) => {
  if (!value) return null;
  const raw = typeof value === "string" ? value : value.s3_key || value.key || value.url;
  if (!raw || typeof raw !== "string") return null;
  if (/^https?:\/\//i.test(raw)) {
    try { return decodeURIComponent(new URL(raw).pathname.replace(/^\/+/, "")); } catch { return null; }
  }
  return raw;
};

const deleteAmemberUser = async (amemberId) => {
  if (!amemberId) return;
  try {
    const resp = await axios.delete(
      `${process.env.AMEMBER_BASE_API_URL}/users/${amemberId}?_key=${process.env.AMEMBER_API_KEY}`,
    );
    // aMember can answer 200 with an error body; "not found" means already gone.
    const data = resp.data;
    const errored = data?.error === true || data?.ok === false;
    if (errored && !/not\s*found/i.test(JSON.stringify(data))) {
      throw new Error(`aMember delete error: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    if (err.response?.status === 404) return;
    throw err;
  }
};

const deleteFirebaseUser = async (firebaseUid) => {
  if (!firebaseUid) return;
  const admin = require("firebase-admin");
  if (!admin.apps?.length) return;
  try {
    await admin.auth().deleteUser(firebaseUid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }
};

const purgeAccount = async (user) => {
  const userId = user.user_id;
  const amemberId = String(user.amember_user_id || userId || "").replace(/^(GPT|PAS)-/, "");

  // External systems first: if one fails the profile stays pending and the
  // next hourly run retries, instead of leaving an orphaned login behind.
  await deleteAmemberUser(amemberId);
  await deleteFirebaseUser(user.firebase_uid);

  const media = await GeneratedMedia.find({ userId }).select("image video").lean();
  for (const item of media) {
    for (const key of [mediaKey(item.image), mediaKey(item.video)]) {
      if (key) await deleteFromS3(key);
    }
  }

  loadAllModels();
  for (const Model of Object.values(mongoose.models)) {
    if (PRESERVED_MODELS.has(Model.modelName)) continue;
    const or = [];
    if (Model.schema.path("user_id")) or.push({ user_id: userId });
    if (Model.schema.path("userId")) or.push({ userId });
    if (!or.length) continue;
    try {
      const { deletedCount } = await Model.deleteMany({ $or: or });
      if (deletedCount) logger.info(`[account-purge] ${userId}: removed ${deletedCount} from ${Model.modelName}`);
    } catch (err) {
      // e.g. an ObjectId-typed userId cannot hold "GPT-123"; nothing to delete there.
      logger.warn(`[account-purge] ${userId}: skipped ${Model.modelName}: ${err.message}`);
    }
  }

  await UserProfile.deleteOne({ _id: user._id });
  forgetCachedStatus(user);
};

const sendDueReminders = async () => {
  const now = Date.now();
  const days = coolingDays();
  if (days <= REMINDER_DAYS_BEFORE) return;
  // Reminder is due REMINDER_DAYS_BEFORE days ahead of the purge. The 2-hour
  // lead lets an hourly run send it before the matching purge run 3 days later.
  const remindBefore = new Date(now - (days - REMINDER_DAYS_BEFORE) * DAY_MS + 2 * 60 * 60 * 1000);
  const purgeCutoff = new Date(now - days * DAY_MS);

  const users = await UserProfile.find({
    is_deleted: true,
    deletion_reminder_sent: { $ne: true },
    deletion_scheduled_at: { $ne: null, $lte: remindBefore, $gt: purgeCutoff },
  });

  for (const user of users) {
    try {
      if (user.email) {
        const daysLeft = Math.max(1, Math.ceil((purgeDateFor(user).getTime() - now) / DAY_MS));
        await sendDeletionReminderEmail(user.email, user.name_f || user.name, daysLeft);
      }
      user.deletion_reminder_sent = true;
      await user.save();
      logger.info(`[account-purge] reminder sent for ${user.user_id}`);
    } catch (err) {
      logger.error(`[account-purge] reminder failed for ${user.user_id}: ${err.message}`);
    }
  }
};

const purgeExpiredAccounts = async () => {
  await sendDueReminders();

  const cutoff = new Date(Date.now() - coolingDays() * DAY_MS);
  const users = await UserProfile.find({
    is_deleted: true,
    deletion_scheduled_at: { $ne: null, $lte: cutoff },
  }).lean();

  for (const user of users) {
    try {
      await purgeAccount(user);
      logger.info(`[account-purge] wiped ${user.user_id}`);
    } catch (err) {
      logger.error(`[account-purge] failed to wipe ${user.user_id}: ${err.message}`);
    }
  }
};

module.exports = {
  PENDING_CODE,
  coolingDays,
  isPendingDeletion,
  purgeDateFor,
  pendingDeletionBody,
  AccountPendingDeletionError,
  findPendingDeletionProfile,
  assertNotPendingDeletion,
  isUserIdPendingDeletion,
  scheduleAccountDeletion,
  restorePendingAccount,
  checkPendingAccountPassword,
  purgeExpiredAccounts,
};
