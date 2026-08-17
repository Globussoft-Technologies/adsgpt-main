#!/usr/bin/env node
/**
 * Tests for services/adFactory/briefGenerationView.js — the read side of
 * "generation rides the campaign pipeline".
 *
 * The interesting cases are all consequences of `campaign.results` being
 * append-only across runs with pre-pushed empty slots. Every assertion here
 * corresponds to a way a naive read gets it wrong:
 *
 *   • showing last week's ads next to this run's
 *   • rendering pending slots as broken cards
 *   • reporting a successful run as failed because a placeholder sat at the tail
 *
 * Run:  node test/adFactory/briefGenerationView.test.js
 */

const assert = require("node:assert/strict");

const { briefGenerationView } = require("../../services/adFactory/briefGenerationView");

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const img = (n) => ({ status: 200, data: `/creatives/${n}.png`, prompt: `prompt ${n}` });
const txt = (n) => ({ status: 200, data: { headline: `Headline ${n}`, primaryText: `Body ${n}` } });
const pendingSlot = () => ({});
const failedSlot = (msg = "generation failed") => ({ status: 500, error: msg });

const campaign = (results, quantity = 3) => ({
  status: "success",
  services: {
    servicesSelected: [
      { serviceName: "image", serviceParams: { quantity, model: "google" } },
      { serviceName: "text", serviceParams: { quantity, model: "auto" } },
    ],
  },
  results: { status: "success", ...results },
});

// ─── ─────────────────────────────────────────────────────────────────────────

group("a fresh single run", () => {
  const v = briefGenerationView(
    campaign({ image: [img(1), img(2), img(3)], text: [txt(1), txt(2), txt(3)] }),
  );

  test("all three pairs are returned", () => {
    assert.equal(v.pairs.length, 3);
  });

  test("image and copy are paired by index, as they are when posted", () => {
    assert.equal(v.pairs[0].imageUrl, "/creatives/1.png");
    assert.equal(v.pairs[0].copy.headline, "Headline 1");
    assert.equal(v.pairs[2].copy.primaryText, "Body 3");
  });

  test("status is success", () => {
    assert.equal(v.status, "success");
    assert.equal(v.failed, 0);
    assert.equal(v.pending, 0);
  });
});

group("THE TRAP: arrays accumulate across runs", () => {
  // Three cycles have run. Only the last three entries are this run's.
  const threeCycles = {
    image: [img(1), img(2), img(3), img(4), img(5), img(6), img(7), img(8), img(9)],
    text: [txt(1), txt(2), txt(3), txt(4), txt(5), txt(6), txt(7), txt(8), txt(9)],
  };
  const v = briefGenerationView(campaign(threeCycles));

  test("only the latest run is shown, not every ad ever made", () => {
    assert.equal(v.pairs.length, 3);
    assert.deepEqual(
      v.pairs.map((p) => p.imageUrl),
      ["/creatives/7.png", "/creatives/8.png", "/creatives/9.png"],
    );
  });

  test("the limit follows the campaign's own requested quantity", () => {
    const five = briefGenerationView(campaign(threeCycles, 5));
    assert.equal(five.pairs.length, 5);
    assert.equal(five.requested, 5);
  });

  test("an explicit limit wins over the campaign's", () => {
    assert.equal(briefGenerationView(campaign(threeCycles), { limit: 2 }).pairs.length, 2);
  });
});

group("THE TRAP: filter before slicing, never after", () => {
  // A stale placeholder sits at the tail after two real results. Slicing the
  // unfiltered array would take [img(2), placeholder] and report a failure.
  const v = briefGenerationView(
    campaign({ image: [img(1), img(2), pendingSlot()], text: [txt(1), txt(2), pendingSlot()] }),
  );

  test("the two real results are found despite the trailing placeholder", () => {
    assert.equal(v.pairs.length, 2);
    assert.equal(v.pairs[0].imageUrl, "/creatives/1.png");
  });

  test("a pending slot is counted as pending, not as a failure", () => {
    assert.equal(v.failed, 0);
    assert.equal(v.pending, 1);
  });

  test("a run in flight reads as running, not idle", () => {
    const c = campaign({ image: [img(1), pendingSlot(), pendingSlot()], text: [txt(1)] });
    c.results.status = "in-progress";
    assert.equal(briefGenerationView(c).status, "running");
  });
});

