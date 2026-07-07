/**
 * Builds the `object_story_spec` field for a Meta Ad creative, keyed by
 * the `objectStorySpecShape` defined in `config/wizardSchema.js`.
 *
 * `object_story_spec` describes the creative — image OR video + copy +
 * CTA + destination — in one Meta-API-shaped blob. Each cell in the
 * wizard matrix maps to a shape here; this module owns the per-shape
 * payload construction so the controller stays thin.
 *
 * Image vs video selection:
 *   - When `params.videoId` is provided, every shape emits `video_data`
 *     instead of `link_data`. `video_data` carries the same copy fields
 *     (title/message/description, call_to_action) as link_data plus
 *     `video_id` and `image_url` (the video poster / thumbnail).
 *   - When `params.imageHash` is provided, shapes emit `link_data` as
 *     before (the V1-verified shape).
 *   - One of the two MUST be set; both throws.
 *
 * VALIDATION STATUS — only the image (`link_data`) Traffic-Website path
 * is byte-for-byte verified against Meta. Video variants are constructed
 * from Meta's v22+ Marketing API reference and verified per cell as we
 * smoke-test them.
 */

/**
 * @param {string} shape   key matching cell.ad.objectStorySpecShape
 * @param {object} params  shape-specific inputs:
 *   common: { pageId, instagramUserId?, headline, primaryText, description?,
 *     callToAction }
 *   media (one of):
 *     - imageHash: string  (use link_data shape)
 *     - videoId + videoThumbnailUrl: string  (use video_data shape;
 *       thumbnail is the video poster Meta shows pre-play. Required by
 *       Meta — without it the creative call fails.)
 *   - link_data variants: + { linkUrl, urlTags? }
 *   - lead_gen_form: + { leadFormId }
 *   - app_link: + { objectStoreUrl, applicationId, deepLink?, customProductPage? }
 *   - click_to_call: + { phoneNumber }
 *   - whatsapp_click_to_message: + { whatsappNumberId? }
 * @returns {object} ready for the SDK `createAdCreative` call's
 *   `object_story_spec` field
 */
function buildObjectStorySpec(shape, params) {
  if (!shape) throw new Error("buildObjectStorySpec: shape is required");
  if (!params || !params.pageId) {
    throw new Error("buildObjectStorySpec: pageId is required for every shape");
  }
  // Exactly one media source must be set. This rule is enforced here
  // (the cheapest check) rather than per-builder, since every shape
  // needs the same constraint — except `template_data` (Sales/CATALOG /
  // Dynamic Product Ads), where Meta sources images per-product from the
  // catalog feed. For template_data the builder rejects imageHash /
  // videoId explicitly (caller bug: shouldn't have set them).
  const hasImage = !!params.imageHash;
  const hasVideo = !!params.videoId;
  if (shape === "template_data") {
    if (hasImage || hasVideo) {
      throw new Error(
        "buildObjectStorySpec('template_data'): images come from the catalog feed — do not supply imageHash or videoId",
      );
    }
  } else if (hasImage === hasVideo) {
    throw new Error(
      "buildObjectStorySpec: provide exactly one of imageHash or videoId",
    );
  }
  // Thumbnail is optional at the builder level — the controller fetches
  // Meta's auto-generated thumbnail before calling us when one wasn't
  // supplied. If the thumbnail is still genuinely absent (rare — only
  // happens when Meta's encoder hasn't produced thumbnails yet), the
  // builder still emits video_data without image_url and lets Meta
  // pick one at ad-creation time. Meta's API tolerates this for newer
  // API versions.

  const base = { page_id: params.pageId };
  // instagram_actor_id was hard-deprecated 2025-09-09 — every live API
  // version uses instagram_user_id. See gotchas.md.
  if (params.instagramUserId) base.instagram_user_id = params.instagramUserId;

  // Each branch returns the *data* block; the outer key (link_data,
  // video_data, or template_data) is decided once per call based on
  // shape + media kind. template_data is its own top-level key Meta
  // recognises for Dynamic Product Ads — same level as link_data /
  // video_data, NOT nested.
  const dataKey =
    shape === "template_data" ? "template_data" : hasVideo ? "video_data" : "link_data";
  const buildPair = (data) => ({ ...base, [dataKey]: data });

  switch (shape) {
    case "link_data":
      return buildPair(buildLinkData(params));

    case "template_data":
      // Sales/CATALOG — plain literal copy (see buildTemplateData's
      // docblock for why the {{product.X}} placeholder feature this used
      // to describe was removed). Images come from the bound product_set;
      // the outer key `template_data` (not `link_data`) is what tells
      // Meta that.
      return buildPair(buildTemplateData(params));

    case "lead_gen_form":
      // Single Instant Form cell — destination_type=ON_AD. The CTA's
      // `value` is form-only; Meta routes every clicker to the form.
      return buildPair(buildLeadGenLinkData(params));

    case "lead_gen_form_with_pixel":
      // Multiple "Website and Instant Forms" cell —
      // destination_type=WEBSITE. The creative is a website ad with a
      // form alongside; CTA's `value` must carry BOTH `link` (the
      // website fallback) AND `lead_gen_form_id`. Without `link`, Meta
      // rejects the ad with code 100 / subcode 1815676 ("Non-website
      // ads are not allowed in ad sets with website destination type").
      return buildPair(buildLeadGenLinkData(params, { ctaIncludesLink: true }));

    case "pixel_website":
      // Leads/Website single — pure website lead capture via Pixel.
      // No form id on the CTA; just a regular link_data with a SIGN_UP-
      // class CTA pointing at the customer's landing page. Conversion
      // attribution lives in the AdSet's promoted_object (pixel +
      // custom_event_type), not the creative.
      return buildPair(buildLinkData(params));

    case "instagram_direct":
      return buildPair(buildInstagramDirectLinkData(params));

    case "app_link":
      return buildPair(buildAppLinkData(params));

    case "messenger_click_to_message":
      return buildPair(buildMessengerLinkData(params));

    case "whatsapp_click_to_message":
      return buildPair(buildWhatsappLinkData(params));

    case "click_to_call":
      return buildPair(buildClickToCallLinkData(params));

    default:
      throw new Error(`buildObjectStorySpec: unknown shape "${shape}"`);
  }
}

