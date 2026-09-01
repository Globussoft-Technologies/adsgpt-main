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
    if (
      allowed !== "http://localhost:*" &&
      allowed !== "https://localhost:*" &&
      allowed !== "http://127.0.0.1:*" &&
      allowed !== "https://127.0.0.1:*"
    ) {
      return false;
    }

    try {
      const parsed = new URL(origin);
      const expectedProtocol = allowed.startsWith("https:") ? "https:" : "http:";
      const expectedHostname = allowed.includes("127.0.0.1") ? "127.0.0.1" : "localhost";
      return parsed.protocol === expectedProtocol && parsed.hostname === expectedHostname;
    } catch {
      return false;
    }
  });
}

module.exports = {
  parseAllowedOrigins,
  isOriginAllowed,
};
