/**
 * Wizard schema — single source of truth for Create Campaign Wizard V2.
 *
 * The wizard's V1 implementation renders one identical form regardless of
 * objective, which makes every objective except Traffic-Website partly or
 * entirely broken (App Promotion has no `application_id`; Leads has no Lead
 * Form picker; Messenger-bound flows show the wrong CTAs). V2 replaces that
 * with a config-driven renderer + validator. This file is the config.
 *
 * Pure data only — no Meta SDK imports, no Joi imports. The downstream
 * consumers are:
 *
 *   • The V2 wizard renderer (frontend), via GET /meta-ads/wizard-schema
 *     (added in Phase 1). The renderer maps a cell's `ad.requiredFields` to
 *     visible inputs and `ctas.allowed` to the CTA dropdown.
 *
 *   • The discriminated-union Joi validator factory `buildAdSetSchema` and
 *     `buildAdSchema` (added in Phase 1 in `Validations/meta.validator.js`).
 *     The factory reads the cell for (objective, conversionLocation) and
 *     builds the required-field set.
 *
 *   • The Meta API payload builders `utils/promotedObject.js` and
 *     `utils/objectStorySpec.js` (added in Phase 1). They switch on the
 *     `promotedObjectShape` / `objectStorySpecShape` keys defined here.
 *
 * Why "shape" keys instead of builder functions inline:
 *   - The schema must be JSON-safe so the frontend can fetch it as-is.
 *   - The shape strings act as a contract between this file and the
 *     payload builders. Adding a new shape requires touching both, which
 *     forces conscious extension.
 *
 * Scope of this file:
 *   - 3 objectives in this round: TRAFFIC, LEADS, APP_PROMOTION (the
 *     remaining 3 still flow through V1 until they migrate).
 *   - Conversion locations are user-facing keys (e.g. INSTANT_FORM) that
 *     map via `metaDestinationType` to Meta's `destination_type` enum
 *     (e.g. ON_AD). The renderer + wizard state speak in our keys; the
 *     backend translates at the SDK boundary.
 *   - App Promotion entries are PLACEHOLDERS pending Meta UI screenshots
 *     from the user. The placeholder cell throws `Cell not implemented`
 *     at the renderer when picked, so V2 cannot accidentally ship a
 *     broken App Promotion flow.
 */

// ─── Catalogs ────────────────────────────────────────────────────────────────
// User-facing labels for every Meta enum the wizard exposes. Centralised
// here so both backend (for error messages) and frontend (for dropdowns)
// pull from the same map.

const OBJECTIVE_LABELS = {
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_LEADS: "Leads",
  OUTCOME_APP_PROMOTION: "App Promotion",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_SALES: "Sales",
};

const CONVERSION_LOCATION_LABELS = {
  WEBSITE: "Website",
  APP: "App",
  MESSENGER: "Messenger",
  WHATSAPP: "WhatsApp",
  PHONE_CALL: "Calls",
  CALLS: "Calls",
  INSTAGRAM: "Instagram",
  INSTANT_FORM: "Instant forms",
  // Traffic-specific combined options
  MESSAGE_DESTINATIONS: "Message destinations",
  INSTAGRAM_OR_FACEBOOK: "Instagram or Facebook",
  // Leads-specific Multiple options
  WEBSITE_AND_INSTANT_FORMS: "Website and instant forms",
  WEBSITE_AND_CALLS: "Website and calls",
  INSTANT_FORMS_AND_MESSENGER: "Instant forms and Messenger",
  // Sales-specific Multiple options (Website-and-X). In-store variants
  // deferred — see wizardSchema.js Sales section for the rationale.
  WEBSITE_AND_APP: "Website and app",
  // Engagement-specific "On your ad" sub-options. Both map to
  // destination_type=ON_AD; the optimisation goal disambiguates the cell
  // in reverse-inference (see cellInference.js).
  VIDEO_VIEWS: "Video views",
  POST_ENGAGEMENT: "Post engagement",
  // Sales-specific catalogue cell — Meta's "Catalog sales" destination
  // (Dynamic Product Ads). promoted_object = product_set (NEW shape),
  // object_story_spec = template_data (NEW shape with placeholders).
  CATALOG: "Catalog sales",
  // Awareness-specific. Meta UI has no destination dropdown for Awareness —
  // the cell split mirrors Meta's Performance Goal groups: STANDARD covers
  // the 3 "Awareness goals" (REACH/IMPRESSIONS/AD_RECALL_LIFT), VIDEO_VIEWS
  // (label already declared above for Engagement) covers the 2 "Video view
  // goals" (THRUPLAY/2-second). Reverse-inference disambiguates via the
  // optimization_goal.
  STANDARD: "Brand awareness",
};

// User-facing labels — match Meta Ads Manager's "Performance goal"
// dropdown wording exactly so the wizard reads the same as Meta's UI.
// Frontend displays the label; the wire format stays the raw enum.
// Some cells override these via `optimizationGoalLabels` on the cell
// definition (e.g. Leads/App relabels OFFSITE_CONVERSIONS as "app
// events" instead of "conversions" because that's what Meta shows).
const OPTIMIZATION_GOAL_LABELS = {
  LINK_CLICKS: "Maximise number of link clicks",
  LANDING_PAGE_VIEWS: "Maximise number of landing page views",
  IMPRESSIONS: "Maximise number of impressions",
  REACH: "Maximise daily unique reach",
  LEAD_GENERATION: "Maximise number of leads",
  QUALITY_LEAD: "Maximise number of conversion leads",
  QUALITY_CALL: "Maximise number of calls",
  APP_INSTALLS: "Maximise number of app installs",
  OFFSITE_CONVERSIONS: "Maximise number of conversions",
  CONVERSATIONS: "Maximise number of conversations",
  // Engagement-specific. THRUPLAY counts a view as 15s OR full play
  // (Meta's recommended default for video ads). POST_ENGAGEMENT
  // optimises for likes / shares / comments on the rendered post.
  THRUPLAY: "Maximise ThruPlay views",
  POST_ENGAGEMENT: "Maximise post engagement",
  // 2-second continuous video views — Meta's lower-watch-threshold goal,
  // surfaced as an alternative to THRUPLAY on VIDEO_VIEWS cells.
  TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: "Maximise 2-second continuous video views",
  // Profile / Page engagement goals — Meta UI surfaces these on the
  // "Instagram or Facebook" cell. PAGE_LIKES is the historic FB-Page
  // goal (Meta auto-renders the UI label as "Maximise number of
  // Facebook Page visits" — the API still accepts the PAGE_LIKES enum).
  PAGE_LIKES: "Maximise Facebook Page visits",
  VISIT_INSTAGRAM_PROFILE: "Maximise Instagram profile visits",
  // Awareness-only. Meta optimises delivery toward people who are most
  // likely to remember seeing the ad. Brand-lift signal is measured via
  // post-impression surveys; not all accounts surface the goal.
  AD_RECALL_LIFT: "Maximise ad recall lift",
  // Engagement Phase 3 deferred goals — labels declared so future work has
  // the wire contract. Both need new picker infrastructure (Event picker
  // for EVENT_RESPONSES, reminder-post picker for REMINDERS_SET) before
  // their cells can ship. See OUTCOME_ENGAGEMENT branch's deferred notes.
  EVENT_RESPONSES: "Maximise event responses",
  REMINDERS_SET: "Maximise reminders set",
};

const BILLING_EVENT_LABELS = {
  IMPRESSIONS: "Impressions",
  LINK_CLICKS: "Link clicks",
};

// Meta's documented rule: most billing events are only valid for the
// matching optimisation goal. Specifically, `LINK_CLICKS` billing is
// accepted ONLY when `optimization_goal === "LINK_CLICKS"` — pairing it
// with LANDING_PAGE_VIEWS / REACH / etc. throws Meta error subcode
// 1815117 ("Billing event invalid for optimisation goal").
//
// Every goal not listed here defaults to IMPRESSIONS-only — the safe
// universal billing event Meta accepts across all goals.
const BILLING_EVENTS_BY_OPTIMIZATION_GOAL = {
  LINK_CLICKS: ["IMPRESSIONS", "LINK_CLICKS"],
};

// Returns the billing events allowed for a given (cell, optimisation goal)
// pair — the intersection of the cell's declared `billingEvents` and the
// per-goal allow-list above. Used by both the frontend AdSetStep
// renderer + backend Joi cross-field check.
function getAllowedBillingEvents(cell, optimizationGoal) {
  const cellList = cell?.adSet?.billingEvents || [];
  const goalList = BILLING_EVENTS_BY_OPTIMIZATION_GOAL[optimizationGoal] || ["IMPRESSIONS"];
  // Preserve cell-declared order so the UI default (first item) stays
  // consistent across goals.
  return cellList.filter((b) => goalList.includes(b));
}