// ─── shared media helper ─────────────────────────────────────────────────────
// Builds the `{image_hash}` OR `{video_id, image_url}` prefix that every
// shape needs. Keeping it in one place means a future Meta field rename
// affects one line, not nine.
function mediaFields(p) {
  if (p.videoId) {
    const fields = { video_id: p.videoId };
    // image_url (the poster) is optional — newer Meta API versions
    // auto-pick a thumbnail when omitted. The V2 controller does its
    // best to provide one via Meta's auto-thumbnail endpoint before
    // calling here, but if the encoder hasn't produced thumbnails yet
    // (very long videos), omit the field and let Meta default.
    if (p.videoThumbnailUrl) fields.image_url = p.videoThumbnailUrl;
    return fields;
  }
  return { image_hash: p.imageHash };
}

// `link_data.link` is required on most shapes; `video_data` accepts
// `link_description` / `call_to_action` but not a bare top-level `link`.
// This helper attaches the link only when the shape's data block is
// link_data — video_data routes the link via call_to_action.value.link
// only.
function attachLink(data, p, isVideo) {
  if (isVideo) return data;
  if (p.linkUrl) data.link = p.linkUrl;
  return data;
}

// Common copy fields the creative shows alongside the media. Same names
// on both link_data and video_data, so this helper is media-agnostic.
function attachCopy(data, p) {
  if (p.primaryText) data.message = p.primaryText;
  if (p.headline) {
    // video_data uses `title`, link_data uses `name`. Both keys map to
    // the headline Meta shows above the media.
    if (p.videoId) data.title = p.headline;
    else data.name = p.headline;
  }
  if (p.description) {
    // Description field name differs by media kind. video_data rejects
    // `description` outright (Meta subcode 1443050: "The field description
    // is not supported in the field video_data of object_story_spec") —
    // for videos the equivalent field is `link_description`.
    if (p.videoId) data.link_description = p.description;
    else data.description = p.description;
  }
  // NOTE: `automatic_translation` used to live here (on link_data / video_data)
  // but Meta moved it out of object_story_spec in v24 — sending it here triggers
  // subcode 1443050 ("The field automatic_translation is not supported in the
  // field link_data of object_story_spec"). The setting now applies at the
  // AdCreative level via degrees_of_freedom_spec.creative_features_spec.
  // TEXT_OVERLAY_TRANSLATION — see `buildAdCreativeOr400` in metaAdLauncherV2.js.
  // (Meta's valid creative_features_spec keys: IG_VIDEO_NATIVE_SUBTITLE,
  // IMAGE_ANIMATION, PRODUCT_BROWSING, PRODUCT_METADATA_AUTOMATION, PROFILE_CARD,
  // STANDARD_ENHANCEMENTS_CATALOG, TEXT_OVERLAY_TRANSLATION — per Meta API #100
  // error response. The earlier `translate_text` key was wrong.)
  return data;
}