group("partial and failed runs are distinguishable", () => {
  test("some worked, some didn't → partial", () => {
    const v = briefGenerationView(
      campaign({ image: [img(1), img(2), failedSlot()], text: [txt(1), txt(2)] }),
    );
    assert.equal(v.status, "partial");
    assert.equal(v.failed, 1);
    assert.equal(v.pairs.length, 2);
  });

  test("none worked → failed", () => {
    const v = briefGenerationView(
      campaign({ image: [failedSlot(), failedSlot(), failedSlot()], text: [] }),
    );
    assert.equal(v.status, "failed");
    assert.equal(v.pairs.length, 0);
  });

  test("nothing has happened yet → idle, not failed", () => {
    assert.equal(briefGenerationView(campaign({ image: [], text: [] })).status, "idle");
    assert.equal(briefGenerationView({}).status, "idle");
  });
});

group("REAL Python payloads — captured, not invented", () => {
  // The fixtures in test/fixtures/adFactoryResult are verbatim callbacks from a
  // live run. They exist because the hand-written fixtures below used a flat
  // { headline, primaryText } that Python has never sent, which hid a bug where
  // every preview card rendered blank copy.
  const fs = require("node:fs");
  const path = require("node:path");
  const load = (f) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/adFactoryResult", f), "utf8"));

  const realText = load("text.json");
  const realImage = load("image.json");

  const realCampaign = campaign(
    { image: realImage.result, text: realText.result },
    2,
  );

  test("a real callback pair produces two complete cards", () => {
    const v = briefGenerationView(realCampaign);
    assert.equal(v.status, "success");
    assert.equal(v.pairs.length, 2);
  });

  test("headline and body come through — the bug that shipped blank cards", () => {
    const [first, second] = briefGenerationView(realCampaign).pairs;
    assert.equal(first.copy.headline, "Scale Your Ads with AI, Fast!");
    assert.ok(first.copy.primaryText.startsWith("Create high-converting ads"));
    assert.equal(second.copy.headline, "Unlock AI-Powered Ad Creation");
    assert.ok(second.copy.primaryText.length > 0);
  });

  test("it reads the SAME place the orchestrator posts from", () => {
    // buildCreativesFromResults uses textData.meta.primary_text; the preview
    // must agree or the user approves copy that differs from what goes live.
    const v = briefGenerationView(realCampaign);
    assert.equal(v.pairs[0].copy.primaryText, realText.result[0].data.meta.primary_text);
    assert.equal(v.pairs[0].copy.headline, realText.result[0].data.meta.headline);
  });

  test("image data stays a relative key, resolved at render time", () => {
    const v = briefGenerationView(realCampaign);
    assert.equal(v.pairs[0].imageUrl, "/creatives/GPT-435/1786954292250.webp");
    assert.ok(!v.pairs[0].imageUrl.startsWith("http"));
  });

  test("the generation prompt survives for the regenerate path", () => {
    assert.ok(briefGenerationView(realCampaign).pairs[0].prompt.length > 0);
  });
});

group("copy shape is normalised so a card never renders [object Object]", () => {
  test("google-only copy falls back to its own description", () => {
    const v = briefGenerationView(
      campaign({ image: [img(1)], text: [{ status: 200, data: { google: { headline: "G", description: "D" } } }] }),
    );
    assert.equal(v.pairs[0].copy.headline, "G");
    assert.equal(v.pairs[0].copy.primaryText, "D");
  });

  test("an object copy is read through", () => {
    const v = briefGenerationView(campaign({ image: [img(1)], text: [txt(1)] }));
    assert.equal(v.pairs[0].copy.headline, "Headline 1");
  });

  test("a plain string copy becomes primaryText", () => {
    const v = briefGenerationView(
      campaign({ image: [img(1)], text: [{ status: 200, data: "Just a sentence." }] }),
    );
    assert.equal(v.pairs[0].copy.primaryText, "Just a sentence.");
    assert.equal(v.pairs[0].copy.headline, "");
  });

  test("alternate key names from upstream are accepted", () => {
    const v = briefGenerationView(
      campaign({ image: [img(1)], text: [{ status: 200, data: { title: "T", message: "M" } }] }),
    );
    assert.equal(v.pairs[0].copy.headline, "T");
    assert.equal(v.pairs[0].copy.primaryText, "M");
  });

  test("an image with no matching copy still renders", () => {
    const v = briefGenerationView(campaign({ image: [img(1), img(2)], text: [txt(1)] }));
    assert.equal(v.pairs.length, 2);
    assert.equal(v.pairs[1].copy, null);
  });
});

group("purity", () => {
  test("the campaign is not mutated", () => {
    const c = campaign({ image: [img(1)], text: [txt(1)] });
    const before = JSON.stringify(c);
    briefGenerationView(c);
    assert.equal(JSON.stringify(c), before);
  });

  test("handles Mongoose-style documents", () => {
    const c = campaign({ image: [img(1)], text: [txt(1)] });
    assert.equal(briefGenerationView({ toObject: () => c, ...c }).pairs.length, 1);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
