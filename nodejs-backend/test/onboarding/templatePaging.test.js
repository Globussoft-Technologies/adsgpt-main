#!/usr/bin/env node
/**
 * Tests for `mergeTemplatePage` — the fold that makes template paging possible.
 *
 * Template recommendations arrive one page at a time: upstream returns five per
 * call and takes a `skip`, so every callback carries a page and not the list.
 * Every other section in the mirror replaces its result; this one has to append,
 * and it has to be safe to run twice, because a webhook can be redelivered and
 * upstream's own ten-minute cache can replay a page verbatim.
 *
 * Pure function, no DB — the mirror's write path is what talks to Mongo, and
 * this is the part with all the reasoning in it.
 *
 * Run:  node test/onboarding/templatePaging.test.js
 */

const assert = require("node:assert/strict");

const { mergeTemplatePage } = require("../../services/onboarding/sessionMirror");
const { nextPage, MAX_LIMIT } = require("../../services/onboarding/templateBridge");

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

const page = (ids, extra = {}) => ({
  templates: ids.map((id) => ({ template_id: id, content_type: `type-${id}` })),
  count: ids.length,
  near_count: 0,
  ...extra,
});

const ids = (merged) => merged.result.templates.map((t) => t.template_id);

console.log("mergeTemplatePage");

test("first page is stored whole", () => {
  const merged = mergeTemplatePage(null, page(["a", "b", "c", "d", "e"]), { limit: 5, skip: 0 });
  assert.deepEqual(ids(merged), ["a", "b", "c", "d", "e"]);
  assert.equal(merged.pagination.loaded, 5);
  assert.equal(merged.pagination.skip, 0);
  assert.equal(merged.pagination.exhausted, false);
});

test("second page appends after the first", () => {
  const first = mergeTemplatePage(null, page(["a", "b"]), { limit: 2, skip: 0 });
  const second = mergeTemplatePage(first.result, page(["c", "d"]), { limit: 2, skip: 2 });
  assert.deepEqual(ids(second), ["a", "b", "c", "d"]);
  assert.equal(second.pagination.loaded, 4);
  assert.equal(second.pagination.skip, 2);
});

test("a redelivered page changes nothing", () => {
  const first = mergeTemplatePage(null, page(["a", "b"]), { limit: 2, skip: 0 });
  const again = mergeTemplatePage(first.result, page(["a", "b"]), { limit: 2, skip: 0 });
  assert.deepEqual(ids(again), ["a", "b"]);
  assert.equal(again.pagination.loaded, 2);
});

test("an overlapping page keeps only what is new", () => {
  const first = mergeTemplatePage(null, page(["a", "b", "c"]), { limit: 3, skip: 0 });
  const second = mergeTemplatePage(first.result, page(["b", "c", "d"]), { limit: 3, skip: 3 });
  assert.deepEqual(ids(second), ["a", "b", "c", "d"]);
});

test("a short page marks the corpus exhausted", () => {
  const merged = mergeTemplatePage(null, page(["a", "b"]), { limit: 5, skip: 0 });
  assert.equal(merged.pagination.exhausted, true);
});

test("a full page does not", () => {
  const merged = mergeTemplatePage(null, page(["a", "b", "c", "d", "e"]), { limit: 5, skip: 0 });
  assert.equal(merged.pagination.exhausted, false);
});

test("an empty page is exhausted and adds nothing", () => {
  const first = mergeTemplatePage(null, page(["a"]), { limit: 1, skip: 0 });
  const second = mergeTemplatePage(first.result, page([]), { limit: 5, skip: 1 });
  assert.deepEqual(ids(second), ["a"]);
  assert.equal(second.pagination.exhausted, true);
});

test("an item with no id is kept rather than dropped", () => {
  const incoming = { templates: [{ content_type: "nameless" }], count: 1 };
  const merged = mergeTemplatePage(null, incoming, { limit: 5, skip: 0 });
  assert.equal(merged.result.templates.length, 1);
});

test("the newest envelope wins, the list is merged", () => {
  const first = mergeTemplatePage(null, page(["a"], { near_count: 4, message: "first" }), {
    limit: 1,
    skip: 0,
  });
  const second = mergeTemplatePage(first.result, page(["b"], { near_count: 0, message: "second" }), {
    limit: 1,
    skip: 1,
  });
  assert.deepEqual(ids(second), ["a", "b"]);
  assert.equal(second.result.message, "second");
  assert.equal(second.result.near_count, 0);
});

test("a result with no templates array is not a page", () => {
  assert.equal(mergeTemplatePage(null, { count: 0 }, { limit: 5 }), null);
  assert.equal(mergeTemplatePage(null, null, { limit: 5 }), null);
});

test("a missing limit cannot declare exhaustion", () => {
  const merged = mergeTemplatePage(null, page(["a"]), {});
  assert.equal(merged.pagination.exhausted, false);
});

console.log("\nnextPage");

test("the first page starts at zero", () => {
  assert.deepEqual(nextPage(0, 10), { skip: 0, limit: 10, exhausted: false });
});

test("the cursor follows what is stored, under the ceiling", () => {
  assert.deepEqual(nextPage(10, 10), { skip: 10, limit: 10, exhausted: false });
});

test("the cursor keeps moving past the old 20/15 ceiling", () => {
  assert.deepEqual(nextPage(20, 10), { skip: 20, limit: 10, exhausted: false });
  assert.deepEqual(nextPage(50, 20), { skip: 50, limit: 20, exhausted: false });
});

