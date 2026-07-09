const crypto = require("crypto");
const PartnerApiKey = require("../../Module/partnerApi/partnerApiKey");
const { hashKey } = require("../../middlewares/partnerApiKey");

// Issue a new partner API key. The raw key is returned exactly once — only
// its hash is ever persisted, so losing the response means generating a
// new key (revoke the old one via PATCH .../revoke).
exports.createKey = async (req, res) => {
  try {
    const { partnerName } = req.body || {};

    if (!partnerName || !partnerName.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "partnerName is required" });
    }

    const rawKey = `pk_live_${crypto.randomBytes(24).toString("hex")}`;
    const keyPrefix = rawKey.slice(0, 16);

    const record = await PartnerApiKey.create({
      partnerName: partnerName.trim(),
      keyPrefix,
      hashedKey: hashKey(rawKey),
    });

    return res.status(201).json({
      success: true,
      apiKey: rawKey,
      id: record._id,
      partnerName: record.partnerName,
      keyPrefix: record.keyPrefix,
      message: "Store this key now — it will not be shown again.",
    });
  } catch (error) {
    console.error("Create partner API key error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create API key" });
  }
};

exports.listKeys = async (req, res) => {
  try {
    const keys = await PartnerApiKey.find(
      {},
      "partnerName keyPrefix status lastUsedAt createdAt",
    ).sort({ createdAt: -1 });

    return res.json({ success: true, keys });
  } catch (error) {
    console.error("List partner API keys error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to list API keys" });
  }
};

exports.revokeKey = async (req, res) => {
  try {
    const { id } = req.params;

    const record = await PartnerApiKey.findByIdAndUpdate(
      id,
      { status: "revoked" },
      { new: true },
    );

    if (!record) {
      return res.status(404).json({ success: false, message: "API key not found" });
    }

    return res.json({
      success: true,
      id: record._id,
      partnerName: record.partnerName,
      status: record.status,
    });
  } catch (error) {
    console.error("Revoke partner API key error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to revoke API key" });
  }
};
