/**
 * Flatten a failed MCP tool result into one short line for the UI.
 *
 * A failed call used to reach the browser as just `{ name }` — indistinguishable
 * from a successful one. When the model retried a failing write four times the
 * user saw four identical "Worked for Ns" pills and no hint that anything had
 * gone wrong, let alone why it kept trying.
 *
 * Failure arrives in three different shapes, because neither server throws:
 *
 *   official   a JSON envelope in a text block —
 *              {"error_category":"INTERNAL","error_message":"An internal error…"}
 *   fork       a human sentence — "Error: Bid amount required for bid strategy…"
 *   bridge     `{ error }` injected by executeCall when the call threw outright
 *
 * Only the reason is returned, never the result body: those carry base64 images
 * and whole insight payloads, and this value is sent over SSE on every call.
 */
const MAX_LEN = 200;

// Deliberately anchored: a campaign named "Error Analysis Q4" appearing inside a
// successful result must not be read as a failure.
const PROSE_FAILURE = /^(error|failed|could not|cannot|unable to)\b/i;

function toolErrorSummary(result) {
  if (!result) return null;

  if (typeof result.error === "string" && result.error.trim()) {
    return result.error.trim().slice(0, MAX_LEN);
  }

  for (const block of result.content || []) {
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    const text = block.text.trim();
    if (!text) continue;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === "object" && parsed.error_message) {
      const category = parsed.error_category ? `${parsed.error_category}: ` : "";
      return `${category}${parsed.error_message}`.replace(/\s+/g, " ").slice(0, MAX_LEN);
    }

    // Only unparsed prose can be a fork-style failure — valid JSON without an
    // error_message is a successful payload, whatever words it contains.
    if (!parsed && PROSE_FAILURE.test(text)) {
      return text.replace(/\s+/g, " ").slice(0, MAX_LEN);
    }
  }

  return null;
}

module.exports = { toolErrorSummary };
