#!/usr/bin/env node
/**
 * Plain-Node tests for the user-defined Autopilot rules feature (v4).
 *
 * Covers the pure pieces:
 *   - createRuleSchema accepts well-formed bodies
 *   - createRuleSchema rejects every flavor of malformed input
 *   - per-field-type op restrictions (numeric vs string fields)
 *   - per-field-type value coercion
 *   - hard caps (attachments / conditions / name / description length)
 *   - updateRuleSchema's "≥1 field present" + per-field validity
 *
 * Mongo CRUD + ownership enforcement is exercised via Module._load stubs
 * matching the pattern used in alertService.test / targetDiscovery.test.
 *
 * Run:  node test/autopilot/userRule.test.js
 */

const assert = require("node:assert/strict");
const Module = require("node:module");

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
function testAsync(name, fn) {
  return (async () => {
    try {
      await fn();
      pass += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      fail += 1;
      FAILURES.push({ name, err });
      console.log(`  ✗ ${name}`);
      console.log(`      ${err.stack || err.message}`);
    }
  })();
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

const {
  createRuleSchema,
  updateRuleSchema,
  NUMERIC_FIELDS,
  STRING_FIELDS,
  MAX_ATTACHMENTS,
  MAX_CONDITION_ROWS,
} = require("../../Validations/autopilotUserRule.validator");
// Real (unstubbed) module — required before `Module._load` is patched below,
// so this captures the actual implementation the controller uses in prod.
const { parseAdAccountIdFilter } = require("../../config/autopilotConfig");

// ─── helpers ────────────────────────────────────────────────────────────────
const validRule = (overrides = {}) => ({
  name: "Pause if no conversions",
  description: "Pause active campaigns spending > ₹500 with zero purchases.",
  severity: "high",
  evaluateOn: "campaign",
  conditions: {
    operator: "AND",
    rules: [
      { field: "status", op: "==", value: "ACTIVE" },
      { field: "spend", op: ">", value: 50000 },
      { field: "purchases", op: "==", value: 0 },
    ],
  },
  action: { type: "pause" },
  attachments: [{ adAccountId: "act_1262110972306470", campaignId: "987654321" }],
  ...overrides,
});

function assertValid(body, schema = createRuleSchema) {
  const { error } = schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
  assert.equal(
    error,
    undefined,
    `expected valid, got: ${error && error.details.map((d) => d.message).join("; ")}`,
  );
}
function assertInvalid(body, expectedFragment, schema = createRuleSchema) {
  const { error } = schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
  assert.ok(error, "expected validation error");
  if (expectedFragment) {
    const all = error.details.map((d) => d.message).join(" | ");
    assert.ok(
      all.toLowerCase().includes(expectedFragment.toLowerCase()),
      `expected error containing "${expectedFragment}", got: ${all}`,
    );
  }
}

// ─── createRuleSchema — happy paths ─────────────────────────────────────────
group("createRuleSchema — accepts well-formed rules", () => {
  test("baseline valid rule", () => {
    assertValid(validRule());
  });

  test("evaluateOn: 'adset' is allowed", () => {
    assertValid(validRule({ evaluateOn: "adset" }));
  });

  test("evaluateOn: 'ad' is allowed", () => {
    assertValid(validRule({ evaluateOn: "ad" }));
  });

  test("severity 'low' / 'medium' / 'high' all accepted", () => {
    assertValid(validRule({ severity: "low" }));
    assertValid(validRule({ severity: "medium" }));
    assertValid(validRule({ severity: "high" }));
  });

  test("action 'alert' is accepted", () => {
    assertValid(validRule({ action: { type: "alert" } }));
  });

  test("bare-numeric adAccountId accepted (controller normalises)", () => {
    assertValid(
      validRule({
        attachments: [
          { adAccountId: "1262110972306470", campaignId: "987" },
        ],
      }),
    );
  });

  test("multiple attachments + conditions are allowed", () => {
    assertValid(
      validRule({
        attachments: [
          { adAccountId: "act_1", campaignId: "111" },
          { adAccountId: "act_2", campaignId: "222" },
          { adAccountId: "act_3", campaignId: "333" },
        ],
        conditions: {
          operator: "AND",
          rules: [
            { field: "spend", op: ">", value: 1000 },
            { field: "ctr", op: "<", value: 0.5 },
            { field: "status", op: "==", value: "ACTIVE" },
          ],
        },
      }),
    );
  });

  test("disabled rule is still valid (toggle off without delete)", () => {
    assertValid(validRule({ enabled: false }));
  });

  test("trims surrounding whitespace on name + description", () => {
    const { value } = createRuleSchema.validate(
      validRule({ name: "  My rule  ", description: "  desc  " }),
      { abortEarly: false, stripUnknown: true },
    );
    assert.equal(value.name, "My rule");
    assert.equal(value.description, "desc");
  });
});

// ─── createRuleSchema — required-field rejections ───────────────────────────
group("createRuleSchema — required-field rejections", () => {
  test("missing name", () => {
    const { name, ...r } = validRule();
    assertInvalid(r, "name");
  });
  test("missing description", () => {
    const { description, ...r } = validRule();
    assertInvalid(r, "description");
  });
  test("missing severity", () => {
    const { severity, ...r } = validRule();
    assertInvalid(r, "severity");
  });
  test("missing evaluateOn", () => {
    const { evaluateOn, ...r } = validRule();
    assertInvalid(r, "evaluateOn");
  });
  test("missing conditions", () => {
    const { conditions, ...r } = validRule();
    assertInvalid(r, "conditions");
  });
  test("missing action", () => {
    const { action, ...r } = validRule();
    assertInvalid(r, "action");
  });
  test("missing attachments", () => {
    const { attachments, ...r } = validRule();
    assertInvalid(r, "attachments");
  });
  test("empty attachments array rejected with friendly message", () => {
    assertInvalid(
      validRule({ attachments: [] }),
      "at least one campaign",
    );
  });
});

// ─── createRuleSchema — bounds ──────────────────────────────────────────────
group("createRuleSchema — hard caps", () => {
  test(`name > ${80} chars rejected`, () => {
    assertInvalid(validRule({ name: "x".repeat(81) }));
  });
  test(`description > ${500} chars rejected`, () => {
    assertInvalid(validRule({ description: "y".repeat(501) }));
  });
  test(`attachments > ${MAX_ATTACHMENTS} rejected`, () => {
    const lots = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({
      adAccountId: "act_1",
      campaignId: String(1000 + i),
    }));
    assertInvalid(validRule({ attachments: lots }), "at most");
  });
  test(`conditions.rules > ${MAX_CONDITION_ROWS} rejected`, () => {
    const lots = Array.from({ length: MAX_CONDITION_ROWS + 1 }, () => ({
      field: "spend",
      op: ">",
      value: 1,
    }));
    assertInvalid(
      validRule({ conditions: { operator: "AND", rules: lots } }),
      "at most",
    );
  });
  test("conditions.rules empty array rejected", () => {
    assertInvalid(
      validRule({ conditions: { operator: "AND", rules: [] } }),
      "at least one condition",
    );
  });
});

