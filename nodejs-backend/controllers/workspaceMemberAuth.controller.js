const {
  invitationInfo,
} = require("../services/workspace/workspaceService");
const {
  accept,
  consumeLogin,
  requestLogin,
} = require("../services/workspace/workspaceMemberAuth");
const {
  workspaceErrorResponse,
} = require("../services/workspace/workspaceConfig");

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
    });
    return res.json({ success: true, ...session });
  } catch (error) {
    return sendError(res, error);
  }
}

async function requestLink(req, res) {
  try {
    return res.json({
      success: true,
      ...(await requestLogin(req.body?.email)),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function consumeLink(req, res) {
  try {
    return res.json({
      success: true,
      ...(await consumeLogin(req.body?.token)),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = { acceptInvitation, consumeLink, info, requestLink };
