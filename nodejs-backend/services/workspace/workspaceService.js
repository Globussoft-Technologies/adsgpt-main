const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Workspace = require("../../Module/workspace/workspace");
const WorkspaceInvitation = require("../../Module/workspace/workspaceInvitation");
const WorkspaceMemberAccount = require(
  "../../Module/workspace/workspaceMemberAccount",
);
const WorkspaceMembership = require("../../Module/workspace/workspaceMembership");
const UserProfile = require("../../Module/user/userProfileModel");
const { requireSponsor } = require("./workspaceSponsor");
const { sendInvitation } = require("./workspaceEmail");
const { hashClientSecret } = require("../oauth/clientSecretService");
const {
  normalizeEmail,
  normalizeFeatures,
  requireFeatures,
  validatePassword,
  workspaceError,
} = require("./workspaceConfig");

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCEPTANCE_STALE_MS = 2 * 60 * 1000;

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function actorId(accountOrId) {
  const id = String(accountOrId?._id || accountOrId || "").trim();
  return id ? `WM-${id}` : "";
}

function accountIdFromActor(value) {
  const id = String(value || "").replace(/^WM-/, "");
  return mongoose.isValidObjectId(id) ? id : "";
}

function displayName(profile) {
  return String(
    profile?.name ||
      [profile?.name_f, profile?.name_l].filter(Boolean).join(" ") ||
      profile?.login ||
      "",
  ).trim();
}

