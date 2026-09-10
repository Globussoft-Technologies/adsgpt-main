/**
 * onboardingClient — thin wrapper over the DS team's onboarding service.
 *
 * That service (`ONBOARDING_INIT_API_CONTRACT.md`) owns the whole expensive
 * half of onboarding: Gemini grounded research, website scraping, the context
 * merge, persistence and the embedding. Node owns identity, the session mirror
 * and the browser-facing surface. This module is the seam between them, and it
 * owns only transport concerns — base URL, timeouts, and turning every possible
 * failure into a typed error the controller can branch on.
 *
 * It deliberately does no mapping. The frontend reads the contract's shapes
 * directly, so re-shaping payloads here would create a second, undocumented
 * contract that drifts from the real one the moment DS ships a field.
 *
 * Two transport decisions worth stating:
 *
 *   • Uploads use Node 22's global `FormData`/`Blob` rather than the `form-data`
 *     package. axios 1.7 serialises native FormData correctly and sets the
 *     multipart boundary itself; reaching for the package would add a
 *     dependency to do what the runtime already does.
 *
 *   • The SSE call returns the raw axios stream, unparsed. The controller pipes
 *     it to the browser byte-for-byte. Parsing and re-emitting the frames would
 *     mean re-implementing event ids, retry hints and `Last-Event-ID` semantics
 *     for no gain — the browser's EventSource already understands them.
 */

const axios = require("axios");
const logger = require("../../utils/logger");

// `POST /onboarding/init` returns 202 BEFORE any AI work starts, so this
// timeout covers a queue write and nothing more. Fifteen seconds is already
// generous; a slower response than that means the service is unhealthy, and
// the user is better served by a fast failure they can retry than by a spinner.
const INIT_TIMEOUT_MS = 15_000;

// Job snapshots and context reads are plain database lookups upstream.
const READ_TIMEOUT_MS = 10_000;

class OnboardingUpstreamError extends Error {
  constructor(message, code, { status = 0, retryable = false, cause = null } = {}) {
    super(message);
    this.name = "OnboardingUpstreamError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

const CODES = Object.freeze({
  // No base URL configured. A deployment problem, not a user problem.
  NOT_CONFIGURED: "ONBOARDING_NOT_CONFIGURED",
  // Service is down or erroring. Retryable — these usually fail fast.
  UNAVAILABLE: "ONBOARDING_UNAVAILABLE",
  // Took too long. NOT retryable: the user already waited the full timeout.
  TIMEOUT: "ONBOARDING_TIMEOUT",
  // Upstream said 4xx. The user's input is the problem; its message is worth
  // passing through, because the contract writes them for humans.
  REJECTED: "ONBOARDING_REJECTED",
  // Job or context id doesn't exist upstream.
  NOT_FOUND: "ONBOARDING_NOT_FOUND",
  // 200, but the body isn't the contract.
  BAD_RESPONSE: "ONBOARDING_BAD_RESPONSE",
});

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

function requireBaseUrl() {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    throw new OnboardingUpstreamError(
      "Onboarding service is not configured",
      CODES.NOT_CONFIGURED
    );
  }
  return baseUrl;
}

/**
 * Every axios failure, reduced to one typed error.
 *
 * The contract's error envelope is `{"error": "..."}` — a bare string with no
 * machine-readable code — so on a 4xx we surface that string verbatim rather
 * than inventing a code it doesn't have. Guessing at categories here would put
 * words in the upstream service's mouth.
 */
function toUpstreamError(error, context) {
  if (error instanceof OnboardingUpstreamError) return error;

  if (error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "")) {
    return new OnboardingUpstreamError(
      `Onboarding service timed out (${context})`,
      CODES.TIMEOUT,
      { retryable: false, cause: error }
    );
  }

  const status = error?.response?.status || 0;

  if (status === 404) {
    return new OnboardingUpstreamError("Not found", CODES.NOT_FOUND, {
      status,
      cause: error,
    });
  }

  if (status >= 400 && status < 500) {
    const upstreamMessage =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      "Onboarding service rejected the request";
    return new OnboardingUpstreamError(upstreamMessage, CODES.REJECTED, {
      status,
      cause: error,
    });
  }

  return new OnboardingUpstreamError(
    `Onboarding service unavailable (${context})`,
    CODES.UNAVAILABLE,
    { status, retryable: true, cause: error }
  );
}

