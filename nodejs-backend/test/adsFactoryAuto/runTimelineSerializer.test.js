#!/usr/bin/env node
/**
 * Tests for services/adsFactoryAuto/runTimelineSerializer.js — the pure
 * transform behind Quick setup's delivery timeline.
 *
 * The property that matters most is PARITY: nothing the v1 canvas could show
 * about a run may be missing from a timeline row. The canvas is a permanently
 * supported mode, so the new surface has to be at least as informative — a
 * user switching modes must not lose visibility.
 *
 * No DB, no SDK, no stubs. Fixture in, rows out.
 *
 * Run:  node test/adsFactoryAuto/runTimelineSerializer.test.js
 */

const assert = require("node:assert/strict");

const {
  serializeRunTimeline,
  _internals,
} = require("../../services/adsFactoryAuto/runTimelineSerializer");

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

const creative = (id, extra = {}) => ({
  creativeId: id,
  imageUrl: `/creatives/${id}.png`,
  headline: `Headline ${id}`,
  message: `Message ${id}`,
  platform: "meta",
  postedAdIds: { meta: `ad_${id}` },
  ...extra,
});

const job = (extra = {}) => ({
  _id: "job1",
  status: "active",
  totalRuns: 3,
  failedRuns: 1,
  pairsPerCycle: 2,
  schedule: {
    frequency: "weekly",
    hour: 9,
    timezone: "Asia/Calcutta",
    nextRunAt: new Date("2026-08-18T03:30:00Z"),
    lastRunAt: new Date("2026-08-11T03:30:00Z"),
  },
  targets: {
    meta: {
      template: { payload: { adAccountId: "act_998877" } },
    },
  },
  runHistory: [
    {
      runId: "r1",
      status: "success",
      startedAt: new Date("2026-07-28T03:30:00Z"),
      completedAt: new Date("2026-07-28T03:34:00Z"),
      metaAdId: "1201",
      automationCreatives: [creative("a"), creative("b")],
    },
    {
      runId: "r2",
      status: "partial",
      startedAt: new Date("2026-08-04T03:30:00Z"),
      completedAt: new Date("2026-08-04T03:35:00Z"),
      metaAdId: "1202",
      automationCreatives: [
        creative("c"),
        creative("d", { postedAdIds: {} }), // this one never went live
      ],
    },
    {
      runId: "r3",
      status: "failed",
      startedAt: new Date("2026-08-11T03:30:00Z"),
      completedAt: new Date("2026-08-11T03:31:00Z"),
      error: "Meta rejected the image — text covers more than 20% of the creative.",
      automationCreatives: [creative("e", { postedAdIds: {} })],
    },
  ],
  ...extra,
});

// ─── Ordering ────────────────────────────────────────────────────────────────

group("ordering — the next run first, then newest completed", () => {
  const { rows } = serializeRunTimeline(job());

  test("projects the next scheduled run on top", () => {
    // "When does this happen again" should be the first thing on screen.
    assert.equal(rows[0].scheduled, true);
    assert.equal(rows[0].status, "scheduled");
    assert.equal(rows[0].liveCount, 0);
  });

  test("completed runs follow, newest first", () => {
    assert.equal(rows[1].runId, "r3");
    assert.equal(rows[2].runId, "r2");
    assert.equal(rows[3].runId, "r1");
  });

  test("cycle numbers count from the oldest run and stay stable", () => {
    // Numbering from the newest would renumber every past run each cycle.
    assert.equal(rows[3].cycle, 1);
    assert.equal(rows[2].cycle, 2);
    assert.equal(rows[1].cycle, 3);
    assert.equal(rows[0].cycle, 4);
  });

  test("a paused job projects no next run", () => {
    const { rows: paused } = serializeRunTimeline(job({ status: "paused" }));
    assert.equal(paused[0].scheduled, false);
    assert.equal(paused[0].runId, "r3");
  });

  test("an active job with no nextRunAt invents nothing", () => {
    const j = job();
    j.schedule.nextRunAt = null;
    const { rows: r } = serializeRunTimeline(j);
    assert.equal(r[0].scheduled, false);
  });
});

// ─── Counts ──────────────────────────────────────────────────────────────────

group("counts — a partial run must not read as a clean one", () => {
  const { rows } = serializeRunTimeline(job());
  const byId = (id) => rows.find((r) => r.runId === id);

  test("a fully successful run counts every ad", () => {
    assert.equal(byId("r1").liveCount, 2);
    assert.equal(byId("r1").failedCount, 0);
  });

  test("a partial run reports both halves", () => {
    // 2 creatives, 1 posted. Showing "1 live" alone would make the failure
    // invisible; showing "2 live" would be a lie.
    assert.equal(byId("r2").liveCount, 1);
    assert.equal(byId("r2").failedCount, 1);
  });

  test("a failed run reports no live ads and carries the reason", () => {
    assert.equal(byId("r3").liveCount, 0);
    assert.ok(byId("r3").failedCount >= 1);
    assert.match(byId("r3").error, /20%/);
  });

  test("total ads published sums across every run", () => {
    const { summary } = serializeRunTimeline(job());
    assert.equal(summary.adsPublished, 3);
  });
});

