/**
 * safeUrl — SSRF guard for endpoints that fetch a URL the user supplied.
 *
 * Ad Factory 2.0's brief endpoint takes a URL from the request body and causes
 * a server-side fetch of it. That is textbook SSRF surface: without a guard,
 * a caller can point us at `http://169.254.169.254/latest/meta-data/` (cloud
 * instance credentials), at `http://localhost:6379` (our own Redis), or at any
 * host inside the VPC that has no business being reachable from the internet.
 *
 * The Python autofill service has its own `_validate_url`, but Node is the
 * FIRST hop. This is a second line of defence in a different process, not a
 * delegation — if the two ever disagree, the stricter one wins and nothing
 * hostile reaches Python at all.
 *
 * Three properties worth understanding:
 *
 *   1. We check the RESOLVED IP, never the hostname string. `evil.com` can
 *      have an A record pointing at 127.0.0.1, and a blocklist of names would
 *      wave it straight through.
 *
 *   2. We re-check at EVERY redirect hop. A permitted public host is free to
 *      302 you inward, which is the classic bypass.
 *
 *   3. Parsing is done with WHATWG `URL`, so the decimal / octal / hex IP
 *      encodings (`http://2130706433/`, `http://0177.0.0.1/`) normalise before
 *      we ever look at them.
 *
 * `assertSafeUrl` is pure apart from the DNS lookup. `safeGet` wraps axios with
 * the guard applied per hop plus a response-size cap.
 */

const dns = require("node:dns").promises;
const net = require("node:net");

// ─── Errors ──────────────────────────────────────────────────────────────────

class UnsafeUrlError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "UnsafeUrlError";
    this.code = "UNSAFE_URL";
    // Machine-readable so callers can branch without string-matching.
    this.reason = reason;
  }
}

// ─── Policy ──────────────────────────────────────────────────────────────────

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Hard cap on redirect hops. Meta/marketing URLs redirect a couple of times
// (http→https, apex→www, tracking); three is comfortably enough and bounds the
// work an attacker can make us do.
const MAX_REDIRECTS = 3;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Is this IPv4 address in a range we refuse to fetch from?
 *
 * Covers the ranges that matter for SSRF rather than every reserved block in
 * the IANA registry: loopback, private, link-local (incl. the cloud metadata
 * address), CGNAT, and the "this network" / broadcast edges.
 */
function isBlockedIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → refuse rather than guess
  }
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8   "this network"
  if (a === 10) return true; // 10.0.0.0/8  private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local — includes
  //                                          169.254.169.254 cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (TEST-NET-1)
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved,
  //                            255.255.255.255 broadcast
  return false;
}

/**
 * Is this IPv6 address blocked?
 *
 * IPv4-mapped addresses (`::ffff:127.0.0.1`) are unwrapped and run through the
 * IPv4 rules — otherwise loopback walks straight in through the v6 door.
 */
function isBlockedIPv6(ip) {
  const lower = String(ip).toLowerCase();

  // ::ffff:127.0.0.1 and the ::ffff:7f00:1 hex spelling.
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped) {
    const inner = mapped[1];
    if (net.isIPv4(inner)) return isBlockedIPv4(inner);
    // Hex form — two 16-bit groups make up the v4 address.
    const groups = inner.split(":");
    if (groups.length === 2) {
      const hi = parseInt(groups[0], 16);
      const lo = parseInt(groups[1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const v4 = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".");
        return isBlockedIPv4(v4);
      }
    }
    return true;
  }

  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // not an IP we understand → refuse
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse and apply every check that does NOT need the network.
 *
 * Split out from the DNS step so tests can exercise the parsing rules without
 * resolving anything, and so callers can reject obvious junk cheaply.
 *
 * @returns {URL}
 * @throws  {UnsafeUrlError}
 */
function parseSafeUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new UnsafeUrlError("A URL is required", "empty");
  }

  const raw = input.trim();

  let url;
  try {
    // Bare domains are common in a paste-a-URL field. Assume https, matching
    // what utils/scrape.js and the Python service already do.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL", "malformed");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(
      "Only http and https URLs are supported",
      "protocol",
    );
  }

  // `user:pass@host` can smuggle a different host past naive parsers and has
  // no legitimate use here.
  if (url.username || url.password) {
    throw new UnsafeUrlError(
      "URLs with embedded credentials are not allowed",
      "credentials",
    );
  }

  if (!url.hostname) {
    throw new UnsafeUrlError("That URL has no host", "no_host");
  }

  // A literal IP in the URL is checked immediately — no DNS needed. WHATWG URL
  // has already normalised decimal/octal/hex forms to dotted quad by now.
  const literal = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (net.isIP(literal) && isBlockedIp(literal)) {
    throw new UnsafeUrlError(
      "That URL points to a private or reserved address",
      "blocked_ip",
    );
  }

  return url;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Parse, then resolve the host and check every address it answers with.
 *
 * A hostname can carry several A/AAAA records; if ANY of them is blocked we
 * refuse, because we don't control which one the HTTP client will connect to.
 *
 * @param {string} input
 * @param {{ lookup?: Function }} [deps] injection point for tests — defaults to
 *        `dns.lookup` with `all: true`.
 * @returns {Promise<URL>}
 * @throws  {UnsafeUrlError}
 */
async function assertSafeUrl(input, deps = {}) {
  const url = parseSafeUrl(input);

  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) return url; // already checked in parseSafeUrl

  const lookup = deps.lookup || ((host) => dns.lookup(host, { all: true }));

  let records;
  try {
    records = await lookup(url.hostname);
  } catch {
    throw new UnsafeUrlError(
      "We couldn't reach that domain — check the address and try again",
      "dns_failed",
    );
  }

  const addresses = (Array.isArray(records) ? records : [records])
    .map((r) => (typeof r === "string" ? r : r?.address))
    .filter(Boolean);

  if (addresses.length === 0) {
    throw new UnsafeUrlError(
      "We couldn't reach that domain — check the address and try again",
      "dns_empty",
    );
  }

  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new UnsafeUrlError(
        "That URL points to a private or reserved address",
        "blocked_ip",
      );
    }
  }

  return url;
}

// ─── Guarded fetch ───────────────────────────────────────────────────────────

/**
 * GET a user-supplied URL with the guard applied at every redirect hop.
 *
 * axios is told NOT to follow redirects (`maxRedirects: 0`) so we can validate
 * each Location ourselves. Letting axios follow them internally would skip the
 * check on hops 2..n, which is exactly the bypass this module exists to close.
 *
 * NOTE: there is still a TOCTOU window between our DNS check and the client's
 * own resolution (DNS rebinding). Closing it properly needs a custom agent
 * that pins the validated IP. Out of scope here and called out rather than
 * pretended away — the ranges above make the realistic attacks fail, and the
 * only caller today talks to our own Python service.
 */
async function safeGet(input, options = {}) {
  const axios = require("axios");
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    headers = {},
    lookup,
  } = options;

  let current = await assertSafeUrl(input, { lookup });

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await axios.get(current.href, {
      timeout,
      headers,
      maxRedirects: 0,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      // 3xx must reach us rather than throwing, so we can validate the target.
      validateStatus: (s) => s >= 200 && s < 400,
    });

    if (response.status < 300) return response;

    const location = response.headers?.location;
    if (!location) {
      throw new UnsafeUrlError(
        "That URL redirected without a destination",
        "bad_redirect",
      );
    }

    // Relative Locations are legal — resolve against the current URL, then
    // re-run the FULL guard on the result.
    const next = new URL(location, current.href).href;
    current = await assertSafeUrl(next, { lookup });
  }

  throw new UnsafeUrlError("That URL redirects too many times", "too_many_redirects");
}

module.exports = {
  parseSafeUrl,
  assertSafeUrl,
  safeGet,
  UnsafeUrlError,
  _internals: {
    isBlockedIp,
    isBlockedIPv4,
    isBlockedIPv6,
    ALLOWED_PROTOCOLS,
    MAX_REDIRECTS,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_BYTES,
  },
};