// ─── createRuleSchema — lookbackDays ────────────────────────────────────────
group("createRuleSchema — lookbackDays", () => {
  test("defaults to 14 when omitted", () => {
    const r = { ...validRule() };
    delete r.lookbackDays;
    const { error, value } = createRuleSchema.validate(r, {
      abortEarly: false,
      stripUnknown: true,
    });
    assert.equal(error, undefined);
    assert.equal(value.lookbackDays, 14);
  });
  test("accepts integer in [1, 90]", () => {
    assertValid(validRule({ lookbackDays: 1 }));
    assertValid(validRule({ lookbackDays: 7 }));
    assertValid(validRule({ lookbackDays: 30 }));
    assertValid(validRule({ lookbackDays: 90 }));
  });
  test("accepts maximum as the lifetime lookback preset", () => {
    assertValid(validRule({ lookbackPreset: "maximum" }));
  });
  test("rejects unknown lookback presets", () => {
    assertInvalid(validRule({ lookbackPreset: "lifetime" }));
  });
  test("rejects 0 / negative", () => {
    assertInvalid(validRule({ lookbackDays: 0 }));
    assertInvalid(validRule({ lookbackDays: -3 }));
  });
  test("rejects > 90", () => {
    assertInvalid(validRule({ lookbackDays: 91 }));
    assertInvalid(validRule({ lookbackDays: 365 }));
  });
  test("rejects non-integer", () => {
    assertInvalid(validRule({ lookbackDays: 7.5 }));
  });
});

