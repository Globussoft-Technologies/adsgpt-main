const crypto = require("crypto");
const PartnerApiKey = require("../Module/partnerApi/partnerApiKey");

const HEADER_NAME = "x-api-key";

function hashKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

// Gates access to AdsGPT itself. Separate from requireMetaSystemUserToken,
// which gates access to Meta on the partner's behalf — a partner needs both:
// this key identifies WHO is calling us, the Meta token is what we call
// Meta with.
async function requirePartnerApiKey(req, res, next) {
  const rawKey = req.headers[HEADER_NAME];

  if (!rawKey) {
    return res.status(401).json({
      status: false,
      error: `Missing required header: ${HEADER_NAME}`,
    });
  }

  try {
    const record = await PartnerApiKey.findOne({
      hashedKey: hashKey(rawKey),
      status: "active",
    });

    if (!record) {
      return res.status(401).json({
        status: false,
        error: "Invalid or revoked API key",
      });
    }

    // Best-effort — a failed write here shouldn't fail the request.
    PartnerApiKey.updateOne(
      { _id: record._id },
      { lastUsedAt: new Date() },
    ).catch(() => {});

    req.partner = { id: record._id.toString(), name: record.partnerName };
    next();
  } catch (error) {
    return res.status(500).json({
      status: false,
      error: "Failed to verify API key",
    });
  }
}

module.exports = { requirePartnerApiKey, HEADER_NAME, hashKey };
