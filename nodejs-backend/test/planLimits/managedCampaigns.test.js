const assert = require("assert");
const Module = require("module");

/**
 * managedCampaigns service — the slot model behind the "operate on only N
 * campaigns" plan rule.
 *
 * The service talks to Mongo (ManagedCampaign) and utils/planLimits, neither
 * of which is reachable here, so both are stubbed via require-cache injection
 * BEFORE the service is loaded. That keeps this a real test of the service's
 * own decision logic — the limit checks, the fail-open behaviour, the
 * uncapped-plan short-circuits — rather than a test of Mongoose.
 */

// ── stubs ───────────────────────────────────────────────────────────────────
let planLimitValue = null; // what getLimitsForUser reports for meta:campaigns
let rows = []; // stand-in ManagedCampaign collection
let throwOnRead = false;

const modelPath = require.resolve("../../Module/adPosting/managedCampaign");
const planLimitsPath = require.resolve("../../utils/planLimits");

function match(query) {
  return rows.filter(
    (r) =>
      (query.userId === undefined || r.userId === query.userId) &&
      (query.campaignId === undefined || r.campaignId === query.campaignId) &&
      (query.adAccountId === undefined || r.adAccountId === query.adAccountId),
  );
}

const ManagedCampaignStub = {
  async countDocuments(query) {
    if (throwOnRead) throw new Error("mongo down");
    return match(query).length;
  },
  find(query) {
    if (throwOnRead) throw new Error("mongo down");
    const res = match(query);
    return { lean: async () => res };
  },
  async exists(query) {
    if (throwOnRead) throw new Error("mongo down");
    return match(query).length > 0 ? { _id: "x" } : null;
  },
  async updateOne(filter, update, opts) {
    if (opts?.upsert && match(filter).length === 0) {
      rows.push({ ...filter, ...(update.$setOnInsert || {}) });
    }
    return { acknowledged: true };
  },
  async deleteOne(filter) {
    const before = rows.length;
    rows = rows.filter((r) => !match(filter).includes(r));
    return { deletedCount: before - rows.length };
  },
  async deleteMany(filter) {
    const live = new Set(filter.campaignId.$nin);
    const before = rows.length;
    rows = rows.filter(
      (r) =>
        !(
          r.userId === filter.userId &&
          r.adAccountId === filter.adAccountId &&
          !live.has(r.campaignId)
        ),
    );
    return { deletedCount: before - rows.length };
  },
};

require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: ManagedCampaignStub };
require.cache[planLimitsPath] = {
  id: planLimitsPath,
  filename: planLimitsPath,
  loaded: true,
  exports: {
    getLimitsForUser: async () => ({ "meta:campaigns": planLimitValue }),
  },
};

const svc = require("../../services/managedCampaigns");

function reset({ limit = null, seed = [] } = {}) {
  planLimitValue = limit;
  rows = seed.map((r) => ({ adAccountId: "act1", ...r }));
  throwOnRead = false;
}

const run = (name, fn) => fn().then(
  () => {},
  (err) => {
    console.error(`FAILED: ${name}\n  ${err.message}`);
    process.exitCode = 1;
  },
);

