function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  return allowedOrigins.some((allowed) => {
    if (allowed !== "http://localhost:*" && allowed !== "https://localhost:*") {
      return false;
    }

    try {
      const parsed = new URL(origin);
      const expectedProtocol = allowed.startsWith("https:") ? "https:" : "http:";
      return parsed.protocol === expectedProtocol && parsed.hostname === "localhost";
    } catch {
      return false;
    }
  });
}

module.exports = {
  parseAllowedOrigins,
  isOriginAllowed,
};
