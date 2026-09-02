const net = require("node:net");

const ACTIONS = ["allow", "block"];
const STATUSES = ["active", "inactive"];

function normalizeIpValue(value) {
  return String(value || "").trim().toLowerCase();
}

function parseIpOrCidr(value) {
  const normalized = normalizeIpValue(value);
  if (!normalized) return { valid: false, message: "IP address or CIDR is required" };

  const parts = normalized.split("/");
  if (parts.length > 2) return { valid: false, message: "Enter a valid IP address or CIDR range" };

  const version = net.isIP(parts[0]);
  if (!version) return { valid: false, message: "Enter a valid IPv4 or IPv6 address" };

  if (parts.length === 1) {
    return { valid: true, value: parts[0], version, kind: "address" };
  }

  if (!/^\d+$/.test(parts[1])) {
    return { valid: false, message: "CIDR prefix must be a number" };
  }

  const prefix = Number(parts[1]);
  const maximum = version === 4 ? 32 : 128;
  if (prefix < 0 || prefix > maximum) {
    return { valid: false, message: `IPv${version} CIDR prefix must be between 0 and ${maximum}` };
  }

  return { valid: true, value: `${parts[0]}/${prefix}`, version, kind: "cidr" };
}

function validateRulePayload(payload, { partial = false } = {}) {
  const input = payload && typeof payload === "object" ? payload : {};
  const output = {};

  if (!partial || Object.prototype.hasOwnProperty.call(input, "value")) {
    const parsed = parseIpOrCidr(input.value);
    if (!parsed.valid) return { valid: false, message: parsed.message };
    output.value = parsed.value;
    output.ipVersion = parsed.version;
    output.kind = parsed.kind;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "action")) {
    if (!ACTIONS.includes(input.action)) {
      return { valid: false, message: `action must be one of: ${ACTIONS.join(", ")}` };
    }
    output.action = input.action;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "status")) {
    const status = input.status || "active";
    if (!STATUSES.includes(status)) {
      return { valid: false, message: `status must be one of: ${STATUSES.join(", ")}` };
    }
    output.status = status;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "label")) {
    const label = String(input.label || "").trim();
    if (!label) return { valid: false, message: "label is required" };
    if (label.length > 100) return { valid: false, message: "label cannot exceed 100 characters" };
    output.label = label;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "notes")) {
    const notes = String(input.notes || "").trim();
    if (notes.length > 500) return { valid: false, message: "notes cannot exceed 500 characters" };
    output.notes = notes;
  }

  if (partial && Object.keys(output).length === 0) {
    return { valid: false, message: "No supported fields were provided" };
  }

  return { valid: true, value: output };
}

module.exports = { ACTIONS, STATUSES, normalizeIpValue, parseIpOrCidr, validateRulePayload };
