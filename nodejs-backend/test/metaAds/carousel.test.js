/**
 * Carousel — Phase 1 (backend shape).
 *
 * Carousel is a MEDIA MODE on cells that already exist, not a new cell:
 * Meta's carousel is `link_data.child_attachments`, an array of 2-10 cards
 * inside the same creative shape a single-image ad uses. These tests pin the
 * three things that make that work — which cells may offer it, what the
 * payload looks like, and what the validator refuses.
 *
 * The failure mode worth guarding hardest is SILENT: if an ad-level
 * imageHash reaches Meta alongside child_attachments, Meta renders the single
 * image and ignores every card, with no error to debug.
 */

const assert = require("assert");

const { buildObjectStorySpec } = require("../../utils/objectStorySpec");
const { buildAdSchemaV2 } = require("../../Validations/meta.v2.validator");
const {
  CELLS,
  cellSupportsCarousel,
  CAROUSEL_MIN_CARDS,
  CAROUSEL_MAX_CARDS,
} = require("../../config/wizardSchema");

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${label}\n        ${err.message}`);
  }
}

const PAGE = "PAGE_ID";
const LINK = "https://example.com";

// A complete, valid single-image ad payload for the Traffic/Website cell —
// the baseline every carousel assertion below varies from.
const adPayload = (over = {}) => ({
  adAccountId: "1",
  adSetId: "2",
  pageId: "p",
  name: "Ad name",
  objective: "OUTCOME_TRAFFIC",
  conversionLocation: "WEBSITE",
  headline: "Headline",
  primaryText: "Primary text",
  linkUrl: LINK,
  ...over,
});

const trafficSchema = buildAdSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
const validate = (over) => trafficSchema.validate(adPayload(over));
const errMsg = (r) =>
  r.error && (r.error.details[0].context?.message || r.error.details[0].message);

console.log("\ncarousel eligibility");

// Eligibility is derived from the creative shape and declared once, rather
// than hand-added to each cell — otherwise the matrix doubles and drifts.
check("only link_data-family shapes are eligible", () => {
  for (const [objective, locations] of Object.entries(CELLS)) {
    for (const [location, cell] of Object.entries(locations)) {
      const shape = cell.ad.objectStorySpecShape;
      const eligible = cellSupportsCarousel(cell);
      const shapeAllows = shape === "link_data" || shape === "pixel_website";
      if (eligible) {
        assert.ok(
          shapeAllows,
          `${objective}/${location} (${shape}) must not be carousel-eligible`,
        );
      }
    }
  }
});

// Their lock exists because Meta rejects image creatives on ThruPlay-optimised
// ad sets (subcode 1815869); a mixed-media carousel would reintroduce it.
check("video-only cells are never eligible", () => {
  for (const locations of Object.values(CELLS)) {
    for (const cell of Object.values(locations)) {
      if (cell.ad.mediaKind === "video") {
        assert.strictEqual(cellSupportsCarousel(cell), false);
      }
    }
  }
});

check("Sales/CATALOG is excluded — it already renders a carousel itself", () => {
  assert.strictEqual(cellSupportsCarousel(CELLS.OUTCOME_SALES.CATALOG), false);
});

check("a cell can opt out explicitly", () => {
  const cell = {
    ad: { objectStorySpecShape: "link_data", carousel: false },
  };
  assert.strictEqual(cellSupportsCarousel(cell), false);
});

check("at least one cell per eligible shape is actually offered", () => {
  const eligible = [];
  for (const locations of Object.values(CELLS)) {
    for (const cell of Object.values(locations)) {
      if (cellSupportsCarousel(cell)) eligible.push(cell.ad.objectStorySpecShape);
    }
  }
  assert.ok(eligible.length > 0, "no cell offers carousel — eligibility broke");
  assert.ok(eligible.includes("link_data"));
});

console.log("\nchild_attachments payload");

const cards = [
  { imageHash: "h1", headline: "Card one", description: "First", link: `${LINK}/1` },
  { imageHash: "h2", headline: "Card two" },
];

check("cards become child_attachments inside link_data", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    primaryText: "Shared copy",
    cards,
  });
  assert.strictEqual(spec.page_id, PAGE);
  assert.ok(spec.link_data, "carousel must live in link_data");
  assert.strictEqual(spec.link_data.child_attachments.length, 2);
  assert.strictEqual(spec.link_data.message, "Shared copy");
});

// Per-card values fall back to the ad-level ones — that fallback is what lets
// the wizard offer "same link on every card" without repeating it N times.
check("a card without its own link inherits the ad-level link", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    cards,
  });
  const [first, second] = spec.link_data.child_attachments;
  assert.strictEqual(first.link, `${LINK}/1`);
  assert.strictEqual(second.link, LINK);
});

check("a card without its own CTA inherits the ad-level CTA", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    callToAction: "SHOP_NOW",
    cards,
  });
  for (const att of spec.link_data.child_attachments) {
    assert.strictEqual(att.call_to_action.type, "SHOP_NOW");
    assert.strictEqual(att.call_to_action.value.link, att.link);
  }
});

check("NO_BUTTON emits no call_to_action", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    callToAction: "NO_BUTTON",
    cards,
  });
  for (const att of spec.link_data.child_attachments) {
    assert.strictEqual(att.call_to_action, undefined);
  }
});

// Unlike the single-media path, a video card inside child_attachments still
// uses name/description — NOT title/link_description.
check("a video card uses name, not title", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    cards: [
      { videoId: "v1", headline: "Video card", videoThumbnailUrl: "https://cdn/x.jpg" },
      { imageHash: "h2" },
    ],
  });
  const [video] = spec.link_data.child_attachments;
  assert.strictEqual(video.video_id, "v1");
  assert.strictEqual(video.name, "Video card");
  assert.strictEqual(video.image_url, "https://cdn/x.jpg");
  assert.strictEqual(video.title, undefined);
});

// A carousel of videos is still link_data — child_attachments has no
// video_data equivalent, and resolving to video_data would drop every card.
check("an all-video carousel still emits link_data", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    cards: [{ videoId: "v1" }, { videoId: "v2" }],
  });
  assert.ok(spec.link_data);
  assert.strictEqual(spec.video_data, undefined);
});

check("pixel_website cells produce carousels too", () => {
  const spec = buildObjectStorySpec("pixel_website", {
    pageId: PAGE,
    linkUrl: LINK,
    cards,
  });
  assert.strictEqual(spec.link_data.child_attachments.length, 2);
});

check("multi-share flags are only emitted when they differ from Meta's default", () => {
  const plain = buildObjectStorySpec("link_data", { pageId: PAGE, linkUrl: LINK, cards });
  assert.strictEqual(plain.link_data.multi_share_optimized, undefined);
  assert.strictEqual(plain.link_data.multi_share_end_card, undefined);

  const tuned = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    cards,
    multiShareOptimized: true,
    multiShareEndCard: false,
  });
  assert.strictEqual(tuned.link_data.multi_share_optimized, true);
  assert.strictEqual(tuned.link_data.multi_share_end_card, false);
});

// THE silent failure: Meta renders the single image and ignores every card.
check("ad-level media alongside cards is rejected, not silently dropped", () => {
  assert.throws(
    () =>
      buildObjectStorySpec("link_data", {
        pageId: PAGE,
        linkUrl: LINK,
        imageHash: "x",
        cards,
      }),
    /carousel media lives on each card/i,
  );
});

check("a card with no media is rejected with its index", () => {
  assert.throws(
    () =>
      buildObjectStorySpec("link_data", {
        pageId: PAGE,
        linkUrl: LINK,
        cards: [{ imageHash: "h1" }, {}],
      }),
    /child_attachments\[1\]/,
  );
});

console.log("\nread-back contract (what edit mode has to recover)");

// This is the fact that broke edit mode: on a carousel, link_data carries
// `message` and `link` but NOT name / description / call_to_action — Meta keeps
// those per card. resolveAdForEdit therefore falls back to card 1 for the
// ad-level Headline / Description / CTA fields, all of which are required or
// user-visible in the edit form. If a future change starts emitting them at the
// top level, this test fails and the fallback should be revisited.
check("a carousel emits no ad-level name / description / call_to_action", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    primaryText: "Shared copy",
    headline: "Ad level headline",
    description: "Ad level description",
    callToAction: "SHOP_NOW",
    cards,
  });
  const data = spec.link_data;
  assert.strictEqual(data.name, undefined, "carousel must not set link_data.name");
  assert.strictEqual(data.description, undefined, "carousel must not set link_data.description");
  assert.strictEqual(
    data.call_to_action,
    undefined,
    "carousel must not set link_data.call_to_action",
  );
  // What it DOES carry, and what edit mode reads directly.
  assert.strictEqual(data.message, "Shared copy");
  assert.strictEqual(data.link, LINK);
});

check("card 1 carries the values edit mode falls back to", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    callToAction: "SHOP_NOW",
    cards,
  });
  const [first] = spec.link_data.child_attachments;
  assert.strictEqual(first.name, "Card one");
  assert.strictEqual(first.description, "First");
  assert.strictEqual(first.call_to_action.type, "SHOP_NOW");
  assert.ok(first.link, "card link is what linkUrl falls back to");
});

console.log("\nsingle-media regression");

// Carousel must not have changed the path every existing cell uses.
check("a single-image ad is unchanged", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    imageHash: "hash",
    headline: "H",
    primaryText: "P",
    description: "D",
  });
  assert.strictEqual(spec.link_data.image_hash, "hash");
  assert.strictEqual(spec.link_data.name, "H");
  assert.strictEqual(spec.link_data.description, "D");
  assert.strictEqual(spec.link_data.child_attachments, undefined);
});

check("a single-video ad still emits video_data", () => {
  const spec = buildObjectStorySpec("link_data", {
    pageId: PAGE,
    linkUrl: LINK,
    videoId: "v1",
    headline: "H",
  });
  assert.ok(spec.video_data);
  assert.strictEqual(spec.video_data.title, "H");
});

check("supplying neither media nor cards still throws", () => {
  assert.throws(
    () => buildObjectStorySpec("link_data", { pageId: PAGE, linkUrl: LINK }),
    /exactly one of imageHash or videoId/,
  );
});

console.log("\nvalidator");

check("a two-card carousel validates", () => {
  const r = validate({ cards: [{ imageHash: "a" }, { imageHash: "b" }] });
  assert.ok(!r.error, errMsg(r));
  assert.strictEqual(r.value.cards.length, 2);
});

check(`fewer than ${CAROUSEL_MIN_CARDS} cards is rejected`, () => {
  const r = validate({ cards: [{ imageHash: "a" }] });
  assert.ok(r.error);
  assert.match(errMsg(r), /at least 2 cards/);
});

check(`more than ${CAROUSEL_MAX_CARDS} cards is rejected`, () => {
  const r = validate({
    cards: Array.from({ length: CAROUSEL_MAX_CARDS + 1 }, () => ({ imageHash: "a" })),
  });
  assert.ok(r.error);
  assert.match(errMsg(r), /at most 10 cards/);
});

check("a card with both or neither media is rejected", () => {
  const both = validate({ cards: [{ imageHash: "a", videoId: "v" }, { imageHash: "b" }] });
  assert.ok(both.error);
  assert.match(errMsg(both), /exactly one of imageHash or videoId/);

  const neither = validate({ cards: [{}, { imageHash: "b" }] });
  assert.ok(neither.error);
});

check("ad-level media alongside cards is rejected", () => {
  const r = validate({ imageHash: "x", cards: [{ imageHash: "a" }, { imageHash: "b" }] });
  assert.ok(r.error);
  assert.match(errMsg(r), /lives on each card/);
});

// Requiring ad-level copy the payload builder discards made the wizard collect
// a headline, throw it away, and then have nothing to show on edit.
check("ad-level headline is NOT required on a carousel", () => {
  const r = validate({ headline: "", cards: [{ imageHash: "a" }, { imageHash: "b" }] });
  assert.ok(!r.error, errMsg(r));
});

check("ad-level headline IS still required without cards", () => {
  const r = validate({ headline: "", imageHash: "x" });
  assert.ok(r.error);
  assert.match(errMsg(r), /Headline is required/);
});

check("a single-image ad still validates with no cards", () => {
  const r = validate({ imageHash: "x" });
  assert.ok(!r.error, errMsg(r));
});

// Sending cards to a cell whose builder would drop them must fail loudly.
check("cards are forbidden on every ineligible cell", () => {
  let checked = 0;
  for (const [objective, locations] of Object.entries(CELLS)) {
    for (const [location, cell] of Object.entries(locations)) {
      if (cellSupportsCarousel(cell)) continue;
      const schema = buildAdSchemaV2(objective, location);
      const r = schema.validate(
        {
          adAccountId: "1",
          adSetId: "2",
          pageId: "p",
          name: "Ad",
          objective,
          conversionLocation: location,
          headline: "H",
          primaryText: "P",
          description: "D",
          linkUrl: LINK,
          leadFormId: "f1",
          objectStoreUrl: "https://apps.apple.com/app/id1",
          applicationId: "123",
          ...(cell.ad.objectStorySpecShape === "template_data" ? {} : { imageHash: "x" }),
          cards: [{ imageHash: "a" }, { imageHash: "b" }],
        },
        { abortEarly: false },
      );
      const cardsError = (r.error?.details || []).find(
        (d) => String(d.path[0]) === "cards",
      );
      assert.ok(
        cardsError,
        `${objective}/${location} (${cell.ad.objectStorySpecShape}) accepted cards`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no ineligible cells were exercised");
});

check("multi-share flags are forbidden on ineligible cells", () => {
  const r = buildAdSchemaV2("OUTCOME_SALES", "CATALOG").validate(
    {
      adAccountId: "1",
      adSetId: "2",
      pageId: "p",
      name: "Ad",
      objective: "OUTCOME_SALES",
      conversionLocation: "CATALOG",
      headline: "H",
      primaryText: "P",
      linkUrl: LINK,
      multiShareOptimized: true,
    },
    { abortEarly: false },
  );
  const err = (r.error?.details || []).find(
    (d) => String(d.path[0]) === "multiShareOptimized",
  );
  assert.ok(err, "multiShareOptimized must be forbidden on Sales/CATALOG");
});

console.log("\nserialised contract (what the wizard receives)");

const { toJSON } = require("../../config/wizardSchema");
const wizardJson = toJSON();

// The frontend must NOT re-derive eligibility from the shape list — two copies
// of that rule would drift. It reads `supportsCarousel` off the cell instead.
check("every serialised cell carries supportsCarousel", () => {
  for (const [objective, group] of Object.entries(wizardJson.objectives)) {
    for (const [location, cell] of Object.entries(group.conversionLocations)) {
      assert.strictEqual(
        typeof cell.supportsCarousel,
        "boolean",
        `${objective}/${location} is missing supportsCarousel`,
      );
    }
  }
});

check("serialised eligibility matches cellSupportsCarousel exactly", () => {
  for (const [objective, group] of Object.entries(wizardJson.objectives)) {
    for (const [location, serialised] of Object.entries(group.conversionLocations)) {
      assert.strictEqual(
        serialised.supportsCarousel,
        cellSupportsCarousel(CELLS[objective][location]),
        `${objective}/${location} serialised eligibility diverged`,
      );
    }
  }
});

// The card editor enforces these bounds client-side; shipping them keeps the
// UI and the Joi schema on one set of numbers.
check("card limits are shipped to the wizard", () => {
  assert.deepStrictEqual(wizardJson.carouselCardLimits, {
    min: CAROUSEL_MIN_CARDS,
    max: CAROUSEL_MAX_CARDS,
  });
});

console.log(
  failures === 0
    ? "\ncarousel: all checks passed\n"
    : `\ncarousel: ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
