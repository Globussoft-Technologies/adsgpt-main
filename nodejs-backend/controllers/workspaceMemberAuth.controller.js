const {
  invitationInfo,
} = require("../services/workspace/workspaceService");
const {
  accept,
  login,
} = require("../services/workspace/workspaceMemberAuth");
const {
  workspaceErrorResponse,
} = require("../services/workspace/workspaceConfig");
const { trackBackendGA4Event } = require("../utils/ga4");

function sendError(res, error) {
  const { statusCode, body } = workspaceErrorResponse(error, {
    fallbackCode: "WORKSPACE_AUTH_ERROR",
    context: "workspace-auth",
  });
  return res.status(statusCode).json(body);
}

async function info(req, res) {
  try {
    return res.json({
      success: true,
      invitation: await invitationInfo(req.params.token),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function acceptInvitation(req, res) {
  try {
    const session = await accept({
      token: req.params.token,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      password: req.body?.password,
    });
    trackBackendGA4Event("workspace", {
      user_id: session?.actorUserId || session?.user?.user_id || "anonymous",
      feature: "workspace",
      action_name: "workspace_invitation_accepted",
      source: "workspace_invitation_accept_page",
      success: true,
    });
    return res.json({ success: true, ...session });
  } catch (error) {
    return sendError(res, error);
  }
}

async function loginMember(req, res) {
  try {
    const session = await login({
      email: req.body?.email,
      password: req.body?.password,
    });
    return res.json({ success: true, ...session });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = { acceptInvitation, info, loginMember };