(async () => {
  // ── uncapped plan: nothing is ever locked ────────────────────────────────
  await run("uncapped plan allows any campaign", async () => {
    reset({ limit: null });
    const gate = await svc.requireManagedCampaign("u1", "c-never-claimed");
    assert.strictEqual(gate.ok, true, "uncapped plan must not gate anything");
    assert.strictEqual(await svc.getCampaignLimit("u1"), null);
  });

  await run("uncapped plan lets a claim through regardless of count", async () => {
    reset({ limit: null, seed: Array.from({ length: 50 }, (_, i) => ({ userId: "u1", campaignId: `c${i}` })) });
    const res = await svc.claimCampaign("u1", { campaignId: "c-new", adAccountId: "act1" });
    assert.strictEqual(res.ok, true);
  });

  // ── capped plan: the gate ────────────────────────────────────────────────
  await run("capped plan blocks an unmanaged campaign", async () => {
    reset({ limit: 2, seed: [{ userId: "u1", campaignId: "c1" }] });
    const gate = await svc.requireManagedCampaign("u1", "c-other");
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.status, 403);
    assert.strictEqual(gate.code, "CAMPAIGN_NOT_MANAGED");
    assert.ok(gate.error.includes("2"), "message should name the limit");
  });

  await run("capped plan allows a managed campaign", async () => {
    reset({ limit: 2, seed: [{ userId: "u1", campaignId: "c1" }] });
    assert.strictEqual((await svc.requireManagedCampaign("u1", "c1")).ok, true);
  });

  // A missing campaignId means the caller couldn't identify the parent (e.g.
  // an ad-set endpoint). Allowed by design — the UI blocks that path — and
  // must NOT be treated as "unmanaged", which would break every such call.
  await run("absent campaignId is allowed, not treated as unmanaged", async () => {
    reset({ limit: 1, seed: [] });
    assert.strictEqual((await svc.requireManagedCampaign("u1", null)).ok, true);
    assert.strictEqual((await svc.requireManagedCampaign("u1", undefined)).ok, true);
  });

  // ── claiming respects the limit ──────────────────────────────────────────
  await run("claim is refused when all slots are used", async () => {
    reset({ limit: 2, seed: [{ userId: "u1", campaignId: "c1" }, { userId: "u1", campaignId: "c2" }] });
    const res = await svc.claimCampaign("u1", { campaignId: "c3", adAccountId: "act1" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, "PLAN_LIMIT_REACHED");
    assert.strictEqual(res.limit, 2);
    assert.strictEqual(res.current, 2);
  });

  await run("re-claiming an already-managed campaign is a no-op success", async () => {
    reset({ limit: 1, seed: [{ userId: "u1", campaignId: "c1" }] });
    const res = await svc.claimCampaign("u1", { campaignId: "c1", adAccountId: "act1" });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.alreadyManaged, true);
    assert.strictEqual(await svc.countManagedCampaigns("u1"), 1, "must not double-consume a slot");
  });

  // The create path reserves its slot upstream via checkPlanLimit, so forcing
  // past the count here is correct — without it, creating the Nth campaign
  // would create it in Meta and then fail to claim it, leaving it orphaned.
  await run("force bypasses the limit for the create path", async () => {
    reset({ limit: 1, seed: [{ userId: "u1", campaignId: "c1" }] });
    const res = await svc.claimCampaign("u1", { campaignId: "c2", adAccountId: "act1", source: "create", force: true });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(await svc.countManagedCampaigns("u1"), 2);
  });

  await run("releasing frees a slot", async () => {
    reset({ limit: 1, seed: [{ userId: "u1", campaignId: "c1" }] });
    assert.strictEqual((await svc.claimCampaign("u1", { campaignId: "c2", adAccountId: "act1" })).ok, false);
    await svc.releaseCampaign("u1", "c1");
    assert.strictEqual((await svc.claimCampaign("u1", { campaignId: "c2", adAccountId: "act1" })).ok, true);
  });

  // ── orphan pruning ───────────────────────────────────────────────────────
  // The scoping here is load-bearing: pruning by userId alone would wipe every
  // slot held under the user's OTHER ad accounts, since those campaigns are
  // absent from this account's list by definition rather than by deletion.
  await run("prune only touches the ad account it was given", async () => {
    reset({
      limit: 5,
      seed: [
        { userId: "u1", campaignId: "c1", adAccountId: "act1" },
        { userId: "u1", campaignId: "c2", adAccountId: "act1" },
        { userId: "u1", campaignId: "c9", adAccountId: "act2" },
      ],
    });
    const deleted = await svc.pruneMissingForAccount("u1", "act1", ["c1"]);
    assert.strictEqual(deleted, 1, "c2 is gone from Meta and should be released");
    const remaining = [...(await svc.listManagedCampaignIds("u1"))].sort();
    assert.deepStrictEqual(remaining, ["c1", "c9"], "act2's slot must survive");
  });

  await run("prune with a full live list deletes nothing", async () => {
    reset({ limit: 5, seed: [{ userId: "u1", campaignId: "c1", adAccountId: "act1" }] });
    assert.strictEqual(await svc.pruneMissingForAccount("u1", "act1", ["c1"]), 0);
  });

  // ── fail-open ────────────────────────────────────────────────────────────
  // A DB blip must never lock a paying user out of their own campaigns.
  await run("gate fails OPEN when the lookup throws", async () => {
    reset({ limit: 1, seed: [] });
    throwOnRead = true;
    assert.strictEqual((await svc.requireManagedCampaign("u1", "c-any")).ok, true);
  });

  if (!process.exitCode) console.log("managedCampaigns tests passed");
})();
