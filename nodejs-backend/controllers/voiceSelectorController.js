const axios = require("axios");

// Thin proxy in front of the Python voice catalog service. The Node side
// holds no ElevenLabs credentials — it only forwards GETs to Python and
// pipes the response back to the browser. Frontend talks only to Node,
// which sidesteps the CORS / direct-from-browser issues entirely.

const BASE = process.env.VOICE_PYTHON_BASE_URL 


function pickParams(query = {}) {
  const out = {};
  for (const k of ["language", "gender", "accent", "age"]) {
    if (typeof query[k] === "string" && query[k].length > 0) out[k] = query[k];
  }
  return out;
}

async function proxyGet(path, req, res) {
  try {
    const { data } = await axios.get(`${BASE}${path}`, {
      params: pickParams(req.query),
      timeout: 30000,
    });
    return res.status(200).json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    const message =
      err?.response?.data?.detail ||
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Voice catalog request failed";
    console.error(`[voice-selector] ${path} failed:`, status, message);
    return res.status(status).json({ error: message });
  }
}

exports.stats = (req, res) => proxyGet("/stats", req, res);
exports.languages = (req, res) => proxyGet("/languages", req, res);
exports.genders = (req, res) => proxyGet("/genders", req, res);
exports.accents = (req, res) => proxyGet("/accents", req, res);
exports.ages = (req, res) => proxyGet("/ages", req, res);
exports.voices = (req, res) => proxyGet("/voices", req, res);