/**
 * Validates the acceptance payload before we hand ids to the client.
 *
 * A malformed acceptance is worse than a failure: the browser would store a
 * junk `job_id`, poll it forever, and show a spinner that can never resolve.
 * Better to fail here, while the user still has a retry button.
 */
function assertAcceptance(data, context) {
  if (!data || typeof data !== "object" || !data.session_id || !data.job_id) {
    throw new OnboardingUpstreamError(
      `Onboarding service returned an unusable response (${context})`,
      CODES.BAD_RESPONSE
    );
  }
  return data;
}

/**
 * POST /api/v1/onboarding/init
 *
 * `userId` comes from the caller's verified JWT, never from the request body —
 * see the note in Validations/onboarding/onboardingInit.validation.js.
 *
 * Sends JSON when there are no files and multipart when there are, matching the
 * contract's two request forms. The `Idempotency-Key` is forwarded untouched:
 * upstream honours it and returns the ORIGINAL job on a retry, which is what
 * stops a double-submit from paying for two AI runs.
 */
async function initOnboarding({
  userId,
  sessionId = "",
  prompt = "",
  files = [],
  idempotencyKey = "",
}) {
  const baseUrl = requireBaseUrl();
  const url = `${baseUrl}/api/v1/onboarding/init`;
  const headers = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let body;
  if (files.length) {
    // multer's memoryStorage gives us `buffer`; Blob wraps it without a copy of
    // the bytes into a string, and preserves the MIME type the contract says is
    // passed on to the AI provider.
    const form = new FormData();
    form.append("user_id", userId);
    if (sessionId) form.append("session_id", sessionId);
    if (prompt) form.append("prompt", prompt);
    for (const file of files) {
      form.append(
        // The contract accepts ANY multipart file-field name and preserves it,
        // so the user's own field name is kept rather than flattened.
        file.fieldname || "file",
        new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }),
        file.originalname || "upload"
      );
    }
    body = form;
    // Left unset on purpose: axios derives the multipart boundary itself, and
    // setting Content-Type by hand omits it and breaks the upload.
  } else {
    body = { user_id: userId, ...(sessionId ? { session_id: sessionId } : {}), prompt };
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await axios.post(url, body, {
      headers,
      timeout: INIT_TIMEOUT_MS,
      // Uploads can be large; axios defaults to 10MB and the contract allows 32.
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return assertAcceptance(response.data, "init");
  } catch (error) {
    const wrapped = toUpstreamError(error, "init");
    logger.error("[onboarding] init failed", {
      code: wrapped.code,
      status: wrapped.status,
      message: wrapped.message,
    });
    throw wrapped;
  }
}

/** GET /api/v1/jobs/{job_id} — the poll fallback and the refresh recovery path. */
async function getJob(jobId) {
  const baseUrl = requireBaseUrl();
  try {
    const response = await axios.get(
      `${baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}`,
      { timeout: READ_TIMEOUT_MS }
    );
    return response.data;
  } catch (error) {
    throw toUpstreamError(error, "job snapshot");
  }
}

/**
 * GET /api/v1/jobs/{job_id}/events — opened as a raw stream for the SSE proxy.
 *
 * `timeout: 0` because this connection is SUPPOSED to stay open; axios's normal
 * timeout would sever a healthy stream mid-run. The caller is responsible for
 * destroying the stream when the browser disconnects — without that, a closed
 * tab leaves a socket held open against upstream.
 */
async function openJobEventStream(jobId, { lastEventId = "" } = {}) {
  const baseUrl = requireBaseUrl();
  const headers = { Accept: "text/event-stream" };
  // Forwarded so upstream replays only what the browser actually missed.
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;

  try {
    const response = await axios.get(
      `${baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/events`,
      { headers, timeout: 0, responseType: "stream" }
    );
    return response.data;
  } catch (error) {
    throw toUpstreamError(error, "job events");
  }
}

/** GET /api/v1/context/{session_id} — the persisted brand context, the truth. */
async function getContext(sessionId) {
  const baseUrl = requireBaseUrl();
  try {
    const response = await axios.get(
      `${baseUrl}/api/v1/context/${encodeURIComponent(sessionId)}`,
      { timeout: READ_TIMEOUT_MS }
    );
    return response.data;
  } catch (error) {
    throw toUpstreamError(error, "context");
  }
}

module.exports = {
  initOnboarding,
  getJob,
  openJobEventStream,
  getContext,
  OnboardingUpstreamError,
  ONBOARDING_ERROR_CODES: CODES,
  _internals: { resolveBaseUrl, toUpstreamError, assertAcceptance },
};
