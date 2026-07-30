const assert = require("node:assert/strict");
const {
  createWorkspaceService,
  tokenHash,
} = require("../../services/workspace/workspaceService");
const {
  createWorkspaceMemberAuth,
} = require("../../services/workspace/workspaceMemberAuth");

function query(value) {
  return {
    lean: async () => value,
  };
}

function invitationHarness({ workspace, email, accountState, memberships }) {
  const invitation = {
    _id: `${workspace._id}-invite`,
    workspaceId: workspace._id,
    invitedByUserId: workspace.ownerUserId,
    inviteeEmail: email,
    features: ["adFactory"],
    tokenHash: tokenHash(`${workspace._id}-token`),
    status: "pending",
    expiresAt: new Date("2037-12-31"),
    acceptanceAttemptId: null,
    acceptanceStartedAt: null,
  };

  const WorkspaceInvitation = {
    findOneAndUpdate: async (filter, update) => {
      if (filter.tokenHash) {
        if (
          invitation.tokenHash !== filter.tokenHash ||
          invitation.status !== filter.status ||
          invitation.expiresAt <= filter.expiresAt.$gt
        ) {
          return null;
        }
      } else if (
        String(filter._id) !== String(invitation._id) ||
        invitation.status !== filter.status ||
        (filter.acceptanceAttemptId &&
          invitation.acceptanceAttemptId !== filter.acceptanceAttemptId)
      ) {
        return null;
      }
      Object.assign(invitation, update.$set);
      return { ...invitation };
    },
    findOne: () => query({ ...invitation }),
    updateOne: async (filter, update) => {
      if (
        String(filter._id) === String(invitation._id) &&
        (!filter.acceptanceAttemptId ||
          filter.acceptanceAttemptId === invitation.acceptanceAttemptId)
      ) {
        Object.assign(invitation, update.$set);
      }
      return { modifiedCount: 1 };
    },
  };

  const WorkspaceMemberAccount = {
    findOne: () => query(accountState.account),
    create: async (value) => {
      accountState.account = {
        _id: "64a33ccd1d76229f9df07843",
        status: "active",
        ...value,
      };
      accountState.created += 1;
      return accountState.account;
    },
    deleteOne: async () => {
      accountState.account = null;
    },
  };

  const WorkspaceMembership = {
    findOne: (filter) =>
      query(
        memberships.find(
          (entry) =>
            (!filter.workspaceId ||
              String(entry.workspaceId) === String(filter.workspaceId)) &&
            (!filter.memberAccountId ||
              String(entry.memberAccountId) ===
                String(filter.memberAccountId)),
        ) || null,
      ),
    findOneAndUpdate: async (filter, update) => {
      let membership = memberships.find(
        (entry) =>
          String(entry.workspaceId) === String(filter.workspaceId) &&
          String(entry.memberAccountId) === String(filter.memberAccountId),
      );
      if (!membership) {
        membership = {
          _id: `membership-${memberships.length + 1}`,
          ...update.$setOnInsert,
        };
        memberships.push(membership);
      }
      Object.assign(membership, update.$set);
      return { ...membership };
    },
    deleteOne: async (filter) => {
      const index = memberships.findIndex(
        (entry) =>
          String(entry.workspaceId) === String(filter.workspaceId) &&
          String(entry.memberAccountId) === String(filter.memberAccountId),
      );
      if (index >= 0) memberships.splice(index, 1);
    },
    updateOne: async () => ({ modifiedCount: 1 }),
  };

  return {
    invitation,
    service: createWorkspaceService({
      WorkspaceInvitation,
      WorkspaceMemberAccount,
      WorkspaceMembership,
      Workspace: {
        findOne: () => query(workspace),
      },
      UserProfile: {
        findOne: () => query(null),
      },
      requireSponsor: async () => ({
        profile: {
          user_id: workspace.ownerUserId,
          subscriptions: { 12: "2037-12-31" },
        },
      }),
      now: () => new Date("2026-07-29T10:00:00Z"),
    }),
  };
}