// ─── createRuleSchema — field-typed value validation ────────────────────────
group("createRuleSchema — field types & operators", () => {
  test("numeric field with numeric value accepted", () => {
    assertValid(
      validRule({
        conditions: {
          operator: "AND",
          rules: [{ field: "spend", op: ">", value: 5000 }],
        },
      }),
    );
  });
  test("numeric field with string value rejected", () => {
    assertInvalid(
      validRule({
        conditions: {
          operator: "AND",
          rules: [{ field: "spend", op: ">", value: "five thousand" }],
        },
      }),
      "must be a number",
    );
  });
  test("string field with string value accepted", () => {
    assertValid(
      validRule({
        conditions: {
          operator: "AND",
          rules: [{ field: "status", op: "==", value: "ACTIVE" }],
        },
      }),
    );
  });
  test("string field with numeric value rejected", () => {
    assertInvalid(
      validRule({
        conditions: {
          operator: "AND",
          rules: [{ field: "status", op: "==", value: 1 }],
        },
      }),
    );
  });
  test("string field with > operator rejected", () => {
    assertInvalid(
      validRule({
        conditions: {
          operator: "AND",
          rules: [{ field: "status", op: ">", value: "ACTIVE" }],
        },
      }),
      "string fields",
    );
  });
  test("unknown field rejected", () => {
    assertInvalid(
      validRule({
        conditions: {
          operator: "AND",
          rules: [{ field: "totally_made_up", op: ">", value: 1 }],
        },
      }),
      "field must be one of",
    );
  });
  test("unknown op rejected", () => {
    assertInvalid(
      validRule({
        conditions: {
          operator: "AND",
          rules: [{ field: "spend", op: "between", value: 5 }],
        },
      }),
    );
  });
  test("OR combinator rejected (deferred to v2)", () => {
    assertInvalid(
      validRule({
        conditions: {
          operator: "OR",
          rules: [{ field: "spend", op: ">", value: 1 }],
        },
      }),
    );
  });
  test("every NUMERIC_FIELDS entry accepted with numeric value", () => {
    for (const f of NUMERIC_FIELDS) {
      assertValid(
        validRule({
          conditions: {
            operator: "AND",
            rules: [{ field: f, op: ">", value: 1 }],
          },
        }),
      );
    }
  });
  test("every STRING_FIELDS entry accepted with string value", () => {
    for (const f of STRING_FIELDS) {
      assertValid(
        validRule({
          conditions: {
            operator: "AND",
            rules: [{ field: f, op: "==", value: "ANY_VALUE" }],
          },
        }),
      );
    }
  });
});

// ─── createRuleSchema — attachment shape ────────────────────────────────────
group("createRuleSchema — attachment shape", () => {
  test("non-numeric campaignId rejected", () => {
    assertInvalid(
      validRule({
        attachments: [{ adAccountId: "act_1", campaignId: "not-a-number" }],
      }),
    );
  });
  test("missing campaignId rejected", () => {
    assertInvalid(
      validRule({ attachments: [{ adAccountId: "act_1" }] }),
    );
  });
  test("missing adAccountId rejected", () => {
    assertInvalid(
      validRule({ attachments: [{ campaignId: "111" }] }),
    );
  });
  test("garbage adAccountId rejected", () => {
    assertInvalid(
      validRule({
        attachments: [{ adAccountId: "act_FOO", campaignId: "111" }],
      }),
    );
  });
});

