const mongoose = require("mongoose");
const IpAccessRule = require("../../Module/admin/ipAccessRule");
const { validateRulePayload } = require("../../utils/ipAccessRule");

function isDuplicateKey(error) {
  return error?.code === 11000;
}

exports.listRules = async (req, res) => {
  try {
    const query = {};
    if (["allow", "block"].includes(req.query.action)) query.action = req.query.action;
    if (["active", "inactive"].includes(req.query.status)) query.status = req.query.status;

    const search = String(req.query.search || "").trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { value: { $regex: escaped, $options: "i" } },
        { label: { $regex: escaped, $options: "i" } },
        { notes: { $regex: escaped, $options: "i" } },
      ];
    }

    const [rules, totals] = await Promise.all([
      IpAccessRule.find(query).sort({ updatedAt: -1 }).lean(),
      IpAccessRule.aggregate([
        { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } }, allowed: { $sum: { $cond: [{ $eq: ["$action", "allow"] }, 1, 0] } }, blocked: { $sum: { $cond: [{ $eq: ["$action", "block"] }, 1, 0] } } } },
      ]),
    ]);

    return res.json({
      success: true,
      rules,
      summary: totals[0] || { total: 0, active: 0, allowed: 0, blocked: 0 },
    });
  } catch (error) {
    console.error("List IP access rules error:", error);
    return res.status(500).json({ success: false, message: "Failed to list IP access rules" });
  }
};

exports.createRule = async (req, res) => {
  const parsed = validateRulePayload(req.body);
  if (!parsed.valid) return res.status(400).json({ success: false, message: parsed.message });

  try {
    const username = req.admin?.username || "admin";
    const rule = await IpAccessRule.create({ ...parsed.value, createdBy: username, updatedBy: username });
    return res.status(201).json({ success: true, rule });
  } catch (error) {
    if (isDuplicateKey(error)) {
      return res.status(409).json({ success: false, message: "A rule for this IP address or range already exists" });
    }
    console.error("Create IP access rule error:", error);
    return res.status(500).json({ success: false, message: "Failed to create IP access rule" });
  }
};

exports.updateRule = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid rule id" });
  }
  const parsed = validateRulePayload(req.body, { partial: true });
  if (!parsed.valid) return res.status(400).json({ success: false, message: parsed.message });

  try {
    const rule = await IpAccessRule.findByIdAndUpdate(
      req.params.id,
      { ...parsed.value, updatedBy: req.admin?.username || "admin" },
      { new: true, runValidators: true },
    );
    if (!rule) return res.status(404).json({ success: false, message: "IP access rule not found" });
    return res.json({ success: true, rule });
  } catch (error) {
    if (isDuplicateKey(error)) {
      return res.status(409).json({ success: false, message: "A rule for this IP address or range already exists" });
    }
    console.error("Update IP access rule error:", error);
    return res.status(500).json({ success: false, message: "Failed to update IP access rule" });
  }
};

exports.deleteRule = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid rule id" });
  }
  try {
    const rule = await IpAccessRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: "IP access rule not found" });
    return res.json({ success: true, id: rule._id });
  } catch (error) {
    console.error("Delete IP access rule error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete IP access rule" });
  }
};