(async () => {
  const accountState = { account: null, created: 0 };
  const memberships = [];
  const workspaceA = {
    _id: "64a33ccd1d76229f9df07842",
    ownerUserId: "GPT-435",
    name: "Owner A Workspace",
    status: "active",
  };
  const workspaceC = {
    _id: "64a33ccd1d76229f9df07845",
    ownerUserId: "GPT-436",
    name: "Owner C Workspace",
    status: "active",
  };

  const first = invitationHarness({
    workspace: workspaceA,
    email: "member@example.com",
    accountState,
    memberships,
  });
  const acceptedA = await first.service.acceptInvitation({
    rawToken: `${workspaceA._id}-token`,
    firstName: "Member",
    lastName: "B",
  });
  assert.equal(first.invitation.status, "accepted");
  assert.equal(accountState.created, 1);
  assert.equal(memberships.length, 1);
  assert.equal(acceptedA.account.email, "member@example.com");

  await assert.rejects(
    first.service.acceptInvitation({
      rawToken: `${workspaceA._id}-token`,
      firstName: "Member",
    }),
    (error) => error.code === "WORKSPACE_INVITE_UNAVAILABLE",
  );
  assert.equal(memberships.length, 1, "an accepted link must not recreate access");

  const second = invitationHarness({
    workspace: workspaceC,
    email: "member@example.com",
    accountState,
    memberships,
  });
  const secondInfo = await second.service.invitationInfo(
    `${workspaceC._id}-token`,
  );
  assert.equal(secondInfo.existingMember, true);
  assert.equal(secondInfo.memberName, "Member B");
  const acceptedC = await second.service.acceptInvitation({
    rawToken: `${workspaceC._id}-token`,
    firstName: "",
  });
  assert.equal(accountState.created, 1, "the same Mongo-only identity must be reused");
  assert.equal(acceptedC.account._id, acceptedA.account._id);
  assert.equal(memberships.length, 2);

  let loginToken;
  const secret = "workspace-login-test-secret-that-is-long";
  const memberAuth = createWorkspaceMemberAuth({
    WorkspaceMemberAccount: {
      findOne: () => query(accountState.account),
      updateOne: async () => ({ modifiedCount: 1 }),
    },
    WorkspaceMembership: {
      findOne: () => query(memberships[0]),
      find: () => query(memberships),
    },
    Workspace: {
      find: () => query([workspaceA, workspaceC]),
    },
    WorkspaceMemberLoginToken: {
      create: async (value) => {
        loginToken = {
          _id: "login-token-id",
          usedAt: null,
          ...value,
        };
        return loginToken;
      },
      findOne: ({ tokenHash: hash, usedAt }) =>
        query(
          loginToken &&
          loginToken.tokenHash === hash &&
          loginToken.usedAt === usedAt
            ? { ...loginToken }
            : null,
        ),
      findOneAndUpdate: async (filter, update) => {
        if (!loginToken || loginToken.usedAt || loginToken._id !== filter._id) {
          return null;
        }
        Object.assign(loginToken, update.$set);
        return { ...loginToken };
      },
    },
    requireSponsor: async (ownerUserId) => ({
      profile: {
        user_id: ownerUserId,
        amember_user_id: ownerUserId.replace("GPT-", ""),
        login: "owner",
        email: "owner@example.com",
        subscriptions: { 12: "2037-12-31" },
        created_from: "GPT",
      },
    }),
    sendLoginLink: async () => ({ sent: false }),
    randomToken: () => "member-login-token",
    exposeLinks: true,
    jwtSecret: secret,
    now: () => new Date("2026-07-29T10:00:00Z"),
  });

  const requested = await memberAuth.requestLogin("member@example.com");
  assert.equal(requested.token, "member-login-token");
  const session = await memberAuth.consumeLogin("member-login-token");
  assert.equal(session.workspaceName, "Owner A Workspace");
  await assert.rejects(
    memberAuth.consumeLogin("member-login-token"),
    (error) => error.code === "WORKSPACE_LOGIN_LINK_INVALID",
  );

  const staleNow = new Date("2026-07-29T10:00:00Z");
  const staleInvitation = {
    _id: "stale-invitation",
    tokenHash: tokenHash("stale-token"),
    status: "accepting",
    acceptanceAttemptId: "old-attempt",
    acceptanceStartedAt: new Date("2026-07-29T09:00:00Z"),
    expiresAt: new Date("2026-07-29T09:30:00Z"),
  };
  const staleService = createWorkspaceService({
    WorkspaceInvitation: {
      findOneAndUpdate: async () => null,
      findOne: () => query({ ...staleInvitation }),
      updateOne: async (_filter, update) => {
        Object.assign(staleInvitation, update.$set);
        return { modifiedCount: 1 };
      },
    },
    now: () => staleNow,
  });
  await assert.rejects(
    staleService.acceptInvitation({
      rawToken: "stale-token",
      firstName: "Member",
    }),
    (error) =>
      error.code === "WORKSPACE_INVITE_UNAVAILABLE" &&
      error.statusCode === 410,
  );
  assert.equal(
    staleInvitation.status,
    "expired",
    "a stale claim must never revive an expired invitation",
  );

  const racedInvitation = {
    _id: "raced-invitation",
    workspaceId: workspaceA._id,
    invitedByUserId: workspaceA.ownerUserId,
    inviteeEmail: "race@example.com",
    features: ["adFactory"],
    tokenHash: tokenHash("race-token"),
    status: "pending",
    expiresAt: new Date("2037-12-31"),
    acceptanceAttemptId: null,
  };
  let racedMembership = null;
  let compensationFilter;
  const raceService = createWorkspaceService({
    WorkspaceInvitation: {
      findOneAndUpdate: async (filter, update) => {
        if (filter.tokenHash) {
          Object.assign(racedInvitation, update.$set);
          return { ...racedInvitation };
        }
        racedMembership.acceptanceAttemptId = "newer-attempt";
        racedInvitation.status = "accepted";
        racedInvitation.acceptanceAttemptId = null;
        return null;
      },
      findOne: () => query({ ...racedInvitation }),
      updateOne: async () => ({ modifiedCount: 0 }),
    },
    WorkspaceMemberAccount: {
      findOne: () => query(null),
      create: async (value) => ({
        _id: "64a33ccd1d76229f9df07849",
        status: "active",
        ...value,
      }),
    },
    WorkspaceMembership: {
      findOne: () => query(null),
      findOneAndUpdate: async (_filter, update) => {
        racedMembership = {
          _id: "raced-membership",
          ...update.$setOnInsert,
          ...update.$set,
        };
        return { ...racedMembership };
      },
      deleteOne: async (filter) => {
        compensationFilter = filter;
        if (
          racedMembership?.acceptanceAttemptId === filter.acceptanceAttemptId
        ) {
          racedMembership = null;
        }
      },
    },
    Workspace: {
      findOne: () => query(workspaceA),
    },
    UserProfile: {
      findOne: () => query(null),
    },
    requireSponsor: async () => ({
      profile: {
        user_id: workspaceA.ownerUserId,
        subscriptions: { 12: "2037-12-31" },
      },
    }),
    now: () => staleNow,
  });
  await assert.rejects(
    raceService.acceptInvitation({
      rawToken: "race-token",
      firstName: "Member",
    }),
    (error) => error.code === "WORKSPACE_ACCEPTANCE_CONFLICT",
  );
  assert.ok(
    compensationFilter?.acceptanceAttemptId,
    "compensation must be scoped to its acceptance attempt",
  );
  assert.ok(
    racedMembership,
    "an older attempt must not delete membership written by a newer attempt",
  );

  console.log("workspaceAcceptance tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