// ─── Deep links ──────────────────────────────────────────────────────────────

group("deep links — or none at all", () => {
  const { rows } = serializeRunTimeline(job());
  const r1 = rows.find((r) => r.runId === "r1");

  test("builds a Meta link scoped to the ad", () => {
    const link = r1.links.find((l) => l.platform === "meta");
    assert.ok(link, "expected a meta link");
    assert.match(link.url, /adsmanager\.facebook\.com/);
    assert.match(link.url, /selected_ad_ids=1201/);
  });

  test("strips the act_ prefix from the account id", () => {
    const link = r1.links.find((l) => l.platform === "meta");
    assert.match(link.url, /act=998877/);
    assert.doesNotMatch(link.url, /act=act_/);
  });

  test("no ad account means no link, rather than a broken one", () => {
    // A half-built URL lands the user on an empty manager view — worse than
    // no link at all.
    const j = job();
    j.targets.meta.template.payload.adAccountId = null;
    const { rows: r } = serializeRunTimeline(j);
    assert.deepEqual(r.find((x) => x.runId === "r1").links, []);
  });

  test("a run with no ad id gets no link", () => {
    assert.deepEqual(rows.find((r) => r.runId === "r3").links, []);
  });

  test("helpers refuse to build from partial inputs", () => {
    const { metaAdLink, googleAdLink } = _internals;
    assert.equal(metaAdLink(null, "123"), null);
    assert.equal(metaAdLink("act_1", null), null);
    assert.equal(googleAdLink(null), null);
  });
});

// ─── Creatives ───────────────────────────────────────────────────────────────

group("creatives carry enough to render a row", () => {
  const { rows } = serializeRunTimeline(job());
  const r1 = rows.find((r) => r.runId === "r1");

  test("image, headline and message all survive", () => {
    assert.equal(r1.creatives.length, 2);
    assert.equal(r1.creatives[0].imageUrl, "/creatives/a.png");
    assert.equal(r1.creatives[0].headline, "Headline a");
    assert.equal(r1.creatives[0].message, "Message a");
  });

  test("falls back to platform-specific copy when the shared fields are empty", () => {
    const j = job();
    j.runHistory[0].automationCreatives = [
      {
        creativeId: "x",
        imageUrl: "/x.png",
        headline: "",
        message: "",
        platformText: { meta: { headline: "Meta headline", message: "Meta message" } },
        postedAdIds: { meta: "ad_x" },
      },
    ];
    const { rows: r } = serializeRunTimeline(j);
    const c = r.find((x) => x.runId === "r1").creatives[0];
    assert.equal(c.headline, "Meta headline");
    assert.equal(c.message, "Meta message");
  });
});

// ─── Mongo Map shapes ────────────────────────────────────────────────────────

