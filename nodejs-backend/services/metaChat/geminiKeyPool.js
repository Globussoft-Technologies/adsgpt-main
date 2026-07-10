// Round-robin pool over a comma-separated GEMINI_API_KEYS env var, same
// pattern as AI/model.js — kept separate because that module is tied to the
// older @google/generative-ai SDK, not @google/genai.
const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

let index = 0;

function getNextGeminiApiKey() {
  if (API_KEYS.length === 0) {
    throw new Error("No GEMINI_API_KEYS/GEMINI_API_KEY configured.");
  }
  const key = API_KEYS[index];
  index = (index + 1) % API_KEYS.length;
  return key;
}

module.exports = { getNextGeminiApiKey };
