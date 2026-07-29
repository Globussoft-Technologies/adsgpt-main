function parseAllowedMobileReturnUrls(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .flatMap((entry) => {
        try {
          const url = new URL(entry);
          return ["http:", "https:"].includes(url.protocol)
            ? []
            : [url.toString()];
        } catch {
          return [];
        }
      }),
  );
}

/**
 * Accept same-origin web URLs and the exact mobile callback registered by the
 * Android and iOS apps. Everything else falls back to the configured frontend
 * to avoid turning the OAuth endpoint into an open redirect.
 */
function safeFacebookReturnUrl(
  candidate,
  fallback,
  mobileReturnUrls = process.env.FACEBOOK_OAUTH_MOBILE_RETURN_URLS,
) {
  let fallbackUrl;
  try {
    fallbackUrl = new URL(fallback);
  } catch {
    return fallback;
  }

  try {
    const target = new URL(candidate || fallback, fallbackUrl);

    if (
      ["http:", "https:"].includes(target.protocol) &&
      target.origin === fallbackUrl.origin
    ) {
      return target.toString();
    }

    const allowedMobileUrls = parseAllowedMobileReturnUrls(mobileReturnUrls);
    if (allowedMobileUrls.has(target.toString())) {
      return target.toString();
    }
  } catch {
    // Invalid candidates use the web fallback below.
  }

  return fallbackUrl.toString();
}

function buildFacebookReturnUrl(candidate, params, fallback, mobileReturnUrls) {
  const redirectUrl = new URL(
    safeFacebookReturnUrl(candidate, fallback, mobileReturnUrls),
  );
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      redirectUrl.searchParams.set(key, String(value));
    }
  }
  return redirectUrl.toString();
}

module.exports = {
  parseAllowedMobileReturnUrls,
  safeFacebookReturnUrl,
  buildFacebookReturnUrl,
};