function memberName(account) {
  return (
    [account?.firstName, account?.lastName].filter(Boolean).join(" ").trim() ||
    account?.email ||
    "Workspace member"
  );
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Route params reach these queries verbatim. Without this guard Mongoose raises
// a CastError for anything that is not an ObjectId, which surfaces as a 500
// instead of the 404 the caller should see.
function requireObjectId(value, code, message) {
  if (!mongoose.isValidObjectId(value)) {
    throw workspaceError(code, message, 404);
  }
  return value;
}

function createWorkspaceService(overrides = {}) {
  const deps = {
    Workspace,
    WorkspaceInvitation,
    WorkspaceMemberAccount,
    WorkspaceMembership,
    UserProfile,
    now: () => new Date(),
    randomToken,
    requireSponsor,
    sendInvitation,
    invitationTtlMs: Number(process.env.WORKSPACE_INVITATION_TTL_MS) ||
      INVITATION_TTL_MS,
    exposeLinks:
      process.env.NODE_ENV !== "production" &&
      process.env.WORKSPACE_EXPOSE_INVITATION_LINK === "true",
    ...overrides,
  };

  async function ensureOwnerWorkspace(ownerUserId) {
    const ownerId = String(ownerUserId || "").trim();
    if (!ownerId || ownerId.startsWith("WM-")) {
      throw workspaceError(
        "WORKSPACE_OWNER_REQUIRED",
        "Only AdsGPT account owners can manage workspaces",
        403,
      );
    }
    const sponsor = await deps.requireSponsor(ownerId);
    let workspace = await deps.Workspace.findOne({
      ownerUserId: ownerId,
      status: "active",
    }).lean();
    if (workspace) return { workspace, sponsor };

    try {
      workspace = await deps.Workspace.create({
        ownerUserId: ownerId,
        name: displayName(sponsor.profile)
          ? `${displayName(sponsor.profile)}'s Workspace`
          : "My Workspace",
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // `ownerUserId` alone is what's uniquely indexed, so that's the only
      // filter guaranteed to find the document that just caused the
      // duplicate-key error — querying with `status: "active"` on top of it
      // left owners with a non-active row (there is no feature that sets
      // one today, but stray rows can exist) permanently stuck: every retry
      // re-hit the same E11000 and the fallback lookup kept coming back
      // empty, surfacing WORKSPACE_CREATE_CONFLICT forever instead of once.
      workspace = await deps.Workspace.findOne({ ownerUserId: ownerId }).lean();
      if (!workspace) {
        throw workspaceError(
          "WORKSPACE_CREATE_CONFLICT",
          "Workspace could not be created — please retry",
          409,
        );
      }
      if (workspace.status !== "active") {
        workspace = await deps.Workspace.findOneAndUpdate(
          { _id: workspace._id },
          { $set: { status: "active" } },
          { new: true },
        ).lean();
      }
    }
    return {
      workspace: workspace?.toObject ? workspace.toObject() : workspace,
      sponsor,
    };
  }

  async function requireOwnedWorkspace(ownerUserId, workspaceId) {
    if (!mongoose.isValidObjectId(workspaceId)) {
      throw workspaceError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
    }
    await deps.requireSponsor(ownerUserId);
    const workspace = await deps.Workspace.findOne({
      _id: workspaceId,
      ownerUserId: String(ownerUserId),
      status: "active",
    }).lean();
    if (!workspace) {
      throw workspaceError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
    }
    return workspace;
  }

  async function findAdsGptUserByEmail(email) {
    return deps.UserProfile.findOne({
      email: {
        $regex: `^${escapeRegex(normalizeEmail(email))}$`,
        $options: "i",
      },
      is_deleted: { $ne: true },
    }).lean();
  }

  async function createInvitation({
    ownerUserId,
    email,
    features,
  }) {
    const inviteeEmail = normalizeEmail(email);
    if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
      throw workspaceError(
        "WORKSPACE_EMAIL_INVALID",
        "Enter a valid email address",
        400,
      );
    }
    const selectedFeatures = requireFeatures(features);
    const { workspace } = await ensureOwnerWorkspace(ownerUserId);

    if (await findAdsGptUserByEmail(inviteeEmail)) {
      throw workspaceError(
        "WORKSPACE_PAID_INVITEE_DISABLED",
        "Inviting existing AdsGPT accounts is not available in this release",
        409,
      );
    }

    const existingAccount = await deps.WorkspaceMemberAccount.findOne({
      email: inviteeEmail,
    }).lean();
    if (existingAccount) {
      const existingMembership = await deps.WorkspaceMembership.findOne({
        workspaceId: workspace._id,
        memberAccountId: existingAccount._id,
        status: "active",
      }).lean();
      if (existingMembership) {
        throw workspaceError(
          "WORKSPACE_MEMBER_EXISTS",
          "This person is already a workspace member",
          409,
        );
      }
    }

    const rawToken = deps.randomToken();
    const now = deps.now();
    const openKey = `${workspace._id}:${inviteeEmail}`;
    const activeInvitation = await deps.WorkspaceInvitation.findOne({
      openKey,
    }).lean();
    if (activeInvitation?.status === "accepting") {
      throw workspaceError(
        "WORKSPACE_INVITE_ACCEPTING",
        "This invitation is currently being accepted",
        409,
      );
    }
    let invitation;
    try {
      invitation = await deps.WorkspaceInvitation.findOneAndUpdate(
        { openKey, status: "pending" },
        {
          $set: {
            invitedByUserId: String(ownerUserId),
            features: selectedFeatures,
            tokenHash: tokenHash(rawToken),
            expiresAt: new Date(now.getTime() + deps.invitationTtlMs),
            acceptanceAttemptId: null,
            acceptanceStartedAt: null,
          },
          $setOnInsert: {
            workspaceId: workspace._id,
            inviteeEmail,
            openKey,
            status: "pending",
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      if (error?.code === 11000) {
        throw workspaceError(
          "WORKSPACE_INVITE_ACCEPTING",
          "This invitation is currently being accepted",
          409,
        );
      }
      throw error;
    }

    const delivery = await deps.sendInvitation({
      to: inviteeEmail,
      token: rawToken,
      workspaceName: workspace.name,
    });
    const result = {
      invitation: invitation?.toObject ? invitation.toObject() : invitation,
      workspace,
      delivery,
    };
    if (deps.exposeLinks && !delivery.sent) result.rawToken = rawToken;
    return result;
  }

  async function invitationInfo(rawToken) {
    const invitation = await deps.WorkspaceInvitation.findOne({
      tokenHash: tokenHash(rawToken),
    }).lean();
    if (!invitation) {
      throw workspaceError(
        "WORKSPACE_INVITE_UNAVAILABLE",
        "Invitation is unavailable",
        404,
      );
    }
    if (invitation.expiresAt <= deps.now() && invitation.status === "pending") {
      await deps.WorkspaceInvitation.updateOne(
        { _id: invitation._id, status: "pending" },
        {
          $set: { status: "expired" },
          $unset: { openKey: 1 },
        },
      );
      invitation.status = "expired";
    }
    if (invitation.status !== "pending") {
      throw workspaceError(
        "WORKSPACE_INVITE_UNAVAILABLE",
        "Invitation is no longer available",
        410,
      );
    }
    const workspace = await deps.Workspace.findOne({
      _id: invitation.workspaceId,
      status: "active",
    }).lean();
    if (!workspace) {
      throw workspaceError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
    }
    await deps.requireSponsor(workspace.ownerUserId);
    const existingAccount = await deps.WorkspaceMemberAccount.findOne({
      email: invitation.inviteeEmail,
      status: "active",
    }).lean();
    return {
      email: invitation.inviteeEmail,
      features: normalizeFeatures(invitation.features),
      workspaceId: String(workspace._id),
      workspaceName: workspace.name,
      existingMember: Boolean(existingAccount),
      hasPassword: Boolean(existingAccount?.passwordHash),
      ...(existingAccount
        ? {
            memberName: memberName(existingAccount),
          }
        : {}),
    };
  }

  async function claimInvitation(rawToken) {
    const now = deps.now();
    const hash = tokenHash(rawToken);
    const attemptId = crypto.randomUUID();
    let invitation = await deps.WorkspaceInvitation.findOneAndUpdate(
      {
        tokenHash: hash,
        status: "pending",
        expiresAt: { $gt: now },
      },
      {
        $set: {
          status: "accepting",
          acceptanceAttemptId: attemptId,
          acceptanceStartedAt: now,
        },
      },
      { new: true },
    );
    if (invitation) return { invitation, attemptId };

    const current = await deps.WorkspaceInvitation.findOne({
      tokenHash: hash,
    }).lean();
    if (
      current?.status === "accepting" &&
      current.acceptanceStartedAt &&
      current.expiresAt > now &&
      current.acceptanceStartedAt.getTime() <=
        now.getTime() - ACCEPTANCE_STALE_MS
    ) {
      invitation = await deps.WorkspaceInvitation.findOneAndUpdate(
        {
          _id: current._id,
          status: "accepting",
          acceptanceAttemptId: current.acceptanceAttemptId,
          expiresAt: { $gt: now },
        },
        {
          $set: {
            acceptanceAttemptId: attemptId,
            acceptanceStartedAt: now,
          },
        },
        { new: true },
      );
      if (invitation) return { invitation, attemptId };
    }
    const expired =
      current?.expiresAt && new Date(current.expiresAt).getTime() <= now.getTime();
    if (
      expired &&
      (current.status === "pending" || current.status === "accepting")
    ) {
      await deps.WorkspaceInvitation.updateOne(
        {
          _id: current._id,
          status: current.status,
          ...(current.acceptanceAttemptId
            ? { acceptanceAttemptId: current.acceptanceAttemptId }
            : {}),
          expiresAt: { $lte: now },
        },
        {
          $set: {
            status: "expired",
            acceptanceAttemptId: null,
            acceptanceStartedAt: null,
          },
          $unset: { openKey: 1 },
        },
      );
    }
    throw workspaceError(
      "WORKSPACE_INVITE_UNAVAILABLE",
      current?.status === "accepting" && !expired
        ? "Invitation acceptance is already in progress"
        : "Invitation is no longer available",
      current?.status === "accepting" && !expired ? 409 : 410,
    );
  }

  async function findOrCreateAccount({ email, firstName, lastName, password }) {
    let account = await deps.WorkspaceMemberAccount.findOne({ email }).lean();
    if (account) {
      if (account.status !== "active") {
        throw workspaceError(
          "WORKSPACE_MEMBER_DISABLED",
          "This workspace member account is disabled",
          403,
        );
      }
      if (!account.passwordHash) {
        // Legacy account (created before password login existed) or a retry
        // of a previously-interrupted accept: bootstrap a password now. This
        // write is a one-time, idempotent side effect — it must never
        // re-hash or error once a password exists, and it is deliberately
        // outside acceptInvitation's compensateAcceptance rollback boundary
        // (that function only ever touches WorkspaceMembership). A stranded
        // legacy member's only path back in is being re-invited, which lands
        // here again with hasPassword still false — this is what lets them
        // finish setup without any email-link infrastructure.
        const validPassword = validatePassword(password);
        const updated = await deps.WorkspaceMemberAccount.findOneAndUpdate(
          { _id: account._id, passwordHash: null },
          { $set: { passwordHash: hashClientSecret(validPassword) } },
          { new: true },
        ).lean();
        account = updated || account;
      }
      return { account, created: false };
    }
    const normalizedFirstName = String(firstName || "").trim();
    if (!normalizedFirstName || normalizedFirstName.length > 80) {
      throw workspaceError(
        "WORKSPACE_MEMBER_NAME_INVALID",
        "Enter a valid first name",
        400,
      );
    }
    const validPassword = validatePassword(password);
    try {
      account = await deps.WorkspaceMemberAccount.create({
        email,
        firstName: normalizedFirstName,
        lastName: String(lastName || "").trim(),
        passwordHash: hashClientSecret(validPassword),
      });
      return {
        account: account?.toObject ? account.toObject() : account,
        created: true,
      };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      account = await deps.WorkspaceMemberAccount.findOne({ email }).lean();
      return { account, created: false };
    }
  }

  async function compensateAcceptance({
    account,
    workspaceId,
    previousMembership,
    attemptId,
  }) {
    if (previousMembership) {
      await deps.WorkspaceMembership.updateOne(
        {
          _id: previousMembership._id,
          acceptanceAttemptId: attemptId,
        },
        {
          $set: {
            status: previousMembership.status,
            features: previousMembership.features,
            removedAt: previousMembership.removedAt || null,
            joinedAt: previousMembership.joinedAt,
            invitedByUserId: previousMembership.invitedByUserId,
            acceptanceAttemptId:
              previousMembership.acceptanceAttemptId || null,
          },
        },
      );
    } else {
      await deps.WorkspaceMembership.deleteOne({
        workspaceId,
        memberAccountId: account._id,
        acceptanceAttemptId: attemptId,
      });
    }
  }

  async function releaseAcceptanceClaim(invitationId, attemptId) {
    await deps.WorkspaceInvitation.updateOne(
      {
        _id: invitationId,
        status: "accepting",
        acceptanceAttemptId: attemptId,
      },
      {
        $set: {
          status: "pending",
          acceptanceAttemptId: null,
          acceptanceStartedAt: null,
        },
      },
    );
  }

  async function acceptInvitation({
    rawToken,
    firstName,
    lastName,
    password,
  }) {
    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();
    if (normalizedFirstName.length > 80 || normalizedLastName.length > 80) {
      throw workspaceError(
        "WORKSPACE_MEMBER_NAME_INVALID",
        "Enter a valid member name",
        400,
      );
    }
    const { invitation, attemptId } = await claimInvitation(rawToken);
    let workspace;
    try {
      workspace = await deps.Workspace.findOne({
        _id: invitation.workspaceId,
        status: "active",
      }).lean();
      if (!workspace) {
        throw workspaceError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
      }
      await deps.requireSponsor(workspace.ownerUserId);
    } catch (error) {
      await releaseAcceptanceClaim(invitation._id, attemptId);
      throw error;
    }
    let adsGptUser;
    try {
      adsGptUser = await findAdsGptUserByEmail(invitation.inviteeEmail);
    } catch (error) {
      await releaseAcceptanceClaim(invitation._id, attemptId);
      throw error;
    }
    if (adsGptUser) {
      await deps.WorkspaceInvitation.updateOne(
        { _id: invitation._id, acceptanceAttemptId: attemptId },
        {
          $set: {
            status: "revoked",
            revokedAt: deps.now(),
            acceptanceAttemptId: null,
          },
          $unset: { openKey: 1 },
        },
      );
      throw workspaceError(
        "WORKSPACE_PAID_INVITEE_DISABLED",
        "This email now belongs to an AdsGPT account",
        409,
      );
    }

    let accountResult;
    try {
      accountResult = await findOrCreateAccount({
        email: invitation.inviteeEmail,
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        password,
      });
    } catch (error) {
      await releaseAcceptanceClaim(invitation._id, attemptId);
      throw error;
    }
    const account = accountResult.account;
    const previousMembership = await deps.WorkspaceMembership.findOne({
      workspaceId: workspace._id,
      memberAccountId: account._id,
    }).lean();

    let membership;
    try {
      membership = await deps.WorkspaceMembership.findOneAndUpdate(
        {
          workspaceId: workspace._id,
          memberAccountId: account._id,
        },
        {
          $set: {
            features: normalizeFeatures(invitation.features),
            status: "active",
            invitedByUserId: invitation.invitedByUserId,
            joinedAt: deps.now(),
            removedAt: null,
            acceptanceAttemptId: attemptId,
          },
          $setOnInsert: {
            workspaceId: workspace._id,
            memberAccountId: account._id,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const completed = await deps.WorkspaceInvitation.findOneAndUpdate(
        {
          _id: invitation._id,
          status: "accepting",
          acceptanceAttemptId: attemptId,
        },
        {
          $set: {
            status: "accepted",
            acceptedByUserId: actorId(account),
            acceptedAt: deps.now(),
            acceptanceAttemptId: null,
          },
          $unset: { openKey: 1 },
        },
        { new: true },
      );
      if (!completed) {
        throw workspaceError(
          "WORKSPACE_ACCEPTANCE_CONFLICT",
          "Invitation acceptance could not be completed",
          409,
        );
      }
    } catch (error) {
      try {
        await compensateAcceptance({
          account,
          workspaceId: workspace._id,
          previousMembership,
          attemptId,
        });
      } finally {
        await releaseAcceptanceClaim(invitation._id, attemptId);
      }
      throw error;
    }
    // The invitation is already accepted, so clearing the internal ownership
    // marker is cleanup only. A transient cleanup failure must never trigger
    // compensation and remove successfully accepted access.
    try {
      await deps.WorkspaceMembership.updateOne(
        {
          _id: membership._id,
          acceptanceAttemptId: attemptId,
        },
        { $set: { acceptanceAttemptId: null } },
      );
    } catch {
      // A later membership write will replace the harmless stale marker.
    }

    return {
      account,
      actorUserId: actorId(account),
      membership: membership?.toObject ? membership.toObject() : membership,
      workspace,
    };
  }

  async function ownerDashboard(ownerUserId) {
    const { workspace } = await ensureOwnerWorkspace(ownerUserId);
    const memberships = await deps.WorkspaceMembership.find({
      workspaceId: workspace._id,
      status: "active",
    }).lean();
    const accountIds = memberships.map((entry) => entry.memberAccountId);
    const accounts = await deps.WorkspaceMemberAccount.find({
      _id: { $in: accountIds },
    }).lean();
    const byId = new Map(accounts.map((account) => [String(account._id), account]));
    const invitations = await deps.WorkspaceInvitation.find({
      workspaceId: workspace._id,
      status: "pending",
      expiresAt: { $gt: deps.now() },
    })
      .sort({ createdAt: -1 })
      .lean();
    return {
      workspace,
      members: memberships
        .map((membership) => ({
          ...membership,
          account: byId.get(String(membership.memberAccountId)),
        }))
        .filter((entry) => entry.account),
      invitations,
    };
  }

  async function updateMember({ ownerUserId, workspaceId, membershipId, features }) {
    requireObjectId(
      membershipId,
      "WORKSPACE_MEMBER_NOT_FOUND",
      "Member not found",
    );
    await requireOwnedWorkspace(ownerUserId, workspaceId);
    const selectedFeatures = requireFeatures(features);
    const membership = await deps.WorkspaceMembership.findOneAndUpdate(
      {
        _id: membershipId,
        workspaceId,
        status: "active",
      },
      { $set: { features: selectedFeatures } },
      { new: true },
    );
    if (!membership) {
      throw workspaceError("WORKSPACE_MEMBER_NOT_FOUND", "Member not found", 404);
    }
    return membership;
  }

  async function removeMember({ ownerUserId, workspaceId, membershipId }) {
    requireObjectId(
      membershipId,
      "WORKSPACE_MEMBER_NOT_FOUND",
      "Member not found",
    );
    await requireOwnedWorkspace(ownerUserId, workspaceId);
    const membership = await deps.WorkspaceMembership.findOneAndUpdate(
      {
        _id: membershipId,
        workspaceId,
        status: "active",
      },
      { $set: { status: "removed", removedAt: deps.now() } },
      { new: true },
    );
    if (!membership) {
      throw workspaceError("WORKSPACE_MEMBER_NOT_FOUND", "Member not found", 404);
    }
    return membership;
  }

  async function revokeInvitation({ ownerUserId, workspaceId, invitationId }) {
    requireObjectId(
      invitationId,
      "WORKSPACE_INVITE_UNAVAILABLE",
      "Invitation is no longer available",
    );
    await requireOwnedWorkspace(ownerUserId, workspaceId);
    const invitation = await deps.WorkspaceInvitation.findOneAndUpdate(
      {
        _id: invitationId,
        workspaceId,
        status: "pending",
      },
      {
        $set: { status: "revoked", revokedAt: deps.now() },
        $unset: { openKey: 1 },
      },
      { new: true },
    );
    if (!invitation) {
      throw workspaceError(
        "WORKSPACE_INVITE_UNAVAILABLE",
        "Invitation is no longer available",
        404,
      );
    }
    return invitation;
  }

  return {
    acceptInvitation,
    actorId,
    createInvitation,
    ensureOwnerWorkspace,
    invitationInfo,
    ownerDashboard,
    removeMember,
    requireOwnedWorkspace,
    revokeInvitation,
    updateMember,
  };
}

const service = createWorkspaceService();

module.exports = {
  ...service,
  accountIdFromActor,
  actorId,
  createWorkspaceService,
  memberName,
  randomToken,
  tokenHash,
};