// Optimisation goals that ONLY accept autobid (LOWEST_COST_WITHOUT_CAP).
// Pairing them with a capped strategy (LOWEST_COST_WITH_BID_CAP / COST_CAP)
// throws Meta error subcode 1885204: "Optimisation goal only supports
// autobid".
//
// The pattern: outcome-style goals (QUALITY_CALL, CONVERSATIONS) where
// Meta's algorithm needs full bid freedom to find the right user. Click /
// view / impression-style goals (LINK_CLICKS, LANDING_PAGE_VIEWS,
// THRUPLAY, REACH, etc.) accept all three strategies. Profile-visit
// goals (PAGE_LIKES, VISIT_INSTAGRAM_PROFILE) are autobid-only because
// the conversion event isn't a clean bid signal — same shape as
// QUALITY_CALL.
//
// Add new goals here when Meta surfaces subcode 1885204 for them. The
// frontend AdSetStep narrows the bid-strategy dropdown via
// `getAllowedBidStrategies` below; the backend Joi enforces it in
// buildAdSetSchemaV2's custom validator.
const AUTOBID_ONLY_OPTIMIZATION_GOALS = new Set([
  "QUALITY_CALL",
  "CONVERSATIONS",
  "PAGE_LIKES",
  "VISIT_INSTAGRAM_PROFILE",
]);

function getAllowedBidStrategies(cell, optimizationGoal) {
  if (AUTOBID_ONLY_OPTIMIZATION_GOALS.has(optimizationGoal)) {
    return ["LOWEST_COST_WITHOUT_CAP"];
  }
  // All other goals accept the full bid-strategy set. The cell can
  // override via `cell.adSet.bidStrategies` but no cell currently does.
  return cell?.adSet?.bidStrategies || [
    "LOWEST_COST_WITHOUT_CAP",
    "LOWEST_COST_WITH_BID_CAP",
    "COST_CAP",
  ];
}

// User-facing CTA labels — match Meta Ads Manager's wording. Both
// BOOK_NOW and BOOK_TRAVEL render as "Book now" in Meta's UI; both
// enums are kept because different cells expose one or the other.
const CTA_LABELS = {
  LEARN_MORE: "Learn more",
  SHOP_NOW: "Shop now",
  SIGN_UP: "Sign up",
  SUBSCRIBE: "Subscribe",
  CONTACT_US: "Contact us",
  DOWNLOAD: "Download",
  BOOK_NOW: "Book now",
  BOOK_TRAVEL: "Book now",
  GET_QUOTE: "Get quote",
  APPLY_NOW: "Apply now",
  GET_OFFER: "Get offer",
  GET_DETAILS: "See details",
  GET_SHOWTIMES: "Get showtimes",
  ORDER_NOW: "Order now",
  WATCH_MORE: "Watch more",
  LISTEN_NOW: "Listen now",
  PLAY_GAME: "Play game",
  REQUEST_TIME: "Request time",
  VIEW_MENU: "See menu",
  INQUIRE_NOW: "Enquire now",
  SEND_UPDATES: "Get updates",
  GET_PROMOTIONS: "Get promotions",
  MESSAGE_PAGE: "Send message",
  INSTAGRAM_MESSAGE: "Send Instagram message",
  VIEW_INSTAGRAM_PROFILE: "View Instagram profile",
  LIKE_PAGE: "Like Page",
  WHATSAPP_MESSAGE: "Send WhatsApp message",
  CALL_NOW: "Call now",
  INSTALL_MOBILE_APP: "Install now",
  USE_APP: "Use app",
  // USE_MOBILE_APP is a distinct Meta enum from USE_APP — Meta's own
  // Ads Manager UI sometimes renders it as "Unknown (USE_MOBILE_APP)"
  // (no display string mapped), but the API accepts it and Meta
  // defaults the Leads/App cell to it. We give it a clean label.
  USE_MOBILE_APP: "Use app",
  NO_BUTTON: "No button",
  // Sales/CATALOG — Dynamic Product Ads. Meta's DPA-specific CTA that
  // takes viewers from the carousel to a fuller product list.
  SEE_MORE: "See more",
};

// Mapping from our user-facing conversion-location key to Meta's
// `destination_type` enum value sent on the AdSet. `null` means we omit
// the field — Meta infers from objective + promoted_object.
//
// Keys are either a bare conversion-location string (applies to that
// location across every objective) OR an objective-qualified
// "OBJECTIVE:LOCATION" string (applies only to that one cell). The
// qualified form exists because the same conversion-location key can
// need a DIFFERENT destination_type depending on objective —
// `WEBSITE_AND_CALLS` is `WEBSITE` for Traffic but `null` for Leads.
// `getMetaDestinationType` checks the qualified key first.
const CONVERSION_LOCATION_TO_META_DESTINATION = {
  WEBSITE: "WEBSITE",
  APP: "APP",
  MESSENGER: "MESSENGER",
  WHATSAPP: "WHATSAPP",
  PHONE_CALL: "PHONE_CALL",
  CALLS: "PHONE_CALL",
  INSTAGRAM: "INSTAGRAM_DIRECT",
  INSTANT_FORM: "ON_AD",
  // Traffic combined: Message destinations primary-routes to Messenger;
  // Meta auto-extends to IG DM / WhatsApp based on Page connections.
  MESSAGE_DESTINATIONS: "MESSENGER",
  // Profile-visit destinations — Meta accepts WEBSITE here (the link
  // points at the profile URL); the CTA enum signals it's a profile.
  INSTAGRAM_OR_FACEBOOK: "WEBSITE",
  // Leads "Multiple" cells — destination_type depends on whether the
  // creative carries a website link in its CTA:
  //
  //  • WEBSITE_AND_INSTANT_FORMS — `lead_gen_form_with_pixel` shape, CTA
  //    value carries BOTH `link` and `lead_gen_form_id`. Meta reads that
  //    as a website-ish creative, so destination_type is OMITTED (null)
  //    and Meta infers the multi-destination routing. Setting WEBSITE
  //    explicitly would lock the label to "Website" + reject the form
  //    (subcode 1815676).
  //  • WEBSITE_AND_CALLS (Leads) — `link_data` shape (no lead form),
  //    plain website creative. destination_type omitted; Meta infers.
  //  • INSTANT_FORMS_AND_MESSENGER — `lead_gen_form` shape, CTA value
  //    has ONLY `lead_gen_form_id` (no link). Meta treats that as a
  //    PURE lead-form creative, which it allows ONLY on
  //    destination_type=ON_AD (subcode 1892040 otherwise). So this one
  //    MUST be ON_AD — it cannot be omitted. Meta layers the Messenger
  //    routing automatically for lead ads on Messenger-capable pages;
  //    Meta's UI may show the conversion location as "Instant forms".
  WEBSITE_AND_INSTANT_FORMS: null,
  INSTANT_FORMS_AND_MESSENGER: "ON_AD",
  // WEBSITE_AND_CALLS exists in BOTH Traffic and Leads — and needs a
  // DIFFERENT value per objective. A bare key would silently apply one
  // objective's value to the other (this exact bug shipped once). Keep
  // it objective-qualified only; do NOT add a bare WEBSITE_AND_CALLS key.
  "OUTCOME_TRAFFIC:WEBSITE_AND_CALLS": "WEBSITE",
  "OUTCOME_LEADS:WEBSITE_AND_CALLS": null,
  // Sales/WEBSITE_AND_CALLS — Multiple cell; omit destination_type so
  // Meta auto-routes between website (Pixel) and calls (Page phone).
  "OUTCOME_SALES:WEBSITE_AND_CALLS": null,
  // Sales/WEBSITE_AND_APP — Multiple cell; same Meta-auto-route pattern.
  WEBSITE_AND_APP: null,
  // Engagement "On your ad" cells — granular surface destination_types.
  // Meta's older 1815715 error listed "Valid values are MESSENGER,
  // UNDEFINED, WEBSITE, APP" but that message pre-dates the SDK's
  // granular ON_VIDEO / ON_POST enums. Sending null triggers 2490408
  // ("Performance goal isn't available") because null + THRUPLAY doesn't
  // give Meta enough to identify the surface. ON_VIDEO + THRUPLAY is the
  // explicit pairing.
  //
  // Objective-qualified so Awareness/VIDEO_VIEWS (truly destination-less)
  // keeps its null mapping. cellInference handles ON_VIDEO + the legacy
  // null pattern for backward compat on existing ad sets.
  "OUTCOME_ENGAGEMENT:VIDEO_VIEWS": "ON_VIDEO",
  "OUTCOME_ENGAGEMENT:POST_ENGAGEMENT": "ON_POST",
  // Awareness/VIDEO_VIEWS — Meta really does have no destination_type;
  // the goal alone drives delivery. Keep null.
  VIDEO_VIEWS: null,
  POST_ENGAGEMENT: null,
  // Engagement Phase 2 + 3 cells:
  //   • INSTAGRAM_OR_FACEBOOK — bare WEBSITE key from above (the profile
  //     URL goes in link_data; CTA enum signals which surface).
  //   • MESSAGE_DESTINATIONS — bare MESSAGE_DESTINATIONS → MESSENGER key
  //     from above. Meta auto-routes to IG-DM / WhatsApp from there based
  //     on Page connections (same as Traffic/Sales messaging cells).
  //
  // No new bare keys needed — generic WEBSITE / APP / MESSAGE_DESTINATIONS
  // entries above cover Engagement.
  //
  // Sales/CATALOG — destination_type omitted (null) so Meta infers from
  // the product_set promoted_object. Reverse-inference (cellInference.js)
  // identifies CATALOG by `promoted_object.product_set_id` presence
  // rather than destination_type.
  CATALOG: null,
  // Awareness/STANDARD — no destination_type. Awareness ad sets have no
  // conversion location in Meta's UI; the goal alone drives delivery.
  // Reverse-inference disambiguates STANDARD vs VIDEO_VIEWS via the
  // optimization_goal (see cellInference.js).
  STANDARD: null,
};

