#!/usr/bin/env node
/**
 * Sanity tests for `config/wizardSchema.js`. Run with:
 *
 *   node test/metaAds/wizardSchema.test.js
 *
 * No test framework — mirrors the project's existing autopilot tests
 * (see `test/autopilot/auditRules.test.js`). The script exits non-zero
 * on failure and prints a PASS/FAIL summary.
 *
 * These tests assert *internal consistency* of the schema only — that
 * every cell references labels that exist, defaults that are in their
 * allowed lists, etc. They do not validate against Meta's API; that
 * happens implicitly the first time a campaign launches in QA.
 */

const assert = require("node:assert/strict");

const schema = require("../../config/wizardSchema");
const {
  CELLS,
  OBJECTIVE_LABELS,
  CONVERSION_LOCATION_LABELS,
  OPTIMIZATION_GOAL_LABELS,
  BILLING_EVENT_LABELS,
  CTA_LABELS,
  listObjectives,
  listConversionLocations,
  getCell,
  isCellImplemented,
  getMetaDestinationType,
  getAllowedCtas,
  getAllowedOptimizationGoals,
  toJSON,
} = schema;

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

// ─── Catalogs are populated ─────────────────────────────────────────────────

group("catalogs", () => {
  test("OBJECTIVE_LABELS covers every objective in CELLS", () => {
    for (const objective of Object.keys(CELLS)) {
      assert.ok(
        OBJECTIVE_LABELS[objective],
        `missing OBJECTIVE_LABELS entry for ${objective}`,
      );
    }
  });

  test("CONVERSION_LOCATION_LABELS covers every location referenced by any cell", () => {
    for (const [objective, locations] of Object.entries(CELLS)) {
      for (const loc of Object.keys(locations)) {
        assert.ok(
          CONVERSION_LOCATION_LABELS[loc],
          `missing CONVERSION_LOCATION_LABELS entry for ${loc} (used by ${objective})`,
        );
      }
    }
  });

  test("getMetaDestinationType resolves every cell to null or a valid enum string", () => {
    for (const [objective, locations] of Object.entries(CELLS)) {
      for (const loc of Object.keys(locations)) {
        const dt = getMetaDestinationType(objective, loc);
        // null = intentionally omitted (Meta infers). Otherwise it must
        // be a non-empty SCREAMING_SNAKE string.
        assert.ok(
          dt === null || (typeof dt === "string" && /^[A-Z_]+$/.test(dt)),
          `${objective}/${loc}: destination_type must be null or an enum string, got ${JSON.stringify(dt)}`,
        );
      }
    }
  });
});

// ─── Every objective has at least one cell ──────────────────────────────────

group("objective coverage", () => {
  test("every objective has at least one conversion location", () => {
    for (const objective of Object.keys(CELLS)) {
      const locations = Object.keys(CELLS[objective]);
      assert.ok(
        locations.length > 0,
        `${objective} has no conversion locations`,
      );
    }
  });

  test("the 3 priority objectives are present", () => {
    for (const objective of [
      "OUTCOME_TRAFFIC",
      "OUTCOME_LEADS",
      "OUTCOME_APP_PROMOTION",
    ]) {
      assert.ok(
        CELLS[objective],
        `expected ${objective} to be in CELLS`,
      );
    }
  });
});

// ─── Every non-placeholder cell is internally consistent ────────────────────

