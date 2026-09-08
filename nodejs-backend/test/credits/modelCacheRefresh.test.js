#!/usr/bin/env node
/**
 * Regression tests for the model-catalog cache refresh.
 *
 * ─── The bug ────────────────────────────────────────────────────────────────
 * The admin save path used to run:
 *
 *     configurationService.invalidateCache();      // nulls the caches NOW
 *     await configurationService.refreshCache();   // ...then a DB round-trip
 *
 * getCachedModel() returns null when the cache is empty, getRuntimeCredit()
 * returns 0 for a null entry, and freezeCredits() treats a 0 amount as a
 * no-op. So for the whole duration of that round-trip EVERY model priced at 0
 * and every generation started in the window rendered completely unmetered —
 * on every admin model save.
 *
 * These tests pin the two properties that close it:
 *   1. refreshCache() reads first and assigns afterwards, so the cache is
 *      never empty mid-refresh.
 *   2. The admin controller's refresh() does not blank the cache first.
 */

const assert = require("node:assert/strict");

const {
  createModelConfigurationService,
} = require("../../services/modelConfigurationService");

const ROWS = [
  {
    canonicalKey: "veo-3.1-fast",
    displayName: "Veo 3.1 fast",
    type: "video",
    aliases: ["Veo 3.1 fast"],
    enabled: true,
    archived: false,
    credits: 4,
    sortOrder: 0,
  },
];

/**
 * A stub Mongoose model whose find() resolves on the next tick, so a caller can
 * observe the cache *while the read is in flight* — which is exactly where the
 * bug lived.
 */
function makeModelStub(rows = ROWS) {
  let resolveRead;
  const stub = {
    find() {
      return {
        sort() {
          return {
            lean() {
              return new Promise((resolve) => {
                resolveRead = () => resolve(rows.map((r) => ({ ...r })));
              });
            },
          };
        },
      };
    },
    finishRead: () => resolveRead(),
  };
  return stub;
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

(async () => {
  console.log("model catalog cache refresh");

  await test("a model stays priceable while a refresh is in flight", async () => {
    const model = makeModelStub();
    const service = createModelConfigurationService({ model });

    // Warm the cache once.
    const first = service.refreshCache();
    model.finishRead();
    await first;

    assert.equal(
      service.getRuntimeCredit(service.getRuntimeModel("veo-3.1-fast")),
      4,
      "precondition: model resolves and prices at 4",
    );

    // Start a second refresh and inspect the cache before its read resolves —
    // this is the admin-save window.
    const inFlight = service.refreshCache();

    assert.notEqual(
      service.getRuntimeModel("veo-3.1-fast"),
      null,
      "model must still resolve while a refresh is in flight",
    );
    assert.equal(
      service.getRuntimeCredit(service.getRuntimeModel("veo-3.1-fast")),
      4,
      "price must not drop to 0 mid-refresh — that is the free-generation bug",
    );

    model.finishRead();
    await inFlight;
  });

  await test("an admin model save never blanks the cache", async () => {
    const row = { ...ROWS[0] };

    // Full stub for the write path: findOne + findOneAndUpdate, both .lean().
    const model = {
      findOne: () => ({ lean: async () => ({ ...row }) }),
      findOneAndUpdate: () => ({ lean: async () => ({ ...row }) }),
      find: () => ({ sort: () => ({ lean: async () => [{ ...row }] }) }),
    };

    const calls = [];
    const service = createModelConfigurationService({ model });
    await service.refreshCache();

    const spied = {
      ...service,
      invalidateCache() {
        calls.push("invalidate");
        return service.invalidateCache();
      },
      refreshCache() {
        calls.push("refresh");
        return service.refreshCache();
      },
    };

    const {
      createModelConfigurationController,
    } = require("../../controllers/admin/modelConfiguration.controller");
    const controller = createModelConfigurationController({
      model,
      auditModel: { async create() {} },
      configurationService: spied,
    });

    let status = 200;
    const res = {
      json() {},
      status(code) {
        status = code;
        return { json() {} };
      },
    };

    await controller.updateModel(
      { params: { canonicalKey: "veo-3.1-fast" }, body: { credits: 4 }, admin: {} },
      res,
    );

    // Guard against a vacuous pass: the save must actually have reached
    // refresh(), otherwise "invalidate was never called" proves nothing.
    assert.equal(status, 200, `save failed (status ${status}) — test would be vacuous`);
    assert.ok(calls.includes("refresh"), "the save must reach refresh()");
    assert.ok(
      !calls.includes("invalidate"),
      "refresh() must not null the cache ahead of its DB read — that window " +
        "prices every model at 0 and makes generations free",
    );
  });

  console.log(
    failures === 0
      ? "\nPASS — model catalog cache refresh"
      : `\nFAIL — ${failures} assertion(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
