import axios from 'axios';
import getCookies from '@/utils/getCookies';
import { facebookAccountHeader } from '@/utils/metaFacebookAccount';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;
const PREFIX = `${BASE_URL}/adsgpt/meta-ads/autopilot/llm-audit`;

const getAuthHeaders = (facebookId) => ({
  Authorization: `Bearer ${getCookies()}`,
  ...(facebookId === undefined
    ? facebookAccountHeader()
    : facebookId
      ? { 'X-Facebook-Id': String(facebookId) }
      : {}),
});

// POST /autopilot/llm-audit?adAccountId=…
export const runLLMAudit = async (adAccountId, facebookId) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/llm-audit`,
    null,
    {
      params: { adAccountId },
      headers: getAuthHeaders(facebookId),
    },
  );
  return data;
};

// GET /autopilot/llm-audit/audits?adAccountId=…
export const listAIAudits = async (adAccountId, facebookId) => {
  const { data } = await axios.get(`${PREFIX}/audits`, {
    params: { adAccountId },
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

// GET /autopilot/llm-audit/findings/:auditId
export const getAIFindings = async (auditId, facebookId) => {
  const { data } = await axios.get(`${PREFIX}/findings/${auditId}`, {
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

// POST /autopilot/llm-audit/apply-fix/:findingId
export const applyAuditFix = async (
  findingId,
  { acknowledgeRisk = false, paramOverrides = {} } = {},
  facebookId,
) => {
  const { data } = await axios.post(
    `${PREFIX}/apply-fix/${findingId}`,
    { confirmed: true, acknowledgeRisk, paramOverrides },
    { headers: getAuthHeaders(facebookId) },
  );
  return data;
};

// POST /autopilot/llm-audit/dismiss/:findingId
export const dismissAuditFinding = async (findingId, facebookId) => {
  const { data } = await axios.post(`${PREFIX}/dismiss/${findingId}`, null, {
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

// POST /autopilot/llm-audit/undo/:findingId
export const undoAuditFix = async (findingId, facebookId) => {
  const { data } = await axios.post(`${PREFIX}/undo/${findingId}`, null, {
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

// GET /autopilot/llm-audit/fix-log
export const getFixLog = async ({ auditId, limit = 50 } = {}) => {
  const { data } = await axios.get(`${PREFIX}/fix-log`, {
    params: { auditId, limit },
    headers: getAuthHeaders(),
  });
  return data;
};