// ─── action shape ───────────────────────────────────────────────────────────
group("createRuleSchema — action shape", () => {
  test("unknown action.type rejected", () => {
    assertInvalid(validRule({ action: { type: "scale_budget" } }));
  });
  test("missing action.type rejected", () => {
    assertInvalid(validRule({ action: {} }));
  });
});

// ─── updateRuleSchema ───────────────────────────────────────────────────────
group("updateRuleSchema", () => {
  test("empty body rejected", () => {
    assertInvalid({}, "at least one field", updateRuleSchema);
  });
  test("partial valid update accepted", () => {
    assertValid({ enabled: false }, updateRuleSchema);
  });
  test("rename only — accepted", () => {
    assertValid({ name: "Renamed rule" }, updateRuleSchema);
  });
  test("attachments cannot be patched to empty", () => {
    assertInvalid(
      { attachments: [] },
      "at least one",
      updateRuleSchema,
    );
  });
  test("invalid severity in patch rejected", () => {
    assertInvalid({ severity: "extreme" }, undefined, updateRuleSchema);
  });
  test("conditions patch with invalid field rejected", () => {
    assertInvalid(
      {
        conditions: {
          operator: "AND",
          rules: [{ field: "FOO", op: ">", value: 1 }],
        },
      },
      undefined,
      updateRuleSchema,
    );
  });
});

// `parseAdAccountIdFilter` backs the account-scoped filtering the Autopilot
// account selector (Overview / Action log / rules list) relies on — a plain
// string for one id, `{ $in }` for several, `undefined` for "no filter" so
// callers can splat it into a Mongo query without an extra `if`.
group("parseAdAccountIdFilter", () => {
  test("empty/undefined input → undefined (no filter)", () => {
    assert.equal(parseAdAccountIdFilter(""), undefined);
    assert.equal(parseAdAccountIdFilter(undefined), undefined);
  });
  test("single id → plain normalized string", () => {
    assert.equal(parseAdAccountIdFilter("123"), "act_123");
    assert.equal(parseAdAccountIdFilter("act_123"), "act_123");
  });
  test("comma-separated ids → normalized $in list", () => {
    assert.deepEqual(parseAdAccountIdFilter("123,act_456"), {
      $in: ["act_123", "act_456"],
    });
  });
  test("blank entries between commas are dropped", () => {
    assert.deepEqual(parseAdAccountIdFilter("123,,456"), {
      $in: ["act_123", "act_456"],
    });
  });
});

// ─── controller — Mongo CRUD + ownership ────────────────────────────────────
//
// Stub the AutopilotUserRule Mongoose model with an in-memory implementation
// so we can exercise the controller's ownership filter without a live DB.
const stubs = {
  docs: [], // [{ _id, userId, ...rule }]
};

const originalLoad = Module._load;
let nextId = 1;
function newId() {
  return String(nextId++);
}

