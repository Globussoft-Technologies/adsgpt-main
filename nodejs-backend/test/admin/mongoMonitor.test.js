const assert = require("node:assert");
const { diff, normaliseRaw } = require("../../services/mongoMonitor");
const { redactShape } = require("../../controllers/admin/dbMonitor.controller");

const shaped = redactShape({
  find: "users",
  filter: { email: "person@example.com", age: { $gte: 21 } },
  ids: ["secret-1", "secret-2"],
  active: true,
  at: new Date("2026-01-01T00:00:00Z"),
});
assert.strictEqual(shaped.find, "<string>");
assert.strictEqual(shaped.filter.email, "<string>");
assert.strictEqual(shaped.filter.age.$gte, "<number>");
assert.deepStrictEqual(shaped.ids, ["<string>", "<2 items>"]);
assert.strictEqual(shaped.active, "<bool>");
assert.strictEqual(shaped.at, "<date>");
assert.ok(!JSON.stringify(shaped).includes("person@example.com"));

const before = {
  at: 1_000,
  opcounters: { insert: 10, query: 5, update: 2, delete: 1, getmore: 0, command: 20 },
  opLatencies: { reads: { latency: 1_000, ops: 10 }, writes: { latency: 2_000, ops: 5 }, commands: { latency: 0, ops: 0 } },
  network: { bytesIn: 1_024, bytesOut: 2_048 },
};
const after = {
  at: 11_000,
  opcounters: { insert: 20, query: 15, update: 7, delete: 1, getmore: 0, command: 30 },
  opLatencies: { reads: { latency: 6_000, ops: 15 }, writes: { latency: 5_000, ops: 7 }, commands: { latency: 0, ops: 0 } },
  network: { bytesIn: 11_264, bytesOut: 22_528 },
};
const rates = diff(before, after);
assert.strictEqual(rates.ops.insert, 1);
assert.strictEqual(rates.ops.total, 3.5);
assert.strictEqual(rates.latencyMs.reads, 1);
assert.strictEqual(rates.latencyMs.writes, 1.5);
assert.strictEqual(rates.networkKbIn, 1);
assert.strictEqual(rates.networkKbOut, 2);
assert.strictEqual(diff(after, before), null);

const normalized = normaliseRaw({
  uptime: 42,
  version: "8.0.0",
  storageEngine: { name: "wiredTiger" },
  wiredTiger: { cache: { "bytes currently in the cache": 10 * 1048576, "maximum bytes configured": 20 * 1048576, "tracked dirty bytes in the cache": 1048576 } },
});
assert.strictEqual(normalized.uptimeSec, 42);
assert.strictEqual(normalized.wiredTigerCache.usedMb, 10);
assert.strictEqual(normalized.wiredTigerCache.maxMb, 20);

console.log("Mongo monitor tests passed");