// ─── The matrix ──────────────────────────────────────────────────────────────
// One entry per (objective, conversionLocation). Every entry has the same
// shape — the renderer + validator factory walk it generically.
//
// Cell shape:
//   {
//     adSet: {
//       optimizationGoals: string[],   // allowed values for the dropdown
//       defaultOptimizationGoal: string,
//       billingEvents: string[],
//       defaultBillingEvent: string,
//       promotedObjectShape: string,   // key for utils/promotedObject.js
//     },
//     ad: {
//       requiredFields: string[],      // wizard form fields, NOT Meta API fields
//       optionalFields: string[],
//       objectStorySpecShape: string,  // key for utils/objectStorySpec.js
//     },
//     ctas: { allowed: string[], default: string },
//     identity: { required: string[], optional: string[] },
//     additionalSteps: string[],       // extra wizard steps (e.g. "leadForm")
//     notes: string,                   // human-readable, surfaced in UI tooltips
//   }

const CELLS = {
  // Traffic — matches Meta Ads Manager's 6 conversion-location options.
  // No Multiple/Single grouping in Meta's UI for Traffic (flat list), so
  // cells leave `group` unset and all render in one section in the wizard.
  // "Message destinations" replaces the older separate Messenger / WhatsApp
  // cells per Meta's modern UI ("no older things" — see status doc).
  OUTCOME_TRAFFIC: {
    WEBSITE: {
      adSet: {
        optimizationGoals: ["LINK_CLICKS", "LANDING_PAGE_VIEWS", "IMPRESSIONS", "REACH"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS", "LINK_CLICKS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description", "urlTags"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: [
          "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "CONTACT_US",
          "DOWNLOAD", "BOOK_TRAVEL", "GET_QUOTE", "APPLY_NOW", "GET_OFFER",
          "ORDER_NOW", "WATCH_MORE", "NO_BUTTON",
        ],
        default: "LEARN_MORE",
      },
      identity: { required: ["page"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Send traffic to your website.",
    },

    APP: {
      adSet: {
        optimizationGoals: ["LINK_CLICKS", "IMPRESSIONS", "REACH"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "app",
        additionalFields: ["mobileAppStore", "applicationId", "objectStoreUrl"],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText"],
        optionalFields: ["description", "deferredDeepLink"],
        objectStorySpecShape: "app_link",
      },
      ctas: {
        allowed: ["INSTALL_MOBILE_APP", "USE_APP", "DOWNLOAD", "LEARN_MORE", "SHOP_NOW"],
        default: "DOWNLOAD",
      },
      identity: { required: ["page", "linkedApp"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Send traffic to your app. Same app linkage as App Promotion campaigns.",
    },

    MESSAGE_DESTINATIONS: {
      adSet: {
        // Meta's modern combined option — viewers are routed to Messenger,
        // Instagram DM or WhatsApp based on the Page's connected surfaces.
        // CONVERSATIONS is the canonical goal (LINK_CLICKS is rejected for
        // messaging destinations as we saw with Leads/WhatsApp).
        optimizationGoals: ["CONVERSATIONS", "IMPRESSIONS", "REACH"],
        defaultOptimizationGoal: "CONVERSATIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        // linkUrl required as the bypass-fallback link (Meta enforces it
        // on every creative). Primary destination is messaging via the
        // CTA's app_destination.
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "messenger_click_to_message",
      },
      ctas: {
        allowed: ["MESSAGE_PAGE", "WHATSAPP_MESSAGE", "INSTAGRAM_MESSAGE", "LEARN_MORE"],
        default: "MESSAGE_PAGE",
      },
      identity: { required: ["page", "messengerEnabled"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Send traffic to Messenger, Instagram DM or WhatsApp. Meta routes per viewer.",
    },

    INSTAGRAM_OR_FACEBOOK: {
      adSet: {
        optimizationGoals: ["LINK_CLICKS", "IMPRESSIONS", "REACH"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        // Reuse link_data — the link points at the profile / page URL.
        // Meta auto-renders the click as a profile-visit when the CTA is
        // VIEW_INSTAGRAM_PROFILE / LIKE_PAGE.
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: ["VIEW_INSTAGRAM_PROFILE", "LIKE_PAGE", "LEARN_MORE"],
        default: "VIEW_INSTAGRAM_PROFILE",
      },
      identity: { required: ["page", "instagram"], optional: [] },
      additionalSteps: [],
      notes: "Send traffic to your Instagram profile, Facebook Page, or both.",
    },

    CALLS: {
      adSet: {
        optimizationGoals: ["QUALITY_CALL", "LINK_CLICKS"],
        defaultOptimizationGoal: "QUALITY_CALL",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "click_to_call",
      },
      ctas: {
        allowed: ["CALL_NOW", "LEARN_MORE"],
        default: "CALL_NOW",
      },
      identity: { required: ["page", "pagePhoneNumber"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Get people to call your phone number on the Page.",
    },

    WEBSITE_AND_CALLS: {
      adSet: {
        // Hybrid — viewers click either to the website OR to call.
        // LINK_CLICKS is the broad goal; QUALITY_CALL also valid.
        optimizationGoals: ["LINK_CLICKS", "QUALITY_CALL", "LANDING_PAGE_VIEWS"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        // Standard link_data with the website link; CALL_NOW CTA is
        // surfaced alongside the website link, and Meta routes per viewer.
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: ["LEARN_MORE", "CALL_NOW", "GET_QUOTE", "CONTACT_US"],
        default: "LEARN_MORE",
      },
      identity: { required: ["page", "pagePhoneNumber"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Send traffic to your website AND offer click-to-call. Meta auto-routes per viewer.",
    },
  },

  // Leads — matches Meta Ads Manager's 10 conversion-location options.
  // Three "Multiple" cells (Meta auto-routes per user) + seven "Single"
  // cells. Each cell uses one of two infrastructure paths:
  //   1. On-Meta capture (Instant Form / Messenger / Calls / Instagram /
  //      WhatsApp / App) — no Pixel required; LEAD_GENERATION / QUALITY_*
  //      optimisation goals.
  //   2. Pixel-tracked capture (Website / any Multiple cell) — requires
  //      a Pixel + a conversion event from the customer's Events Manager;
  //      OFFSITE_CONVERSIONS optimisation goal; promoted_object carries
  //      pixel_id + custom_event_type.
  //
  // Multiple cells layer Instant Form / Messenger / Calls on top of a
  // Pixel-tracked Website setup — Meta's algorithm decides which path
  // each user is most likely to convert through. The creative carries
  // BOTH a link (for Pixel website capture) AND the form id / messenger
  // destination / tel: URL where applicable.
  OUTCOME_LEADS: {
    // ─── Multiple (Meta auto-routes per user) ─────────────────────────────

    WEBSITE_AND_INSTANT_FORMS: {
      group: "multiple",
      adSet: {
        // Meta's UI for this cell shows only "Maximise number of conversions"
        // — the OFFSITE_CONVERSIONS goal. LEAD_GENERATION isn't surfaced
        // because Multiple-routing requires Pixel-tracked conversions to
        // make the routing decision per viewer.
        optimizationGoals: ["OFFSITE_CONVERSIONS"],
        defaultOptimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "pixel",
        // Pixel + Event live on the AdSet (not on user-visible inputs in
        // the wizard's required/optionalFields — they're picked via
        // dedicated AdSet pickers and surface as additionalFields).
        additionalFields: ["pixelId", "pixelEventType"],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "leadFormId", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "lead_gen_form_with_pixel",
      },
      ctas: {
        allowed: ["SIGN_UP", "APPLY_NOW", "GET_QUOTE", "LEARN_MORE", "SUBSCRIBE", "GET_OFFER"],
        default: "SIGN_UP",
      },
      identity: { required: ["page", "pixel"], optional: ["instagram"] },
      additionalSteps: ["leadForm"],
      notes: "Meta routes each viewer to whichever converts best — the Instant Form, or your website (Pixel-tracked).",
    },

    WEBSITE_AND_CALLS: {
      group: "multiple",
      adSet: {
        // Meta's UI surfaces only OFFSITE_CONVERSIONS here — same reasoning
        // as Website+Instant Forms (Pixel-tracked is the routing signal).
        optimizationGoals: ["OFFSITE_CONVERSIONS"],
        defaultOptimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "pixel",
        additionalFields: ["pixelId", "pixelEventType"],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        // This Multiple cell runs as a website-shaped creative (link_data)
        // — the call routing is handled by Meta's optimiser + Page phone,
        // not the creative. Per-viewer routing (call vs. website) is
        // decided on the AdSet, not the creative.
        objectStorySpecShape: "link_data",
      },
      // CTA list verified against Meta Ads Manager for this exact cell
      // (Leads / Website and calls). Notably Meta does NOT offer
      // CALL_NOW here — the call routing isn't a CTA, it's the
      // optimiser's job — so CALL_NOW would be rejected. This is the
      // generic website-ad CTA catalogue.
      ctas: {
        allowed: [
          "NO_BUTTON", "APPLY_NOW", "BOOK_NOW", "CONTACT_US", "DOWNLOAD",
          "GET_OFFER", "GET_QUOTE", "GET_SHOWTIMES", "GET_DETAILS",
          "LEARN_MORE", "LISTEN_NOW", "ORDER_NOW", "PLAY_GAME",
          "REQUEST_TIME", "VIEW_MENU", "SHOP_NOW", "SIGN_UP",
          "SUBSCRIBE", "WATCH_MORE",
        ],
        default: "LEARN_MORE",
      },
      identity: { required: ["page", "pixel", "pagePhoneNumber"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Meta routes viewers to call the Page's phone OR visit the website (Pixel-tracked).",
    },

    INSTANT_FORMS_AND_MESSENGER: {
      group: "multiple",
      adSet: {
        optimizationGoals: ["LEAD_GENERATION"],
        defaultOptimizationGoal: "LEAD_GENERATION",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "leadFormId", "linkUrl"],
        optionalFields: ["description"],
        // Use the lead_gen_form shape — Meta layers Messenger as an
        // alternative path automatically when destination_type allows it.
        objectStorySpecShape: "lead_gen_form",
      },
      // CTA list verified against Meta Ads Manager for this exact cell.
      // Notably MESSAGE_PAGE is NOT offered — the lead_gen_form creative
      // shape binds only the form id (no messenger app_destination); Meta
      // does the Form ⇄ Messenger routing per viewer, the CTA is just
      // button copy.
      ctas: {
        allowed: [
          "GET_DETAILS", "LEARN_MORE", "SUBSCRIBE", "BOOK_NOW", "SIGN_UP",
          "APPLY_NOW", "DOWNLOAD", "GET_OFFER", "GET_QUOTE",
        ],
        default: "SIGN_UP",
      },
      identity: { required: ["page", "messengerEnabled"], optional: ["instagram"] },
      additionalSteps: ["leadForm"],
      notes: "Meta routes viewers to either the Instant Form or a Messenger chat — whichever they're more likely to convert through.",
    },

    // ─── Single (one destination) ─────────────────────────────────────────

    WEBSITE: {
      group: "single",
      adSet: {
        // Matches Meta UI: 5 options — OFFSITE_CONVERSIONS (default) +
        // LANDING_PAGE_VIEWS + LINK_CLICKS + REACH + IMPRESSIONS.
        optimizationGoals: [
          "OFFSITE_CONVERSIONS",
          "LANDING_PAGE_VIEWS",
          "LINK_CLICKS",
          "REACH",
          "IMPRESSIONS",
        ],
        defaultOptimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "pixel",
        additionalFields: ["pixelId", "pixelEventType"],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description", "urlTags"],
        objectStorySpecShape: "pixel_website",
      },
      // CTA list verified against Meta Ads Manager for Leads / Website.
      ctas: {
        allowed: [
          "GET_DETAILS", "LEARN_MORE", "SUBSCRIBE", "BOOK_NOW", "SIGN_UP",
          "APPLY_NOW", "DOWNLOAD", "GET_OFFER", "GET_QUOTE",
        ],
        default: "SIGN_UP",
      },
      identity: { required: ["page", "pixel"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Capture leads on your website. Requires a Meta Pixel with a Lead event configured in Events Manager.",
    },

    INSTANT_FORM: {
      group: "single",
      adSet: {
        optimizationGoals: ["LEAD_GENERATION", "QUALITY_LEAD"],
        defaultOptimizationGoal: "LEAD_GENERATION",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "leadFormId", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "lead_gen_form",
      },
      ctas: {
        allowed: ["SIGN_UP", "APPLY_NOW", "GET_QUOTE", "LEARN_MORE", "SUBSCRIBE", "GET_OFFER"],
        default: "SIGN_UP",
      },
      identity: { required: ["page"], optional: ["instagram"] },
      additionalSteps: ["leadForm"],
      notes: "Capture leads via a Meta-hosted Instant Form on the ad. No Pixel required.",
    },

    MESSENGER: {
      group: "single",
      adSet: {
        // Meta's UI shows only "Maximise number of leads" for this cell.
        optimizationGoals: ["LEAD_GENERATION"],
        defaultOptimizationGoal: "LEAD_GENERATION",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "messenger_click_to_message",
      },
      // CTA list verified against Meta Ads Manager for Leads / Messenger.
      ctas: {
        allowed: [
          "CONTACT_US", "GET_QUOTE", "INQUIRE_NOW", "GET_DETAILS",
          "LEARN_MORE", "MESSAGE_PAGE", "ORDER_NOW", "SEND_UPDATES",
          "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "GET_PROMOTIONS",
          "APPLY_NOW", "BOOK_NOW",
        ],
        default: "MESSAGE_PAGE",
      },
      identity: { required: ["page", "messengerEnabled"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Lead capture via Messenger conversation. Best for accounts running active Messenger flows.",
    },

    INSTAGRAM: {
      group: "single",
      adSet: {
        // Meta UI: only "Maximise number of leads".
        optimizationGoals: ["LEAD_GENERATION"],
        defaultOptimizationGoal: "LEAD_GENERATION",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "instagram_direct",
      },
      // CTA list verified against Meta Ads Manager for Leads / Instagram.
      // "Send Instagram message" (INSTAGRAM_MESSAGE) is the messaging
      // CTA; VIEW_INSTAGRAM_PROFILE is NOT offered for this Leads cell.
      ctas: {
        allowed: [
          "GET_OFFER", "GET_QUOTE", "INSTAGRAM_MESSAGE", "GET_DETAILS",
          "LEARN_MORE", "SIGN_UP", "SUBSCRIBE", "APPLY_NOW", "BOOK_NOW",
        ],
        default: "INSTAGRAM_MESSAGE",
      },
      // IG identity is required (not just optional) — the destination IS
      // the IG account's direct messages.
      identity: { required: ["page", "instagram"], optional: [] },
      additionalSteps: [],
      notes: "Lead capture via Instagram Direct Messages.",
    },

    WHATSAPP: {
      group: "single",
      adSet: {
        // Meta UI: only "Maximise number of conversations" — the
        // conversion event IS the WhatsApp message exchange.
        // LEAD_GENERATION is rejected with subcode 2490408
        // ("Performance goal isn't available") for this cell.
        optimizationGoals: ["CONVERSATIONS"],
        defaultOptimizationGoal: "CONVERSATIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "whatsapp_click_to_message",
      },
      // Meta Ads Manager offers only ONE CTA for this cell — the
      // dropdown is disabled, fixed on "Send WhatsApp message".
      ctas: {
        allowed: ["WHATSAPP_MESSAGE"],
        default: "WHATSAPP_MESSAGE",
      },
      identity: { required: ["page", "whatsappBusinessConnected"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Lead capture via WhatsApp chat. The Page must have a connected WhatsApp Business account.",
    },

    CALLS: {
      group: "single",
      adSet: {
        // Meta UI: only "Maximise number of calls".
        optimizationGoals: ["QUALITY_CALL"],
        defaultOptimizationGoal: "QUALITY_CALL",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "click_to_call",
      },
      ctas: {
        allowed: ["CALL_NOW", "LEARN_MORE"],
        default: "CALL_NOW",
      },
      identity: { required: ["page", "pagePhoneNumber"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Capture leads via inbound calls to the phone number on the Page.",
    },

    APP: {
      group: "single",
      adSet: {
        // OFFSITE_CONVERSIONS was retired from this cell. Meta still
        // demands pixel_id + custom_event_type as the "main conversion"
        // for Lead campaigns on App destinations (subcode 2446759 — Meta
        // treats Leads/App as a Conversions-family campaign regardless
        // of optimization_goal). The Pixel fields surface in the wizard
        // via additionalFields below; createAdSetV2 then PATCHes
        // campaign.promoted_object with them BEFORE creating the ad set
        // — pixel fields cannot live on adset.promoted_object alongside
        // app fields (Meta rejects with subcode 1815229 "pixel_id not
        // supported for WEBSITE_CONVERSIONS"). The two-level structure
        // is the only path that resolves both error pairs.
        optimizationGoals: ["LINK_CLICKS", "REACH"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "app",
        additionalFields: [
          "mobileAppStore",
          "applicationId",
          "objectStoreUrl",
          "pixelId",
          "pixelEventType",
        ],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText"],
        optionalFields: ["description", "deferredDeepLink"],
        objectStorySpecShape: "app_link",
      },
      // CTA list verified against Meta Ads Manager for Leads / App.
      // Note: Meta does NOT offer INSTALL_MOBILE_APP here (this cell
      // captures leads via an existing app, not installs) — the app
      // CTA is USE_MOBILE_APP, which Meta also pre-selects as default.
      ctas: {
        allowed: [
          "USE_MOBILE_APP", "NO_BUTTON", "CONTACT_US", "GET_OFFER",
          "GET_QUOTE", "GET_DETAILS", "LEARN_MORE", "ORDER_NOW",
          "DOWNLOAD", "SHOP_NOW", "GET_SHOWTIMES", "SIGN_UP",
          "LISTEN_NOW", "PLAY_GAME", "SUBSCRIBE", "REQUEST_TIME",
          "VIEW_MENU", "WATCH_MORE", "APPLY_NOW", "BOOK_NOW",
        ],
        default: "USE_MOBILE_APP",
      },
      identity: { required: ["page", "linkedApp"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Capture leads via your mobile app. Same app linkage as App Promotion campaigns.",
    },
  },

  // Engagement — matches Meta Ads Manager's 6 conversion-location options.
  // MVP ships 5 cells: Messenger, WhatsApp, Calls, Video views, Post
  // engagement. Instagram-DM messaging, Website, App, Facebook Page,
  // Instagram Profile, and "Automatic destination" messaging are deferred —
  // see docs/ENGAGEMENT_CELLS_SPEC.md for rationale.
  //
  // VIDEO_VIEWS introduces the first `mediaKind: 'video'` cell — the AdStep
  // hides the image-upload path and force-renders the video uploader, and
  // both the frontend validator + backend Joi factory enforce videoId
  // (rejecting imageHash). Every other Engagement cell accepts image OR
  // video like Traffic/Leads.
  OUTCOME_ENGAGEMENT: {
    // ─── Engagement Phase 3 (2026-06-18) ──────────────────────────────────
    // Consolidated MESSENGER + WHATSAPP + INSTAGRAM (3 separate cells in
    // Phase 1+2) into ONE MESSAGE_DESTINATIONS cell — mirrors what Meta's
    // UI shows + matches the Sales pattern (Sales messaging consolidation
    // shipped 2026-06-17 with the same rationale). Meta auto-routes to
    // Messenger / IG-DM / WhatsApp based on Page connections + CTA.
    // Reverse-inference (cellInference.js) collapses all 3 destination_type
    // values to MESSAGE_DESTINATIONS for Engagement so legacy ad sets
    // created under the old per-platform cells still resolve cleanly.
    MESSAGE_DESTINATIONS: {
      adSet: {
        // CONVERSATIONS is the primary goal Meta surfaces for messaging;
        // LINK_CLICKS is the "Other goals" fallback in Meta's UI ("for
        // people most likely to click on them"). IMPRESSIONS / REACH are
        // accepted on the same cell — Meta delivers messaging creatives
        // optimised for whichever signal you pick.
        optimizationGoals: ["CONVERSATIONS", "LINK_CLICKS", "IMPRESSIONS", "REACH"],
        defaultOptimizationGoal: "CONVERSATIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        // linkUrl required as bypass-fallback (Meta enforces it on every
        // creative even when the CTA opens a chat). messenger_click_to_message
        // is the canonical shape for auto-routed messaging — same as Sales/
        // MESSAGE_DESTINATIONS + Traffic/MESSAGE_DESTINATIONS.
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "messenger_click_to_message",
      },
      ctas: {
        // All 3 messaging CTAs allowed — user picks which surface to
        // emphasise; Meta routes per viewer.
        allowed: ["MESSAGE_PAGE", "WHATSAPP_MESSAGE", "INSTAGRAM_MESSAGE", "LEARN_MORE"],
        default: "MESSAGE_PAGE",
      },
      // messengerEnabled is the canonical Page-side requirement — the
      // Page must have Messenger enabled (everyone does by default) plus
      // any of IG / WhatsApp Business for the corresponding leg to deliver.
      // Meta gracefully degrades: if WhatsApp isn't connected, that route
      // is dropped without breaking delivery.
      identity: { required: ["page", "messengerEnabled"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive messaging conversations — Messenger, Instagram DM, WhatsApp. Meta auto-routes per viewer based on Page connections + CTA. Consolidated from 3 per-platform cells in Phase 3.",
    },

    PHONE_CALL: {
      adSet: {
        // Meta UI: only "Maximise number of calls" for Engagement/Calls.
        optimizationGoals: ["QUALITY_CALL"],
        defaultOptimizationGoal: "QUALITY_CALL",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "click_to_call",
      },
      ctas: {
        allowed: ["CALL_NOW", "LEARN_MORE"],
        default: "CALL_NOW",
      },
      identity: { required: ["page", "pagePhoneNumber"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive inbound calls to the Page's phone number.",
    },

    VIDEO_VIEWS: {
      adSet: {
        // Meta UI default: ThruPlay (15s OR full play). Phase 2 adds
        // TWO_SECOND_CONTINUOUS_VIDEO_VIEWS as the alternate goal Meta's
        // UI surfaces for shorter-watch-threshold optimisation. Per-cell
        // custom goals (e.g. AD_RECALL_LIFT) still deferred.
        optimizationGoals: ["THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"],
        defaultOptimizationGoal: "THRUPLAY",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        // mediaKind=video forces the AdStep into video-only mode (the
        // image segmented button is hidden) and both validators reject
        // imageHash. The existing link_data builder emits `video_data`
        // automatically when `videoId` is set, so no new shape needed.
        // `videoId` lives in requiredFields so the renderer surfaces the
        // video field and validateAd reads the contract generically.
        mediaKind: "video",
        requiredFields: ["videoId", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: ["LEARN_MORE", "SHOP_NOW", "WATCH_MORE", "SIGN_UP", "DOWNLOAD", "NO_BUTTON"],
        default: "LEARN_MORE",
      },
      identity: { required: ["page"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Maximise video views. ThruPlay counts a view at 15s or full play, whichever comes first.",
    },

    POST_ENGAGEMENT: {
      adSet: {
        // Meta UI: only POST_ENGAGEMENT for this cell. Optimises for likes,
        // shares, and comments on the rendered creative.
        optimizationGoals: ["POST_ENGAGEMENT"],
        defaultOptimizationGoal: "POST_ENGAGEMENT",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        // image OR video — both work for post engagement. Uses the generic
        // link_data shape; builder emits video_data when videoId is set.
        // "Boost existing post" path (object_story_id) is deferred.
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: [
          "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WATCH_MORE",
          "DOWNLOAD", "GET_OFFER", "NO_BUTTON",
        ],
        default: "LEARN_MORE",
      },
      identity: { required: ["page"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive likes, shares and comments on your post.",
    },

    // ─── Engagement Phase 2 cells ─────────────────────────────────────────
    // Added 2026-06-02. All reuse existing object_story_spec shapes — no
    // new builder work. See docs/ENGAGEMENT_CELLS_SPEC.md §"Phase 2".
    //
    // Note (Phase 3): the per-platform INSTAGRAM cell from Phase 2 was
    // collapsed into MESSAGE_DESTINATIONS above to match Meta UI's single
    // "Message destinations" option. Reverse-inference still recognises
    // destination_type=INSTAGRAM_DIRECT and routes legacy ad sets to
    // MESSAGE_DESTINATIONS.

    WEBSITE: {
      adSet: {
        // Mirror of Leads/Website goal list — Meta surfaces the same
        // 5 goals for Engagement/Website. OFFSITE_CONVERSIONS is the
        // recommended default (pixel-tracked conversions).
        optimizationGoals: [
          "OFFSITE_CONVERSIONS",
          "LANDING_PAGE_VIEWS",
          "LINK_CLICKS",
          "REACH",
          "IMPRESSIONS",
        ],
        defaultOptimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "pixel",
        additionalFields: ["pixelId", "pixelEventType"],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description", "urlTags"],
        objectStorySpecShape: "pixel_website",
      },
      ctas: {
        allowed: [
          "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "CONTACT_US",
          "DOWNLOAD", "BOOK_NOW", "GET_QUOTE", "APPLY_NOW", "GET_OFFER",
          "ORDER_NOW", "WATCH_MORE", "NO_BUTTON",
        ],
        default: "LEARN_MORE",
      },
      identity: { required: ["page", "pixel"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive on-site engagement. Requires a Meta Pixel + conversion event configured in Events Manager.",
    },

    APP: {
      adSet: {
        // Engagement/App — drive engagement WITH an existing app (not
        // installs). Same Meta constraint as Leads/APP: Meta demands a
        // `custom_event_type` in promoted_object as the "main conversion"
        // for Conversions-family campaigns on App destination (subcode
        // 2446759). The `app` promoted_object shape auto-includes
        // custom_event_type when the form supplies pixelEventType — so
        // pixelId + pixelEventType in additionalFields surface the
        // wizard's Pixel/Event picker. We pass pixelEventType through
        // but NOT pixel_id (Meta rejects pixel_id alongside app fields
        // with subcode 1815229 "not supported for WEBSITE_CONVERSIONS").
        optimizationGoals: ["LINK_CLICKS", "REACH", "IMPRESSIONS"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "app",
        additionalFields: [
          "mobileAppStore",
          "applicationId",
          "objectStoreUrl",
          "pixelId",
          "pixelEventType",
        ],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText"],
        optionalFields: ["description", "deferredDeepLink"],
        objectStorySpecShape: "app_link",
      },
      ctas: {
        // USE_MOBILE_APP previously here too — same Meta enum behavior,
        // same "Use app" display label as USE_APP → rendered as a
        // duplicate entry in the dropdown. Keep USE_APP (the canonical
        // one used here historically). Leads/APP keeps USE_MOBILE_APP
        // because Meta defaults to that one specifically there.
        allowed: ["USE_APP", "DOWNLOAD", "LEARN_MORE", "SHOP_NOW"],
        default: "USE_APP",
      },
      identity: { required: ["page", "linkedApp"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive engagement with your existing app (re-opens / in-app actions). For installs, use the App Promotion objective.",
    },

    // INSTAGRAM_OR_FACEBOOK — restored 2026-06-18 (Phase 3). Previously
    // removed because Meta rejected PAGE_LIKES + VISIT_INSTAGRAM_PROFILE
    // with subcode 2490408. Meta UI now auto-substitutes a working goal
    // (labelled "Maximise number of Facebook Page visits") so the cell is
    // usable again. The API enum behind that UI label is still PAGE_LIKES;
    // Meta surfaces it under the new wording on the dropdown but accepts
    // the same enum on launch. VISIT_INSTAGRAM_PROFILE remains paired so
    // IG-side delivery has its own optimisation signal.
    //
    // Caveat (live verification pending): some accounts may still hit
    // subcode 2490408 on PAGE_LIKES — particularly accounts under a
    // Special Ad Category (Financial / Employment / Housing) where Meta
    // restricts profile-style goals. If verification surfaces the rejection
    // broadly, fall back to REACH + IMPRESSIONS only (matches Awareness/
    // STANDARD pattern) and document the SAC carve-out in §6 of the spec.
    INSTAGRAM_OR_FACEBOOK: {
      adSet: {
        // PAGE_LIKES is Meta's API enum for the "Maximise Facebook Page
        // visits" goal (Meta relabelled the UI without renaming the enum).
        // VISIT_INSTAGRAM_PROFILE is the IG analogue. Both are autobid-only
        // per AUTOBID_ONLY_OPTIMIZATION_GOALS — wizard restricts bid
        // strategy automatically.
        optimizationGoals: ["PAGE_LIKES", "VISIT_INSTAGRAM_PROFILE"],
        defaultOptimizationGoal: "PAGE_LIKES",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        // Same shape as Traffic/INSTAGRAM_OR_FACEBOOK — the destination is
        // a profile URL embedded in the CTA value's link field; the linkUrl
        // form field carries the canonical profile URL. Meta surfaces these
        // creatives in feed + reels + stories.
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        // Profile-visit CTAs — Meta accepts LIKE_PAGE (FB page-side) and
        // VIEW_INSTAGRAM_PROFILE (IG-side) for INSTAGRAM_OR_FACEBOOK. The
        // UI label may render as "Follow page" but the API enum is LIKE_PAGE
        // (same as Traffic/INSTAGRAM_OR_FACEBOOK).
        allowed: ["VIEW_INSTAGRAM_PROFILE", "LIKE_PAGE", "MESSAGE_PAGE", "LEARN_MORE", "NO_BUTTON"],
        default: "VIEW_INSTAGRAM_PROFILE",
      },
      // IG identity OPTIONAL (cell delivers on FB if IG isn't connected,
      // matching Meta's "Instagram or Facebook" wording — either surface
      // works). Page always required as the FB-side identity.
      identity: { required: ["page"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive profile visits on Instagram or Facebook. Meta delivers to whichever surface the viewer is more likely to engage on. PAGE_LIKES is the API enum behind the 'Facebook Page visits' UI label (Meta relabelled but didn't rename).",
    },

    // ─── DEFERRED — Engagement Phase 3 follow-up cells ────────────────────
    //
    // EVENT_RESPONSES — "Event responses" engagement type. Needs:
    //   • New promotedObjectShape "event" with `{ event_id }` payload
    //   • New wizard step (Facebook Event picker — list events the Page
    //     owns + lets user pick one)
    //   • Backend endpoint to list Page events
    //   • Reverse-inference signal (promoted_object.event_id presence)
    //
    // REMINDERS_SET — "Reminders set" engagement type. Needs:
    //   • Wizard step to pick a scheduled live video / reminder-eligible
    //     post (object_story_id reference)
    //   • Backend endpoint to list reminder-eligible Page content
    //   • CTA + ad fields adjusted for boost-existing-post pattern
    //
    // Both are niche cells gated on net-new picker infrastructure. Goals
    // declared in OPTIMIZATION_GOAL_LABELS so future work has the wire
    // contract ready. Re-open when there's customer demand.
  },

  OUTCOME_APP_PROMOTION: {
    APP: {
      adSet: {
        // APP_INSTALLS only.
        //
        // Why this is the only goal: the other two App Promotion
        // optimisation goals Meta exposes — OFFSITE_CONVERSIONS (in-app
        // events like purchase) and VALUE (revenue maximisation) — both
        // require a Mobile Measurement Partner (AppsFlyer, Adjust, etc.)
        // forwarding post-install events to Meta. We don't have an MMP
        // integration; Meta would accept those settings but never receive
        // the events, so campaigns would run with no optimisation signal
        // → poor delivery, wasted spend. APP_INSTALLS uses Meta's own
        // install tracking (less accurate on iOS post-ATT but functional)
        // and is the only goal that works correctly in this stack.
        //
        // If an MMP is ever integrated, re-enable by adding
        // "OFFSITE_CONVERSIONS" and "VALUE" to this array.
        optimizationGoals: ["APP_INSTALLS"],
        defaultOptimizationGoal: "APP_INSTALLS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "app",
        // App-Promotion-specific fields the renderer surfaces in the AdSet
        // step before optimisation goal. These don't exist on Traffic/Leads
        // cells, so the renderer renders them only when this array is
        // present and non-empty.
        //   - mobileAppStore: enum APPLE_APP_STORE | GOOGLE_PLAY. Drives
        //     which apps are listable in `applicationId`.
        //   - applicationId: Meta application id selected from the ad
        //     account's promotable_apps list. Becomes promoted_object's
        //     application_id.
        //   - objectStoreUrl: the app's listing URL on the chosen store.
        //     Surfaced to the user by the app picker (Phase 2 fetches it
        //     from the promotable_apps response) so the backend doesn't
        //     need a second SDK round-trip to resolve it.
        additionalFields: ["mobileAppStore", "applicationId", "objectStoreUrl"],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText"],
        // `deferredDeepLink` opens a specific in-app surface after install.
        // `customProductPage` is Apple's Custom Product Page ID (App Store
        // Connect feature for iOS landing-page variants).
        optionalFields: ["description", "deferredDeepLink", "customProductPage"],
        objectStorySpecShape: "app_link",
      },
      // CTA list verified against Meta Ads Manager for App Promotion.
      // "Explore more" is offered by Meta's UI but the bundled SDK's
      // CallToActionType enum has no matching value — omitted rather
      // than guess an enum that could fail validation. Add it once the
      // correct enum is confirmed.
      ctas: {
        allowed: [
          "GET_DETAILS", "LEARN_MORE", "ORDER_NOW", "DOWNLOAD",
          "SHOP_NOW", "SIGN_UP", "LISTEN_NOW", "PLAY_GAME", "SUBSCRIBE",
          "WATCH_MORE", "INSTALL_MOBILE_APP", "USE_APP", "BOOK_NOW",
        ],
        default: "INSTALL_MOBILE_APP",
      },
      // `linkedApp` is checked against the ad account's promotable_apps
      // edge, not against the selected Page. If empty, the renderer halts
      // at the AdSet step with "No apps configured for this ad account —
      // add one via Meta Business Suite".
      identity: {
        required: ["page", "linkedApp"],
        optional: ["instagram", "threads"],
      },
      additionalSteps: [],
      notes:
        "Drive app installs to a single store (Apple App Store or Google Play). The mobile-app-store + app pickers live on the ad set; the ad inherits both. Optional creative-level deep link and Apple custom product page ID supported. iOS 14+ delivery (SKAdNetwork-aware campaigns) is a separate Meta campaign type, deferred — campaigns currently deliver to Android + pre-14.5 iOS.",
    },
  },

  // Sales — 7 cells. Six are mechanical clones of existing Leads /
  // Engagement cells (the API contracts overlap; only the objective
  // differs). The 7th — CATALOG — is the first cell with both a NEW
  // promoted_object shape (`product_set`) AND a NEW objectStorySpec
  // shape (`template_data` for Dynamic Product Ads).
  //
  // Full spec: docs/SALES_CELLS_SPEC.md. Deferred items (Multiple cells,
  // In-store, VALUE optimisation, Advantage+ Sales auto-mode, Carousel)
  // are listed there with re-open triggers.
  OUTCOME_SALES: {
    // ─── Multiple (Meta auto-routes per viewer) ───────────────────────────
    // Meta's UI shows these as "Website and X" — viewers are routed to
    // whichever destination they're most likely to convert through.
    // destination_type omitted; Meta uses the cell's promoted_object + CTA
    // shape to infer routing. Pixel tracking remains the primary signal.
    //
    // Deferred (NOT shipping in this round): WEBSITE_AND_IN_STORE +
    // WEBSITE_APP_IN_STORE. Both require an Offline Conversions API
    // integration (uploading in-store purchase events back to Meta) which
    // isn't plumbed in this stack. Adding them without offline events
    // means the in-store leg delivers nothing — worse than not offering
    // the cell. Re-open when offline events land.
    WEBSITE_AND_CALLS: {
      group: "multiple",
      adSet: {
        // Same shape as Leads/WEBSITE_AND_CALLS — Pixel-tracked website
        // conversions + click-to-call from the same creative. Meta
        // optimises per viewer based on their predicted conversion path.
        optimizationGoals: ["OFFSITE_CONVERSIONS", "LINK_CLICKS", "QUALITY_CALL"],
        defaultOptimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "pixel",
        additionalFields: ["pixelId", "pixelEventType"],
      },
      ad: {
        // Standard link_data — website link as the primary URL; CALL_NOW
        // CTA layered on top for the call leg. Meta auto-routes.
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: ["LEARN_MORE", "CALL_NOW", "SHOP_NOW", "GET_QUOTE", "CONTACT_US"],
        default: "LEARN_MORE",
      },
      identity: { required: ["page", "pixel", "pagePhoneNumber"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive on-site purchases AND phone calls. Meta auto-routes per viewer based on predicted conversion path. Same Pixel + Page phone constraints as the single-cell versions.",
    },

    WEBSITE_AND_APP: {
      group: "multiple",
      adSet: {
        // No OFFSITE_CONVERSIONS at the cell level — same MMP constraint
        // as Sales/APP. The website leg uses Pixel + LINK_CLICKS; the app
        // leg uses store URL. With an MMP integration, this could expand
        // to OFFSITE_CONVERSIONS spanning both. Without one, ship the
        // delivery-only goals so the cell is at least usable.
        optimizationGoals: ["LINK_CLICKS", "REACH", "IMPRESSIONS"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "pixel",
        // Pixel scopes the website leg; mobileAppStore/applicationId/
        // objectStoreUrl scope the app leg. All four required so Meta can
        // route per viewer.
        additionalFields: [
          "pixelId",
          "pixelEventType",
          "mobileAppStore",
          "applicationId",
          "objectStoreUrl",
        ],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: ["SHOP_NOW", "LEARN_MORE", "USE_APP", "DOWNLOAD", "SIGN_UP"],
        default: "SHOP_NOW",
      },
      identity: { required: ["page", "pixel", "linkedApp"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive purchases on both your website and your app. Meta auto-routes per viewer. OFFSITE_CONVERSIONS deferred — needs an MMP to forward in-app events (same constraint as Sales/APP).",
    },

    // ─── Single (one destination) ─────────────────────────────────────────
    WEBSITE: {
      adSet: {
        // Mirror of Leads/Website goal list — Meta surfaces the same
        // 5 goals for Sales/Website. OFFSITE_CONVERSIONS is the
        // recommended default (Pixel + conversion event).
        // VALUE optimisation deferred (needs value-rules UI).
        optimizationGoals: [
          "OFFSITE_CONVERSIONS",
          "LANDING_PAGE_VIEWS",
          "LINK_CLICKS",
          "REACH",
          "IMPRESSIONS",
        ],
        defaultOptimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "pixel",
        additionalFields: ["pixelId", "pixelEventType"],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description", "urlTags"],
        objectStorySpecShape: "pixel_website",
      },
      ctas: {
        allowed: [
          "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "CONTACT_US",
          "DOWNLOAD", "BOOK_NOW", "GET_QUOTE", "APPLY_NOW", "GET_OFFER",
          "ORDER_NOW", "WATCH_MORE", "NO_BUTTON",
        ],
        default: "SHOP_NOW",
      },
      identity: { required: ["page", "pixel"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive purchases on your website. Requires a Meta Pixel + conversion event in Events Manager.",
    },

    // Meta Ads Manager surfaces messaging as ONE option for Sales —
    // "Message destinations" — and routes per viewer across Messenger /
    // IG Direct / WhatsApp based on the Page's connected surfaces and
    // the CTA. Same pattern as Traffic/MESSAGE_DESTINATIONS (NOT the
    // Engagement triplet of split MESSENGER/WHATSAPP/INSTAGRAM cells).
    // The CTA enum decides the primary platform; Meta layers the others
    // automatically.
    MESSAGE_DESTINATIONS: {
      adSet: {
        optimizationGoals: ["CONVERSATIONS", "IMPRESSIONS", "REACH"],
        defaultOptimizationGoal: "CONVERSATIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        // linkUrl required as bypass-fallback (Meta enforces it on every
        // creative even when the CTA opens Messenger).
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "messenger_click_to_message",
      },
      ctas: {
        allowed: ["MESSAGE_PAGE", "WHATSAPP_MESSAGE", "INSTAGRAM_MESSAGE", "LEARN_MORE"],
        default: "MESSAGE_PAGE",
      },
      identity: { required: ["page", "messengerEnabled"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive messaging conversations that lead to purchase. Meta routes per viewer to Messenger, Instagram DM or WhatsApp based on Page connections + CTA.",
    },

    PHONE_CALL: {
      adSet: {
        optimizationGoals: ["QUALITY_CALL"],
        defaultOptimizationGoal: "QUALITY_CALL",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "click_to_call",
      },
      ctas: {
        allowed: ["CALL_NOW", "LEARN_MORE"],
        default: "CALL_NOW",
      },
      identity: { required: ["page", "pagePhoneNumber"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive inbound sales calls to the Page's phone number.",
    },

    APP: {
      adSet: {
        // Sales/App — same Meta constraint as Leads/APP and Engagement/APP:
        // Meta demands `custom_event_type` in promoted_object as the "main
        // conversion" for Conversions-family campaigns on App destination
        // (subcode 2446759). The `app` promoted_object shape auto-includes
        // custom_event_type when the form supplies pixelEventType. Pixel
        // picker surfaced via additionalFields. pixel_id NOT passed to
        // adset.promoted_object (Meta rejects with 1815229).
        optimizationGoals: ["LINK_CLICKS", "REACH"],
        defaultOptimizationGoal: "LINK_CLICKS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "app",
        additionalFields: [
          "mobileAppStore",
          "applicationId",
          "objectStoreUrl",
          "pixelId",
          "pixelEventType",
        ],
      },
      ad: {
        requiredFields: ["imageHash", "headline", "primaryText"],
        optionalFields: ["description", "deferredDeepLink"],
        objectStorySpecShape: "app_link",
      },
      ctas: {
        // USE_MOBILE_APP previously here too — same Meta enum behavior,
        // same "Use app" display label as USE_APP → rendered as a
        // duplicate entry in the dropdown. Keep USE_APP (the canonical
        // one used here historically). Leads/APP keeps USE_MOBILE_APP
        // because Meta defaults to that one specifically there.
        allowed: ["USE_APP", "DOWNLOAD", "LEARN_MORE", "SHOP_NOW"],
        default: "USE_APP",
      },
      identity: { required: ["page", "linkedApp"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Drive purchases inside your app. For installs, use OUTCOME_APP_PROMOTION. OFFSITE_CONVERSIONS deferred — needs an MMP.",
    },

    CATALOG: {
      adSet: {
        // OFFSITE_CONVERSIONS is the only goal Meta accepts on the
        // catalog cell — Dynamic Product Ads optimise against Pixel-
        // tracked purchase events scoped to products in the bound
        // product_set. VALUE optimisation is the documented alternative
        // (revenue rather than conversion count) but deferred — needs
        // value-rules setup which isn't built yet.
        optimizationGoals: ["OFFSITE_CONVERSIONS"],
        defaultOptimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "product_set",
        // catalogId + productSetId picked on the new Catalog wizard step
        // (additionalSteps: ["catalog"] below). pixelId + pixelEventType
        // still required — Meta needs the Pixel for visitor tracking AND
        // the product_set for ad-content scoping.
        additionalFields: ["pixelId", "pixelEventType", "catalogId", "productSetId"],
      },
      ad: {
        // No media field required — Meta sources images per product from
        // the catalog feed. Headline / primaryText / description / linkUrl
        // accept placeholder syntax ({{product.name}}, {{product.price}},
        // etc.); the AdStep surfaces an insert-chip toolbar and the
        // validator skips the standard 40/125/30 char caps for this cell
        // (templates expand per product at delivery; Meta truncates).
        requiredFields: ["headline", "primaryText", "linkUrl"],
        optionalFields: ["description"],
        objectStorySpecShape: "template_data",
      },
      ctas: {
        allowed: ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "BOOK_NOW", "SEE_MORE"],
        default: "SHOP_NOW",
      },
      identity: { required: ["page", "pixel", "catalog"], optional: ["instagram"] },
      // New wizard step inserted between AdSet and Ad — Catalog picker +
      // Product Set picker. Same pattern as Leads/Instant Form's
      // additionalSteps: ['leadForm'].
      additionalSteps: ["catalog"],
      notes: "Dynamic Product Ads. Meta substitutes product images / names / prices per viewer from the bound product set. Requires Pixel + Catalog + Product Set.",
    },
  },

  // ─── OUTCOME_AWARENESS ────────────────────────────────────────────────────
  // Brand-recall objective. Meta UI has NO conversion-location dropdown
  // for Awareness — the goal alone differentiates the two cells. Cell
  // split mirrors Meta's Performance Goal groupings exactly:
  //   STANDARD     → "Awareness goals" (REACH / IMPRESSIONS / AD_RECALL_LIFT)
  //   VIDEO_VIEWS  → "Video view goals" (THRUPLAY / 2-second)
  // Reverse-inference uses the optimization_goal alone (cellInference.js).
  // No new builder shapes — link_data + video_data already exist. The only
  // net-new infrastructure is frequency_control_specs on the AdSet, exposed
  // only when the picked goal is REACH (see Joi + AdSet step UI).
  OUTCOME_AWARENESS: {
    STANDARD: {
      group: "single",
      adSet: {
        // 3 "Awareness goals" from Meta's Performance Goal dropdown.
        // REACH is Meta's recommended default and the only goal that
        // surfaces frequency control. AD_RECALL_LIFT is documented as a
        // valid value across recent Marketing API versions; not all
        // accounts surface it but Meta accepts the enum.
        optimizationGoals: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT"],
        defaultOptimizationGoal: "REACH",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        // promoted_object: { page_id } — mirrors Engagement cells (Meta
        // accepts it as the "Page being promoted" context). Awareness
        // doesn't strictly need it but including it matches the existing
        // pattern and avoids a no-promoted-object branch in the launcher.
        promotedObjectShape: "page",
        // frequencyControl is the only net-new field — surfaces only when
        // goal === REACH (frontend conditional; Joi accepts it on any
        // goal). Meta's UI shape: "max N impressions every M days".
        additionalFields: ["frequencyControl"],
      },
      ad: {
        // linkUrl is OPTIONAL for Awareness — the objective is brand
        // recall, not click-through. Pure brand campaigns with CTA =
        // NO_BUTTON omit the destination entirely. Conditional rule
        // lives in wizardValidation: linkUrl required only when
        // callToAction != NO_BUTTON.
        //
        // imageHash sits in requiredFields as the "media required"
        // signal (mediaKind='any' means video is an accepted substitute;
        // validators + the media check in AdStep enforce image-XOR-video
        // generically). Matches Sales/WEBSITE's mediaKind='any' pattern.
        requiredFields: ["imageHash", "headline", "primaryText"],
        optionalFields: ["description", "linkUrl"],
        objectStorySpecShape: "link_data",
        // mediaKind: 'any' — image OR video both valid for STANDARD.
        mediaKind: "any",
      },
      ctas: {
        allowed: [
          "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "CONTACT_US",
          "DOWNLOAD", "BOOK_NOW", "GET_QUOTE", "APPLY_NOW", "GET_OFFER",
          "WATCH_MORE", "NO_BUTTON",
        ],
        default: "LEARN_MORE",
      },
      identity: { required: ["page"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Brand awareness — reach, impressions, or ad recall lift. linkUrl is optional (pure brand campaigns use NO_BUTTON CTA + no destination). Frequency cap appears on the AdSet step when the picked goal is REACH.",
    },

    VIDEO_VIEWS: {
      group: "single",
      adSet: {
        // 2 "Video view goals" from Meta's Performance Goal dropdown.
        // THRUPLAY counts 15s OR full play; TWO_SECOND is the lower-
        // threshold alternative. Both billed against IMPRESSIONS (Meta
        // accepts THRUPLAY billing as an alternative but it's less
        // common; default safe).
        optimizationGoals: ["THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"],
        defaultOptimizationGoal: "THRUPLAY",
        billingEvents: ["IMPRESSIONS"],
        defaultBillingEvent: "IMPRESSIONS",
        promotedObjectShape: "page",
        // No frequency control on video goals — Meta's UI doesn't surface
        // it on ThruPlay/2s-optimised ad sets.
      },
      ad: {
        // mediaKind=video forces the AdStep into video-only mode (the
        // image segmented button is hidden). Meta rejects image
        // creatives on ThruPlay/2s-optimised ad sets (subcode 1815869).
        // videoId in requiredFields so validateAd reads the contract
        // generically — same pattern as Engagement/VIDEO_VIEWS.
        mediaKind: "video",
        requiredFields: ["videoId", "headline", "primaryText"],
        optionalFields: ["description", "linkUrl"],
        objectStorySpecShape: "link_data",
      },
      ctas: {
        allowed: ["WATCH_MORE", "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "NO_BUTTON"],
        default: "WATCH_MORE",
      },
      identity: { required: ["page"], optional: ["instagram"] },
      additionalSteps: [],
      notes: "Video views — ThruPlay (15s or full play) or 2-second continuous. Video-only cell (Meta rejects image creatives on these ad sets, subcode 1815869). linkUrl optional — videos that drive plays without a click destination are common.",
    },
  },
};

// ─── Accessors ───────────────────────────────────────────────────────────────
// Pure read functions over the data above. The renderer + validator only
// import these; they never reach into CELLS directly. Keeping the surface
// narrow makes it cheap to change the internal shape later.

function listObjectives() {
  return Object.keys(CELLS);
}

function listConversionLocations(objective) {
  const branch = CELLS[objective];
  if (!branch) return [];
  return Object.keys(branch);
}

function getCell(objective, conversionLocation) {
  const cell = CELLS?.[objective]?.[conversionLocation];
  if (!cell) {
    throw new Error(
      `wizardSchema: no cell for (${objective}, ${conversionLocation})`,
    );
  }
  return cell;
}

function isCellImplemented(objective, conversionLocation) {
  const cell = CELLS?.[objective]?.[conversionLocation];
  return Boolean(cell) && !cell.placeholder;
}

// Resolve the Meta `destination_type` for a cell. Checks the
// objective-qualified key ("OBJECTIVE:LOCATION") first, then the bare
// conversion-location key. Presence is checked with `in` — NOT `??` —
// because a qualified key can legitimately map to `null` (omit the
// field), and `??` would wrongly fall through to the bare key.
function getMetaDestinationType(objective, conversionLocation) {
  const qualified = `${objective}:${conversionLocation}`;
  if (qualified in CONVERSION_LOCATION_TO_META_DESTINATION) {
    return CONVERSION_LOCATION_TO_META_DESTINATION[qualified];
  }
  if (conversionLocation in CONVERSION_LOCATION_TO_META_DESTINATION) {
    return CONVERSION_LOCATION_TO_META_DESTINATION[conversionLocation];
  }
  return null;
}

function getAllowedCtas(objective, conversionLocation) {
  const cell = getCell(objective, conversionLocation);
  if (cell.placeholder) return [];
  return cell.ctas.allowed;
}

function getAllowedOptimizationGoals(objective, conversionLocation) {
  const cell = getCell(objective, conversionLocation);
  if (cell.placeholder) return [];
  return cell.adSet.optimizationGoals;
}

// Returns the schema as a plain JSON-safe object — used by the wizard
// schema endpoint to ship the whole config to the frontend in one call.
function toJSON() {
  return {
    objectives: Object.fromEntries(
      Object.entries(CELLS).map(([objective, locations]) => [
        objective,
        {
          label: OBJECTIVE_LABELS[objective],
          conversionLocations: Object.fromEntries(
            Object.entries(locations).map(([loc, cell]) => [
              loc,
              {
                label: CONVERSION_LOCATION_LABELS[loc],
                metaDestinationType: getMetaDestinationType(objective, loc),
                ...cell,
              },
            ]),
          ),
        },
      ]),
    ),
    labels: {
      objective: OBJECTIVE_LABELS,
      conversionLocation: CONVERSION_LOCATION_LABELS,
      optimizationGoal: OPTIMIZATION_GOAL_LABELS,
      billingEvent: BILLING_EVENT_LABELS,
      cta: CTA_LABELS,
    },
    // Meta's optimisation-goal → billing-event compatibility rule, shipped
    // to the frontend so the AdSetStep can narrow the billing dropdown
    // when the goal changes. See subcode 1815117.
    billingEventsByOptimizationGoal: BILLING_EVENTS_BY_OPTIMIZATION_GOAL,
    // Optimisation goals that only accept autobid (LOWEST_COST_WITHOUT_CAP) —
    // see subcode 1885204. Frontend uses this to narrow the bid-strategy
    // dropdown when the goal changes.
    autobidOnlyOptimizationGoals: [...AUTOBID_ONLY_OPTIMIZATION_GOALS],
  };
}

module.exports = {
  // Raw data — exported for tests + the toJSON serialiser.
  CELLS,
  OBJECTIVE_LABELS,
  CONVERSION_LOCATION_LABELS,
  OPTIMIZATION_GOAL_LABELS,
  BILLING_EVENT_LABELS,
  CTA_LABELS,
  CONVERSION_LOCATION_TO_META_DESTINATION,
  BILLING_EVENTS_BY_OPTIMIZATION_GOAL,
  AUTOBID_ONLY_OPTIMIZATION_GOALS,

  // Accessors — the consumer surface.
  listObjectives,
  listConversionLocations,
  getCell,
  isCellImplemented,
  getMetaDestinationType,
  getAllowedCtas,
  getAllowedOptimizationGoals,
  getAllowedBillingEvents,
  getAllowedBidStrategies,
  toJSON,
};