// ─── link_data — Traffic/Website (V1-verified shape) ─────────────────────────

function buildLinkData(p) {
  const isVideo = !!p.videoId;
  if (!isVideo && !p.imageHash) {
    throw new Error("link_data: imageHash or videoId is required");
  }
  if (!p.linkUrl) throw new Error("link_data: linkUrl is required");
  // Mirror of V1 createAd's payload. Meta rejects empty-string fields
  // (`name: ""`) with "Invalid parameter", so optional fields attach only
  // when truthy.
  let data = { ...mediaFields(p) };
  data = attachLink(data, p, isVideo);
  data = attachCopy(data, p);
  if (p.callToAction && p.callToAction !== "NO_BUTTON") {
    data.call_to_action = {
      type: p.callToAction,
      value: { link: p.linkUrl },
    };
  }
  return data;
}

// ─── lead_gen_form — Leads/Instant Form ──────────────────────────────────────

function buildLeadGenLinkData(p, opts = {}) {
  const isVideo = !!p.videoId;
  if (!isVideo && !p.imageHash) {
    throw new Error("lead_gen_form: imageHash or videoId is required");
  }
  if (!p.leadFormId || !p.linkUrl) {
    throw new Error("lead_gen_form: leadFormId + linkUrl are required");
  }
  // Meta requires `link_data.link` to be a real EXTERNAL URL on Lead Gen
  // ads (subcode 1815316: "Lead ad creative does not use external URL").
  // Facebook / Page URLs are rejected. The link acts as a fallback
  // destination when users skip the form.
  //
  // CTA `value` shape depends on the ad set's destination_type:
  //   - Single Instant Form (destination_type=ON_AD, opts.ctaIncludesLink
  //     defaults to false) → CTA value only carries `lead_gen_form_id`.
  //     Meta routes every clicker to the form.
  //   - Multiple "Website and Instant Forms" (destination_type=WEBSITE,
  //     opts.ctaIncludesLink=true) → CTA value carries BOTH `link` AND
  //     `lead_gen_form_id`. Without `link`, Meta rejects the ad with
  //     code 100 / subcode 1815676 ("Non-website ads are not allowed in
  //     ad sets with website destination type"). The form is then the
  //     alternative path Meta picks per viewer.
  let data = { ...mediaFields(p) };
  data = attachLink(data, p, isVideo);
  data = attachCopy(data, p);
  const ctaValue = { lead_gen_form_id: p.leadFormId };
  if (opts.ctaIncludesLink) ctaValue.link = p.linkUrl;
  data.call_to_action = {
    type: p.callToAction || "SIGN_UP",
    value: ctaValue,
  };
  return data;
}

// ─── app_link — App Promotion ───────────────────────────────────────────────

function buildAppLinkData(p) {
  const isVideo = !!p.videoId;
  if (!isVideo && !p.imageHash) {
    throw new Error("app_link: imageHash or videoId is required");
  }
  if (!p.objectStoreUrl || !p.applicationId) {
    throw new Error("app_link: objectStoreUrl + applicationId are required");
  }
  // For App Promotion, `link` is the app store URL (Apple App Store or
  // Play Store). Meta's INSTALL_MOBILE_APP / USE_APP CTAs require
  // `value.application` (the Meta application id) alongside `value.link`.
  // Without it Meta rejects with a generic "Invalid parameter" — the
  // error_user_msg mentions the application field.
  let data = { ...mediaFields(p) };
  if (!isVideo) data.link = p.objectStoreUrl;
  data = attachCopy(data, p);
  data.call_to_action = {
    type: p.callToAction || "INSTALL_MOBILE_APP",
    value: {
      application: p.applicationId,
      link: p.objectStoreUrl,
    },
  };
  if (p.deepLink) {
    // Both branches use the same URL for MVP; future bi-platform work
    // splits them.
    data.app_link_spec = {
      ios: [{ url: p.deepLink }],
      android: [{ url: p.deepLink }],
    };
  }
  if (p.customProductPage) {
    data.custom_product_page_id = p.customProductPage;
  }
  return data;
}