group("non-placeholder cell consistency", () => {
  for (const [objective, locations] of Object.entries(CELLS)) {
    for (const [loc, cell] of Object.entries(locations)) {
      if (cell.placeholder) continue;

      const ctx = `${objective} / ${loc}`;

      test(`${ctx}: has adSet block`, () => {
        assert.ok(cell.adSet, "missing adSet block");
        assert.ok(Array.isArray(cell.adSet.optimizationGoals), "optimizationGoals must be array");
        assert.ok(cell.adSet.optimizationGoals.length > 0, "optimizationGoals must be non-empty");
        assert.ok(Array.isArray(cell.adSet.billingEvents), "billingEvents must be array");
        assert.ok(cell.adSet.billingEvents.length > 0, "billingEvents must be non-empty");
      });

      test(`${ctx}: defaultOptimizationGoal is in allowed list`, () => {
        assert.ok(
          cell.adSet.optimizationGoals.includes(cell.adSet.defaultOptimizationGoal),
          `default ${cell.adSet.defaultOptimizationGoal} not in [${cell.adSet.optimizationGoals.join(", ")}]`,
        );
      });

      test(`${ctx}: defaultBillingEvent is in allowed list`, () => {
        assert.ok(
          cell.adSet.billingEvents.includes(cell.adSet.defaultBillingEvent),
          `default ${cell.adSet.defaultBillingEvent} not in [${cell.adSet.billingEvents.join(", ")}]`,
        );
      });

      test(`${ctx}: every optimizationGoal has a label`, () => {
        for (const g of cell.adSet.optimizationGoals) {
          assert.ok(
            OPTIMIZATION_GOAL_LABELS[g],
            `missing OPTIMIZATION_GOAL_LABELS entry for ${g}`,
          );
        }
      });

      test(`${ctx}: every billingEvent has a label`, () => {
        for (const b of cell.adSet.billingEvents) {
          assert.ok(
            BILLING_EVENT_LABELS[b],
            `missing BILLING_EVENT_LABELS entry for ${b}`,
          );
        }
      });

      test(`${ctx}: has ad block with required + optional + objectStorySpecShape`, () => {
        assert.ok(cell.ad, "missing ad block");
        assert.ok(Array.isArray(cell.ad.requiredFields), "requiredFields must be array");
        assert.ok(Array.isArray(cell.ad.optionalFields), "optionalFields must be array");
        assert.ok(
          typeof cell.ad.objectStorySpecShape === "string" && cell.ad.objectStorySpecShape.length > 0,
          "objectStorySpecShape must be non-empty string",
        );
      });

      test(`${ctx}: media-source contract is consistent with objectStorySpecShape`, () => {
        // Cells without a mediaKind lock accept either, and require image
        // by default (image is the common case — the wizard UI tabs to
        // video on demand). Cells with `mediaKind: 'video'` (e.g.
        // OUTCOME_ENGAGEMENT/VIDEO_VIEWS) require videoId instead, and
        // the validator + AdStep enforce that the user can't supply an
        // image. Either contract is acceptable here; what's not OK is a
        // cell that requires neither.
        //
        // Sales/CATALOG (template_data shape) is the exception — images
        // come from the catalog feed per product, so neither imageHash
        // nor videoId is in requiredFields. The Joi factory rejects
        // EITHER field if supplied. Skip the image-or-video assertion;
        // the alternative contract is "catalog provides media".
        const req = cell.ad.requiredFields;
        const hasImageHash = req.includes("imageHash");
        const hasVideoId = req.includes("videoId");
        if (cell.ad.objectStorySpecShape === "template_data") {
          assert.ok(
            !hasImageHash && !hasVideoId,
            "template_data cells must NOT require imageHash or videoId (catalog provides images)",
          );
          return;
        }
        assert.ok(
          hasImageHash || hasVideoId,
          "every cell must require either imageHash or videoId",
        );
        if (cell.ad.mediaKind === "video") {
          assert.ok(
            hasVideoId && !hasImageHash,
            "mediaKind='video' cells must require videoId and NOT imageHash",
          );
        }
        if (cell.ad.mediaKind === "image") {
          assert.ok(
            hasImageHash && !hasVideoId,
            "mediaKind='image' cells must require imageHash and NOT videoId",
          );
        }
      });

      test(`${ctx}: has ctas block with allowed + default`, () => {
        assert.ok(cell.ctas, "missing ctas block");
        assert.ok(Array.isArray(cell.ctas.allowed) && cell.ctas.allowed.length > 0, "ctas.allowed must be non-empty array");
        assert.ok(
          cell.ctas.allowed.includes(cell.ctas.default),
          `default CTA ${cell.ctas.default} not in [${cell.ctas.allowed.join(", ")}]`,
        );
      });

      test(`${ctx}: every CTA has a label`, () => {
        for (const c of cell.ctas.allowed) {
          assert.ok(
            CTA_LABELS[c],
            `missing CTA_LABELS entry for ${c}`,
          );
        }
      });

      test(`${ctx}: identity.required includes at least "page"`, () => {
        assert.ok(
          Array.isArray(cell.identity?.required) && cell.identity.required.includes("page"),
          "every cell must require a Page identity",
        );
      });

      test(`${ctx}: additionalSteps is an array`, () => {
        assert.ok(Array.isArray(cell.additionalSteps), "additionalSteps must be array (use [] for none)");
      });

      test(`${ctx}: notes is a non-empty string`, () => {
        assert.ok(
          typeof cell.notes === "string" && cell.notes.length > 0,
          "notes is surfaced in wizard tooltips — must be non-empty",
        );
      });
    }
  }
});

