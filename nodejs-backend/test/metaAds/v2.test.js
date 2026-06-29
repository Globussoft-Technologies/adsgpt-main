#!/usr/bin/env node
/**
 * V2 builders + Joi factory tests. Run with:
 *
 *   node test/metaAds/v2.test.js
 *
 * Mirrors the project's plain-Node assertion style. Exits non-zero on
 * failure.
 */

const assert = require("node:assert/strict");

const { buildPromotedObject } = require("../../utils/promotedObject");
const { buildObjectStorySpec } = require("../../utils/objectStorySpec");
const {
  createCampaignSchemaV2,
  updateCampaignSchemaV2,
  buildAdSetSchemaV2,
  updateAdSetSchemaV2,
  buildAdSchemaV2,
} = require("../../Validations/meta.v2.validator");
const {
  listObjectives,
  listConversionLocations,
  getCell,
  getMetaDestinationType,
} = require("../../config/wizardSchema");

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  FAIL: ${name}`);
    console.log(`      ${err.message}`);
  }
}

function group(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// ─── buildPromotedObject ────────────────────────────────────────────────────

group("buildPromotedObject", () => {
  test("shape=null returns undefined (field is omitted on the AdSet)", () => {
    assert.equal(buildPromotedObject(null, {}), undefined);
  });

  test("shape=undefined returns undefined", () => {
    assert.equal(buildPromotedObject(undefined, {}), undefined);
  });

  test("shape='page' with pageId returns { page_id }", () => {
    const po = buildPromotedObject("page", { pageId: "page_42" });
    assert.deepEqual(po, { page_id: "page_42" });
  });

  test("shape='page' without pageId throws", () => {
    assert.throws(
      () => buildPromotedObject("page", {}),
      /pageId is required/,
    );
  });

  test("shape='app' with valid params returns the right payload", () => {
    const po = buildPromotedObject("app", {
      applicationId: "1234567890",
      objectStoreUrl: "https://play.google.com/store/apps/details?id=com.example",
    });
    assert.deepEqual(po, {
      application_id: "1234567890",
      object_store_url: "https://play.google.com/store/apps/details?id=com.example",
    });
  });

  test("shape='app' without applicationId throws", () => {
    assert.throws(
      () => buildPromotedObject("app", { objectStoreUrl: "x" }),
      /applicationId \+ objectStoreUrl/,
    );
  });

  test("shape='app' without objectStoreUrl throws", () => {
    assert.throws(
      () => buildPromotedObject("app", { applicationId: "x" }),
      /applicationId \+ objectStoreUrl/,
    );
  });

  test("unknown shape throws", () => {
    assert.throws(
      () => buildPromotedObject("not_a_real_shape", {}),
      /unknown shape/,
    );
  });
});

// ─── buildObjectStorySpec ────────────────────────────────────────────────────

group("buildObjectStorySpec — link_data (V1-verified shape)", () => {
  const fullParams = {
    pageId: "page_123",
    instagramUserId: "ig_456",
    imageHash: "hash_abc",
    headline: "Headline copy",
    primaryText: "Primary text body",
    description: "Description",
    linkUrl: "https://example.com/landing",
    callToAction: "LEARN_MORE",
  };

  test("link_data builds the exact V1 createAd shape", () => {
    const oss = buildObjectStorySpec("link_data", fullParams);
    assert.deepEqual(oss, {
      page_id: "page_123",
      instagram_user_id: "ig_456",
      link_data: {
        image_hash: "hash_abc",
        link: "https://example.com/landing",
        message: "Primary text body",
        name: "Headline copy",
        description: "Description",
        call_to_action: {
          type: "LEARN_MORE",
          value: { link: "https://example.com/landing" },
        },
      },
    });
  });

  test("link_data omits empty optional fields (Meta rejects empty strings)", () => {
    const oss = buildObjectStorySpec("link_data", {
      pageId: "page_123",
      imageHash: "hash_abc",
      linkUrl: "https://example.com",
      callToAction: "LEARN_MORE",
    });
    assert.ok(!("message" in oss.link_data));
    assert.ok(!("name" in oss.link_data));
    assert.ok(!("description" in oss.link_data));
    assert.ok(!("instagram_user_id" in oss));
  });

  test("link_data with NO_BUTTON skips call_to_action entirely", () => {
    const oss = buildObjectStorySpec("link_data", {
      pageId: "page_123",
      imageHash: "hash_abc",
      linkUrl: "https://example.com",
      callToAction: "NO_BUTTON",
    });
    assert.ok(!("call_to_action" in oss.link_data));
  });

  test("link_data throws without imageHash", () => {
    // After image+video support, the xor check fires before the
    // per-shape required-fields check — neither media set fails the
    // xor with a "provide exactly one" message.
    assert.throws(
      () =>
        buildObjectStorySpec("link_data", {
          pageId: "page_123",
          linkUrl: "https://example.com",
          callToAction: "LEARN_MORE",
        }),
      /exactly one of imageHash or videoId/,
    );
  });
});

group("buildObjectStorySpec — lead_gen_form", () => {
  test("lead_gen_form embeds lead_gen_form_id in the CTA value and uses linkUrl", () => {
    const oss = buildObjectStorySpec("lead_gen_form", {
      pageId: "page_123",
      imageHash: "hash_abc",
      headline: "Get a quote",
      primaryText: "Tell us about your needs",
      leadFormId: "form_999",
      linkUrl: "https://example.com/lp",
      callToAction: "SIGN_UP",
    });
    assert.equal(oss.link_data.call_to_action.value.lead_gen_form_id, "form_999");
    assert.equal(oss.link_data.call_to_action.type, "SIGN_UP");
    // Meta requires an external (non-Facebook) URL on Lead Gen creative
    // (error 1815316). The user-provided linkUrl is used as the fallback
    // destination when users skip the Instant Form.
    assert.equal(oss.link_data.link, "https://example.com/lp");
  });

  test("lead_gen_form without leadFormId throws", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("lead_gen_form", {
          pageId: "page_123",
          imageHash: "hash_abc",
          linkUrl: "https://example.com",
        }),
      /leadFormId/,
    );
  });

  test("lead_gen_form without linkUrl throws (Meta requires external URL)", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("lead_gen_form", {
          pageId: "page_123",
          imageHash: "hash_abc",
          leadFormId: "form_999",
        }),
      /linkUrl/,
    );
  });
});

group("buildObjectStorySpec — app_link", () => {
  const base = {
    pageId: "page_123",
    imageHash: "hash_abc",
    headline: "Try our app",
    primaryText: "Install now",
    objectStoreUrl: "https://play.google.com/store/apps/details?id=com.example",
    applicationId: "111222333444",
    callToAction: "INSTALL_MOBILE_APP",
  };

  test("app_link uses objectStoreUrl as the link", () => {
    const oss = buildObjectStorySpec("app_link", base);
    assert.equal(oss.link_data.link, base.objectStoreUrl);
    assert.equal(oss.link_data.call_to_action.value.link, base.objectStoreUrl);
  });

  test("app_link includes application id in CTA value (Meta requires this)", () => {
    const oss = buildObjectStorySpec("app_link", base);
    assert.equal(oss.link_data.call_to_action.value.application, base.applicationId);
  });

  test("app_link throws without applicationId", () => {
    assert.throws(
      () => buildObjectStorySpec("app_link", { ...base, applicationId: undefined }),
      /objectStoreUrl \+ applicationId are required/,
    );
  });

  test("app_link with deepLink adds app_link_spec for both platforms", () => {
    const oss = buildObjectStorySpec("app_link", {
      ...base,
      deepLink: "myapp://offers",
    });
    assert.deepEqual(oss.link_data.app_link_spec, {
      ios: [{ url: "myapp://offers" }],
      android: [{ url: "myapp://offers" }],
    });
  });

  test("app_link without deepLink omits app_link_spec", () => {
    const oss = buildObjectStorySpec("app_link", base);
    assert.ok(!("app_link_spec" in oss.link_data));
  });

  test("app_link with customProductPage adds custom_product_page_id", () => {
    const oss = buildObjectStorySpec("app_link", {
      ...base,
      customProductPage: "cpp_abc",
    });
    assert.equal(oss.link_data.custom_product_page_id, "cpp_abc");
  });
});

group("buildObjectStorySpec — click-to-message / call", () => {
  test("messenger_click_to_message has app_destination=MESSENGER + external link", () => {
    const oss = buildObjectStorySpec("messenger_click_to_message", {
      pageId: "page_123",
      imageHash: "hash_abc",
      headline: "Chat with us",
      primaryText: "We're online",
      linkUrl: "https://example.com/lp",
      callToAction: "MESSAGE_PAGE",
    });
    assert.equal(oss.link_data.call_to_action.value.app_destination, "MESSENGER");
    assert.equal(oss.link_data.call_to_action.value.page, "page_123");
    // Meta requires the external link field even on Messenger ads.
    assert.equal(oss.link_data.link, "https://example.com/lp");
  });

  test("messenger_click_to_message throws without linkUrl", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("messenger_click_to_message", {
          pageId: "page_123",
          imageHash: "hash_abc",
        }),
      /linkUrl is required/,
    );
  });

  test("whatsapp_click_to_message has app_destination=WHATSAPP", () => {
    const oss = buildObjectStorySpec("whatsapp_click_to_message", {
      pageId: "page_123",
      imageHash: "hash_abc",
      callToAction: "WHATSAPP_MESSAGE",
    });
    assert.equal(oss.link_data.call_to_action.value.app_destination, "WHATSAPP");
  });

  test("click_to_call uses linkUrl as link_data.link and tel: on the CTA", () => {
    const oss = buildObjectStorySpec("click_to_call", {
      pageId: "page_123",
      imageHash: "hash_abc",
      phoneNumber: "+919876543210",
      linkUrl: "https://example.com/contact",
      callToAction: "CALL_NOW",
    });
    // link_data.link must be an https:// URL (Meta rejects tel: there
    // for Lead Gen / external-URL rules).
    assert.equal(oss.link_data.link, "https://example.com/contact");
    // The CTA value carries the tel: URL — that's what fires the dialer.
    assert.equal(oss.link_data.call_to_action.value.link, "tel:+919876543210");
    // link_caption is intentionally omitted — Meta validates it as a URL
    // for WEBSITE-routed ads (Leads/Website-and-Calls) and rejects a bare
    // phone number with "Call to Action link caption is not a URL".
    assert.equal(oss.link_data.call_to_action.value.link_caption, undefined);
  });

  test("click_to_call strips tel: prefix when building the CTA link", () => {
    const oss = buildObjectStorySpec("click_to_call", {
      pageId: "page_123",
      imageHash: "hash_abc",
      phoneNumber: "tel:+12345678",
      linkUrl: "https://example.com",
      callToAction: "CALL_NOW",
    });
    // Even when the caller already prepends tel:, the builder should not
    // produce tel:tel:+12345678.
    assert.equal(oss.link_data.call_to_action.value.link, "tel:+12345678");
  });

  test("click_to_call normalises a formatted Page phone number", () => {
    // Facebook Pages return `phone` formatted with spaces / parens /
    // dashes — Meta rejects the tel: URL (subcode 2061044) unless it's
    // bare digits with an optional leading +.
    for (const [raw, expected] of [
      ["+91 98765 43210", "tel:+919876543210"],
      ["(555) 123-4567", "tel:5551234567"],
      ["+1-555-123-4567", "tel:+15551234567"],
      ["tel:+44 20 7946 0958", "tel:+442079460958"],
    ]) {
      const oss = buildObjectStorySpec("click_to_call", {
        pageId: "page_123",
        imageHash: "hash_abc",
        phoneNumber: raw,
        linkUrl: "https://example.com",
        callToAction: "CALL_NOW",
      });
      assert.equal(
        oss.link_data.call_to_action.value.link,
        expected,
        `phone "${raw}" should normalise to ${expected}`,
      );
    }
  });

  test("click_to_call throws on an unusable Page phone number", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("click_to_call", {
          pageId: "page_123",
          imageHash: "hash_abc",
          phoneNumber: "n/a",
          linkUrl: "https://example.com",
          callToAction: "CALL_NOW",
        }),
      /not a usable phone number/,
    );
  });

  test("click_to_call throws without linkUrl", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("click_to_call", {
          pageId: "page_123",
          imageHash: "hash_abc",
          phoneNumber: "+12345678",
        }),
      /linkUrl are required/,
    );
  });
});

group("buildObjectStorySpec — error paths", () => {
  test("missing shape throws", () => {
    assert.throws(
      () => buildObjectStorySpec("", { pageId: "x" }),
      /shape is required/,
    );
  });

  test("missing pageId throws", () => {
    assert.throws(
      () => buildObjectStorySpec("link_data", {}),
      /pageId is required/,
    );
  });

  test("unknown shape throws", () => {
    // Must pass media to get past the xor check; the shape error fires
    // after media validation.
    assert.throws(
      () =>
        buildObjectStorySpec("not_a_real_shape", { pageId: "x", imageHash: "h" }),
      /unknown shape/,
    );
  });
});

// ─── buildObjectStorySpec — media xor (image vs video) ──────────────────────

group("buildObjectStorySpec — media xor (image vs video)", () => {
  test("throws when neither imageHash nor videoId is provided", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("link_data", {
          pageId: "p",
          linkUrl: "https://example.com",
        }),
      /exactly one of imageHash or videoId/,
    );
  });

  test("throws when both imageHash and videoId are provided", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("link_data", {
          pageId: "p",
          imageHash: "h",
          videoId: "v",
          videoThumbnailUrl: "https://thumb.jpg",
          linkUrl: "https://example.com",
        }),
      /exactly one of imageHash or videoId/,
    );
  });

  test("omits image_url cleanly when videoId is set without a thumbnail", () => {
    // Builder no longer throws — the V2 controller fetches Meta's
    // auto-thumbnail before calling; if even that fails, Meta picks
    // one at ad-creation time. So the builder just emits video_data
    // without image_url and trusts Meta's default.
    const oss = buildObjectStorySpec("link_data", {
      pageId: "p",
      videoId: "v",
      linkUrl: "https://example.com",
      headline: "H",
      primaryText: "P",
      callToAction: "LEARN_MORE",
    });
    assert.equal(oss.video_data.video_id, "v");
    assert.ok(!("image_url" in oss.video_data));
  });

  test("video path emits video_data with title (not name) and image_url", () => {
    const oss = buildObjectStorySpec("link_data", {
      pageId: "p",
      videoId: "v123",
      videoThumbnailUrl: "https://thumb.jpg",
      linkUrl: "https://example.com",
      headline: "Headline",
      primaryText: "Body",
      callToAction: "LEARN_MORE",
    });
    assert.ok(!("link_data" in oss));
    assert.equal(oss.video_data.video_id, "v123");
    assert.equal(oss.video_data.image_url, "https://thumb.jpg");
    // headline maps to `title` on video_data, `name` on link_data.
    assert.equal(oss.video_data.title, "Headline");
    assert.equal(oss.video_data.message, "Body");
    assert.equal(oss.video_data.call_to_action.type, "LEARN_MORE");
    assert.equal(oss.video_data.call_to_action.value.link, "https://example.com");
  });

  test("video path on app_link builds video_data with application id on CTA", () => {
    const oss = buildObjectStorySpec("app_link", {
      pageId: "p",
      videoId: "v",
      videoThumbnailUrl: "https://thumb.jpg",
      objectStoreUrl: "https://play.google.com/store/apps/details?id=com.example",
      applicationId: "123",
      headline: "Get the app",
      primaryText: "Body",
      callToAction: "INSTALL_MOBILE_APP",
    });
    assert.ok(!("link_data" in oss));
    assert.equal(oss.video_data.video_id, "v");
    assert.equal(oss.video_data.call_to_action.value.application, "123");
    assert.equal(oss.video_data.call_to_action.value.link, "https://play.google.com/store/apps/details?id=com.example");
  });
});

// ─── createCampaignSchemaV2 ──────────────────────────────────────────────────

group("createCampaignSchemaV2", () => {
  test("accepts a valid Traffic body", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test campaign",
      objective: "OUTCOME_TRAFFIC",
    });
    assert.equal(error, undefined);
  });

  test("accepts a valid App Promotion body", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "App test",
      objective: "OUTCOME_APP_PROMOTION",
    });
    assert.equal(error, undefined);
  });

  test("rejects an objective not in the V2 schema with a helpful message", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      // All 6 ODAX objectives are in V2 now. Use a pre-ODAX legacy name
      // (Meta still accepts these on its API for backwards compat but the
      // wizard doesn't know about them) to exercise the rejection path.
      objective: "BRAND_AWARENESS",
    });
    assert.ok(error);
    // We override Joi's default "must be one of" with a user-facing
    // message that explains the V1/V2 split — assert the actual copy
    // so a future revert to Joi's default is caught.
    assert.match(error.details[0].message, /V2 only supports the migrated objectives/);
  });

  test("rejects both dailyBudget and lifetimeBudget at once", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
      dailyBudget: 500,
      lifetimeBudget: 5000,
    });
    assert.ok(error);
    assert.match(
      error.details[0].context?.message || error.details[0].message,
      /dailyBudget OR lifetimeBudget/,
    );
  });

  test("specialAdCategoryCountries is accepted on the campaign body", () => {
    const { error, value } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
      specialAdCategories: ["HOUSING"],
      specialAdCategoryCountries: ["IN", "US"],
    });
    assert.equal(error, undefined);
    assert.deepEqual(value.specialAdCategoryCountries, ["IN", "US"]);
  });

  test("specialAdCategoryCountries lowercases are rejected (must be 2-letter uppercase)", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
      specialAdCategoryCountries: ["india"],
    });
    assert.ok(error);
  });

  test("defaults status to PAUSED + specialAdCategories to []", () => {
    const { error, value } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
    });
    assert.equal(error, undefined);
    assert.equal(value.status, "PAUSED");
    assert.deepEqual(value.specialAdCategories, []);
  });

  test("rejects a spendCap equal to the daily budget", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
      dailyBudget: 10000,
      spendCap: 10000,
    });
    assert.ok(error);
    assert.match(
      error.details[0].context?.message || error.details[0].message,
      /must be greater than the daily budget/,
    );
  });

  test("rejects a spendCap below the daily budget", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
      dailyBudget: 10000,
      spendCap: 5000,
    });
    assert.ok(error);
    assert.match(
      error.details[0].context?.message || error.details[0].message,
      /must be greater than the daily budget/,
    );
  });

  test("accepts a spendCap above the daily budget", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
      dailyBudget: 10000,
      spendCap: 50000,
    });
    assert.equal(error, undefined);
  });

  test("rejects a spendCap below the lifetime budget", () => {
    const { error } = createCampaignSchemaV2.validate({
      adAccountId: "act_123",
      name: "Test",
      objective: "OUTCOME_TRAFFIC",
      lifetimeBudget: 50000,
      spendCap: 10000,
    });
    assert.ok(error);
    assert.match(
      error.details[0].context?.message || error.details[0].message,
      /at least the lifetime budget/,
    );
  });
});

// ─── buildAdSetSchemaV2 ──────────────────────────────────────────────────────

group("buildAdSetSchemaV2 — factory plumbing", () => {
  test("throws for unknown cell", () => {
    assert.throws(
      () => buildAdSetSchemaV2("OUTCOME_FAKE", "NOWHERE"),
      /not an implemented cell/,
    );
  });

  test("returns a Joi schema for an implemented cell", () => {
    const schema = buildAdSetSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
    assert.ok(schema && typeof schema.validate === "function");
  });
});

group("buildAdSetSchemaV2 — Traffic / Website", () => {
  const schema = buildAdSetSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
  const validBody = {
    adAccountId: "act_123",
    campaignId: "camp_456",
    pageId: "page_789",
    name: "Test adset",
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    optimizationGoal: "LINK_CLICKS",
    targeting: {
      locations: [{ type: "country", key: "IN", mode: "include" }],
    },
  };

  test("accepts a valid Traffic-Website body", () => {
    const { error } = schema.validate(validBody);
    assert.equal(error, undefined);
  });

  test("defaults optimizationGoal + billingEvent from the cell", () => {
    const { error, value } = schema.validate({
      ...validBody,
      optimizationGoal: undefined,
      billingEvent: undefined,
    });
    assert.equal(error, undefined);
    assert.equal(value.optimizationGoal, "LINK_CLICKS");
    assert.equal(value.billingEvent, "IMPRESSIONS");
  });

  test("rejects an optimizationGoal not allowed for Traffic-Website", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "LEAD_GENERATION",
    });
    assert.ok(error);
    assert.match(error.details[0].message, /must be one of/);
  });

  test("rejects a mismatched conversionLocation", () => {
    const { error } = schema.validate({
      ...validBody,
      conversionLocation: "MESSENGER",
    });
    assert.ok(error);
  });

  test("rejects empty targeting (no locations, no worldwide, no savedAudience)", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: { locations: [], worldwide: false },
    });
    assert.ok(error);
    assert.match(
      error.details[0].context?.message || error.details[0].message,
      /at least one location/,
    );
  });

  test("rejects targeting with only excluded locations (no includes)", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [{ type: "country", key: "IN", mode: "exclude" }],
        worldwide: false,
      },
    });
    assert.ok(error);
    assert.match(
      error.details[0].context?.message || error.details[0].message,
      /at least one location/,
    );
  });

  test("savedAudienceId satisfies the targeting requirement", () => {
    const { error } = schema.validate({
      ...validBody,
      savedAudienceId: "aud_42",
      targeting: { locations: [], worldwide: false },
    });
    assert.equal(error, undefined);
  });

  test("accepts a city with km radius", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [
          {
            type: "city",
            key: "1006661",
            name: "Delhi",
            mode: "include",
            radius: 25,
            distanceUnit: "kilometer",
          },
        ],
      },
    });
    assert.equal(error, undefined);
  });

  test("rejects a city radius above the 80 km cap", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [
          { type: "city", key: "1006661", mode: "include", radius: 200 },
        ],
      },
    });
    assert.ok(error);
  });

  test("accepts a region (state) entry", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [{ type: "region", key: "3847", mode: "include" }],
      },
    });
    assert.equal(error, undefined);
  });

  test("accepts a country_group (free trade area) entry", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [{ type: "country_group", key: "eea", mode: "include" }],
      },
    });
    assert.equal(error, undefined);
  });

  test("rejects an unknown location type", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [{ type: "neighborhood", key: "x", mode: "include" }],
      },
    });
    assert.ok(error);
  });

  test("accepts a custom map-pin with lat/lng/radius", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [
          {
            type: "custom",
            key: "custom:19.07,72.87",
            name: "Pin @ 19.07, 72.87",
            mode: "include",
            latitude: 19.07,
            longitude: 72.87,
            radius: 25,
          },
        ],
      },
    });
    assert.equal(error, undefined);
  });

  test("rejects a custom pin missing latitude", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [
          { type: "custom", key: "p", mode: "include", longitude: 72.87, radius: 25 },
        ],
      },
    });
    assert.ok(error);
  });

  test("rejects a custom pin missing radius", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [
          {
            type: "custom",
            key: "p",
            mode: "include",
            latitude: 19.07,
            longitude: 72.87,
          },
        ],
      },
    });
    assert.ok(error);
  });

  test("rejects a custom pin with out-of-range latitude", () => {
    const { error } = schema.validate({
      ...validBody,
      targeting: {
        locations: [
          {
            type: "custom",
            key: "p",
            mode: "include",
            latitude: 120,
            longitude: 72.87,
            radius: 25,
          },
        ],
      },
    });
    assert.ok(error);
  });
});

group("buildAdSetSchemaV2 — bid strategy ↔ bid amount (both directions)", () => {
  const schema = buildAdSetSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
  const base = {
    adAccountId: "act_123",
    campaignId: "camp_456",
    pageId: "page_789",
    name: "Test adset",
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    optimizationGoal: "LINK_CLICKS",
    targeting: {
      locations: [{ type: "country", key: "IN", mode: "include" }],
    },
  };
  const msg = (error) =>
    error.details[0].context?.message || error.details[0].message;

  test("capped strategy (COST_CAP) WITH bidAmount is accepted", () => {
    const { error } = schema.validate({
      ...base,
      bidStrategy: "COST_CAP",
      bidAmount: 50,
    });
    assert.equal(error, undefined);
  });

  test("capped strategy (COST_CAP) WITHOUT bidAmount is rejected", () => {
    const { error } = schema.validate({ ...base, bidStrategy: "COST_CAP" });
    assert.ok(error);
    assert.match(msg(error), /bidAmount is required/);
  });

  test("capped strategy (LOWEST_COST_WITH_BID_CAP) WITHOUT bidAmount is rejected", () => {
    const { error } = schema.validate({
      ...base,
      bidStrategy: "LOWEST_COST_WITH_BID_CAP",
    });
    assert.ok(error);
    assert.match(msg(error), /bidAmount is required/);
  });

  test("automatic strategy (LOWEST_COST_WITHOUT_CAP) WITH bidAmount is rejected", () => {
    const { error } = schema.validate({
      ...base,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      bidAmount: 50,
    });
    assert.ok(error);
    assert.match(msg(error), /can't be set/);
  });

  test("automatic strategy WITHOUT bidAmount is accepted", () => {
    const { error } = schema.validate({
      ...base,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    });
    assert.equal(error, undefined);
  });

  test("default strategy (omitted) WITHOUT bidAmount is accepted", () => {
    const { error, value } = schema.validate({ ...base });
    assert.equal(error, undefined);
    assert.equal(value.bidStrategy, "LOWEST_COST_WITHOUT_CAP");
  });
});

group("buildAdSetSchemaV2 — schedule (minimum 24h run window)", () => {
  const schema = buildAdSetSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
  const base = {
    adAccountId: "act_123",
    campaignId: "camp_456",
    pageId: "page_789",
    name: "Test adset",
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    optimizationGoal: "LINK_CLICKS",
    targeting: {
      locations: [{ type: "country", key: "IN", mode: "include" }],
    },
  };
  const msg = (error) =>
    error.details[0].context?.message || error.details[0].message;
  const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
  const HOUR = 60 * 60 * 1000;

  test("no endTime — no schedule constraint", () => {
    const { error } = schema.validate({ ...base });
    assert.equal(error, undefined);
  });

  test("25h window (explicit start + end) is accepted", () => {
    const { error } = schema.validate({
      ...base,
      startTime: iso(HOUR),
      endTime: iso(26 * HOUR),
    });
    assert.equal(error, undefined);
  });

  test("2h window is rejected as too short", () => {
    const { error } = schema.validate({
      ...base,
      startTime: iso(HOUR),
      endTime: iso(3 * HOUR),
    });
    assert.ok(error);
    assert.match(msg(error), /schedule is too short/);
  });

  test("endTime before startTime is rejected", () => {
    const { error } = schema.validate({
      ...base,
      startTime: iso(10 * HOUR),
      endTime: iso(2 * HOUR),
    });
    assert.ok(error);
    assert.match(msg(error), /after startTime/);
  });

  test("endTime only (no startTime) <24h from now is too short", () => {
    const { error } = schema.validate({ ...base, endTime: iso(2 * HOUR) });
    assert.ok(error);
    assert.match(msg(error), /schedule is too short/);
  });

  test("endTime only (no startTime) >24h from now is accepted", () => {
    const { error } = schema.validate({ ...base, endTime: iso(30 * HOUR) });
    assert.equal(error, undefined);
  });
});

group("buildAdSetSchemaV2 — App Promotion (sandbox)", () => {
  const schema = buildAdSetSchemaV2("OUTCOME_APP_PROMOTION", "APP");
  const validBody = {
    adAccountId: "act_123",
    campaignId: "camp_456",
    pageId: "page_789",
    name: "Test app adset",
    objective: "OUTCOME_APP_PROMOTION",
    conversionLocation: "APP",
    mobileAppStore: "GOOGLE_PLAY",
    applicationId: "app_111",
    objectStoreUrl: "https://play.google.com/store/apps/details?id=com.example",
    targeting: {
      locations: [{ type: "country", key: "IN", mode: "include" }],
    },
  };

  test("accepts a valid App Promotion body", () => {
    const { error } = schema.validate(validBody);
    assert.equal(error, undefined);
  });

  test("rejects body without mobileAppStore", () => {
    const { error } = schema.validate({ ...validBody, mobileAppStore: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /mobileAppStore/);
  });

  test("rejects body without applicationId", () => {
    const { error } = schema.validate({ ...validBody, applicationId: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /applicationId/);
  });

  test("rejects body without objectStoreUrl", () => {
    const { error } = schema.validate({ ...validBody, objectStoreUrl: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /objectStoreUrl/);
  });

  test("rejects objectStoreUrl that is not a valid URL", () => {
    const { error } = schema.validate({ ...validBody, objectStoreUrl: "not-a-url" });
    assert.ok(error);
  });

  test("rejects mobileAppStore not in the enum", () => {
    const { error } = schema.validate({
      ...validBody,
      mobileAppStore: "AMAZON_APPSTORE",
    });
    assert.ok(error);
  });

  test("rejects deferred optimization goals (OFFSITE_CONVERSIONS)", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "OFFSITE_CONVERSIONS",
    });
    assert.ok(error, "OFFSITE_CONVERSIONS must be rejected in sandbox mode");
  });
});

// ─── buildAdSchemaV2 ─────────────────────────────────────────────────────────

group("buildAdSchemaV2 — Traffic / Website", () => {
  const schema = buildAdSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
  const validBody = {
    adAccountId: "act_123",
    adSetId: "adset_456",
    pageId: "page_789",
    name: "Test ad",
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    imageHash: "hash_abc",
    headline: "Click here",
    primaryText: "Body text",
    linkUrl: "https://example.com",
  };

  test("accepts a valid Traffic-Website body", () => {
    const { error } = schema.validate(validBody);
    assert.equal(error, undefined);
  });

  test("rejects body without linkUrl (required for Traffic-Website)", () => {
    const { error } = schema.validate({ ...validBody, linkUrl: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /linkUrl/);
  });

  test("rejects body with a CTA not in the cell's allowed list", () => {
    const { error } = schema.validate({
      ...validBody,
      callToAction: "MESSAGE_PAGE",
    });
    assert.ok(error);
  });

  test("rejects body with a CTA that is in another cell's allowed list but not this one", () => {
    // INSTALL_MOBILE_APP is allowed for App Promotion but not Traffic-Website
    const { error } = schema.validate({
      ...validBody,
      callToAction: "INSTALL_MOBILE_APP",
    });
    assert.ok(error);
  });

  test("forbids deferredDeepLink + customProductPage on Traffic-Website", () => {
    // Joi.forbidden() rejects the field's presence entirely.
    const { error: dlErr } = schema.validate({
      ...validBody,
      deferredDeepLink: "myapp://x",
    });
    assert.ok(dlErr);
    const { error: cppErr } = schema.validate({
      ...validBody,
      customProductPage: "page_id",
    });
    assert.ok(cppErr);
  });
});

group("buildAdSchemaV2 — Leads / Instant Form", () => {
  const schema = buildAdSchemaV2("OUTCOME_LEADS", "INSTANT_FORM");
  const validBody = {
    adAccountId: "act_123",
    adSetId: "adset_456",
    pageId: "page_789",
    name: "Test lead ad",
    objective: "OUTCOME_LEADS",
    conversionLocation: "INSTANT_FORM",
    imageHash: "hash_abc",
    headline: "Get a quote",
    primaryText: "Tell us about your needs",
    leadFormId: "form_999",
    linkUrl: "https://example.com/lp",
  };

  test("accepts a valid Leads-InstantForm body", () => {
    const { error } = schema.validate(validBody);
    assert.equal(error, undefined);
  });

  test("rejects body without leadFormId", () => {
    const { error } = schema.validate({ ...validBody, leadFormId: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /leadFormId/);
  });

  test("linkUrl is required for Leads-InstantForm (Meta needs external URL)", () => {
    const { error } = schema.validate({ ...validBody, linkUrl: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /linkUrl/);
  });

  test("defaults callToAction to SIGN_UP (cell default)", () => {
    const { error, value } = schema.validate(validBody);
    assert.equal(error, undefined);
    assert.equal(value.callToAction, "SIGN_UP");
  });
});

group("buildAdSchemaV2 — App Promotion", () => {
  const schema = buildAdSchemaV2("OUTCOME_APP_PROMOTION", "APP");
  const validBody = {
    adAccountId: "act_123",
    adSetId: "adset_456",
    pageId: "page_789",
    name: "Test app ad",
    objective: "OUTCOME_APP_PROMOTION",
    conversionLocation: "APP",
    imageHash: "hash_abc",
    headline: "Install our app",
    primaryText: "Try it today",
    objectStoreUrl: "https://play.google.com/store/apps/details?id=com.example",
    applicationId: "111222333444",
  };

  test("accepts body without linkUrl (App Promotion uses objectStoreUrl)", () => {
    const { error } = schema.validate(validBody);
    assert.equal(error, undefined);
  });

  test("rejects body without objectStoreUrl (resent from AdSet step)", () => {
    const { error } = schema.validate({ ...validBody, objectStoreUrl: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /objectStoreUrl/);
  });

  test("rejects body without applicationId (required for INSTALL_MOBILE_APP CTA)", () => {
    const { error } = schema.validate({ ...validBody, applicationId: undefined });
    assert.ok(error);
    assert.match(error.details[0].message, /applicationId/);
  });

  test("accepts deferredDeepLink + customProductPage as optional", () => {
    const { error } = schema.validate({
      ...validBody,
      deferredDeepLink: "myapp://promo",
      customProductPage: "cpp_id_123",
    });
    assert.equal(error, undefined);
  });

  test("defaults callToAction to INSTALL_MOBILE_APP (cell default)", () => {
    const { error, value } = schema.validate(validBody);
    assert.equal(error, undefined);
    assert.equal(value.callToAction, "INSTALL_MOBILE_APP");
  });
});

group("buildAdSchemaV2 — App-Promo-only fields forbidden on non-app cells", () => {
  const trafficBody = {
    adAccountId: "act_123",
    adSetId: "adset_456",
    pageId: "page_789",
    name: "Test",
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    imageHash: "hash_abc",
    headline: "x",
    primaryText: "y",
    linkUrl: "https://example.com",
  };

  test("Traffic-Website forbids objectStoreUrl", () => {
    const schema = buildAdSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
    const { error } = schema.validate({
      ...trafficBody,
      objectStoreUrl: "https://play.google.com/x",
    });
    assert.ok(error);
  });

  test("Traffic-Website forbids applicationId", () => {
    const schema = buildAdSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
    const { error } = schema.validate({
      ...trafficBody,
      applicationId: "999",
    });
    assert.ok(error);
  });
});

// ─── Exhaustive per-cell coverage ───────────────────────────────────────────
// Every (objective × conversionLocation) cell is driven through the full
// payload chain — object_story_spec builder, promoted_object builder, and
// both Joi factories. This is the regression net: changing a builder,
// schema field, or validator that breaks ANY cell fails a test here. It
// can't verify Meta *accepts* the payload (only a live launch does), but
// it locks the payload SHAPE so accidental edits surface immediately.

// Kitchen-sink params — every field any object_story_spec shape might
// need. Each builder picks the subset it uses; extras are ignored.
function ossParams(cell, media) {
  return {
    pageId: "page_1",
    instagramUserId: "ig_1",
    headline: "Test headline",
    primaryText: "Test primary text",
    description: "Test description",
    callToAction: cell.ctas.default,
    linkUrl: "https://example.com/landing",
    leadFormId: "form_1",
    applicationId: "app_1",
    objectStoreUrl: "https://apps.apple.com/app/id123456789",
    phoneNumber: "+15551234567",
    autoTranslate: false,
    ...media,
  };
}

// A valid create-adset body for a cell — base fields + whatever the
// cell's additionalFields require.
function adSetBody(objective, conversionLocation, cell) {
  const body = {
    adAccountId: "act1",
    campaignId: "camp1",
    pageId: "page_1",
    name: "Test ad set",
    objective,
    conversionLocation,
    dailyBudget: 1000,
    targeting: {
      locations: [{ type: "country", key: "IN", mode: "include" }],
    },
  };
  for (const field of cell.adSet.additionalFields || []) {
    if (field === "mobileAppStore") body.mobileAppStore = "GOOGLE_PLAY";
    else if (field === "applicationId") body.applicationId = "app_1";
    else if (field === "objectStoreUrl") {
      body.objectStoreUrl = "https://play.google.com/store/apps/details?id=com.x";
    } else if (field === "pixelId") body.pixelId = "pixel_1";
    else if (field === "pixelEventType") body.pixelEventType = "LEAD";
    else if (field === "catalogId") body.catalogId = "cat_1";
    else if (field === "productSetId") body.productSetId = "ps_1";
    else if (field === "frequencyControl") {
      // Awareness/STANDARD — Meta's frequency cap. Optional at the Joi
      // level (no UI surfaces it off REACH goal) but the auto-sweep
      // provides a valid one so the field block gets exercised.
      body.frequencyControl = { capFrequency: 2, capPeriodDays: 7 };
    }
  }
  return body;
}

// A valid create-ad body for a cell — base + required copy/destination
// fields + app fields when the shape needs them. mediaKind drives the
// media field (Engagement/VIDEO_VIEWS is video-only; rest accept either).
// Sales/CATALOG (template_data shape) is the catalog exception — no
// media, placeholder-safe linkUrl.
function adBody(objective, conversionLocation, cell) {
  const req = new Set(cell.ad.requiredFields);
  const isCatalog = cell.ad.objectStorySpecShape === "template_data";
  const body = {
    adAccountId: "act1",
    adSetId: "adset1",
    pageId: "page_1",
    name: "Test ad",
    objective,
    conversionLocation,
    headline: "Test headline",
    primaryText: "Test primary text",
    description: "Test description",
    callToAction: cell.ctas.default,
  };
  if (!isCatalog) {
    if (cell.ad.mediaKind === "video") {
      body.videoId = "vid_1";
      body.videoThumbnailUrl = "https://example.com/poster.jpg";
    } else {
      body.imageHash = "hash_abc";
    }
  }
  if (req.has("linkUrl") || cell.ad.optionalFields.includes("linkUrl")) {
    body.linkUrl = isCatalog ? "{{product.url}}" : "https://example.com/landing";
  }
  if (req.has("leadFormId")) body.leadFormId = "form_1";
  if (cell.ad.objectStorySpecShape === "app_link") {
    body.objectStoreUrl = "https://play.google.com/store/apps/details?id=com.x";
    body.applicationId = "app_1";
  }
  return body;
}

group("every cell — object_story_spec builds for image AND video", () => {
  for (const objective of listObjectives()) {
    for (const conversionLocation of listConversionLocations(objective)) {
      const cell = getCell(objective, conversionLocation);
      const label = `${objective}/${conversionLocation}`;
      // template_data cells (Sales/CATALOG) don't accept user-supplied
      // media — images come from the catalog feed. The image/video
      // auto-sweep doesn't apply; cell-specific tests below cover the
      // template_data builder shape directly.
      if (cell.ad.objectStorySpecShape === "template_data") continue;

      test(`${label}: object_story_spec builds with an image`, () => {
        const oss = buildObjectStorySpec(
          cell.ad.objectStorySpecShape,
          ossParams(cell, { imageHash: "hash_abc" }),
        );
        assert.equal(oss.page_id, "page_1");
        assert.ok(
          oss.link_data || oss.video_data,
          "must produce link_data or video_data",
        );
        assert.ok(
          (oss.link_data || oss.video_data).image_hash === "hash_abc",
          "image creative must carry image_hash",
        );
      });

      test(`${label}: object_story_spec builds with a video`, () => {
        const oss = buildObjectStorySpec(
          cell.ad.objectStorySpecShape,
          ossParams(cell, {
            videoId: "vid_1",
            videoThumbnailUrl: "https://example.com/poster.jpg",
          }),
        );
        assert.ok(oss.video_data, "video creative must produce video_data");
        assert.equal(oss.video_data.video_id, "vid_1");
        assert.ok(!oss.link_data, "video creative must not produce link_data");
      });
    }
  }
});

group("every cell — promoted_object builds", () => {
  for (const objective of listObjectives()) {
    for (const conversionLocation of listConversionLocations(objective)) {
      const cell = getCell(objective, conversionLocation);
      const label = `${objective}/${conversionLocation}`;
      test(`${label}: promoted_object builds without throwing`, () => {
        const po = buildPromotedObject(cell.adSet.promotedObjectShape, {
          pageId: "page_1",
          applicationId: "app_1",
          objectStoreUrl: "https://play.google.com/store/apps/details?id=com.x",
          pixelId: "pixel_1",
          pixelEventType: "LEAD",
          // Sales/CATALOG product_set shape needs productSetId; kitchen-
          // sink params cover all shapes' requirements.
          productSetId: "ps_1",
        });
        // `page` / `app` / `pixel` / `product_set` shapes return an
        // object; `null` shape returns undefined. Both are valid.
        assert.ok(
          po === undefined || (typeof po === "object" && po !== null),
          `promoted_object must be an object or undefined, got ${JSON.stringify(po)}`,
        );
      });
    }
  }
});

group("every cell — Joi factories accept a valid body", () => {
  for (const objective of listObjectives()) {
    for (const conversionLocation of listConversionLocations(objective)) {
      const cell = getCell(objective, conversionLocation);
      const label = `${objective}/${conversionLocation}`;

      test(`${label}: buildAdSetSchemaV2 accepts a valid body`, () => {
        const schema = buildAdSetSchemaV2(objective, conversionLocation);
        const { error } = schema.validate(adSetBody(objective, conversionLocation, cell));
        assert.ok(!error, error && error.message);
      });

      test(`${label}: buildAdSchemaV2 accepts a valid body`, () => {
        const schema = buildAdSchemaV2(objective, conversionLocation);
        const { error } = schema.validate(adBody(objective, conversionLocation, cell));
        assert.ok(!error, error && error.message);
      });
    }
  }
});

// ─── cellInference (resolve-cell) ───────────────────────────────────────────

const {
  destinationToConversionLocation,
  inferCellForMetaCampaign,
} = require("../../controllers/adPosting/cellInference");

group("destinationToConversionLocation", () => {
  test("WEBSITE → WEBSITE", () => {
    assert.equal(destinationToConversionLocation("OUTCOME_TRAFFIC", "WEBSITE"), "WEBSITE");
  });
  test("APP → APP", () => {
    assert.equal(destinationToConversionLocation("OUTCOME_APP_PROMOTION", "APP"), "APP");
  });
  test("ON_AD → INSTANT_FORM", () => {
    assert.equal(destinationToConversionLocation("OUTCOME_LEADS", "ON_AD"), "INSTANT_FORM");
  });
  test("INSTAGRAM_DIRECT → INSTAGRAM", () => {
    assert.equal(destinationToConversionLocation("OUTCOME_LEADS", "INSTAGRAM_DIRECT"), "INSTAGRAM");
  });
  test("PHONE_CALL on Leads → CALLS", () => {
    assert.equal(destinationToConversionLocation("OUTCOME_LEADS", "PHONE_CALL"), "CALLS");
  });
  test("PHONE_CALL on Traffic → PHONE_CALL", () => {
    assert.equal(destinationToConversionLocation("OUTCOME_TRAFFIC", "PHONE_CALL"), "PHONE_CALL");
  });
  test("unknown destination → null", () => {
    assert.equal(destinationToConversionLocation("OUTCOME_TRAFFIC", "ZZZ"), null);
  });
});

group("inferCellForMetaCampaign", () => {
  test("Traffic + WEBSITE destination resolves the WEBSITE cell", () => {
    const r = inferCellForMetaCampaign(
      { objective: "OUTCOME_TRAFFIC" },
      { destination_type: "WEBSITE" },
    );
    assert.equal(r.error, undefined);
    assert.equal(r.objective, "OUTCOME_TRAFFIC");
    assert.equal(r.conversionLocation, "WEBSITE");
    assert.ok(r.cell);
  });

  test("missing destination_type falls back per objective (Traffic → WEBSITE)", () => {
    const r = inferCellForMetaCampaign({ objective: "OUTCOME_TRAFFIC" }, {});
    assert.equal(r.conversionLocation, "WEBSITE");
    assert.ok(r.cell);
  });

  test("App Promotion fallback → APP", () => {
    const r = inferCellForMetaCampaign({ objective: "OUTCOME_APP_PROMOTION" }, {});
    assert.equal(r.conversionLocation, "APP");
  });

  test("Leads fallback → INSTANT_FORM", () => {
    const r = inferCellForMetaCampaign({ objective: "OUTCOME_LEADS" }, {});
    assert.equal(r.conversionLocation, "INSTANT_FORM");
  });

  test("lowercase objective is normalised", () => {
    const r = inferCellForMetaCampaign(
      { objective: "outcome_traffic" },
      { destination_type: "WEBSITE" },
    );
    assert.equal(r.objective, "OUTCOME_TRAFFIC");
  });

  test("unsupported objective returns an error", () => {
    // Pre-ODAX legacy objective (Meta still accepts on API but V2 doesn't
    // map it). All 6 ODAX objectives are now supported, so this is the
    // canonical "out of scope" test case.
    const r = inferCellForMetaCampaign({ objective: "BRAND_AWARENESS" }, {});
    assert.ok(r.error);
    assert.equal(r.cell, undefined);
  });

  test("missing objective returns an error", () => {
    const r = inferCellForMetaCampaign({}, {});
    assert.ok(r.error);
  });
});

// ─── updateCampaignSchemaV2 (edit campaign) ─────────────────────────────────

group("updateCampaignSchemaV2", () => {
  test("accepts a partial update (name only)", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      name: "Renamed campaign",
    });
    assert.ok(!error, error && error.message);
  });

  test("accepts a budget + spend cap update", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      dailyBudget: 50000,
      spendCap: 200000,
    });
    assert.ok(!error, error && error.message);
  });

  test("requires adAccountId + campaignId", () => {
    const { error } = updateCampaignSchemaV2.validate({ name: "x" });
    assert.ok(error);
  });

  test("rejects changing objective (immutable)", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      objective: "OUTCOME_LEADS",
    });
    assert.ok(error);
  });

  test("rejects changing special ad categories (immutable)", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      specialAdCategories: ["HOUSING"],
    });
    assert.ok(error);
  });

  test("rejects daily + lifetime budget together", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      dailyBudget: 10000,
      lifetimeBudget: 50000,
    });
    assert.ok(error);
  });

  test("rejects spend cap at or below the daily budget", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      dailyBudget: 50000,
      spendCap: 50000,
    });
    assert.ok(error);
  });

  test("rejects a sub-minimum budget", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      dailyBudget: 50,
    });
    assert.ok(error);
  });

  // Sanity-ceiling tests — these are typo-guards, not Meta's hard limits.
  // See BUDGET_*_MAX_MINOR in meta.v2.validator.js for the values.
  test("rejects a daily budget above the ₹1cr typo-ceiling", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      dailyBudget: 999_999_999_999, // ₹999cr ≫ ₹1cr cap
    });
    assert.ok(error);
  });

  test("rejects a spend cap above the ₹10cr typo-ceiling", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      spendCap: 999_999_999_999,
    });
    assert.ok(error);
  });

  test("accepts a daily budget exactly at the ₹1cr ceiling", () => {
    const { error } = updateCampaignSchemaV2.validate({
      adAccountId: "act_1",
      campaignId: "c1",
      dailyBudget: 1_000_000_000, // exactly ₹1cr in paise
    });
    assert.ok(!error, error && error.message);
  });
});

// ─── buildObjectStorySpec — video_data description field-name remap ────────
// Meta rejects `description` in video_data with subcode 1443050. The
// builder must remap it to `link_description` for video creatives.

group("buildObjectStorySpec — description ↔ link_description split by media kind", () => {
  const params = {
    pageId: "page_1",
    headline: "Walk in unmatched comfort",
    primaryText: "Upgrade your walk.",
    description: "Stylish, durable, lightweight.",
    linkUrl: "https://example.com",
    callToAction: "SHOP_NOW",
  };

  test("image creative → uses `description` key", () => {
    const oss = buildObjectStorySpec("link_data", { ...params, imageHash: "h" });
    assert.equal(oss.link_data.description, "Stylish, durable, lightweight.");
    assert.ok(!("link_description" in oss.link_data));
  });

  test("video creative → uses `link_description`, NOT `description` (subcode 1443050)", () => {
    const oss = buildObjectStorySpec("link_data", {
      ...params,
      videoId: "vid_1",
      videoThumbnailUrl: "https://example.com/p.jpg",
    });
    assert.equal(oss.video_data.link_description, "Stylish, durable, lightweight.");
    assert.ok(
      !("description" in oss.video_data),
      "video_data must not carry the 'description' field — Meta rejects it",
    );
  });
});

// ─── buildAdSetSchemaV2 — billing event ↔ optimisation goal compatibility ──
// Meta rejects mismatched pairs with subcode 1815117. The Joi factory
// catches this before launch.

group("buildAdSetSchemaV2 — billing event ↔ goal compatibility", () => {
  const schema = buildAdSetSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
  const base = {
    adAccountId: "act1",
    campaignId: "c1",
    pageId: "page_1",
    name: "Billing-goal test",
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    dailyBudget: 1000,
    targeting: { locations: [{ type: "country", key: "IN", mode: "include" }] },
  };

  test("LANDING_PAGE_VIEWS + LINK_CLICKS billing → reject (subcode 1815117)", () => {
    const { error } = schema.validate({
      ...base,
      optimizationGoal: "LANDING_PAGE_VIEWS",
      billingEvent: "LINK_CLICKS",
    });
    assert.ok(error);
  });

  test("LANDING_PAGE_VIEWS + IMPRESSIONS billing → accept", () => {
    const { error } = schema.validate({
      ...base,
      optimizationGoal: "LANDING_PAGE_VIEWS",
      billingEvent: "IMPRESSIONS",
    });
    assert.ok(!error, error && error.message);
  });

  test("LINK_CLICKS + LINK_CLICKS billing → accept (the only legal pair for LINK_CLICKS billing)", () => {
    const { error } = schema.validate({
      ...base,
      optimizationGoal: "LINK_CLICKS",
      billingEvent: "LINK_CLICKS",
    });
    assert.ok(!error, error && error.message);
  });

  test("REACH + LINK_CLICKS billing → reject", () => {
    const { error } = schema.validate({
      ...base,
      optimizationGoal: "REACH",
      billingEvent: "LINK_CLICKS",
    });
    assert.ok(error);
  });
});

// ─── buildAdSetSchemaV2 — bid strategy ↔ optimisation goal compatibility ──
// Meta rejects capped strategies on autobid-only goals with subcode 1885204
// ("Optimisation goal only supports autobid"). The Joi factory catches this
// before launch.

group("buildAdSetSchemaV2 — bid strategy ↔ goal compatibility", () => {
  // QUALITY_CALL (the bug reporter's case) — Engagement / Calls cell.
  const schema = buildAdSetSchemaV2("OUTCOME_ENGAGEMENT", "PHONE_CALL");
  const base = {
    adAccountId: "act1",
    campaignId: "c1",
    pageId: "page_1",
    name: "Autobid-only goal test",
    objective: "OUTCOME_ENGAGEMENT",
    conversionLocation: "PHONE_CALL",
    optimizationGoal: "QUALITY_CALL",
    billingEvent: "IMPRESSIONS",
    dailyBudget: 1000,
    targeting: { locations: [{ type: "country", key: "IN", mode: "include" }] },
  };

  test("QUALITY_CALL + LOWEST_COST_WITH_BID_CAP → reject (subcode 1885204)", () => {
    const { error } = schema.validate({
      ...base,
      bidStrategy: "LOWEST_COST_WITH_BID_CAP",
      bidAmount: 500,
    });
    assert.ok(error);
  });

  test("QUALITY_CALL + COST_CAP → reject (subcode 1885204)", () => {
    const { error } = schema.validate({
      ...base,
      bidStrategy: "COST_CAP",
      bidAmount: 500,
    });
    assert.ok(error);
  });

  test("QUALITY_CALL + LOWEST_COST_WITHOUT_CAP → accept (the only legal strategy)", () => {
    const { error } = schema.validate({
      ...base,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    });
    assert.ok(!error, error && error.message);
  });

  test("CONVERSATIONS + LOWEST_COST_WITH_BID_CAP → reject (autobid-only)", () => {
    // Engagement/WHATSAPP was consolidated into MESSAGE_DESTINATIONS in
    // Phase 3 (2026-06-18). The autobid-only rule for CONVERSATIONS is
    // still tested via the consolidated cell.
    const msgSchema = buildAdSetSchemaV2("OUTCOME_ENGAGEMENT", "MESSAGE_DESTINATIONS");
    const { error } = msgSchema.validate({
      ...base,
      conversionLocation: "MESSAGE_DESTINATIONS",
      optimizationGoal: "CONVERSATIONS",
      bidStrategy: "LOWEST_COST_WITH_BID_CAP",
      bidAmount: 500,
    });
    assert.ok(error);
  });

  test("Capped strategies still accepted on goals not in the autobid-only set (THRUPLAY)", () => {
    const videoSchema = buildAdSetSchemaV2("OUTCOME_ENGAGEMENT", "VIDEO_VIEWS");
    const { error } = videoSchema.validate({
      ...base,
      conversionLocation: "VIDEO_VIEWS",
      optimizationGoal: "THRUPLAY",
      bidStrategy: "LOWEST_COST_WITH_BID_CAP",
      bidAmount: 500,
    });
    assert.ok(!error, error && error.message);
  });
});

// ─── buildAdSchemaV2 — Meta copy-length caps ────────────────────────────────
// Headline 40 / primaryText 125 / description 30 mirror Meta's display-
// without-truncation thresholds for single-image/video ads. Above these,
// Ads Manager shows "…" on the rendered creative — we reject at our layer
// so users don't ship copy nobody will read in full.

group("buildAdSchemaV2 — Meta copy-length caps", () => {
  const schema = buildAdSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
  const base = {
    adAccountId: "act1",
    adSetId: "adset1",
    pageId: "page_1",
    name: "Length-cap test ad",
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    imageHash: "hash_abc",
    linkUrl: "https://example.com/landing",
    callToAction: "LEARN_MORE",
  };

  test("rejects a headline over 40 chars", () => {
    const { error } = schema.validate({
      ...base,
      headline: "x".repeat(41),
      primaryText: "ok",
    });
    assert.ok(error);
  });

  test("accepts a headline at exactly 40 chars", () => {
    const { error } = schema.validate({
      ...base,
      headline: "x".repeat(40),
      primaryText: "ok",
    });
    assert.ok(!error, error && error.message);
  });

  test("rejects primary text over 125 chars", () => {
    const { error } = schema.validate({
      ...base,
      headline: "ok",
      primaryText: "x".repeat(126),
    });
    assert.ok(error);
  });

  test("rejects a description over 30 chars", () => {
    const { error } = schema.validate({
      ...base,
      headline: "ok",
      primaryText: "ok",
      description: "x".repeat(31),
    });
    assert.ok(error);
  });
});

// ─── updateAdSetSchemaV2 (edit ad set) ──────────────────────────────────────

group("updateAdSetSchemaV2", () => {
  test("accepts a name-only update", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      name: "Renamed ad set",
    });
    assert.ok(!error, error && error.message);
  });

  test("accepts a budget + bid cap update", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      dailyBudget: 30000,
      bidAmount: 5000,
    });
    assert.ok(!error, error && error.message);
  });

  test("accepts a targeting update (country + city radius)", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      targeting: {
        locations: [
          { type: "country", key: "IN", mode: "include" },
          { type: "city", key: "2295414", radius: 40, mode: "include" },
        ],
        ageMin: 25,
        ageMax: 45,
      },
    });
    assert.ok(!error, error && error.message);
  });

  test("requires adAccountId + adSetId", () => {
    const { error } = updateAdSetSchemaV2.validate({ name: "x" });
    assert.ok(error);
  });

  test("rejects changing optimization goal (locked)", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      optimizationGoal: "LINK_CLICKS",
    });
    assert.ok(error);
  });

  test("rejects changing billing event (locked)", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      billingEvent: "IMPRESSIONS",
    });
    assert.ok(error);
  });

  test("rejects changing bid strategy (locked)", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      bidStrategy: "LOWEST_COST_WITH_BID_CAP",
    });
    assert.ok(error);
  });

  test("rejects a custom pin without a radius", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      targeting: {
        locations: [
          { type: "custom", key: "custom:1,2", latitude: 1, longitude: 2, mode: "include" },
        ],
      },
    });
    assert.ok(error);
  });

  test("rejects a schedule shorter than 24h", () => {
    const { error } = updateAdSetSchemaV2.validate({
      adAccountId: "act_1",
      adSetId: "s1",
      startTime: "2026-06-01T00:00:00Z",
      endTime: "2026-06-01T06:00:00Z",
    });
    assert.ok(error);
  });
});

// ─── OUTCOME_ENGAGEMENT — cell-specific tests ───────────────────────────────
// The auto-sweep above already covers builder + Joi happy paths for every
// engagement cell. These tests pin down the engagement-specific edges that
// the auto-sweep can't: media-kind enforcement, optimisation-goal-based
// reverse cell inference, and the new conversion-location → destination_type
// mappings. `inferCellForMetaCampaign` is already imported above; pull
// SUPPORTED_OBJECTIVES from the same module.

const { SUPPORTED_OBJECTIVES } = require("../../controllers/adPosting/cellInference");

group("OUTCOME_ENGAGEMENT — registered in SUPPORTED_OBJECTIVES (backend)", () => {
  test("OUTCOME_ENGAGEMENT is listed in cellInference.SUPPORTED_OBJECTIVES", () => {
    assert.ok(
      SUPPORTED_OBJECTIVES.has("OUTCOME_ENGAGEMENT"),
      "OUTCOME_ENGAGEMENT must be in SUPPORTED_OBJECTIVES",
    );
  });

  test("listConversionLocations exposes the live engagement cells (Phase 3 — 7 cells)", () => {
    const locs = listConversionLocations("OUTCOME_ENGAGEMENT");
    assert.deepEqual(
      [...locs].sort(),
      [
        // Phase 3 consolidated MESSENGER + WHATSAPP + INSTAGRAM into ONE
        // MESSAGE_DESTINATIONS cell (matches Meta UI + mirrors Sales pattern).
        // INSTAGRAM_OR_FACEBOOK restored — Meta now accepts PAGE_LIKES under
        // the "Maximise Facebook Page visits" UI label.
        // EVENT_RESPONSES + REMINDERS_SET deferred — need new picker
        // infrastructure (Facebook Event picker / reminder-post picker).
        "MESSAGE_DESTINATIONS", "PHONE_CALL", "VIDEO_VIEWS", "POST_ENGAGEMENT",
        "WEBSITE", "APP", "INSTAGRAM_OR_FACEBOOK",
      ].sort(),
    );
  });
});

group("OUTCOME_ENGAGEMENT — destination_type mappings (Phase 3)", () => {
  // MESSAGE_DESTINATIONS consolidated from MESSENGER+WHATSAPP+INSTAGRAM —
  // bare key maps to MESSENGER (Meta routes to IG-DM/WhatsApp from there).
  test("MESSAGE_DESTINATIONS → MESSENGER (bare key; Meta auto-routes)", () => {
    assert.equal(
      getMetaDestinationType("OUTCOME_ENGAGEMENT", "MESSAGE_DESTINATIONS"),
      "MESSENGER",
    );
  });
  test("PHONE_CALL → PHONE_CALL", () => {
    assert.equal(getMetaDestinationType("OUTCOME_ENGAGEMENT", "PHONE_CALL"), "PHONE_CALL");
  });
  test("VIDEO_VIEWS → ON_VIDEO (granular SDK surface destination)", () => {
    assert.equal(getMetaDestinationType("OUTCOME_ENGAGEMENT", "VIDEO_VIEWS"), "ON_VIDEO");
  });
  test("POST_ENGAGEMENT → ON_POST", () => {
    assert.equal(getMetaDestinationType("OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT"), "ON_POST");
  });
  test("WEBSITE → WEBSITE", () => {
    assert.equal(getMetaDestinationType("OUTCOME_ENGAGEMENT", "WEBSITE"), "WEBSITE");
  });
  test("APP → APP", () => {
    assert.equal(getMetaDestinationType("OUTCOME_ENGAGEMENT", "APP"), "APP");
  });
  test("INSTAGRAM_OR_FACEBOOK → ON_PAGE (per Meta's allowed destination_type list for OUTCOME_ENGAGEMENT)", () => {
    // Meta docs: developers.facebook.com/docs/marketing-api/adset/destination_type/
    // OUTCOME_ENGAGEMENT's allowed list does NOT include WEBSITE.
    // ON_PAGE is the documented profile/page-visit enum for Engagement.
    assert.equal(
      getMetaDestinationType("OUTCOME_ENGAGEMENT", "INSTAGRAM_OR_FACEBOOK"),
      "ON_PAGE",
    );
  });
});

group("OUTCOME_ENGAGEMENT — VIDEO_VIEWS cell shape", () => {
  const cell = getCell("OUTCOME_ENGAGEMENT", "VIDEO_VIEWS");

  test("declares mediaKind='video'", () => {
    assert.equal(cell.ad.mediaKind, "video");
  });

  test("default optimisation goal is THRUPLAY", () => {
    assert.equal(cell.adSet.defaultOptimizationGoal, "THRUPLAY");
    assert.ok(cell.adSet.optimizationGoals.includes("THRUPLAY"));
  });

  test("uses the existing link_data shape (builder emits video_data via media switch)", () => {
    assert.equal(cell.ad.objectStorySpecShape, "link_data");
  });

  test("requiredFields contains videoId, not imageHash", () => {
    assert.ok(cell.ad.requiredFields.includes("videoId"));
    assert.ok(!cell.ad.requiredFields.includes("imageHash"));
  });
});

group("OUTCOME_ENGAGEMENT — VIDEO_VIEWS Joi factory enforces mediaKind", () => {
  const schema = buildAdSchemaV2("OUTCOME_ENGAGEMENT", "VIDEO_VIEWS");
  const validBody = {
    adAccountId: "act1",
    adSetId: "adset1",
    pageId: "page_1",
    name: "Video views ad",
    objective: "OUTCOME_ENGAGEMENT",
    conversionLocation: "VIDEO_VIEWS",
    videoId: "vid_1",
    videoThumbnailUrl: "https://example.com/poster.jpg",
    headline: "Watch this",
    primaryText: "Body copy",
    description: "",
    linkUrl: "https://example.com/landing",
    callToAction: "LEARN_MORE",
  };

  test("accepts a video body", () => {
    const { error } = schema.validate(validBody);
    assert.ok(!error, error && error.message);
  });

  test("rejects an image-only body (mediaKind='video' forbids imageHash)", () => {
    const body = { ...validBody };
    delete body.videoId;
    delete body.videoThumbnailUrl;
    body.imageHash = "hash_abc";
    const { error } = schema.validate(body);
    assert.ok(error, "image body must be rejected for a video-only cell");
    // Joi's `.custom()` collapses our descriptive message into the generic
    // "contains an invalid value" — the human message hides in
    // error.details[0].context.message. Assert it's the mediaKind error
    // and not e.g. the generic XOR (since the body has imageHash without
    // videoId, both would fire — order matters and mediaKind wins).
    const ctxMsg = error?.details?.[0]?.context?.message || "";
    assert.match(ctxMsg, /video creative/i);
  });

  test("rejects providing BOTH image and video (XOR still applies)", () => {
    const { error } = schema.validate({ ...validBody, imageHash: "hash_abc" });
    assert.ok(error);
  });
});

group("OUTCOME_ENGAGEMENT — POST_ENGAGEMENT cell shape", () => {
  const cell = getCell("OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT");

  test("optimisation goal locked to POST_ENGAGEMENT", () => {
    assert.deepEqual(cell.adSet.optimizationGoals, ["POST_ENGAGEMENT"]);
    assert.equal(cell.adSet.defaultOptimizationGoal, "POST_ENGAGEMENT");
  });

  test("accepts image OR video (mediaKind not locked)", () => {
    assert.ok(cell.ad.mediaKind === undefined || cell.ad.mediaKind === "any");
  });

  test("Joi factory accepts an image body", () => {
    const schema = buildAdSchemaV2("OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT");
    const { error } = schema.validate({
      adAccountId: "act1",
      adSetId: "adset1",
      pageId: "page_1",
      name: "Post engagement ad",
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "POST_ENGAGEMENT",
      imageHash: "hash_abc",
      headline: "Engage",
      primaryText: "Body",
      description: "",
      linkUrl: "https://example.com",
      callToAction: "LEARN_MORE",
    });
    assert.ok(!error, error && error.message);
  });
});

group("OUTCOME_ENGAGEMENT — MESSAGE_DESTINATIONS cell shape (Phase 3)", () => {
  const cell = getCell("OUTCOME_ENGAGEMENT", "MESSAGE_DESTINATIONS");

  test("default optimisation goal is CONVERSATIONS; LINK_CLICKS surfaced as 'Other goal'", () => {
    assert.equal(cell.adSet.defaultOptimizationGoal, "CONVERSATIONS");
    assert.ok(cell.adSet.optimizationGoals.includes("LINK_CLICKS"));
  });

  test("uses the canonical messenger_click_to_message shape", () => {
    assert.equal(cell.ad.objectStorySpecShape, "messenger_click_to_message");
  });

  test("CTA list covers all 3 messaging surfaces (Messenger, IG-DM, WhatsApp) + LEARN_MORE", () => {
    assert.deepEqual(
      [...cell.ctas.allowed].sort(),
      ["MESSAGE_PAGE", "WHATSAPP_MESSAGE", "INSTAGRAM_MESSAGE", "LEARN_MORE"].sort(),
    );
  });
});

group("OUTCOME_ENGAGEMENT — INSTAGRAM_OR_FACEBOOK cell shape (Phase 3 restoration)", () => {
  const cell = getCell("OUTCOME_ENGAGEMENT", "INSTAGRAM_OR_FACEBOOK");

  test("optimisation goals are PAGE_LIKES + VISIT_INSTAGRAM_PROFILE", () => {
    assert.deepEqual(
      [...cell.adSet.optimizationGoals].sort(),
      ["PAGE_LIKES", "VISIT_INSTAGRAM_PROFILE"].sort(),
    );
  });

  test("uses link_data shape (profile URL via linkUrl, surface via CTA)", () => {
    assert.equal(cell.ad.objectStorySpecShape, "link_data");
  });

  test("IG identity is OPTIONAL (cell delivers on FB if IG isn't connected)", () => {
    assert.ok(!cell.identity.required.includes("instagram"));
    assert.ok(cell.identity.optional.includes("instagram"));
  });
});

group("OUTCOME_ENGAGEMENT — PHONE_CALL cell shape", () => {
  const cell = getCell("OUTCOME_ENGAGEMENT", "PHONE_CALL");

  test("optimisation goal locked to QUALITY_CALL", () => {
    assert.deepEqual(cell.adSet.optimizationGoals, ["QUALITY_CALL"]);
  });

  test("reuses the Traffic click_to_call shape", () => {
    assert.equal(cell.ad.objectStorySpecShape, "click_to_call");
  });
});

group("OUTCOME_ENGAGEMENT — inferCellForMetaCampaign disambiguates ON_AD by optimization_goal", () => {
  const campaign = { objective: "OUTCOME_ENGAGEMENT" };

  test("ON_AD + THRUPLAY → VIDEO_VIEWS cell", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "ON_AD",
      optimization_goal: "THRUPLAY",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "VIDEO_VIEWS");
  });

  test("ON_AD + POST_ENGAGEMENT → POST_ENGAGEMENT cell", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "ON_AD",
      optimization_goal: "POST_ENGAGEMENT",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "POST_ENGAGEMENT");
  });

  test("ON_AD with no/unknown goal falls back to VIDEO_VIEWS", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "ON_AD",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "VIDEO_VIEWS");
  });

  test("messaging destinations all collapse to MESSAGE_DESTINATIONS (Phase 3 consolidation)", () => {
    for (const dest of ["MESSENGER", "WHATSAPP", "INSTAGRAM_DIRECT"]) {
      const out = inferCellForMetaCampaign(campaign, {
        destination_type: dest,
        optimization_goal: "CONVERSATIONS",
      });
      assert.ok(!out.error, `${dest} unexpectedly errored: ${out.error}`);
      assert.equal(
        out.conversionLocation,
        "MESSAGE_DESTINATIONS",
        `${dest} should resolve to MESSAGE_DESTINATIONS on Engagement`,
      );
    }
  });

  test("destination_type=ON_PAGE resolves to INSTAGRAM_OR_FACEBOOK cell (current write-side enum)", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "ON_PAGE",
      optimization_goal: "PAGE_LIKES",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "INSTAGRAM_OR_FACEBOOK");
  });

  test("PAGE_LIKES goal resolves to INSTAGRAM_OR_FACEBOOK cell (legacy read-side compat: WEBSITE was the prior wrong enum)", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "WEBSITE",
      optimization_goal: "PAGE_LIKES",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "INSTAGRAM_OR_FACEBOOK");
  });

  test("VISIT_INSTAGRAM_PROFILE goal resolves to INSTAGRAM_OR_FACEBOOK cell", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "WEBSITE",
      optimization_goal: "VISIT_INSTAGRAM_PROFILE",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "INSTAGRAM_OR_FACEBOOK");
  });

  test("PHONE_CALL on engagement → PHONE_CALL cell (not CALLS — that's the Leads cell)", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "PHONE_CALL",
      optimization_goal: "QUALITY_CALL",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "PHONE_CALL");
  });

  test("no destination falls back to VIDEO_VIEWS (most-common engagement cell)", () => {
    const out = inferCellForMetaCampaign(campaign, {});
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "VIDEO_VIEWS");
  });

  // Phase 2 inference paths (INSTAGRAM_DIRECT now collapses to
  // MESSAGE_DESTINATIONS — covered by the consolidation test above).
  test("WEBSITE + OFFSITE_CONVERSIONS → WEBSITE cell (pixel path)", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "WEBSITE",
      optimization_goal: "OFFSITE_CONVERSIONS",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "WEBSITE");
  });

  test("APP destination → APP cell", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "APP",
      optimization_goal: "LINK_CLICKS",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "APP");
  });
});

group("OUTCOME_ENGAGEMENT — Phase 2 cell shapes (INSTAGRAM consolidated into MESSAGE_DESTINATIONS in Phase 3)", () => {
  test("WEBSITE cell uses pixel_website shape + requires pixel additionalFields", () => {
    const cell = getCell("OUTCOME_ENGAGEMENT", "WEBSITE");
    assert.equal(cell.ad.objectStorySpecShape, "pixel_website");
    assert.equal(cell.adSet.promotedObjectShape, "pixel");
    assert.deepEqual(cell.adSet.additionalFields, ["pixelId", "pixelEventType"]);
    assert.equal(cell.adSet.defaultOptimizationGoal, "OFFSITE_CONVERSIONS");
  });

  test("APP cell uses app_link shape + does NOT include APP_INSTALLS goal (engagement, not install)", () => {
    const cell = getCell("OUTCOME_ENGAGEMENT", "APP");
    assert.equal(cell.ad.objectStorySpecShape, "app_link");
    assert.ok(!cell.adSet.optimizationGoals.includes("APP_INSTALLS"));
    assert.ok(cell.adSet.optimizationGoals.includes("LINK_CLICKS"));
  });

  // INSTAGRAM_OR_FACEBOOK cell retired — Meta rejected PAGE_LIKES and
  // VISIT_INSTAGRAM_PROFILE with subcode 2490408. Re-add when Meta's
  // profile-visit enum is verified.

  test("VIDEO_VIEWS now accepts TWO_SECOND_CONTINUOUS_VIDEO_VIEWS goal", () => {
    const cell = getCell("OUTCOME_ENGAGEMENT", "VIDEO_VIEWS");
    assert.ok(cell.adSet.optimizationGoals.includes("THRUPLAY"));
    assert.ok(cell.adSet.optimizationGoals.includes("TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"));
    assert.equal(cell.adSet.defaultOptimizationGoal, "THRUPLAY");
  });
});

group("OUTCOME_ENGAGEMENT — Phase 2 Joi factories accept valid bodies", () => {
  test("VIDEO_VIEWS accepts a 2-second-continuous-views body", () => {
    const schema = buildAdSetSchemaV2("OUTCOME_ENGAGEMENT", "VIDEO_VIEWS");
    const { error } = schema.validate({
      adAccountId: "act1",
      campaignId: "c1",
      pageId: "page_1",
      name: "2-sec views adset",
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "VIDEO_VIEWS",
      optimizationGoal: "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS",
      dailyBudget: 1000,
      targeting: { locations: [{ type: "country", key: "IN", mode: "include" }] },
    });
    assert.ok(!error, error && error.message);
  });

  // INSTAGRAM_OR_FACEBOOK valid-body tests removed along with the cell.

  test("Engagement WEBSITE rejects body without pixelId (additionalFields enforced)", () => {
    const schema = buildAdSetSchemaV2("OUTCOME_ENGAGEMENT", "WEBSITE");
    const { error } = schema.validate({
      adAccountId: "act1",
      campaignId: "c1",
      pageId: "page_1",
      name: "Missing pixel",
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "WEBSITE",
      dailyBudget: 1000,
      targeting: { locations: [{ type: "country", key: "IN", mode: "include" }] },
    });
    assert.ok(error, "pixelId must be required");
  });
});

// ─── OUTCOME_SALES — cell-specific tests ────────────────────────────────────
// The auto-sweep covers Joi happy paths + promoted_object + object_story_spec
// builds for every Sales cell. These tests pin down the Sales-specific
// edges the auto-sweep can't infer: CATALOG's new shapes, the no-media
// contract, the placeholder-friendly copy/linkUrl, and reverse-inference
// via product_set_id presence.

group("OUTCOME_SALES — registered + cells live", () => {
  test("listObjectives includes OUTCOME_SALES", () => {
    assert.ok(listObjectives().includes("OUTCOME_SALES"));
  });
  test("listConversionLocations exposes 7 Sales cells (matches Meta UI's 4 Single + 2 of 4 Multiple + CATALOG; in-store Multiples deferred)", () => {
    const locs = listConversionLocations("OUTCOME_SALES");
    assert.deepEqual(
      [...locs].sort(),
      [
        // Multiple (Meta auto-routes per viewer): 2 of 4 shipped;
        // WEBSITE_AND_IN_STORE + WEBSITE_APP_IN_STORE deferred — need
        // Offline Conversions API integration.
        "WEBSITE_AND_CALLS", "WEBSITE_AND_APP",
        // Single (4 of 4 from Meta UI)
        "WEBSITE", "APP", "MESSAGE_DESTINATIONS", "PHONE_CALL",
        // Catalog — separate Advantage+ flow, not in the dropdown
        "CATALOG",
      ].sort(),
    );
  });
  test("OUTCOME_SALES is in cellInference.SUPPORTED_OBJECTIVES", () => {
    assert.ok(SUPPORTED_OBJECTIVES.has("OUTCOME_SALES"));
  });
});

group("OUTCOME_SALES — destination_type mappings", () => {
  test("WEBSITE → WEBSITE", () => {
    assert.equal(getMetaDestinationType("OUTCOME_SALES", "WEBSITE"), "WEBSITE");
  });
  test("APP → APP", () => {
    assert.equal(getMetaDestinationType("OUTCOME_SALES", "APP"), "APP");
  });
  test("MESSAGE_DESTINATIONS → MESSENGER (Meta auto-routes per Page connections + CTA)", () => {
    assert.equal(
      getMetaDestinationType("OUTCOME_SALES", "MESSAGE_DESTINATIONS"),
      "MESSENGER",
    );
  });
  test("PHONE_CALL → PHONE_CALL", () => {
    assert.equal(getMetaDestinationType("OUTCOME_SALES", "PHONE_CALL"), "PHONE_CALL");
  });
  test("CATALOG → null (omit; reverse-inference uses product_set_id)", () => {
    assert.equal(getMetaDestinationType("OUTCOME_SALES", "CATALOG"), null);
  });
});

group("OUTCOME_SALES/APP — OFFSITE_CONVERSIONS unlock (Meta SDK / Conversions API for App)", () => {
  // Live-verified 2026-06-26 via Meta UI capture: Sales/App exposes
  // "Maximise number of app events" goal. The unlock path is Meta SDK +
  // Conversions API for App — no third-party MMP service required.
  const cell = getCell("OUTCOME_SALES", "APP");

  test("optimizationGoals includes OFFSITE_CONVERSIONS", () => {
    assert.ok(
      cell.adSet.optimizationGoals.includes("OFFSITE_CONVERSIONS"),
      "Sales/APP must offer OFFSITE_CONVERSIONS after the 2026-06-26 unlock",
    );
  });

  test("optimizationGoals also keeps LINK_CLICKS + REACH (fallback delivery goals)", () => {
    assert.ok(cell.adSet.optimizationGoals.includes("LINK_CLICKS"));
    assert.ok(cell.adSet.optimizationGoals.includes("REACH"));
  });

  test("additionalFields does NOT include pixelId (app shape can't carry pixel_id — subcode 1815229)", () => {
    assert.ok(
      !cell.adSet.additionalFields.includes("pixelId"),
      "pixelId removed from Sales/APP additionalFields — dead data on app shape",
    );
  });

  test("additionalFields keeps pixelEventType (mapped to custom_event_type on the app shape)", () => {
    assert.ok(cell.adSet.additionalFields.includes("pixelEventType"));
  });
});

group("OUTCOME_SALES/WEBSITE_AND_APP — OFFSITE_CONVERSIONS unlock (multi-source event)", () => {
  // Live-verified 2026-06-26 via Meta UI capture: Sales/Website-and-app
  // exposes "Maximise number of conversions" with a "Build event" flow
  // that creates a multi-source event spanning Pixel + App SDK.
  const cell = getCell("OUTCOME_SALES", "WEBSITE_AND_APP");

  test("optimizationGoals includes OFFSITE_CONVERSIONS", () => {
    assert.ok(
      cell.adSet.optimizationGoals.includes("OFFSITE_CONVERSIONS"),
      "Sales/WEBSITE_AND_APP must offer OFFSITE_CONVERSIONS after the 2026-06-26 unlock",
    );
  });

  test("defaultOptimizationGoal stays LINK_CLICKS (backward compat — OFFSITE is opt-in)", () => {
    assert.equal(cell.adSet.defaultOptimizationGoal, "LINK_CLICKS");
  });
});

group("OUTCOME_SALES/CATALOG — cell shape", () => {
  const cell = getCell("OUTCOME_SALES", "CATALOG");

  test("uses new objectStorySpecShape 'template_data'", () => {
    assert.equal(cell.ad.objectStorySpecShape, "template_data");
  });
  test("uses new promotedObjectShape 'product_set'", () => {
    assert.equal(cell.adSet.promotedObjectShape, "product_set");
  });
  test("additionalFields include pixel + catalog + product set", () => {
    assert.deepEqual(
      [...cell.adSet.additionalFields].sort(),
      ["catalogId", "pixelEventType", "pixelId", "productSetId"],
    );
  });
  test("requiredFields contain NO imageHash or videoId (catalog provides media)", () => {
    assert.ok(!cell.ad.requiredFields.includes("imageHash"));
    assert.ok(!cell.ad.requiredFields.includes("videoId"));
  });
  test("additionalSteps inserts the Catalog wizard step", () => {
    assert.deepEqual(cell.additionalSteps, ["catalog"]);
  });
  test("optimizationGoal locked to OFFSITE_CONVERSIONS", () => {
    assert.deepEqual(cell.adSet.optimizationGoals, ["OFFSITE_CONVERSIONS"]);
  });
});

group("OUTCOME_SALES/CATALOG — product_set promoted_object builder", () => {
  test("returns { pixel_id, product_set_id }", () => {
    const po = buildPromotedObject("product_set", {
      pixelId: "px_123",
      productSetId: "ps_456",
    });
    assert.deepEqual(po, { pixel_id: "px_123", product_set_id: "ps_456" });
  });
  test("throws without pixelId", () => {
    assert.throws(
      () => buildPromotedObject("product_set", { productSetId: "ps_456" }),
      /pixelId \+ productSetId/,
    );
  });
  test("throws without productSetId", () => {
    assert.throws(
      () => buildPromotedObject("product_set", { pixelId: "px_123" }),
      /pixelId \+ productSetId/,
    );
  });
});

group("OUTCOME_SALES/CATALOG — template_data object_story_spec builder", () => {
  const params = {
    pageId: "page_1",
    headline: "Shop {{product.name}}",
    primaryText: "Best price on {{product.brand}}",
    description: "{{product.price}}",
    linkUrl: "{{product.url}}",
    callToAction: "SHOP_NOW",
  };

  test("produces a top-level template_data block (not link_data)", () => {
    const oss = buildObjectStorySpec("template_data", params);
    assert.ok(oss.template_data, "template_data must be the outer key");
    assert.ok(!oss.link_data, "no link_data on template_data shape");
    assert.ok(!oss.video_data, "no video_data on template_data shape");
  });
  test("preserves placeholders unchanged", () => {
    const oss = buildObjectStorySpec("template_data", params);
    assert.equal(oss.template_data.name, "Shop {{product.name}}");
    assert.equal(oss.template_data.message, "Best price on {{product.brand}}");
    assert.equal(oss.template_data.description, "{{product.price}}");
    assert.equal(oss.template_data.link, "{{product.url}}");
    assert.equal(oss.template_data.call_to_action.value.link, "{{product.url}}");
  });
  test("rejects imageHash (catalog feed provides media)", () => {
    assert.throws(
      () => buildObjectStorySpec("template_data", { ...params, imageHash: "h_x" }),
      /catalog feed/,
    );
  });
  test("rejects videoId (catalog feed provides media)", () => {
    assert.throws(
      () =>
        buildObjectStorySpec("template_data", {
          ...params,
          videoId: "v_x",
          videoThumbnailUrl: "https://x.com/p.jpg",
        }),
      /catalog feed/,
    );
  });
  test("throws without linkUrl", () => {
    const incomplete = { ...params };
    delete incomplete.linkUrl;
    assert.throws(
      () => buildObjectStorySpec("template_data", incomplete),
      /linkUrl/,
    );
  });
});

group("OUTCOME_SALES/CATALOG — Joi factories", () => {
  const adSetSchema = buildAdSetSchemaV2("OUTCOME_SALES", "CATALOG");
  const validAdSetBody = {
    adAccountId: "act1",
    campaignId: "c1",
    pageId: "page_1",
    name: "Catalog adset",
    objective: "OUTCOME_SALES",
    conversionLocation: "CATALOG",
    pixelId: "px_1",
    pixelEventType: "Purchase",
    catalogId: "cat_1",
    productSetId: "ps_1",
    dailyBudget: 1000,
    targeting: { locations: [{ type: "country", key: "IN", mode: "include" }] },
  };

  test("CATALOG adset accepts a valid body with pixel + catalog + product set", () => {
    const { error } = adSetSchema.validate(validAdSetBody);
    assert.ok(!error, error && error.message);
  });
  test("CATALOG adset rejects without catalogId", () => {
    const body = { ...validAdSetBody, catalogId: undefined };
    const { error } = adSetSchema.validate(body);
    assert.ok(error);
  });
  test("CATALOG adset rejects without productSetId", () => {
    const body = { ...validAdSetBody, productSetId: undefined };
    const { error } = adSetSchema.validate(body);
    assert.ok(error);
  });
  test("CATALOG adset still requires pixelId + pixelEventType alongside catalog", () => {
    const { error } = adSetSchema.validate({ ...validAdSetBody, pixelId: undefined });
    assert.ok(error);
  });

  const adSchema = buildAdSchemaV2("OUTCOME_SALES", "CATALOG");
  const validAdBody = {
    adAccountId: "act1",
    adSetId: "as1",
    pageId: "page_1",
    name: "Catalog ad",
    objective: "OUTCOME_SALES",
    conversionLocation: "CATALOG",
    headline: "Shop {{product.name}}",
    primaryText: "Best deals on {{product.brand}} — starting at {{product.current_price}}",
    linkUrl: "{{product.url}}",
    callToAction: "SHOP_NOW",
  };

  test("CATALOG ad accepts placeholder copy longer than the standard 40-char cap", () => {
    const longHeadline = "Free shipping on {{product.name}} from {{product.brand}} — limited stock!";
    const { error } = adSchema.validate({ ...validAdBody, headline: longHeadline });
    assert.ok(!error, error && error.message);
  });
  test("CATALOG ad accepts {{product.url}} as linkUrl (no URI check)", () => {
    const { error } = adSchema.validate(validAdBody);
    assert.ok(!error, error && error.message);
  });
  test("CATALOG ad rejects imageHash (catalog provides images)", () => {
    const { error } = adSchema.validate({ ...validAdBody, imageHash: "h_x" });
    assert.ok(error);
  });
  test("CATALOG ad rejects videoId (catalog provides images)", () => {
    const { error } = adSchema.validate({
      ...validAdBody,
      videoId: "v_x",
      videoThumbnailUrl: "https://x.com/p.jpg",
    });
    assert.ok(error);
  });
});

group("OUTCOME_SALES — reverse-inference", () => {
  const campaign = { objective: "OUTCOME_SALES" };
  test("ad set with product_set_id → CATALOG cell", () => {
    const out = inferCellForMetaCampaign(campaign, {
      promoted_object: { pixel_id: "px_1", product_set_id: "ps_1" },
      optimization_goal: "OFFSITE_CONVERSIONS",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "CATALOG");
  });
  test("ad set without product_set_id + WEBSITE destination → WEBSITE cell", () => {
    const out = inferCellForMetaCampaign(campaign, {
      destination_type: "WEBSITE",
      optimization_goal: "OFFSITE_CONVERSIONS",
      promoted_object: { pixel_id: "px_1", custom_event_type: "Purchase" },
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "WEBSITE");
  });
  test("messaging destinations all collapse to MESSAGE_DESTINATIONS (Meta UI shows them as one option for Sales)", () => {
    for (const dest of ["MESSENGER", "WHATSAPP", "INSTAGRAM_DIRECT"]) {
      const out = inferCellForMetaCampaign(campaign, {
        destination_type: dest,
        optimization_goal: "CONVERSATIONS",
      });
      assert.ok(!out.error, `${dest} unexpectedly errored: ${out.error}`);
      assert.equal(
        out.conversionLocation,
        "MESSAGE_DESTINATIONS",
        `${dest} should resolve to MESSAGE_DESTINATIONS`,
      );
    }
  });
  test("non-messaging destinations route to their own cells", () => {
    for (const [dest, og, expected] of [
      ["PHONE_CALL", "QUALITY_CALL", "PHONE_CALL"],
      ["APP", "LINK_CLICKS", "APP"],
    ]) {
      const out = inferCellForMetaCampaign(campaign, {
        destination_type: dest,
        optimization_goal: og,
      });
      assert.ok(!out.error, `${dest} unexpectedly errored: ${out.error}`);
      assert.equal(out.conversionLocation, expected);
    }
  });
  test("no destination + no product_set_id falls back to WEBSITE", () => {
    const out = inferCellForMetaCampaign(campaign, {});
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "WEBSITE");
  });
});

// ─── OUTCOME_AWARENESS — registered + cells live ────────────────────────────
// All 6 ODAX objectives are now in V2 after this migration. The auto-sweep
// covers the Joi happy paths + builder shapes; these tests pin down the
// Awareness-specific edges: optional linkUrl, video-only lock, frequency
// cap field handling, and goal-based reverse-inference.

group("OUTCOME_AWARENESS — registered + cells live", () => {
  test("listObjectives includes OUTCOME_AWARENESS", () => {
    assert.ok(listObjectives().includes("OUTCOME_AWARENESS"));
  });
  test("listConversionLocations exposes 2 Awareness cells (STANDARD + VIDEO_VIEWS)", () => {
    const locs = listConversionLocations("OUTCOME_AWARENESS");
    assert.deepEqual([...locs].sort(), ["STANDARD", "VIDEO_VIEWS"].sort());
  });
  test("OUTCOME_AWARENESS is in cellInference.SUPPORTED_OBJECTIVES", () => {
    assert.ok(SUPPORTED_OBJECTIVES.has("OUTCOME_AWARENESS"));
  });
  test("Awareness destination_type is null for both cells", () => {
    assert.equal(getMetaDestinationType("OUTCOME_AWARENESS", "STANDARD"), null);
    assert.equal(getMetaDestinationType("OUTCOME_AWARENESS", "VIDEO_VIEWS"), null);
  });
});

group("OUTCOME_AWARENESS/STANDARD — Joi adset", () => {
  const schema = buildAdSetSchemaV2("OUTCOME_AWARENESS", "STANDARD");
  const validBody = {
    adAccountId: "act1",
    campaignId: "c1",
    pageId: "page_1",
    name: "Awareness adset",
    objective: "OUTCOME_AWARENESS",
    conversionLocation: "STANDARD",
    dailyBudget: 1000,
    targeting: { locations: [{ type: "country", key: "IN", mode: "include" }] },
  };

  test("accepts REACH goal with frequencyControl", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "REACH",
      frequencyControl: { capFrequency: 2, capPeriodDays: 7 },
    });
    assert.ok(!error, error && error.message);
  });
  test("accepts AD_RECALL_LIFT goal", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "AD_RECALL_LIFT",
    });
    assert.ok(!error, error && error.message);
  });
  test("accepts REACH goal WITHOUT frequencyControl (Meta default = no cap)", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "REACH",
    });
    assert.ok(!error, error && error.message);
  });
  test("rejects frequencyControl with capFrequency = 0", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "REACH",
      frequencyControl: { capFrequency: 0, capPeriodDays: 7 },
    });
    assert.ok(error);
  });
  test("rejects frequencyControl with capPeriodDays = 91", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "REACH",
      frequencyControl: { capFrequency: 2, capPeriodDays: 91 },
    });
    assert.ok(error);
  });
  test("rejects an unsupported optimization goal", () => {
    const { error } = schema.validate({
      ...validBody,
      optimizationGoal: "OFFSITE_CONVERSIONS",
    });
    assert.ok(error);
  });
});

group("OUTCOME_AWARENESS/STANDARD — Joi ad (linkUrl optional)", () => {
  const schema = buildAdSchemaV2("OUTCOME_AWARENESS", "STANDARD");
  const baseBody = {
    adAccountId: "act1",
    adSetId: "as1",
    pageId: "page_1",
    name: "Awareness ad",
    objective: "OUTCOME_AWARENESS",
    conversionLocation: "STANDARD",
    headline: "Brand recall",
    primaryText: "Remember our brand.",
    imageHash: "hash1",
    callToAction: "LEARN_MORE",
  };

  test("accepts a body WITHOUT linkUrl (pure brand campaign)", () => {
    const { error } = schema.validate(baseBody);
    assert.ok(!error, error && error.message);
  });
  test("accepts a body WITH a valid linkUrl", () => {
    const { error } = schema.validate({
      ...baseBody,
      linkUrl: "https://example.com/landing",
    });
    assert.ok(!error, error && error.message);
  });
  test("rejects a malformed linkUrl when provided", () => {
    const { error } = schema.validate({ ...baseBody, linkUrl: "not a url" });
    assert.ok(error);
  });
});

group("OUTCOME_AWARENESS/VIDEO_VIEWS — Joi ad (video-only lock)", () => {
  const schema = buildAdSchemaV2("OUTCOME_AWARENESS", "VIDEO_VIEWS");
  const validBody = {
    adAccountId: "act1",
    adSetId: "as1",
    pageId: "page_1",
    name: "Video views ad",
    objective: "OUTCOME_AWARENESS",
    conversionLocation: "VIDEO_VIEWS",
    headline: "Watch",
    primaryText: "Our story.",
    videoId: "video_1",
    callToAction: "WATCH_MORE",
  };

  test("accepts a video body", () => {
    const { error } = schema.validate(validBody);
    assert.ok(!error, error && error.message);
  });
  test("rejects an image-only body (mediaKind: video lock)", () => {
    const imageBody = { ...validBody };
    delete imageBody.videoId;
    imageBody.imageHash = "hash1";
    const { error } = schema.validate(imageBody);
    assert.ok(error);
  });
});

group("OUTCOME_AWARENESS — reverse-inference via optimization_goal", () => {
  const campaign = { objective: "OUTCOME_AWARENESS" };

  test("REACH goal resolves to STANDARD cell", () => {
    const out = inferCellForMetaCampaign(campaign, { optimization_goal: "REACH" });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "STANDARD");
  });
  test("IMPRESSIONS goal resolves to STANDARD cell", () => {
    const out = inferCellForMetaCampaign(campaign, { optimization_goal: "IMPRESSIONS" });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "STANDARD");
  });
  test("AD_RECALL_LIFT goal resolves to STANDARD cell", () => {
    const out = inferCellForMetaCampaign(campaign, { optimization_goal: "AD_RECALL_LIFT" });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "STANDARD");
  });
  test("THRUPLAY goal resolves to VIDEO_VIEWS cell", () => {
    const out = inferCellForMetaCampaign(campaign, { optimization_goal: "THRUPLAY" });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "VIDEO_VIEWS");
  });
  test("TWO_SECOND_CONTINUOUS_VIDEO_VIEWS goal resolves to VIDEO_VIEWS cell", () => {
    const out = inferCellForMetaCampaign(campaign, {
      optimization_goal: "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS",
    });
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "VIDEO_VIEWS");
  });
  test("ad set with no destination_type and no optimization_goal falls back to STANDARD", () => {
    const out = inferCellForMetaCampaign(campaign, {});
    assert.ok(!out.error, out.error);
    assert.equal(out.conversionLocation, "STANDARD");
  });
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) {
    console.log(`  ${f.name}`);
    console.log(`    ${f.err.stack || f.err.message}`);
  }
  process.exit(1);
}
