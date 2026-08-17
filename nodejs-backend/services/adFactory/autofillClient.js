/**
 * autofillClient — thin wrapper over the Python team's autofill endpoint.
 *
 * `POST /adfactory/autofill { website_url }` scrapes a URL and returns
 * `{ brandInfo, objectives }` — a shape that maps field-for-field onto Ad
 * Factory's own `brandInfo` / `objectives` sub-documents, and which answers 9
 * of the 12 inputs the v1 canvas blocks on. Node already consumes this exact
 * response in `utils/scrape.js` (`scrapePage2`) for BrandIQ; Ad Factory simply
 * never called it.
 *
 * This module owns only the transport concerns — URL safety, timeout, one
 * retry, and turning every failure into a typed error the caller can branch on.
 * Interpreting the response is `briefMapper`'s job, and it is pure.
 *
 * Base URL: `AD_FACTORY_AUTOFILL_API` when set, otherwise the already-deployed
 * `PYTHON_SCRAPER_BRANDIQ` that BrandIQ uses. The fallback means this works
 * today without waiting on new infrastructure; the dedicated variable exists so
 * the two consumers can be pointed at different deployments later without a
 * code change. (docs/AD_FACTORY_2.md §10.3, item V1.)
 */

const axios = require("axios");
const { assertSafeUrl, UnsafeUrlError } = require("../../utils/safeUrl");
const logger = require("../../utils/logger");

// Measured: ~35s for a cold (uncached) read, +15s of headroom = 50s.
//
// Python scrapes the page and runs a Gemini pass, so this is slow by nature.
// It also keeps a 7-day Redis cache keyed per normalised URL, so a repeat read
// of the same page returns fast — 35s is the COLD path, which is what a
// first-time user always pays.
//
// This number is a product constraint, not just a config value: it is most of
// the time-to-first-creative budget on its own. See docs/AD_FACTORY_2.md §12.
const DEFAULT_TIMEOUT_MS = 50_000;

class AutofillError extends Error {
  constructor(message, code, { retryable = false, cause = null } = {}) {
    super(message);
    this.name = "AutofillError";
    this.code = code;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

const CODES = Object.freeze({
  // The URL itself is the problem — unreachable, or Python could read nothing
  // useful from it. The caller should fall back to the brand path, NOT retry.
  UNUSABLE_URL: "AUTOFILL_UNUSABLE_URL",
  // Our side rejected the URL before we ever called out.
  UNSAFE_URL: "UNSAFE_URL",
  // The service is down / erroring. Retryable — these fail in milliseconds.
  UNAVAILABLE: "AUTOFILL_UNAVAILABLE",
  // Took too long. NOT retryable — the user already waited the full timeout.
  TIMEOUT: "AUTOFILL_TIMEOUT",
  // We got 200 but the body isn't the contract.
  BAD_RESPONSE: "AUTOFILL_BAD_RESPONSE",
  // No base URL configured.
  NOT_CONFIGURED: "AUTOFILL_NOT_CONFIGURED",
});

function resolveBaseUrl() {
  return (
    process.env.AD_FACTORY_AUTOFILL_API ||
    process.env.PYTHON_SCRAPER_BRANDIQ ||
    ""
  );
}

// A 200 that doesn't carry at least one of the two top-level keys is not the
// contract, and mapping it would silently produce an empty brief.
function isContractShape(data) {
  if (!data || typeof data !== "object") return false;
  return (
    (data.brandInfo && typeof data.brandInfo === "object") ||
    (data.objectives && typeof data.objectives === "object")
  );
}

/**
 * Fetch autofill data for a URL.
 *
 * @param {string} url                 user-supplied; validated here
 * @param {object} [options]
 * @param {number} [options.timeout]
 * @param {Function} [options.lookup]  DNS injection point, for tests
 * @param {Function} [options.post]    HTTP injection point, for tests
 * @param {string}  [options.baseUrl]  overrides env resolution
 * @returns {Promise<{ brandInfo: object, objectives: object, sourceUrl: string }>}
 * @throws  {AutofillError|UnsafeUrlError}
 */
async function fetchAutofill(url, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    lookup,
    post = (u, body, cfg) => axios.post(u, body, cfg),
    baseUrl = resolveBaseUrl(),
  } = options;

  if (!baseUrl) {
    throw new AutofillError(
      "Autofill is not configured on this environment",
      CODES.NOT_CONFIGURED,
    );
  }

  // Validate before calling out — Node is the first hop, so a hostile URL must
  // never reach Python even though Python has its own check. Rethrown as-is:
  // UnsafeUrlError already carries a user-safe message and a machine reason.
  const safe = await assertSafeUrl(url, { lookup });

  const attempt = async () => {
    try {
      const res = await post(
        baseUrl,
        { website_url: safe.href },
        { timeout, headers: { "Content-Type": "application/json" } },
      );
      const data = res?.data;
      if (!isContractShape(data)) {
        throw new AutofillError(
          "We couldn't read that page — try a different URL",
          CODES.BAD_RESPONSE,
        );
      }
      return {
        brandInfo: data.brandInfo || {},
        objectives: data.objectives || {},
        sourceUrl: safe.href,
      };
    } catch (err) {
      if (err instanceof AutofillError) throw err;

      if (err?.code === "ECONNABORTED" || /timeout/i.test(err?.message || "")) {
        // NOT retryable, deliberately. A timeout means the user has already
        // waited the full 50s; a silent retry would make them wait 100s for
        // the same likely outcome. Retries are reserved for failures that
        // return in milliseconds (below), where a second attempt is free.
        throw new AutofillError(
          "Reading that page took too long — try again",
          CODES.TIMEOUT,
          { retryable: false, cause: err },
        );
      }

      const status = err?.response?.status;

      // Python returns 400 for an unreachable URL and for an N/A result (a
      // deliberate guard in autofill_prod.py, so we don't get an empty 200).
      // Either way the URL is the problem — retrying changes nothing.
      if (status === 400 || status === 404 || status === 422) {
        throw new AutofillError(
          "We couldn't read that page — check the link or pick a saved brand",
          CODES.UNUSABLE_URL,
          { cause: err },
        );
      }

      throw new AutofillError(
        "Our page reader is unavailable right now — try again shortly",
        CODES.UNAVAILABLE,
        { retryable: true, cause: err },
      );
    }
  };

  try {
    return await attempt();
  } catch (err) {
    // Exactly one retry, and only for transient classes. Retrying a rejected
    // URL just burns another 60s of the user's patience.
    if (!(err instanceof AutofillError) || !err.retryable) throw err;
    logger.warn(
      `[adFactory:autofill] ${err.code} for ${safe.hostname} — retrying once`,
    );
    return attempt();
  }
}

module.exports = {
  fetchAutofill,
  AutofillError,
  AUTOFILL_ERROR_CODES: CODES,
  _internals: { resolveBaseUrl, isContractShape, DEFAULT_TIMEOUT_MS },
};