// ─── instagram_direct (Leads/Instagram) ──────────────────────────────────────

function buildInstagramDirectLinkData(p) {
  const isVideo = !!p.videoId;
  if (!isVideo && !p.imageHash) {
    throw new Error("instagram_direct: imageHash or videoId is required");
  }
  if (!p.linkUrl) throw new Error("instagram_direct: linkUrl is required");
  // Same pattern as Messenger click-to-message — external link required
  // (bypass-fallback), CTA value carries the destination signal.
  let data = { ...mediaFields(p) };
  data = attachLink(data, p, isVideo);
  data = attachCopy(data, p);
  data.call_to_action = {
    type: p.callToAction || "INSTAGRAM_MESSAGE",
    value: {
      app_destination: "INSTAGRAM_DIRECT",
      page: p.pageId,
    },
  };
  return data;
}

// ─── messenger_click_to_message ──────────────────────────────────────────────

function buildMessengerLinkData(p) {
  const isVideo = !!p.videoId;
  if (!isVideo && !p.imageHash) {
    throw new Error("messenger_click_to_message: imageHash or videoId is required");
  }
  if (!p.linkUrl) throw new Error("messenger_click_to_message: linkUrl is required");
  // Meta requires `link_data.link` on every creative — empty/missing →
  // subcode 2061015 ("link field is required"). For Lead Gen + Messenger
  // it additionally must be a non-Facebook URL (subcode 1815316). The
  // user-provided linkUrl serves as the bypass-fallback; primary
  // destination is Messenger via the CTA's app_destination.
  let data = { ...mediaFields(p) };
  data = attachLink(data, p, isVideo);
  data = attachCopy(data, p);
  data.call_to_action = {
    type: p.callToAction || "MESSAGE_PAGE",
    value: {
      app_destination: "MESSENGER",
      page: p.pageId,
    },
  };
  return data;
}

// ─── whatsapp_click_to_message ───────────────────────────────────────────────

function buildWhatsappLinkData(p) {
  const isVideo = !!p.videoId;
  if (!isVideo && !p.imageHash) {
    throw new Error("whatsapp_click_to_message: imageHash or videoId is required");
  }
  let data = { ...mediaFields(p) };
  data = attachCopy(data, p);
  // Real hit (2026-07-07, subcode 1856030): "Invalid value field page for
  // CTA type: WHATSAPP_MESSAGE." Unlike `app_destination: "MESSENGER"`
  // (buildMessengerLinkData above), which accepts — and can even need —
  // a `page` field so the CTA can point at a DIFFERENT Facebook Page than
  // the ad's own, WhatsApp has no such cross-page concept: the chat opens
  // against whichever WhatsApp Business number is connected to THIS ad's
  // own Page (already set via `object_story_spec.page_id`). Meta rejects
  // `page` outright for this CTA type — don't add it back by copy-pasting
  // the Messenger shape.
  data.call_to_action = {
    type: p.callToAction || "WHATSAPP_MESSAGE",
    value: {
      app_destination: "WHATSAPP",
      ...(p.whatsappNumberId ? { whatsapp_number_id: p.whatsappNumberId } : {}),
    },
  };
  return data;
}

// ─── click_to_call ───────────────────────────────────────────────────────────