// ─── CTA_LABELS keys must be real Meta call_to_action enum values ──────────
//
// Real hit (2026-07-08, trace LX-B76D5CE2): "GET_DETAILS" was a made-up key
// (whoever wrote CTA_LABELS used the display LABEL's wording — "See
// details" — as the key, instead of Meta's actual API constant, which is
// `SEE_DETAILS`). It shipped with a correct label, was internally
// consistent everywhere it was used, and passed the "every CTA has a
// label" test above forever — because that test only checks
// self-consistency (does the label map have SOME entry for this key), not
// ground truth (is this key a value Meta's API actually accepts). Cross-
// checking every CTA_LABELS key the same day found a SECOND instance of
// the identical mistake: "VIEW_MENU" (real value: `SEE_MENU`).
//
// META_VALID_CTAS below is Meta's own enumeration of every value it
// accepts for `call_to_action[type]`, copied VERBATIM from a live 400
// response body (not hand-typed, not from docs) — see the trace above.
// This is the single most authoritative source available: it's Meta's
// actual validation code talking, for the exact field this schema feeds.
group("CTA_LABELS keys are real Meta call_to_action enum values", () => {
  const META_VALID_CTAS = new Set([
    "BOOK_TRAVEL", "CONTACT_US", "DONATE", "DONATE_NOW", "DOWNLOAD",
    "GET_DIRECTIONS", "GO_LIVE", "INTERESTED", "LEARN_MORE", "SEE_DETAILS",
    "LIKE_PAGE", "MESSAGE_PAGE", "RAISE_MONEY", "SAVE", "SEND_TIP",
    "SHOP_NOW", "SIGN_UP", "VIEW_INSTAGRAM_PROFILE", "INSTAGRAM_MESSAGE",
    "LOYALTY_LEARN_MORE", "PURCHASE_GIFT_CARDS", "PAY_TO_ACCESS", "SEE_MORE",
    "TRY_IN_CAMERA", "WHATSAPP_LINK", "GET_IN_TOUCH", "TRY_NOW",
    "ASK_A_QUESTION", "START_A_CHAT", "CHAT_NOW", "ASK_US", "CHAT_WITH_US",
    "BOOK_NOW", "CHECK_AVAILABILITY", "ORDER_NOW", "WHATSAPP_MESSAGE",
    "GET_MOBILE_APP", "INSTALL_MOBILE_APP", "USE_MOBILE_APP", "INSTALL_APP",
    "USE_APP", "PLAY_GAME", "TRY_DEMO", "WATCH_VIDEO", "WATCH_MORE",
    "OPEN_LINK", "NO_BUTTON", "LISTEN_MUSIC", "MOBILE_DOWNLOAD", "GET_OFFER",
    "GET_OFFER_VIEW", "BUY_NOW", "BUY_TICKETS", "UPDATE_APP", "BET_NOW",
    "ADD_TO_CART", "SELL_NOW", "GET_SHOWTIMES", "LISTEN_NOW",
    "GET_EVENT_TICKETS", "REMIND_ME", "SEARCH_MORE", "PRE_REGISTER",
    "SWIPE_UP_PRODUCT", "SWIPE_UP_SHOP", "PLAY_GAME_ON_FACEBOOK",
    "VISIT_WORLD", "OPEN_INSTANT_APP", "JOIN_GROUP", "GET_PROMOTIONS",
    "SEND_UPDATES", "INQUIRE_NOW", "VISIT_PROFILE", "CHAT_ON_WHATSAPP",
    "EXPLORE_MORE", "CONFIRM", "JOIN_CHANNEL", "MAKE_AN_APPOINTMENT",
    "ASK_ABOUT_SERVICES", "BOOK_A_CONSULTATION", "GET_A_QUOTE",
    "BUY_VIA_MESSAGE", "ASK_FOR_MORE_INFO", "VIEW_PRODUCT", "VIEW_CHANNEL",
    "WATCH_LIVE_VIDEO", "JOIN_LIVE_VIDEO", "IMAGINE", "CALL", "MISSED_CALL",
    "CALL_NOW", "CALL_ME", "APPLY_NOW", "BUY", "GET_QUOTE", "SUBSCRIBE",
    "RECORD_NOW", "VOTE_NOW", "GIVE_FREE_RIDES", "REGISTER_NOW",
    "OPEN_MESSENGER_EXT", "EVENT_RSVP", "CIVIC_ACTION", "SEND_INVITES",
    "REFER_FRIENDS", "REQUEST_TIME", "SEE_MENU", "SEARCH", "TRY_IT",
    "TRY_ON", "LINK_CARD", "DIAL_CODE", "FIND_YOUR_GROUPS", "START_ORDER",
  ]);

  for (const key of Object.keys(CTA_LABELS)) {
    test(`CTA_LABELS key "${key}" is a real Meta enum value`, () => {
      assert.ok(
        META_VALID_CTAS.has(key),
        `"${key}" is not in Meta's documented call_to_action enum — likely a ` +
          `made-up key (check whether the LABEL text was used as the key by ` +
          `mistake, as happened with GET_DETAILS→SEE_DETAILS and ` +
          `VIEW_MENU→SEE_MENU). If Meta genuinely added a new CTA this list ` +
          `doesn't know about yet, add it to META_VALID_CTAS above with a ` +
          `note on where it was confirmed.`,
      );
    });
  }
});

