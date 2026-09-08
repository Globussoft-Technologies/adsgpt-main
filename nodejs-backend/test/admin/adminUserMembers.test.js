const assert = require("node:assert");
const { fetchAllMembers, _internals } = require("../../services/amemberUserDirectory");
const {
  applyMemberData,
  buildMemberIndexes,
  enrichRows,
  filterBySignupRange,
  findMember,
  paginateRows,
} = require("../../utils/adminUserMembers");

const originalBaseUrl = process.env.AMEMBER_BASE_API_URL;
const originalApiKey = process.env.AMEMBER_API_KEY;
process.env.AMEMBER_BASE_API_URL = "https://members.example.test/api";
process.env.AMEMBER_API_KEY = "test-key";

async function run() {
  _internals.resetCache();
  const calls = [];
  const successfulClient = {
    async get(url, config) {
      calls.push({ url, config });
      return {
        data: {
          0: {
            user_id: 101,
            email: "Member@Example.com",
            phone: "+91 98765 43210",
            added: "2026-09-07 20:00:32",
          },
          _total: 1,
        },
      };
    },
  };

  const lookup = await fetchAllMembers({ httpClient: successfulClient, now: 1_000 });
  assert.deepStrictEqual(lookup, {
    members: [{
      memberId: "101",
      email: "Member@Example.com",
      contactNo: "+91 98765 43210",
      signUpDate: "2026-09-07",
    }],
    stale: false,
  });
  assert.strictEqual(calls.length, 1, "bulk endpoint should be called once for a short page");
  assert.strictEqual(calls[0].url, "https://members.example.test/api/users");
  assert.strictEqual(calls[0].config.params._count, _internals.PAGE_SIZE);

  const members = [
    { memberId: "101", email: "wrong@example.com", contactNo: "ID", signUpDate: "2026-09-01" },
    { memberId: "202", email: "fallback@example.com", contactNo: "EMAIL", signUpDate: "2026-09-02" },
    { memberId: "303", email: "derived@example.com", contactNo: "DERIVED", signUpDate: "2026-09-03" },
  ];
  const indexes = buildMemberIndexes(members);
  assert.strictEqual(
    findMember({ amember_user_id: 101, email: "fallback@example.com" }, indexes).contactNo,
    "ID",
    "explicit member ID must win over email",
  );
  assert.strictEqual(
    findMember({ user_id: "GPT-303", email: "fallback@example.com" }, indexes).contactNo,
    "DERIVED",
    "legacy GPT member ID should be recognized",
  );
  assert.strictEqual(
    findMember({ user_id: "local", email: " FALLBACK@example.com " }, indexes).contactNo,
    "EMAIL",
    "email should be a case-insensitive fallback",
  );

  const rows = [
    { userId: "one", generations: 9, credits: 18, cost: 1.25 },
    { userId: "two", generations: 4, credits: 8, cost: 0.5 },
    { userId: "missing", generations: 1, credits: 2, cost: 0.1 },
  ];
  const profileMap = new Map([
    ["one", { user_id: "one", amember_user_id: "101" }],
    ["two", { user_id: "two", email: "fallback@example.com" }],
    ["missing", { user_id: "missing", email: "nobody@example.com" }],
  ]);
  const enriched = enrichRows(rows, profileMap, members);
  assert.strictEqual(enriched[0].contactNo, "ID");
  assert.strictEqual(enriched[0].signUpDate, "2026-09-01");
  assert.strictEqual(enriched[2].contactNo, null);
  assert.strictEqual(enriched[2].signUpDate, null);
  assert.deepStrictEqual(
    { generations: enriched[0].generations, credits: enriched[0].credits, cost: enriched[0].cost },
    { generations: 9, credits: 18, cost: 1.25 },
    "existing activity fields must remain unchanged",
  );
  assert.strictEqual(
    enrichRows([{ userId: "GPT-303" }], new Map(), members)[0].contactNo,
    "DERIVED",
    "activity rows without a profile should still support the legacy ID relationship",
  );

  assert.deepStrictEqual(
    _internals.normalizeMember({ user_id: 404, email: "empty@example.com", phone: "", added: "bad" }),
    { memberId: "404", email: "empty@example.com", contactNo: null, signUpDate: null },
  );

  assert.deepStrictEqual(
    filterBySignupRange(enriched, "2026-09-02", "").map((row) => row.userId),
    ["two"],
    "start-only filtering should be inclusive and exclude missing dates",
  );
  assert.deepStrictEqual(
    filterBySignupRange(enriched, "", "2026-09-01").map((row) => row.userId),
    ["one"],
    "end-only filtering should be inclusive",
  );
  assert.deepStrictEqual(
    filterBySignupRange(enriched, "2026-09-01", "2026-09-02").map((row) => row.userId),
    ["one", "two"],
    "both signup boundaries should be inclusive",
  );
  assert.deepStrictEqual(filterBySignupRange(enriched, "2027-01-01", "2027-01-31"), []);

  const filtered = filterBySignupRange(enriched, "2026-09-01", "2026-09-02");
  const secondPage = paginateRows(filtered, 2, 1);
  assert.strictEqual(secondPage.total, 2);
  assert.strictEqual(secondPage.data[0].userId, "two");
  assert.strictEqual(secondPage.hasMore, false);

  const unavailable = applyMemberData({
    rows,
    profileMap,
    members: [],
    signUpFrom: "2026-09-01",
    signUpTo: "2026-09-30",
    available: false,
  });
  assert.strictEqual(unavailable.rows.length, rows.length, "directory failure must preserve activity rows");
  assert.strictEqual(unavailable.signupFilterRequested, true);
  assert.strictEqual(unavailable.signupFilterApplied, false);
  assert.ok(unavailable.rows.every((row) => row.contactNo === null && row.signUpDate === null));

  _internals.resetCache();
  await assert.rejects(
    fetchAllMembers({ httpClient: { get: async () => { throw new Error("offline"); } }, now: 2_000 }),
    /offline/,
  );

  _internals.resetCache();
  await fetchAllMembers({ httpClient: successfulClient, now: 3_000 });
  const stale = await fetchAllMembers({
    httpClient: { get: async () => { throw new Error("offline"); } },
    now: 3_000 + _internals.CACHE_TTL_MS + 1,
  });
  assert.strictEqual(stale.stale, true);
  assert.strictEqual(stale.members[0].memberId, "101");

  console.log("Admin user aMember enrichment tests passed");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    _internals.resetCache();
    if (originalBaseUrl === undefined) delete process.env.AMEMBER_BASE_API_URL;
    else process.env.AMEMBER_BASE_API_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.AMEMBER_API_KEY;
    else process.env.AMEMBER_API_KEY = originalApiKey;
  });
