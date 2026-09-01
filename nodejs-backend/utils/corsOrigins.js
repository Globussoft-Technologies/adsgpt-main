function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return true;
    }
  } catch {
    // ignore
  }

  return allowedOrigins.some((allowed) => {
    if (allowed !== "http://localhost:*" && allowed !== "https://localhost:*" && allowed !== "http://127.0.0.1:*" && allowed !== "https://127.0.0.1:*") {
      return false;
    }

    try {
      const parsed = new URL(origin);
      const expectedProtocol = allowed.startsWith("https:") ? "https:" : "http:";
      return parsed.protocol === expectedProtocol && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    } catch {
      return false;
    }
  });
}

module.exports = {
  parseAllowedOrigins,
  isOriginAllowed,
};