// ─── Cell implementation status ─────────────────────────────────────────────

group("cell implementation status", () => {
  test("isCellImplemented returns true for every cell in this MVP", () => {
    // After App Promotion landed (Phase 0 follow-up from screenshots),
    // every cell in CELLS is fully implemented. If a future cell is
    // added as a placeholder, add a negative-case test alongside it.
    for (const [objective, locations] of Object.entries(CELLS)) {
      for (const loc of Object.keys(locations)) {
        assert.equal(
          isCellImplemented(objective, loc),
          true,
          `${objective}/${loc} should be implemented`,
        );
      }
    }
  });
});

// ─── App Promotion invariants ───────────────────────────────────────────────
// App Promotion runs without MMP, so the optimisation-goal list is
// restricted to APP_INSTALLS. These tests guard that restriction +
// the cell's shape decisions.

group("App Promotion", () => {
  const cell = CELLS.OUTCOME_APP_PROMOTION.APP;

  test("optimizationGoals is exactly [APP_INSTALLS]", () => {
    // Without MMP, OFFSITE_CONVERSIONS (in-app events) and VALUE both
    // depend on the MMP forwarding post-install events back to Meta;
    // exposing them would let users pick goals that never optimise.
    // Re-enable by appending to this array when MMP is integrated.
    assert.deepEqual(cell.adSet.optimizationGoals, ["APP_INSTALLS"]);
  });

  test("App Promotion uses the 'app' promoted_object shape", () => {
    assert.equal(cell.adSet.promotedObjectShape, "app");
  });

  test("App Promotion uses the 'app_link' object_story_spec shape", () => {
    assert.equal(cell.ad.objectStorySpecShape, "app_link");
  });

  test("App Promotion requires a linkedApp identity, not just a page", () => {
    assert.ok(
      cell.identity.required.includes("linkedApp"),
      "App Promotion must require linkedApp in addition to page",
    );
  });

  test("App Promotion exposes mobileAppStore + applicationId on the adSet", () => {
    assert.ok(
      Array.isArray(cell.adSet.additionalFields),
      "additionalFields must be array",
    );
    assert.ok(cell.adSet.additionalFields.includes("mobileAppStore"));
    assert.ok(cell.adSet.additionalFields.includes("applicationId"));
  });
});

