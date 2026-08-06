const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const {
  isWorkspaceError,
  normalizeFeatures,
  requireFeatures,
  validatePassword,
  workspaceError,
  workspaceErrorResponse,
} = require("../../services/workspace/workspaceConfig");
const {
  evaluateSponsor,
  expiryTime,
} = require("../../services/workspace/workspaceSponsor");
const {
  actorId,
  createWorkspaceService,
} = require("../../services/workspace/workspaceService");
const {
  createWorkspaceMemberAuth,
} = require("../../services/workspace/workspaceMemberAuth");
const workspaceController = require("../../controllers/workspace.controller");

function query(value) {
  return {
    lean: async () => value,
    sort() {
      return this;
    },
  };
}

(async () => {
  assert.deepEqual(
    normalizeFeatures(["adsManager", "bogus", "adFactory", "adsManager"]),
    [
      "adFactory",
      "adsManager.meta.manager",
      "adsManager.google.manager",
      "adsManager.tiktok.manager",
    ],
  );
  assert.deepEqual(normalizeFeatures(["adStudio.adCopy", "adStudio.adLibrary"]), [
    "adStudio.adCopy",
    "adStudio.adLibrary",
  ]);
  assert.throws(
    () => requireFeatures([]),
    (error) => error.code === "WORKSPACE_FEATURES_REQUIRED",
  );
  assert.throws(
    () => requireFeatures(["adsManager.google.autopilot"]),
    (error) => error.code === "WORKSPACE_FEATURES_REQUIRED",
    "unavailable permission leaves must not be assignable",
  );

  assert.equal(expiryTime("2037-12-31") > Date.now(), true);
  assert.equal(
    evaluateSponsor(
      { subscriptions: { 8: "2037-12-31" } },
      { excludedPlanIds: "8,19" },
    ).eligible,
    false,
  );
  assert.equal(
    evaluateSponsor(
      { subscriptions: { 12: "2037-12-31" } },
      { allowedPlanIds: "12", excludedPlanIds: "8,19" },
    ).eligible,
    true,
  );
  assert.equal(
    evaluateSponsor(
      { subscriptions: { 12: "2020-01-01" } },
      { allowedPlanIds: "12" },
    ).eligible,
    false,
  );

  assert.equal(
    evaluateSponsor(
      { subscriptions: { 8: "2037-12-31" } },
      { allowedPlanIds: undefined, excludedPlanIds: undefined },
    ).eligible,
    true,
    "every active plan must be eligible by default",
  );

  const owner = {
    user_id: "GPT-435",
    amember_user_id: "435",
    login: "owner",
    email: "owner@example.com",
    name_f: "Owner",
    name_l: "One",
    subscriptions: { 12: "2037-12-31" },
    created_from: "GPT",
  };
  const workspace = {
    _id: "64a33ccd1d76229f9df07842",
    ownerUserId: "GPT-435",
    name: "Owner One's Workspace",
    status: "active",
  };

  const paidInviteService = createWorkspaceService({
    Workspace: {
      findOne: () => query(workspace),
    },
    UserProfile: {
      findOne: () => query({ user_id: "GPT-999" }),
    },
    requireSponsor: async () => ({ profile: owner, eligible: true }),
  });
  await assert.rejects(
    paidInviteService.createInvitation({
      ownerUserId: "GPT-435",
      email: "paid@example.com",
      features: ["adFactory"],
    }),
    (error) => error.code === "WORKSPACE_PAID_INVITEE_DISABLED",
  );

  let emailDelivery;
  const createdInvitationService = createWorkspaceService({
    Workspace: {
      findOne: () => query(workspace),
    },
    UserProfile: {
      findOne: () => query(null),
    },
    WorkspaceMemberAccount: {
      findOne: () => query(null),
    },
    WorkspaceInvitation: {
      findOne: () => query(null),
      findOneAndUpdate: async (_filter, update) => ({
        _id: "64a33ccd1d76229f9df07844",
        workspaceId: workspace._id,
        inviteeEmail: "new@example.com",
        features: update.$set.features,
        expiresAt: update.$set.expiresAt,
      }),
    },
    requireSponsor: async () => ({ profile: owner, eligible: true }),
    randomToken: () => "invite-token",
    sendInvitation: async (value) => {
      emailDelivery = value;
      return { sent: true };
    },
  });
  const created = await createdInvitationService.createInvitation({
    ownerUserId: "GPT-435",
    email: "NEW@example.com",
    features: ["adFactory", "bad"],
  });
  assert.equal(created.invitation.inviteeEmail, "new@example.com");
  assert.deepEqual(created.invitation.features, ["adFactory"]);
  assert.equal(emailDelivery.to, "new@example.com");
  assert.equal(emailDelivery.workspaceName, workspace.name);

  const unavailableService = createWorkspaceService({
    WorkspaceInvitation: {
      findOneAndUpdate: async () => null,
      findOne: () => query({ status: "accepted" }),
    },
  });
  await assert.rejects(
    unavailableService.acceptInvitation({
      rawToken: "old-token",
      firstName: "Old",
    }),
    (error) =>
      error.code === "WORKSPACE_INVITE_UNAVAILABLE" &&
      error.statusCode === 410,
  );

  const account = {
    _id: "64a33ccd1d76229f9df07843",
    email: "member@example.com",
    firstName: "Member",
    lastName: "B",
    status: "active",
  };
  const secondWorkspace = {
    _id: "64a33ccd1d76229f9df07845",
    ownerUserId: "GPT-436",
    name: "Another Workspace",
    status: "active",
  };
  const memberships = [
    {
      workspaceId: workspace._id,
      memberAccountId: account._id,
      features: ["adFactory"],
      status: "active",
    },
    {
      workspaceId: secondWorkspace._id,
      memberAccountId: account._id,
      features: ["brandIq"],
      status: "active",
    },
  ];
  const secret = "workspace-test-secret-that-is-long-enough";
  const memberAuth = createWorkspaceMemberAuth({
    WorkspaceMembership: {
      find: (filter) =>
        query(
          memberships.filter(
            (entry) =>
              !filter.workspaceId ||
              String(entry.workspaceId) === String(filter.workspaceId),
          ),
        ),
    },
    Workspace: {
      find: ({ _id }) =>
        query(
          [workspace, secondWorkspace].filter((entry) =>
            _id.$in.map(String).includes(String(entry._id)),
          ),
        ),
    },
    WorkspaceMemberAccount: {
      findOne: () => query(account),
    },
    requireSponsor: async (ownerUserId) => ({
      profile: {
        ...owner,
        user_id: ownerUserId,
        amember_user_id: ownerUserId.replace("GPT-", ""),
      },
    }),
    jwtSecret: secret,
  });

  const choices = await memberAuth.listMemberWorkspaces(actorId(account));
  assert.deepEqual(
    choices.map((entry) => entry.name),
    ["Another Workspace", "Owner One's Workspace"],
  );

  const switched = await memberAuth.switchWorkspace({
    actorUserId: actorId(account),
    workspaceId: secondWorkspace._id,
  });
  const decoded = jwt.verify(switched.token, secret, {
    algorithms: ["HS512"],
  });
  assert.equal(decoded.user_id, 436);
  assert.equal(decoded.actorUserId, actorId(account));
  assert.equal(decoded.workspace_id, secondWorkspace._id);
  assert.deepEqual(decoded.workspace_features, [
    "brandIq.myBrands",
    "brandIq.competitors",
  ]);
  assert.equal(decoded.session_scope, "workspace_member");

  const fallbackAuth = createWorkspaceMemberAuth({
    WorkspaceMembership: {
      find: () => query(memberships),
    },
    Workspace: {
      find: () => query([workspace, secondWorkspace]),
    },
    WorkspaceMemberAccount: {
      findOne: () => query(account),
    },
    requireSponsor: async (ownerUserId) => {
      if (ownerUserId === secondWorkspace.ownerUserId) {
        const error = new Error("Subscription expired");
        error.code = "WORKSPACE_SPONSOR_PLAN_REQUIRED";
        error.statusCode = 403;
        throw error;
      }
      return {
        profile: {
          ...owner,
          user_id: ownerUserId,
          amember_user_id: ownerUserId.replace("GPT-", ""),
        },
      };
    },
    jwtSecret: secret,
  });
  const fallbackSession = await fallbackAuth.switchWorkspace({
    actorUserId: actorId(account),
  });
  assert.equal(
    fallbackSession.workspaceId,
    workspace._id,
    "initial login must skip workspaces whose owner is no longer eligible",
  );
  const eligibleChoices = await fallbackAuth.listMemberWorkspaces(actorId(account));
  assert.deepEqual(
    eligibleChoices.map((entry) => entry.id),
    [workspace._id],
    "the workspace picker must omit workspaces with ineligible owners",
  );

  const staleClaims = {
    actorUserId: actorId(account),
    session_scope: "workspace_member",
    delegated: true,
    workspace_id: secondWorkspace._id,
    workspace_name: secondWorkspace.name,
    workspace_features: ["adFactory"],
  };
  await assert.rejects(
    memberAuth.validateSession(staleClaims),
    (error) =>
      error.code === "WORKSPACE_ACCESS_CHANGED" && error.statusCode === 403,
    "a stale feature claim must be rejected so the client re-authenticates, rather than silently patched with a reissued token",
  );

  const currentClaims = {
    ...staleClaims,
    workspace_features: ["brandIq.myBrands", "brandIq.competitors"],
  };
  const validated = await memberAuth.validateSession(currentClaims);
  assert.equal(
    validated.membership.workspaceId,
    secondWorkspace._id,
    "claims that already match the latest membership must be accepted",
  );

  let forbidden;
  await workspaceController.invite(
    {
      user: {
        user_id: "GPT-435",
        actorUserId: actorId(account),
        session_scope: "workspace_member",
        delegated: true,
      },
      body: { email: "other@example.com", features: ["adFactory"] },
    },
    {
      status(code) {
        forbidden = { code };
        return this;
      },
      json(body) {
        forbidden.body = body;
        return body;
      },
    },
  );
  assert.equal(forbidden.code, 403);
  assert.equal(forbidden.body.code, "WORKSPACE_OWNER_REQUIRED");

  // An active membership whose workspace has since been archived must be
  // reported as withdrawn access, not crash on an empty selection.
  const archivedAuth = createWorkspaceMemberAuth({
    WorkspaceMembership: {
      find: () => query([memberships[0]]),
    },
    Workspace: {
      // The membership survives, but the workspace no longer matches
      // status: "active", so nothing comes back here.
      find: () => query([]),
    },
    WorkspaceMemberAccount: {
      findOne: () => query(account),
    },
    requireSponsor: async () => ({ profile: owner }),
    jwtSecret: secret,
  });
  await assert.rejects(
    archivedAuth.validateSession({
      actorUserId: actorId(account),
      session_scope: "workspace_member",
      delegated: true,
      workspace_id: workspace._id,
    }),
    (error) =>
      error.code === "WORKSPACE_MEMBERSHIP_REQUIRED" && error.statusCode === 403,
    "an archived workspace must not throw a TypeError from an empty selection",
  );

  // Malformed ids must never reach Mongoose, which would raise a CastError and
  // surface as a 500 instead of a 404.
  await assert.rejects(
    memberAuth.switchWorkspace({
      actorUserId: actorId(account),
      workspaceId: "not-an-object-id",
    }),
    (error) =>
      error.code === "WORKSPACE_NOT_FOUND" && error.statusCode === 404,
  );

  const rejectQueries = () => {
    throw new Error("the database must not be reached for a malformed id");
  };
  const idGuardService = createWorkspaceService({
    WorkspaceMembership: { findOneAndUpdate: rejectQueries },
    WorkspaceInvitation: { findOneAndUpdate: rejectQueries },
    Workspace: { findOne: rejectQueries },
    requireSponsor: async () => ({ profile: owner }),
  });
  await assert.rejects(
    idGuardService.updateMember({
      ownerUserId: "GPT-435",
      workspaceId: workspace._id,
      membershipId: "nope",
      features: ["adFactory"],
    }),
    (error) =>
      error.code === "WORKSPACE_MEMBER_NOT_FOUND" && error.statusCode === 404,
  );
  await assert.rejects(
    idGuardService.removeMember({
      ownerUserId: "GPT-435",
      workspaceId: workspace._id,
      membershipId: "nope",
    }),
    (error) =>
      error.code === "WORKSPACE_MEMBER_NOT_FOUND" && error.statusCode === 404,
  );
  await assert.rejects(
    idGuardService.revokeInvitation({
      ownerUserId: "GPT-435",
      workspaceId: workspace._id,
      invitationId: "nope",
    }),
    (error) =>
      error.code === "WORKSPACE_INVITE_UNAVAILABLE" && error.statusCode === 404,
  );

  // Only deliberate workspace errors may describe themselves to a caller.
  assert.equal(isWorkspaceError(workspaceError("WORKSPACE_X", "nope", 404)), true);
  assert.equal(isWorkspaceError(new TypeError("Cannot read properties")), false);
  assert.equal(
    isWorkspaceError(Object.assign(new Error("cast failed"), { code: 11000 })),
    false,
    "a driver error code must not be mistaken for a workspace code",
  );
  assert.equal(
    isWorkspaceError({ code: "WORKSPACE_X" }),
    false,
    "a workspace code without a status is not a deliberate response",
  );
  assert.equal(
    isWorkspaceError(workspaceError("WORKSPACE_PASSWORD_INVALID", "nope", 400)),
    true,
  );
  assert.equal(
    isWorkspaceError(workspaceError("WORKSPACE_INVALID_CREDENTIALS", "nope", 401)),
    true,
  );

  assert.throws(
    () => validatePassword("short1"),
    (error) => error.code === "WORKSPACE_PASSWORD_INVALID",
    "a 6-character password must be rejected",
  );
  assert.equal(validatePassword("exactly8"), "exactly8");
  assert.equal(validatePassword("a".repeat(128)), "a".repeat(128));
  assert.throws(
    () => validatePassword("a".repeat(129)),
    (error) => error.code === "WORKSPACE_PASSWORD_INVALID",
    "an oversized password must be rejected",
  );

  const deliberate = workspaceErrorResponse(
    workspaceError("WORKSPACE_MEMBER_NOT_FOUND", "Member not found", 404),
  );
  assert.equal(deliberate.statusCode, 404);
  assert.deepEqual(deliberate.body, {
    success: false,
    code: "WORKSPACE_MEMBER_NOT_FOUND",
    message: "Member not found",
  });

  const originalConsoleError = console.error;
  let logged = 0;
  console.error = () => {
    logged += 1;
  };
  let internal;
  try {
    // Shaped like the Mongoose CastError the id guards now prevent, and like
    // any other unexpected fault: the caller must learn nothing from it.
    internal = workspaceErrorResponse(
      Object.assign(new Error('Cast to ObjectId failed for value "nope"'), {
        name: "CastError",
      }),
      { fallbackCode: "WORKSPACE_ERROR", context: "workspace" },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.body.code, "WORKSPACE_ERROR");
  assert.equal(
    internal.body.message,
    "Workspace request failed",
    "an internal failure must not echo its message to the caller",
  );
  assert.equal(logged, 1, "an unexpected failure must still be logged server-side");

  console.log("workspaceCore tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
