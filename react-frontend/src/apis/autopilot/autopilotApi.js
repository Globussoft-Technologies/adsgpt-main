import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

const headers = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// -----------------------------------------------------------------------------
// Single-account auto-pause dry-run or live.
// -----------------------------------------------------------------------------
export const runAutopilotForAccount = async ({
  adAccountId,
  dryRun = true,
  severityFloor = 'critical',
}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/run`,
    null,
    {
      params: { adAccountId, dryRun, severityFloor },
      headers: headers(),
    },
  );
  return data;
};

// -----------------------------------------------------------------------------
// On-demand rule-based audit (37 rules). Read-only — returns findings, takes
// no actions. Companion to runLLMAudit (LLM lane). Cron path uses the same
// engine on its hourly tick.
// -----------------------------------------------------------------------------
export const runAutopilotRuleAudit = async ({ adAccountId }) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/audit/run`,
    null,
    {
      params: { adAccountId },
      headers: headers(),
      timeout: 120_000,
    },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Full orchestrator cycle across every account with ownerUserId set.
// -----------------------------------------------------------------------------
export const runAutopilotCycle = async ({
  dryRun = true,
  severityFloor = 'critical',
  force = false,
} = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/run-cycle`,
    null,
    {
      params: { dryRun, severityFloor, force },
      headers: headers(),
      // Cycle fans out across multiple accounts + hits Meta API for each.
      // The dev server takes ~15s for 4 accounts; allow headroom.
      timeout: 180_000,
    },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Hook-based rename proposals (Phase 7a).
// -----------------------------------------------------------------------------
export const renameByHook = async ({
  adAccountId,
  dryRun = true,
  prefix = '[Hook]',
  limit = 500,
}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rename-by-hook`,
    null,
    {
      params: { adAccountId, dryRun, prefix, limit },
      headers: headers(),
      timeout: 180_000,
    },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Paginated action log.
// -----------------------------------------------------------------------------
export const getActionLog = async ({
  adAccountId,
  runId,
  entityId,
  action,
  outcome,
  from,
  to,
  page = 1,
  limit = 20,
} = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/log`,
    {
      params: {
        adAccountId,
        runId,
        entityId,
        action,
        outcome,
        from,
        to,
        page,
        limit,
      },
      headers: headers(),
    },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Per-user windowed summary (Overview tab cards).
// -----------------------------------------------------------------------------
// Accepts either `{ from, to }` (preferred — explicit calendar range from
// the Overview date picker) OR `{ windowDays }` (legacy rolling window).
// The backend honors `from`/`to` first and falls back to `windowDays`.
export const getAutopilotSummary = async ({
  windowDays,
  from,
  to,
} = {}) => {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (!from && !to) params.windowDays = windowDays ?? 7;
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/summary`,
    { params, headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Per-run drilldown — full row set + rollup for one runId.
// -----------------------------------------------------------------------------
export const getAutopilotRunDetail = async (runId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/log/${encodeURIComponent(runId)}`,
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Per-user settings (Phase 4 backfill).
// -----------------------------------------------------------------------------
export const getAutopilotSettings = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/settings`,
    { headers: headers() },
  );
  return data;
};

export const updateAutopilotSettings = async (patch) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/settings`,
    patch,
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Slack webhook sanity check.
// -----------------------------------------------------------------------------
export const testSlack = async () => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/test-slack`,
    null,
    { headers: headers() },
  );
  return data;
};

export const testEmail = async () => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/test-email`,
    null,
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Telegram bot sanity check.
// -----------------------------------------------------------------------------
export const testTelegram = async () => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/test-telegram`,
    null,
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Autopilot config (read-only) — global live-actions flag + any ops-level
// per-account threshold pins. The set of accounts the cron acts on is no
// longer hardcoded; it's discovered per-tick from each user's own
// `/me/adaccounts`. Components that need an account list should call
// `getAdAccounts()` from `metaAds/metaAdsApi`, not import a static list.
// -----------------------------------------------------------------------------
export const getAutopilotConfig = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/config`,
    { headers: headers() },
  );
  // Returns { status, liveActionsAllowed, accountOverrides: [{adAccountId, rawId, overrides, ...}] }
  // `liveActionsAllowed` is a single global flag driven by the
  // AUTOPILOT_LIVE_ACTIONS_ALLOWED env var on the backend.
  // `accountOverrides` is the optional per-account threshold-pin map (empty
  // by default in v3).
  return data;
};

// -----------------------------------------------------------------------------
// Audit-rule catalog. Drives the per-account rule-overrides editor in the
// Settings UI: every rule's id, severity, description, defaults, and the
// list of tunable thresholds (with type/label/hint/step) for rendering.
// Static-ish — safe to call once per Settings tab mount.
// -----------------------------------------------------------------------------
export const getAuditRules = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/audit-rules`,
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// User-defined rules (Autopilot v4). Form-based rules attached to specific
// campaigns; the cron evaluates only attached (rule × entity) pairs.
// -----------------------------------------------------------------------------
export const listUserRules = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rules`,
    { headers: headers() },
  );
  return data;
};

export const createUserRule = async (rule) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rules`,
    rule,
    { headers: headers() },
  );
  return data;
};

export const updateUserRule = async (id, patch) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rules/${encodeURIComponent(id)}`,
    patch,
    { headers: headers() },
  );
  return data;
};

export const deleteUserRule = async (id) => {
  const { data } = await axios.delete(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rules/${encodeURIComponent(id)}`,
    { headers: headers() },
  );
  return data;
};

export const testUserRule = async (id) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rules/${encodeURIComponent(id)}/test`,
    null,
    { headers: headers() },
  );
  return data;
};

export const getRuleTemplates = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rule-templates`,
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Phase 9 — rotation queue + manual rotation trigger.
// -----------------------------------------------------------------------------
export const getRotationQueue = async ({
  adAccountId,
  adsetId,
  includeUsed = false,
  limit = 50,
} = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rotation-queue`,
    {
      params: { adAccountId, adsetId, includeUsed, limit },
      headers: headers(),
    },
  );
  return data;
};

export const triggerRotation = async ({ adAccountId, dryRun = true } = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/rotate`,
    null,
    {
      params: { adAccountId, dryRun },
      headers: headers(),
      timeout: 180_000,
    },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Phase 10 — approve an auto-generated draft for live rotation.
// -----------------------------------------------------------------------------
export const approveGeneratedDraft = async (draftId) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/autopilot/approve-generated/${draftId}`,
    null,
    { headers: headers() },
  );
  return data;
};