function buildClickToCallLinkData(p) {
  const isVideo = !!p.videoId;
  if (!isVideo && !p.imageHash) {
    throw new Error("click_to_call: imageHash or videoId is required");
  }
  if (!p.phoneNumber || !p.linkUrl) {
    throw new Error("click_to_call: phoneNumber + linkUrl are required");
  }
  // Normalise the phone into a tel:-safe value. The number comes from
  // the Facebook Page's `phone` field, which Meta returns FORMATTED —
  // "+91 98765 43210", "(555) 123-4567", "091-98765-43210", etc. A
  // tel: URL built from that raw string (`tel:+91 98765 43210`) is
  // rejected by Meta with subcode 2061044 ("Invalid phone number"),
  // blamed on call_to_action[value][link]. Meta wants bare digits with
  // an optional leading "+". We strip spaces / parens / dashes / dots
  // and keep a leading "+" if the source had one. We can't invent a
  // country code, so a number with neither "+" nor a country code is
  // passed through as digits-only — that's a Page-data problem the
  // advertiser must fix in Page Settings.
  const rawPhone = String(p.phoneNumber).replace(/^tel:/i, "").trim();
  const hadPlus = rawPhone.startsWith("+");
  const digits = rawPhone.replace(/[^\d]/g, "");
  if (digits.length < 7) {
    throw new Error(
      `click_to_call: the Page phone number ("${p.phoneNumber}") is not a usable phone number — fix it in Meta Page Settings → About → Contact info`,
    );
  }
  // link_data.link stays an https:// URL (Meta rejects tel: there for
  // Lead Gen, subcode 1815316). The tel: URL goes on the CTA value's
  // link so the button-press triggers the dialer.
  const telUrl = `tel:${hadPlus ? "+" : ""}${digits}`;
  let data = { ...mediaFields(p) };
  data = attachLink(data, p, isVideo);
  data = attachCopy(data, p);
  // `link_caption` is intentionally omitted — for click_to_call CTAs on
  // WEBSITE-routed ads (Leads/Website-and-Calls uses destination_type=
  // WEBSITE), Meta validates link_caption as a URL and rejects a bare
  // phone number with "Call to Action link caption is not a URL". The
  // field is optional; dropping it works across every cell that uses
  // this builder.
  data.call_to_action = {
    type: p.callToAction || "CALL_NOW",
    value: { link: telUrl },
  };
  return data;
}

// ─── template_data — Sales/CATALOG (Dynamic Product Ads) ────────────────────
// Copy fields look like link_data (message / title / description /
// call_to_action) but the outer key is `template_data` (set by the
// dispatcher above) — this is the key that tells Meta the creative is
// bound to a product_set (see promoted_object) rather than a single fixed
// image/video. No image_hash / video_id (catalog provides images).
//
// REMOVED 2026-07-07: a `{{product.X}}` placeholder/macro feature used to
// live here, on the assumption that Meta resolves per-product tokens
// inside this text at delivery. That assumption was never verified
// against Meta's real product before shipping. Two of the offered tokens
// were proven live-broken ({{product.url}} — subcode 2061006;
// {{product.description}} — subcode 1487844) before a direct check of
// Meta Ads Manager's own Catalog-ad creation flow found no placeholder
// affordance there AT ALL — the whole feature was speculative. Copy
// fields here are now plain literal text, same as every other cell,
// including the standard 40/125/30 character caps (meta.v2.validator.js).
// See gotchas.md for the full retrospective.
function buildTemplateData(p) {
  if (!p.linkUrl) throw new Error("template_data: linkUrl is required");
  const data = {};
  // Meta DPA convention: `message` = primary text above the carousel of
  // products; `name` = headline on each product card; `description` =
  // subline under the price on each card. Same field names as link_data.
  if (p.primaryText) data.message = p.primaryText;
  if (p.headline) data.name = p.headline;
  if (p.description) data.description = p.description;
  // Real URL — validated as a URI at the Joi boundary
  // (meta.v2.validator.js); this builder just passes it through.
  data.link = p.linkUrl;
  if (p.callToAction && p.callToAction !== "NO_BUTTON") {
    data.call_to_action = {
      type: p.callToAction,
      value: { link: p.linkUrl },
    };
  }
  return data;
}

module.exports = {
  buildObjectStorySpec,
  _internals: {
    buildLinkData,
    buildLeadGenLinkData,
    buildAppLinkData,
    buildInstagramDirectLinkData,
    buildMessengerLinkData,
    buildWhatsappLinkData,
    buildClickToCallLinkData,
    buildTemplateData,
  },
};
