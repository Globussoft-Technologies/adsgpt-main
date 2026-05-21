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
  buildAdSetSchemaV2,
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
      objective: "OUTCOME_SALES",
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
  }
  return body;
}

// A valid create-ad body for a cell — base + required copy/destination
// fields + app fields when the shape needs them.
function adBody(objective, conversionLocation, cell) {
  const req = new Set(cell.ad.requiredFields);
  const body = {
    adAccountId: "act1",
    adSetId: "adset1",
    pageId: "page_1",
    name: "Test ad",
    objective,
    conversionLocation,
    imageHash: "hash_abc",
    headline: "Test headline",
    primaryText: "Test primary text",
    description: "Test description",
    callToAction: cell.ctas.default,
  };
  if (req.has("linkUrl") || cell.ad.optionalFields.includes("linkUrl")) {
    body.linkUrl = "https://example.com/landing";
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
        });
        // `page` / `app` / `pixel` shapes return an object; `null` shape
        // returns undefined (field omitted on the AdSet). Both are valid.
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
