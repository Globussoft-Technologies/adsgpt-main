/**
 * Validation for the onboarding init endpoint.
 *
 * Three rules shape this file:
 *
 *   1. `user_id` is NOT accepted from the client. Python's contract requires it
 *      in the body, but a request body is not evidence of identity — Node reads
 *      it from the verified JWT and injects it when forwarding. A client that
 *      sends one is trying to onboard as somebody else, so the field is
 *      rejected outright rather than quietly ignored.
 *
 *   2. "A prompt OR at least one file" is the real requirement, and it can only
 *      be judged once multer has parsed the body. Joi validates the text
 *      fields; the controller runs the cross-field check against `req.files`.
 *      Splitting it this way keeps one obviously-correct rule in one place
 *      instead of two half-rules that disagree on empty multipart bodies.
 *
 *   3. URL *safety* is not handled here. Joi can see that a string looks like a
 *      URL; it cannot tell you `internal.corp` resolves to 10.0.0.5. The prompt
 *      is free text that causes a server-side fetch downstream, which is
 *      textbook SSRF surface, so every URL we find in it goes through
 *      `utils/safeUrl` in the controller — where DNS is available. Node is the
 *      first hop and must not delegate that check to Python.
 */

const Joi = require("joi");

// Python's ceiling, matched exactly. Being stricter here would reject payloads
// the downstream service would happily accept; being looser would let us hand
// it something it rejects, turning our 202 into a delayed failure.
const MAX_PROMPT_LENGTH = 1_048_576;

// Total attachment size. The contract's default; enforced in Node too so a
// 200MB upload dies at our edge rather than after crossing the wire twice.
const MAX_TOTAL_UPLOAD_BYTES = 32 * 1024 * 1024;

// A generous cap on how many URLs we bother extracting from the prompt. Python
// only scrapes the first one; the rest are recorded as provenance. Someone
// pasting 500 links is not a use case worth spending DNS lookups on.
const MAX_EXTRACTED_URLS = 10;

// Fields the client is never allowed to set, with the reason each is refused.
// Rejected loudly (400) rather than stripped, because silently dropping
// `user_id` would let a caller believe they had onboarded a different account.
const FORBIDDEN_FIELDS = Object.freeze({
  user_id: "user_id is taken from your session, not the request body",
  userId: "user_id is taken from your session, not the request body",
});

/**
 * The text half of the request. Identical field names in the JSON and
 * multipart forms, so one schema covers both — multer puts text fields on
 * `req.body` either way.
 */
const initSchema = Joi.object({
  // Optional here, conditionally required in the controller: a request with no
  // prompt but a logo attached is valid, and Joi cannot see `req.files`.
  prompt: Joi.string().trim().max(MAX_PROMPT_LENGTH).allow("").messages({
    "string.max": "That prompt is too long",
  }),

  // Supplied to CONTINUE an existing session — re-running onboarding with the
  // same id updates that session's context upstream instead of creating a
  // second one. Omitted on a first run; the upstream service mints it.
  //
  // NOT validated as a UUID, despite what ONBOARDING_INIT_API_CONTRACT.md says.
  // Live responses return `session_id: "2"` and `user_id: "1"` — the service
  // uses plain sequential ids, so a UUID rule here would reject every real
  // request. Treated as an opaque string: we never parse it, only echo it back,
  // and it has to be owned by the caller before it is used (checked in the
  // controller) regardless of its shape.
  session_id: Joi.string().trim().max(200),
}).unknown(false);

/**
 * Rejects the fields listed above before Joi ever runs.
 *
 * Returns an error message, or null when the body is clean.
 */
function rejectForbiddenFields(body = {}) {
  for (const [field, message] of Object.entries(FORBIDDEN_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, field)) return message;
  }
  return null;
}

/**
 * Pulls every http(s) URL out of free-text prompt.
 *
 * Deliberately permissive about what it MATCHES and strict about what it
 * RETURNS: the regex casts a wide net, then `new URL()` is the actual judge, so
 * a malformed match is dropped rather than passed downstream. Trailing
 * punctuation is trimmed because a URL at the end of a sentence usually arrives
 * with a full stop stuck to it, and "https://acme.example." is a different
 * hostname.
 *
 * This does NOT decide whether a URL is safe to fetch — see `utils/safeUrl`.
 */
function extractUrls(prompt = "") {
  if (!prompt) return [];

  const matches = String(prompt).match(/https?:\/\/[^\s<>"']+/gi) || [];
  const seen = new Set();
  const urls = [];

  for (const raw of matches) {
    const trimmed = raw.replace(/[.,;:!?)\]}]+$/, "");
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }
    // Dedupe on the normalised form so the same link pasted twice, once with a
    // trailing slash, counts once.
    const key = parsed.href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(parsed.href);
    if (urls.length >= MAX_EXTRACTED_URLS) break;
  }

  return urls;
}

/**
 * Total bytes across every uploaded file. multer's own `limits.fileSize` caps
 * each file individually; this is the aggregate the contract actually
 * specifies, which ten 4MB files would otherwise slip past.
 */
function totalUploadBytes(files = []) {
  return files.reduce((sum, file) => sum + (file?.size || 0), 0);
}

module.exports = {
  initSchema,
  rejectForbiddenFields,
  extractUrls,
  totalUploadBytes,
  MAX_PROMPT_LENGTH,
  MAX_TOTAL_UPLOAD_BYTES,
  MAX_EXTRACTED_URLS,
};