Module._load = function patched(request, parent, isMain) {
  if (request.endsWith("Module/autopilot/autopilotUserRule")) {
    return {
      find: (q) => ({
        sort: () => ({
          lean: async () =>
            stubs.docs.filter(matchesQuery(q)),
        }),
      }),
      findOne: (q) => ({
        lean: async () => stubs.docs.find(matchesQuery(q)) || null,
      }),
      create: async (doc) => {
        const created = {
          _id: newId(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...doc,
        };
        stubs.docs.push(created);
        return { toObject: () => created, ...created };
      },
      findOneAndUpdate: (q, patch) => ({
        lean: async () => {
          const idx = stubs.docs.findIndex(matchesQuery(q));
          if (idx === -1) return null;
          stubs.docs[idx] = {
            ...stubs.docs[idx],
            ...(patch.$set || {}),
            updatedAt: new Date(),
          };
          return stubs.docs[idx];
        },
      }),
      findOneAndDelete: (q) => ({
        lean: async () => {
          const idx = stubs.docs.findIndex(matchesQuery(q));
          if (idx === -1) return null;
          const [doc] = stubs.docs.splice(idx, 1);
          return doc;
        },
      }),
    };
  }
  if (request.endsWith("config/autopilotConfig")) {
    const normalizeAdAccountId = (id) =>
      !id
        ? id
        : String(id).startsWith("act_")
          ? String(id)
          : `act_${id}`;
    return {
      normalizeAdAccountId,
      parseAdAccountIdFilter: (raw) => {
        if (!raw) return undefined;
        const ids = String(raw)
          .split(",")
          .map((s) => normalizeAdAccountId(s.trim()))
          .filter(Boolean);
        if (ids.length === 0) return undefined;
        return ids.length === 1 ? ids[0] : { $in: ids };
      },
    };
  }
  if (request.endsWith("utils/logger")) {
    return { info: () => {}, warn: () => {}, error: () => {} };
  }
  return originalLoad.apply(this, arguments);
};

// Resolves a (possibly dotted) query key against a doc, mirroring Mongo's
// own array semantics — `attachments.adAccountId` reads every attachment's
// `adAccountId` into a flat array so `$in`/equality checks below can match
// against any element (like a real `find({'attachments.adAccountId': ...})`).
function fieldValue(doc, key) {
  if (!key.includes(".")) return doc[key];
  const [base, subKey] = [key.slice(0, key.indexOf(".")), key.slice(key.indexOf(".") + 1)];
  const baseVal = doc[base];
  return Array.isArray(baseVal) ? baseVal.map((item) => item?.[subKey]) : baseVal?.[subKey];
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === "object" && "$in" in expected) {
    const candidates = Array.isArray(actual) ? actual : [actual];
    return candidates.some((v) => expected.$in.includes(v));
  }
  if (Array.isArray(actual)) return actual.includes(expected);
  return actual === expected;
}

function matchesQuery(q) {
  return (doc) => {
    for (const [k, v] of Object.entries(q || {})) {
      if (!matchesValue(fieldValue(doc, k), v)) return false;
    }
    return true;
  };
}

// Re-require the controller now that loaders are patched.
const userRuleController = require("../../controllers/autopilot/autopilotUserRuleController");

function fakeReq({ user_id, body, params, query }) {
  return {
    user: { user_id },
    body: body || {},
    params: params || {},
    query: query || {},
  };
}
function fakeRes() {
  const out = {};
  out.status = (code) => {
    out.statusCode = code;
    return out;
  };
  out.json = (payload) => {
    out.payload = payload;
    return out;
  };
  return out;
}