group("tolerates every shape Mongo hands back", () => {
  const { mapToObject } = _internals;

  test("a real Map", () => {
    assert.deepEqual(mapToObject(new Map([["meta", "1"]])), { meta: "1" });
  });

  test("a plain object (what .lean() gives)", () => {
    assert.deepEqual(mapToObject({ meta: "1" }), { meta: "1" });
  });

  test("array-of-pairs", () => {
    assert.deepEqual(mapToObject([["meta", "1"]]), { meta: "1" });
  });

  test("null and junk degrade to an empty object", () => {
    assert.deepEqual(mapToObject(null), {});
    assert.deepEqual(mapToObject("nope"), {});
    assert.deepEqual(mapToObject(undefined), {});
  });

  test("hydrated documents with toObject are unwrapped", () => {
    const hydrated = { toObject: () => job() };
    const { rows } = serializeRunTimeline(hydrated);
    assert.ok(rows.length > 0);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

group("summary — the header line", () => {
  const { summary } = serializeRunTimeline(job());

  test("carries schedule and run counts", () => {
    assert.equal(summary.status, "active");
    assert.equal(summary.totalRuns, 3);
    assert.equal(summary.failedRuns, 1);
    assert.equal(summary.successfulRuns, 2);
    assert.equal(summary.frequency, "weekly");
    assert.equal(summary.hour, 9);
    assert.equal(summary.timezone, "Asia/Calcutta");
    assert.equal(summary.pairsPerCycle, 2);
  });

  test("hour 0 is preserved, not treated as missing", () => {
    const j = job();
    j.schedule.hour = 0;
    assert.equal(serializeRunTimeline(j).summary.hour, 0);
  });

  test("a paused job reports no next run", () => {
    assert.equal(serializeRunTimeline(job({ status: "paused" })).summary.nextRunAt, null);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

group("edge cases", () => {
  test("empty runHistory gives an empty list, not null", () => {
    const { rows, summary } = serializeRunTimeline(
      job({ runHistory: [], totalRuns: 0, failedRuns: 0 }),
    );
    // Still projects the next run — a job that hasn't run yet should say when
    // it will, not look broken.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scheduled, true);
    assert.equal(summary.adsPublished, 0);
  });

  test("an undefined job doesn't throw", () => {
    assert.doesNotThrow(() => serializeRunTimeline(undefined));
    const { rows } = serializeRunTimeline(undefined);
    assert.deepEqual(rows, []);
  });

  test("limit caps the rows returned", () => {
    const { rows } = serializeRunTimeline(job(), { limit: 2 });
    assert.equal(rows.length, 2);
  });

  test("an invalid limit is ignored rather than returning nothing", () => {
    for (const limit of [0, -1, "abc", null]) {
      const { rows } = serializeRunTimeline(job(), { limit });
      assert.ok(rows.length > 2, `limit ${limit} should not truncate`);
    }
  });

  test("does not mutate the job", () => {
    const j = job();
    const snapshot = JSON.parse(JSON.stringify(j));
    serializeRunTimeline(j);
    assert.deepEqual(JSON.parse(JSON.stringify(j)), snapshot);
  });

  test("is deterministic", () => {
    assert.deepEqual(serializeRunTimeline(job()), serializeRunTimeline(job()));
  });
});

// ─── Parity with the canvas ──────────────────────────────────────────────────

group("parity — nothing the canvas showed is missing", () => {
  const { rows } = serializeRunTimeline(job());
  const r2 = rows.find((r) => r.runId === "r2");

  test("every field the automation node surfaced has a home", () => {
    for (const key of [
      "runId",
      "status",
      "startedAt",
      "completedAt",
      "liveCount",
      "failedCount",
      "error",
      "creatives",
      "links",
      "platformContext",
    ]) {
      assert.ok(key in r2, `timeline row is missing ${key}`);
    }
  });

  test("platformContext is passed through for per-platform drill-down", () => {
    const j = job();
    j.runHistory[1].platformContext = { meta: { campaignId: "c1", adSetId: "as1" } };
    const { rows: r } = serializeRunTimeline(j);
    assert.deepEqual(r.find((x) => x.runId === "r2").platformContext, {
      meta: { campaignId: "c1", adSetId: "as1" },
    });
  });
});

group("per-creative outcome, for the published-ads view", () => {
  // The run-level `links` are built from `metaAdId`, which records ONE ad. On a
  // 3-pair run that deep-links to the first and says nothing about the other
  // two; on a partial run it cannot show which creative failed. These are what
  // let the UI list published ads individually.
  const job = {
    status: "active",
    schedule: { frequency: "weekly", hour: 9 },
    targets: { meta: { template: { payload: { adAccountId: "act_998877" } } } },
    runHistory: [
      {
        runId: "r1",
        status: "partial",
        startedAt: "2026-08-17T09:00:00Z",
        metaAdId: "111",
        automationCreatives: [
          { creativeId: "c1", imageUrl: "/a.webp", headline: "One", postedAdIds: { meta: "111" } },
          { creativeId: "c2", imageUrl: "/b.webp", headline: "Two", postedAdIds: {} },
        ],
      },
    ],
  };

  const row = serializeRunTimeline(job).rows.find((r) => r.runId === "r1");

  test("a creative that produced an ad is marked posted", () => {
    assert.equal(row.creatives[0].posted, true);
  });

  test("a creative that produced none is NOT marked posted", () => {
    assert.equal(row.creatives[1].posted, false);
    assert.deepEqual(row.creatives[1].adLinks, []);
  });

  test("each posted creative carries its own deep link and ad id", () => {
    const [link] = row.creatives[0].adLinks;
    assert.equal(link.platform, "meta");
    assert.equal(link.adId, "111");
    assert.match(link.url, /act=998877/);
    assert.match(link.url, /selected_ad_ids=111/);
  });

  test("no ad account means no link rather than a half-built URL", () => {
    const bare = { ...job, targets: { meta: { template: { payload: {} } } } };
    const r = serializeRunTimeline(bare).rows.find((x) => x.runId === "r1");
    assert.deepEqual(r.creatives[0].adLinks, []);
    // Still marked posted — the ad exists, we just cannot link to it.
    assert.equal(r.creatives[0].posted, true);
  });

  test("posted count matches the run's own liveCount", () => {
    assert.equal(row.creatives.filter((c) => c.posted).length, row.liveCount);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`  ✗ ${f.name}\n    ${f.err.stack}`);
  process.exit(1);
}
