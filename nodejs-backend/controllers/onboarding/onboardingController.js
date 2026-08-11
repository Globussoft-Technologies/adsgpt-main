const checkUserExist = require('../../Module/adCopy/CheckUserExist');

/**
 * Onboarding Controller
 *
 * Source of truth for onboarding completion status.
 * Uses the existing `checkUserExist` Mongoose model (collection: checkuserexists).
 *
 * Endpoints (mounted on /adsgpt/adcopy via adsCopyChat.js router):
 *   POST /check-user/:userId          → read-only existence check
 *   POST /complete-onboarding/:userId → upsert completion (idempotent)
 */

/**
 * checkUserExists
 *
 * READ-ONLY check — does NOT create or modify any document.
 *
 * Response:
 *   { exists: true  } → user is in the collection → already onboarded
 *   { exists: false } → user is NOT in the collection → new user
 */
function getPossibleUserIds(rawId, reqUser) {
  const ids = new Set();
  if (rawId) {
    const sId = String(rawId);
    ids.add(sId);
    ids.add(rawId);
    if (!sId.startsWith('PAS-')) ids.add(`PAS-${sId}`);
    if (!sId.startsWith('GPT-')) ids.add(`GPT-${sId}`);
    if (sId.includes('-')) {
      const stripped = sId.split('-').slice(1).join('-');
      if (stripped) ids.add(stripped);
    }
  }
  if (reqUser?.user_id) {
    const uId = String(reqUser.user_id);
    ids.add(uId);
    if (uId.includes('-')) {
      const stripped = uId.split('-').slice(1).join('-');
      if (stripped) ids.add(stripped);
    }
  }
  if (reqUser?.id) {
    ids.add(String(reqUser.id));
  }
  return Array.from(ids).map((id) => ({ userId: id }));
}

exports.checkUserExists = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const queryOr = getPossibleUserIds(userId, req.user);
    const userDoc = await checkUserExist.findOne({ $or: queryOr }).lean();

    const exists = Boolean(userDoc && userDoc.onboardingCompleted !== false);

    return res.status(200).json({
      exists,
      onboardingCompleted: Boolean(userDoc?.onboardingCompleted),
    });
  } catch (error) {
    console.error('[Onboarding] checkUserExists error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * completeOnboarding
 *
 * WRITE — upserts the user document marking onboarding as complete.
 * Idempotent: safe to call multiple times (e.g. user clicks "Finish" twice).
 *
 * Response:
 *   { success: true }
 */
exports.completeOnboarding = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const queryOr = getPossibleUserIds(userId, req.user);
    const primaryId = req.user?.user_id || String(userId);

    await checkUserExist.findOneAndUpdate(
      { $or: queryOr },
      { $set: { userId: primaryId, onboardingCompleted: true } },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Onboarding] completeOnboarding error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * resetOnboarding
 *
 * DELETE — removes the onboarding record from checkUserExist collection
 * so the user will be prompted with the onboarding tour again on next load/refresh.
 *
 * Response:
 *   { success: true, message: "Onboarding reset successfully" }
 */
exports.resetOnboarding = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const queryOr = getPossibleUserIds(userId, req.user);
    await checkUserExist.deleteMany({ $or: queryOr });

    return res.status(200).json({ success: true, message: 'Onboarding reset successfully' });
  } catch (error) {
    console.error('[Onboarding] resetOnboarding error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
