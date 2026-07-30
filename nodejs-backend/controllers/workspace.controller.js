const {
  createInvitation,
  ensureOwnerWorkspace,
  ownerDashboard,
  removeMember,
  revokeInvitation,
  updateMember,
} = require("../services/workspace/workspaceService");
const {
  listMemberWorkspaces,
  switchWorkspace,
} = require("../services/workspace/workspaceMemberAuth");
const {
  normalizeFeatures,
  workspaceErrorResponse,
  WORKSPACE_ASSIGNABLE_FEATURES,
} = require(
  "../services/workspace/workspaceConfig",
);

function sendError(res, error) {
  const { statusCode, body } = workspaceErrorResponse(error, {
    fallbackCode: "WORKSPACE_ERROR",
    context: "workspace",
  });
  return res.status(statusCode).json(body);
}

function isMemberSession(user) {
  return user?.session_scope === "workspace_member" && user?.delegated === true;
}

function requireOwnerRequest(req) {
  if (isMemberSession(req.user)) {
    const error = new Error("Workspace members cannot manage workspace access");
    error.code = "WORKSPACE_OWNER_REQUIRED";
    error.statusCode = 403;
    throw error;
  }
}

function serializeDashboard(result) {
  return {
    workspace: {
      id: String(result.workspace._id),
      name: result.workspace.name,
      ownerUserId: result.workspace.ownerUserId,
    },
    members: result.members.map((entry) => ({
      id: String(entry._id),
      email: entry.account.email,
      name:
        [entry.account.firstName, entry.account.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || entry.account.email,
      features: normalizeFeatures(entry.features),
      joinedAt: entry.joinedAt,
    })),
    invitations: result.invitations.map((entry) => ({
      id: String(entry._id),
      email: entry.inviteeEmail,
      features: normalizeFeatures(entry.features),
      expiresAt: entry.expiresAt,
    })),
  };
}

async function list(req, res) {
  try {
    if (isMemberSession(req.user)) {
      return res.json({
        success: true,
        canManage: false,
        workspaces: await listMemberWorkspaces(req.user.actorUserId),
      });
    }
    const dashboard = await ownerDashboard(req.user.user_id);
    return res.json({
      success: true,
      canManage: true,
      features: WORKSPACE_ASSIGNABLE_FEATURES,
      ...serializeDashboard(dashboard),
      workspaces: [
        {
          id: String(dashboard.workspace._id),
          name: dashboard.workspace.name,
          ownerUserId: dashboard.workspace.ownerUserId,
          features: WORKSPACE_ASSIGNABLE_FEATURES,
        },
      ],
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function invite(req, res) {
  try {
    requireOwnerRequest(req);
    const result = await createInvitation({
      ownerUserId: req.user.user_id,
      email: req.body?.email,
      features: req.body?.features,
    });
    return res.status(201).json({
      success: true,
      invitation: {
        id: String(result.invitation._id),
        email: result.invitation.inviteeEmail,
        features: result.invitation.features,
        expiresAt: result.invitation.expiresAt,
      },
      ...(result.rawToken ? { invitationToken: result.rawToken } : {}),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function update(req, res) {
  try {
    requireOwnerRequest(req);
    const workspace = await ensureOwnerWorkspace(req.user.user_id);
    const membership = await updateMember({
      ownerUserId: req.user.user_id,
      workspaceId: workspace.workspace._id,
      membershipId: req.params.membershipId,
      features: req.body?.features,
    });
    return res.json({
      success: true,
      member: {
        id: String(membership._id),
        features: membership.features,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function remove(req, res) {
  try {
    requireOwnerRequest(req);
    const workspace = await ensureOwnerWorkspace(req.user.user_id);
    await removeMember({
      ownerUserId: req.user.user_id,
      workspaceId: workspace.workspace._id,
      membershipId: req.params.membershipId,
    });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error);
  }
}

async function revoke(req, res) {
  try {
    requireOwnerRequest(req);
    const workspace = await ensureOwnerWorkspace(req.user.user_id);
    await revokeInvitation({
      ownerUserId: req.user.user_id,
      workspaceId: workspace.workspace._id,
      invitationId: req.params.invitationId,
    });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error);
  }
}

async function switchSession(req, res) {
  try {
    if (!isMemberSession(req.user)) {
      return sendError(
        res,
        Object.assign(new Error("Workspace member sign-in is required"), {
          code: "WORKSPACE_MEMBER_SESSION_REQUIRED",
          statusCode: 403,
        }),
      );
    }
    const session = await switchWorkspace({
      actorUserId: req.user.actorUserId,
      workspaceId: req.params.workspaceId,
    });
    return res.json({ success: true, ...session });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = { invite, list, remove, revoke, switchSession, update };
