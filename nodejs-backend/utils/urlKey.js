/**
 * canonicalUrlKey — one page, one key.
 *
 * PURE. No DB, no network.
 *
 * Ad Factory dedupes briefs per (user, page) so that reading the same page
 * twice reuses the existing brief instead of paying for a second scrape. That
 * only works if "the same page" has one spelling, and `new URL(x).href` is not
 * enough: it normalises case and adds a trailing slash, but leaves all of these
 * as distinct strings —
 *
 *   dell.com
 *   https://dell.com
 *   https://www.dell.com/
 *   http://dell.com/
 *   https://dell.com/?utm_source=newsletter
 *   https://dell.com/#specs
 *
 * — which is exactly how one account ends up with six briefs for one site, each
 * one having cost a ~35s LLM read. This collapses them.
 *
 * What is deliberately NOT collapsed: the path. `/laptops` and `/monitors` are
 * different pages and must produce different briefs, so only a single trailing
 * slash is trimmed.
 *
 * The key is for MATCHING ONLY. `source.url` keeps what the user actually
 * typed — that is what gets scraped, what the CTA links to, and what is shown
 * back to them. Never send this key anywhere.
 */

// Params that identify a campaign or a click, never a page. Dropping them means
// the same page shared from an email and from an ad dedupe to one brief.
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "ttclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
  "_ga",
  "_gl",
  "yclid",
  "dclid",
]);

/**
 * @param {string} input  A URL, with or without a scheme.
 * @returns {string} A canonical key, or "" when the input isn't a usable URL.
 *                   An empty key must never be stored — it would make every
 *                   unparseable input collide with every other.
 */
function canonicalUrlKey(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";

  // A bare domain is what people actually paste. Assume https so it parses;
  // the scheme is dropped from the key anyway, so http/https collapse together
  // — they are the same page, and sites redirect between them freely.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return "";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "";

  let host = url.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return "";

  // Non-default ports are part of the identity; default ones are noise.
  const port =
    url.port && !((url.protocol === "https:" && url.port === "443") ||
                  (url.protocol === "http:" && url.port === "80"))
      ? `:${url.port}`
      : "";

  // One trailing slash goes; deeper paths are left alone because they are
  // genuinely different pages.
  let path = url.pathname || "/";
  if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") path = "";

  // Remaining params are sorted so ?a=1&b=2 and ?b=2&a=1 agree.
  const params = [];
  for (const [k, v] of url.searchParams) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) continue;
    params.push([k, v]);
  }
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length
    ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}`
    : "";

  // The fragment is never sent to a server, so it cannot identify a page.
  return `${host}${port}${path}${query}`;
}

module.exports = { canonicalUrlKey, TRACKING_PARAMS };
