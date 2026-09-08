const assert = require("node:assert");
const {
  findActiveUserIds,
  isActiveUser,
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