// ─── Lead-form-specific invariants ──────────────────────────────────────────
// These guard the Phase-3 contract: any cell that uses the lead_gen_form
// object_story_spec MUST require `leadFormId` and MUST insert the
// "leadForm" wizard step. Drift here will produce ads with missing form
// bindings, which Meta accepts at the SDK call but renders unfillable.

group("lead form invariants", () => {
  test("any lead_gen_form cell requires leadFormId", () => {
    for (const [objective, locations] of Object.entries(CELLS)) {
      for (const [loc, cell] of Object.entries(locations)) {
        if (cell.placeholder) continue;
        if (cell.ad?.objectStorySpecShape === "lead_gen_form") {
          assert.ok(
            cell.ad.requiredFields.includes("leadFormId"),
            `${objective}/${loc} uses lead_gen_form but does not require leadFormId`,
          );
          assert.ok(
            cell.additionalSteps.includes("leadForm"),
            `${objective}/${loc} uses lead_gen_form but does not insert the leadForm wizard step`,
          );
        }
      }
    }
  });
});

// ─── Accessors ──────────────────────────────────────────────────────────────

group("accessors", () => {
  test("listObjectives returns the keys of CELLS", () => {
    assert.deepEqual(listObjectives().sort(), Object.keys(CELLS).sort());
  });

  test("listConversionLocations returns the Traffic locations (Meta-aligned)", () => {
    // Traffic was rebuilt to match Meta's 6 conversion locations.
    // MESSENGER + WHATSAPP standalone cells folded into MESSAGE_DESTINATIONS;
    // PHONE_CALL renamed to CALLS.
    const locs = listConversionLocations("OUTCOME_TRAFFIC");
    assert.ok(locs.includes("WEBSITE"));
    assert.ok(locs.includes("APP"));
    assert.ok(locs.includes("MESSAGE_DESTINATIONS"));
    assert.ok(locs.includes("INSTAGRAM_OR_FACEBOOK"));
    assert.ok(locs.includes("CALLS"));
    assert.ok(locs.includes("WEBSITE_AND_CALLS"));
  });

  test("listConversionLocations returns [] for unknown objective", () => {
    assert.deepEqual(listConversionLocations("OUTCOME_FAKE"), []);
  });

  test("getCell returns the cell for valid (objective, location)", () => {
    const cell = getCell("OUTCOME_TRAFFIC", "WEBSITE");
    assert.ok(cell.adSet);
    assert.ok(cell.ad);
  });

  test("getCell throws for unknown (objective, location)", () => {
    assert.throws(
      () => getCell("OUTCOME_FAKE", "NOWHERE"),
      /no cell for/,
    );
  });

  test("getMetaDestinationType returns the Meta enum value per (objective, location)", () => {
    assert.equal(getMetaDestinationType("OUTCOME_TRAFFIC", "WEBSITE"), "WEBSITE");
    assert.equal(getMetaDestinationType("OUTCOME_LEADS", "INSTANT_FORM"), "ON_AD");
    assert.equal(getMetaDestinationType("OUTCOME_LEADS", "CALLS"), "PHONE_CALL");
    assert.equal(getMetaDestinationType("OUTCOME_APP_PROMOTION", "APP"), "APP");
  });

  test("getMetaDestinationType — Leads Multiple cells per creative shape", () => {
    // Website-link-carrying creatives omit destination_type so Meta
    // infers the multi-destination routing (non-null re-introduces the
    // "shows as Website" / subcode 1815676 bugs).
    assert.equal(getMetaDestinationType("OUTCOME_LEADS", "WEBSITE_AND_INSTANT_FORMS"), null);
    assert.equal(getMetaDestinationType("OUTCOME_LEADS", "WEBSITE_AND_CALLS"), null);
    // Instant-forms-and-Messenger uses the `lead_gen_form` shape — a
    // PURE lead-form creative (CTA value is form-id only, no link).
    // Meta allows that ONLY on destination_type=ON_AD (subcode 1892040
    // otherwise). It MUST be ON_AD — not omitted.
    assert.equal(getMetaDestinationType("OUTCOME_LEADS", "INSTANT_FORMS_AND_MESSENGER"), "ON_AD");
  });

  test("getMetaDestinationType — WEBSITE_AND_CALLS diverges by objective", () => {
    // Regression guard: the same conversion-location key needs DIFFERENT
    // destination_type per objective. Traffic keeps WEBSITE; Leads omits
    // it. A bare shared key silently broke one objective once.
    assert.equal(getMetaDestinationType("OUTCOME_TRAFFIC", "WEBSITE_AND_CALLS"), "WEBSITE");
    assert.equal(getMetaDestinationType("OUTCOME_LEADS", "WEBSITE_AND_CALLS"), null);
  });

  test("getAllowedCtas returns the allowed list for a cell", () => {
    const ctas = getAllowedCtas("OUTCOME_LEADS", "INSTANT_FORM");
    assert.ok(ctas.includes("SIGN_UP"));
    assert.ok(!ctas.includes("SHOP_NOW"), "Leads cells should not allow SHOP_NOW");
  });

  test("getAllowedCtas returns App-Promo-appropriate CTAs", () => {
    const ctas = getAllowedCtas("OUTCOME_APP_PROMOTION", "APP");
    assert.ok(ctas.includes("INSTALL_MOBILE_APP"));
    assert.ok(ctas.includes("USE_APP"));
    assert.ok(!ctas.includes("MESSAGE_PAGE"), "App Promotion should not allow MESSAGE_PAGE");
    assert.ok(!ctas.includes("CALL_NOW"), "App Promotion should not allow CALL_NOW");
  });

  test("getAllowedOptimizationGoals filters per cell", () => {
    const goals = getAllowedOptimizationGoals("OUTCOME_TRAFFIC", "WEBSITE");
    assert.ok(goals.includes("LINK_CLICKS"));
    assert.ok(!goals.includes("LEAD_GENERATION"), "Traffic/Website should not include LEAD_GENERATION");
  });
});

// ─── toJSON is round-trippable ──────────────────────────────────────────────
// The schema endpoint serves toJSON() to the frontend. Anything not
// JSON-safe here (Sets, Maps, Symbols, functions) would crash the
// renderer at fetch time. The round-trip catches that.

group("toJSON", () => {
  test("toJSON output is JSON.stringify-able and round-trippable", () => {
    const json = toJSON();
    const roundTripped = JSON.parse(JSON.stringify(json));
    assert.deepEqual(roundTripped, json);
  });

  test("toJSON includes every objective + every cell", () => {
    const json = toJSON();
    for (const [objective, locations] of Object.entries(CELLS)) {
      assert.ok(json.objectives[objective], `toJSON missing ${objective}`);
      for (const loc of Object.keys(locations)) {
        assert.ok(
          json.objectives[objective].conversionLocations[loc],
          `toJSON missing ${objective}/${loc}`,
        );
      }
    }
  });

  test("toJSON includes the label catalogs", () => {
    const json = toJSON();
    assert.ok(json.labels.objective);
    assert.ok(json.labels.conversionLocation);
    assert.ok(json.labels.optimizationGoal);
    assert.ok(json.labels.billingEvent);
    assert.ok(json.labels.cta);
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