(async () => {
  await group("controller — list", async () => {
    await testAsync("returns only the caller's rules", async () => {
      stubs.docs = [
        { _id: "1", userId: "u1", name: "A" },
        { _id: "2", userId: "u2", name: "B" },
        { _id: "3", userId: "u1", name: "C" },
      ];
      const req = fakeReq({ user_id: "u1" });
      const res = fakeRes();
      await userRuleController.list(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.status, true);
      assert.equal(res.payload.rules.length, 2);
      assert.deepEqual(
        res.payload.rules.map((r) => r._id).sort(),
        ["1", "3"],
      );
    });

    await testAsync(
      "adAccountId query param scopes to rules whose attachments touch it",
      async () => {
        stubs.docs = [
          {
            _id: "1",
            userId: "u1",
            name: "A",
            attachments: [{ adAccountId: "act_100" }],
          },
          {
            _id: "2",
            userId: "u1",
            name: "B",
            // Spans two accounts — should surface for either one.
            attachments: [{ adAccountId: "act_200" }, { adAccountId: "act_300" }],
          },
          {
            _id: "3",
            userId: "u1",
            name: "C",
            attachments: [{ adAccountId: "act_999" }],
          },
        ];
        const req = fakeReq({ user_id: "u1", query: { adAccountId: "100,300" } });
        const res = fakeRes();
        await userRuleController.list(req, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(
          res.payload.rules.map((r) => r._id).sort(),
          ["1", "2"],
        );
      },
    );
  });

  await group("controller — create", async () => {
    await testAsync("rejects invalid body with 400", async () => {
      stubs.docs = [];
      const req = fakeReq({ user_id: "u1", body: { name: "incomplete" } });
      const res = fakeRes();
      await userRuleController.create(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.status, false);
      assert.ok(Array.isArray(res.payload.details));
    });

    await testAsync(
      "creates with userId stamped + adAccountId normalised",
      async () => {
        stubs.docs = [];
        const body = validRule({
          attachments: [
            { adAccountId: "1262110972306470", campaignId: "987" },
          ],
        });
        const req = fakeReq({ user_id: "u1", body });
        const res = fakeRes();
        await userRuleController.create(req, res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.payload.status, true);
        assert.equal(res.payload.rule.userId, "u1");
        assert.equal(
          res.payload.rule.attachments[0].adAccountId,
          "act_1262110972306470",
          "controller should canonicalise to act_-prefixed",
        );
        // Defensive: client cannot smuggle orphan flags on create.
        assert.equal(res.payload.rule.attachments[0].orphan, false);
      },
    );
  });

  await group("controller — update", async () => {
    await testAsync(
      "returns 404 when patching another user's rule",
      async () => {
        stubs.docs = [{ _id: "1", userId: "u_other", name: "x" }];
        const req = fakeReq({
          user_id: "u_attacker",
          body: { name: "hijacked" },
          params: { id: "1" },
        });
        const res = fakeRes();
        await userRuleController.update(req, res);
        assert.equal(res.statusCode, 404);
        // Confirm doc was not mutated.
        assert.equal(stubs.docs[0].name, "x");
      },
    );
    await testAsync(
      "rejects empty patch body with 400",
      async () => {
        stubs.docs = [{ _id: "1", userId: "u1", name: "x" }];
        const req = fakeReq({
          user_id: "u1",
          body: {},
          params: { id: "1" },
        });
        const res = fakeRes();
        await userRuleController.update(req, res);
        assert.equal(res.statusCode, 400);
      },
    );
    await testAsync(
      "applies a valid partial patch",
      async () => {
        stubs.docs = [{ _id: "1", userId: "u1", name: "x", enabled: true }];
        const req = fakeReq({
          user_id: "u1",
          body: { enabled: false },
          params: { id: "1" },
        });
        const res = fakeRes();
        await userRuleController.update(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.payload.rule.enabled, false);
      },
    );
  });

  await group("controller — delete", async () => {
    await testAsync(
      "returns 404 when deleting another user's rule",
      async () => {
        stubs.docs = [{ _id: "1", userId: "u_other", name: "x" }];
        const req = fakeReq({ user_id: "u_attacker", params: { id: "1" } });
        const res = fakeRes();
        await userRuleController.remove(req, res);
        assert.equal(res.statusCode, 404);
        assert.equal(stubs.docs.length, 1, "doc should not be deleted");
      },
    );
    await testAsync("deletes the caller's rule", async () => {
      stubs.docs = [{ _id: "1", userId: "u1", name: "x" }];
      const req = fakeReq({ user_id: "u1", params: { id: "1" } });
      const res = fakeRes();
      await userRuleController.remove(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(stubs.docs.length, 0);
    });
  });

  await group("controller — test (preview)", async () => {
    await testAsync(
      "returns 404 for another user's rule",
      async () => {
        stubs.docs = [{ _id: "1", userId: "u_other" }];
        const req = fakeReq({ user_id: "u_attacker", params: { id: "1" } });
        const res = fakeRes();
        await userRuleController.test(req, res);
        assert.equal(res.statusCode, 404);
      },
    );
    await testAsync(
      "Phase 1 stub returns notImplemented: true",
      async () => {
        stubs.docs = [{ _id: "1", userId: "u1" }];
        const req = fakeReq({ user_id: "u1", params: { id: "1" } });
        const res = fakeRes();
        await userRuleController.test(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.payload.notImplemented, true);
        assert.deepEqual(res.payload.evaluations, []);
      },
    );
  });

  // ─── Phase 2 — templates ──────────────────────────────────────────────
  const {
    listTemplates,
    TEMPLATES,
  } = require("../../config/autopilotRuleTemplates");

  await group("templates — catalog shape", async () => {
    await testAsync("at least 10 templates", () => {
      assert.ok(
        TEMPLATES.length >= 10,
        `expected ≥10 templates, got ${TEMPLATES.length}`,
      );
    });
    await testAsync("every template has required surface fields", () => {
      for (const t of TEMPLATES) {
        assert.ok(t.id, "template missing id");
        assert.ok(t.category, `template ${t.id} missing category`);
        assert.ok(t.headline, `template ${t.id} missing headline`);
        assert.ok(t.blurb, `template ${t.id} missing blurb`);
        assert.ok(t.template, `template ${t.id} missing template object`);
      }
    });
    await testAsync(
      "every template's `template` object passes createRuleSchema (after attaching one campaign)",
      () => {
        // Templates omit `attachments` because the user picks campaigns
        // per-rule. To verify the rest of the shape is valid, pad in a
        // dummy attachment and run the validator.
        for (const t of TEMPLATES) {
          const candidate = {
            ...t.template,
            attachments: [
              { adAccountId: "act_1", campaignId: "111" },
            ],
          };
          const { error } = createRuleSchema.validate(candidate, {
            abortEarly: false,
          });
          assert.equal(
            error,
            undefined,
            `${t.id} fails validator: ${error && error.details.map((d) => d.message).join("; ")}`,
          );
        }
      },
    );
    await testAsync("template ids are unique", () => {
      const ids = TEMPLATES.map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length, "duplicate template ids");
    });
    await testAsync("templates span all severity levels", () => {
      const sevs = new Set(TEMPLATES.map((t) => t.template.severity));
      for (const s of ["low", "medium", "high"]) {
        assert.ok(sevs.has(s), `no template with severity '${s}'`);
      }
    });
    await testAsync("templates span all evaluateOn levels", () => {
      const levels = new Set(TEMPLATES.map((t) => t.template.evaluateOn));
      for (const l of ["campaign", "adset", "ad"]) {
        assert.ok(levels.has(l), `no template with evaluateOn '${l}'`);
      }
    });
  });

  await group("controller — templates endpoint", async () => {
    await testAsync(
      "returns the full template catalog",
      async () => {
        const req = fakeReq({ user_id: "u1" });
        const res = fakeRes();
        await userRuleController.templates(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.payload.status, true);
        assert.equal(res.payload.templates.length, TEMPLATES.length);
      },
    );
    await testAsync(
      "templates response is a copy (caller can't mutate seed)",
      async () => {
        const req = fakeReq({ user_id: "u1" });
        const res = fakeRes();
        await userRuleController.templates(req, res);
        // Mutate the response.
        res.payload.templates[0].headline = "MUTATED";
        // Re-call: original headline should be intact.
        const res2 = fakeRes();
        await userRuleController.templates(req, res2);
        assert.notEqual(res2.payload.templates[0].headline, "MUTATED");
      },
    );
  });

  // listTemplates exported smoke check
  await testAsync(
    "listTemplates() returns plain array of objects",
    () => {
      const out = listTemplates();
      assert.ok(Array.isArray(out));
      assert.ok(out.every((t) => typeof t === "object"));
    },
  );

  // Restore loader + report.
  Module._load = originalLoad;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of FAILURES) {
      console.log(`  - ${f.name}: ${f.err.stack || f.err.message}`);
    }
    process.exit(1);
  }
})();
