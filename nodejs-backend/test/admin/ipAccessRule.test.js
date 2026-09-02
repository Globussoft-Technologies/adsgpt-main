const assert = require("node:assert");
const { parseIpOrCidr, validateRulePayload } = require("../../utils/ipAccessRule");

assert.deepStrictEqual(parseIpOrCidr(" 192.168.1.1 "), {
  valid: true,
  value: "192.168.1.1",
  version: 4,
  kind: "address",
});
assert.deepStrictEqual(parseIpOrCidr("10.0.0.0/08"), {
  valid: true,
  value: "10.0.0.0/8",
  version: 4,
  kind: "cidr",
});
assert.strictEqual(parseIpOrCidr("2001:db8::/64").valid, true);
assert.strictEqual(parseIpOrCidr("10.0.0.1/33").valid, false);
assert.strictEqual(parseIpOrCidr("not-an-ip").valid, false);

const valid = validateRulePayload({ value: "203.0.113.4", label: "Office", action: "allow" });
assert.strictEqual(valid.valid, true);
assert.strictEqual(valid.value.status, "active");
assert.strictEqual(valid.value.ipVersion, 4);

assert.strictEqual(validateRulePayload({ value: "203.0.113.4", label: "", action: "allow" }).valid, false);
assert.strictEqual(validateRulePayload({ value: "203.0.113.4", label: "Office", action: "deny" }).valid, false);
assert.strictEqual(validateRulePayload({}, { partial: true }).valid, false);
assert.deepStrictEqual(validateRulePayload({ status: "inactive" }, { partial: true }), {
  valid: true,
  value: { status: "inactive" },
});

console.log("IP access rule validation tests passed");
