const assert = require("node:assert");
const {
  filterRowsByActivityView,
  findActiveUserIds,
  isActiveUser,
  resolveActivityView,
  matchesActivityFilters,
  _internals,
} = require("../../services/adminUserActivity");

function distinctModel(ids, calls, source) {
  return {
    async distinct(field, query) {
      calls.push({ source, field, query });
      return ids;
    },
  };
}

async function run() {
  const calls = [];
  const models = {
    GeneratedMedia: distinctModel(["GPT-1"], calls, "generated"),
    TokenUsage: distinctModel(["GPT-2"], calls, "tokens"),
    Campaign: distinctModel(["GPT-3"], calls, "campaign"),
    ManagedCampaign: distinctModel(["4"], calls, "managed"),
    History: distinctModel(["GPT-5"], calls, "history"),
    MetaChatSession: distinctModel(["GPT-6"], calls, "chat"),
    GooglePostedAd: distinctModel(["GPT-9"], calls, "google_ad"),
    AnalyticsEvent: {
      async aggregate(pipeline) {
        calls.push({ source: "analytics", pipeline });
        return [{ _id: "GPT-7" }];
      },
    },
    BrandsList: {
      async aggregate(pipeline) {
        calls.push({ source: "brands", pipeline });
        return [{ _id: "GPT-8" }];
      },
    },
  };

  const result = await findActiveUserIds({
    from: "2026-09-01",
    to: "2026-09-07",
    models,
    logger: { warn() {} },
  });

  assert.deepStrictEqual(result.failedSources, []);
  for (let id = 1; id <= 8; id += 1) {
    assert.strictEqual(result.activeUserIds.has(`GPT-${id}`), true);
    assert.strictEqual(result.activeUserIds.has(String(id)), true);
  }
  assert.strictEqual(result.activeUserIds.has("GPT-9"), true);
  const generatedCall = calls.find((call) => call.source === "generated");
  assert.strictEqual(generatedCall.field, "userId");
  assert.strictEqual(generatedCall.query.createdAt.$gte.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.strictEqual(generatedCall.query.createdAt.$lte.toISOString(), "2026-09-07T23:59:59.999Z");
  const analyticsCall = calls.find((call) => call.source === "analytics");
  assert.deepStrictEqual(analyticsCall.pipeline[1].$match["events.time_spent"], { $gt: 0 });

  assert.strictEqual(_internals.PRODUCT_PAGE_PATTERN.test("/assistant"), true);
  assert.strictEqual(_internals.PRODUCT_PAGE_PATTERN.test("/adstudio/adCopy"), true);
  assert.strictEqual(_internals.PRODUCT_PAGE_PATTERN.test("/profile"), false);
  assert.strictEqual(_internals.PRODUCT_PAGE_PATTERN.test("/onboarding"), false);
  assert.strictEqual(_internals.PRODUCT_PAGE_PATTERN.test("/login"), false);

  assert.strictEqual(
    isActiveUser(
      { userId: "local-user" },
      { user_id: "local-user", amember_user_id: "4" },
      result.activeUserIds,
    ),
    true,
    "aMember identity should match activity recorded as GPT-<id>",
  );
  assert.strictEqual(isActiveUser({ userId: "inactive" }, {}, result.activeUserIds), false);

  const activityRow = {
    generations: 10,
    credits: 25,
    cost: 4.5,
    lastActivity: "2026-09-05T10:00:00.000Z",
  };
  assert.strictEqual(matchesActivityFilters(activityRow, {}), true);
  assert.strictEqual(matchesActivityFilters(activityRow, { generationsMin: "10", costMax: "4.5" }), true);
  assert.strictEqual(matchesActivityFilters(activityRow, { generationsMin: "11" }), false);
  assert.strictEqual(matchesActivityFilters(activityRow, { creditsMax: "24" }), false);
  assert.strictEqual(
    matchesActivityFilters(activityRow, { lastActivityFrom: "2026-09-05", lastActivityTo: "2026-09-05" }),
    true,
  );
  assert.strictEqual(
    matchesActivityFilters({ ...activityRow, lastActivity: null }, { lastActivityFrom: "2026-09-01" }),
    false,
  );

  // The three views the admin filter offers: used the app, used nothing, everyone.
  const viewRows = [
    { userId: "local-user" },
    { userId: "GPT-7" },
    { userId: "dormant-a" },
    { userId: "dormant-b" },
  ];
  const viewProfiles = new Map([["local-user", { user_id: "local-user", amember_user_id: "4" }]]);
  const byView = (view) =>
    filterRowsByActivityView({
      rows: viewRows,
      profileMap: viewProfiles,
      activeUserIds: result.activeUserIds,
      view,
    }).map((row) => row.userId);

  assert.deepStrictEqual(byView("active"), ["local-user", "GPT-7"]);
  assert.deepStrictEqual(byView("inactive"), ["dormant-a", "dormant-b"]);
  assert.deepStrictEqual(byView("all"), viewRows.map((row) => row.userId));
  assert.deepStrictEqual(
    [...byView("active"), ...byView("inactive")].sort(),
    byView("all").slice().sort(),
    "active and inactive must partition the full set - no user in both, none lost",
  );

  assert.deepStrictEqual(resolveActivityView("all"), {
    view: "all",
    available: true,
    applied: true,
    failedSources: [],
  });
  assert.strictEqual(resolveActivityView("bogus").view, "all", "unknown views fall back to all");
  assert.strictEqual(resolveActivityView("active", []).applied, true);
  assert.strictEqual(resolveActivityView("inactive", []).applied, true);
  // An incomplete active set inverts into a list of users who look dormant but
  // are not, so the inactive view must refuse to run rather than mislead.
  assert.strictEqual(resolveActivityView("inactive", ["token_usage"]).applied, false);
  assert.strictEqual(resolveActivityView("inactive", ["token_usage"]).available, false);
  assert.strictEqual(resolveActivityView("active", ["token_usage"]).applied, false);
  assert.strictEqual(
    resolveActivityView("all", ["token_usage"]).applied,
    true,
    "the unfiltered view does not depend on activity sources",
  );

  const failedModels = { ...models };
  failedModels.TokenUsage = { async distinct() { throw new Error("token store unavailable"); } };
  const warnings = [];
  const partial = await findActiveUserIds({
    from: "2026-09-01",
    to: "2026-09-07",
    models: failedModels,
    logger: { warn: (...args) => warnings.push(args) },
  });
  assert.deepStrictEqual(partial.failedSources, ["token_usage"]);
  assert.strictEqual(partial.activeUserIds.has("GPT-1"), true);
  assert.strictEqual(warnings.length, 1);

  console.log("Admin active user tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