test("no total cap: skip is simply what is stored, never exhausted locally", () => {
  assert.deepEqual(nextPage(5000, 20), { skip: 5000, limit: 20, exhausted: false });
});

test("page size is clamped to the contract's per-page maximum only", () => {
  assert.equal(nextPage(0, 500).limit, MAX_LIMIT);
  assert.equal(nextPage(0, 0).limit, 10);
});

test("paging a real corpus reaches its end and stops", () => {
  const corpus = Array.from({ length: 60 }, (_, i) => `c${i}`);
  let stored = mergeTemplatePage(null, { templates: corpus.slice(0, 20).map((id) => ({ template_id: id })) }, { limit: 20, skip: 0 });
  for (let guard = 0; guard < 12; guard += 1) {
    const page = nextPage(stored.pagination.loaded, 20);
    if (page.exhausted || stored.pagination.exhausted) break;
    const slice = corpus.slice(page.skip, page.skip + page.limit);
    stored = mergeTemplatePage(stored.result, { templates: slice.map((id) => ({ template_id: id })) }, page);
  }
  assert.equal(stored.pagination.loaded, 60);
  assert.equal(stored.pagination.exhausted, true);
});

test("a brand with zero videos can still page its images", () => {
  const imgs = (from, n) => Array.from({ length: n }, (_, i) => ({ sha256: `i${from + i}` }));
  const first = mergeTemplatePage(null, { templates: [], image_templates: imgs(0, 20) }, { limit: 20, skip: 0 });
  assert.equal(first.pagination.loaded, 20);
  assert.equal(first.pagination.exhausted, false);
  const page = nextPage(first.pagination.loaded, 20);
  assert.equal(page.skip, 20);
  const second = mergeTemplatePage(first.result, { templates: [], image_templates: imgs(20, 20) }, page);
  assert.equal(second.result.templates.length, 40);
});

test("a page of nothing but duplicates ends paging (upstream ignores skip for images)", () => {
  const imgs = Array.from({ length: 10 }, (_, i) => ({ sha256: `i${i}` }));
  const first = mergeTemplatePage(null, { templates: [], image_templates: imgs }, { limit: 10, skip: 0 });
  assert.equal(first.pagination.exhausted, false);
  const again = mergeTemplatePage(first.result, { templates: [], image_templates: imgs }, { limit: 10, skip: 10 });
  assert.equal(again.result.templates.length, 10);
  assert.equal(again.pagination.exhausted, true);
});

console.log("\nvideo + image in one list");

test("image_templates join the list tagged media_type=image, keyed by sha256", () => {
  const merged = mergeTemplatePage(
    null,
    { templates: [{ template_id: "v1" }], image_templates: [{ sha256: "abc", image_url: "u" }] },
    { limit: 5, skip: 0 }
  );
  assert.deepEqual(
    merged.result.templates.map((t) => [t.template_id, t.media_type]),
    [["v1", "video"], ["abc", "image"]]
  );
  assert.equal(merged.result.image_templates, undefined);
});

test("an image-only callback no longer erases stored videos", () => {
  const first = mergeTemplatePage(null, page(["a", "b"]), { limit: 2, skip: 0 });
  const second = mergeTemplatePage(first.result, { image_templates: [{ sha256: "i1" }] }, { limit: 2, skip: 0 });
  assert.deepEqual(ids(second), ["a", "b", "i1"]);
});

test("exhausted only when neither corpus filled the page", () => {
  const merged = mergeTemplatePage(
    null,
    { templates: [{ template_id: "a" }, { template_id: "b" }], image_templates: [{ sha256: "x" }, { sha256: "y" }] },
    { limit: 2, skip: 0 }
  );
  assert.equal(merged.pagination.loaded, 2);
  assert.equal(merged.pagination.exhausted, false);
  const short = mergeTemplatePage(null, { templates: [{ template_id: "a" }], image_templates: [{ sha256: "x" }] }, { limit: 2 });
  assert.equal(short.pagination.exhausted, true);
});

test("an upstream type key wins over the inferred one", () => {
  const merged = mergeTemplatePage(null, { templates: [{ template_id: "a", type: "image" }] }, {});
  assert.equal(merged.result.templates[0].media_type, "image");
});

test("refresh replaces the list, so rotated links are not kept", () => {
  const first = mergeTemplatePage(null, { templates: [{ template_id: "a", video_url: "old" }] }, { limit: 5 });
  const refreshed = mergeTemplatePage(
    first.result,
    { templates: [{ template_id: "a", video_url: "new" }] },
    { limit: 5, skip: 0, replace: true }
  );
  assert.equal(refreshed.result.templates.length, 1);
  assert.equal(refreshed.result.templates[0].video_url, "new");
});

console.log("\nSSE parser");

test("parses split chunks and CRLF into frames", () => {
  const { createSseParser } = require("../../services/onboarding/templateBridge")._internals;
  const frames = [];
  const feed = createSseParser((event, data) => frames.push([event, data]));
  feed(Buffer.from('event: template\r\ndata: {"template_id":"a"}\r\n\r\nevent: im'));
  feed(Buffer.from('age_template\ndata: {"sha256":"b"}\n\nevent: done\ndata: {"count":1}\n\n'));
  assert.deepEqual(frames, [
    ["template", { template_id: "a" }],
    ["image_template", { sha256: "b" }],
    ["done", { count: 1 }],
  ]);
});

console.log(`\n${passed} passed${process.exitCode ? " (with failures)" : ""}`);
