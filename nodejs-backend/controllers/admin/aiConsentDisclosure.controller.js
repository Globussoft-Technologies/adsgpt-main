const AiConsentDisclosure = require("../../Module/privacy/aiConsentDisclosureModel");
const { PLATFORMS, VERSION_RE, compareVersions } = AiConsentDisclosure;
const logger = require("../../utils/logger");

// GET /adsgpt/admin/ai-consent/disclosures?platform=ios
// Published versions, newest first, plus the current version per platform.
// platform is optional; without it every platform is listed.
exports.listDisclosures = async (req, res) => {
  try {
    const { platform } = req.query;
    if (platform && !PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `platform must be one of: ${PLATFORMS.join(", ")}` });
    }

    const disclosures = (await AiConsentDisclosure.find(platform ? { platform } : {}).lean())
      .sort((a, b) => a.platform.localeCompare(b.platform) || compareVersions(b.version, a.version));

    const currentVersions = {};
    for (const d of disclosures) {
      if (!currentVersions[d.platform]) currentVersions[d.platform] = d.version;
    }

    return res.json({ success: true, currentVersions, disclosures });
  } catch (error) {
    logger.error("[listDisclosures] error:", error);
    return res.status(500).json({ success: false, message: "Failed to list disclosures" });
  }
};

// POST /adsgpt/admin/ai-consent/disclosures { platform, version, text }
// Publishes a version for one platform. It must be higher than that platform's
// current version, and becomes current immediately, so that platform's users
// are asked again. Published versions can't be edited or deleted.
exports.publishDisclosure = async (req, res) => {
  try {
    const { platform } = req.body || {};
    const version = typeof req.body?.version === "string" ? req.body.version.trim() : "";
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `platform must be one of: ${PLATFORMS.join(", ")}` });
    }
    if (!VERSION_RE.test(version)) {
      return res.status(400).json({ success: false, message: 'version must look like "1", "1.1" or "1.1.1"' });
    }
    if (!text) {
      return res.status(400).json({ success: false, message: "text is required" });
    }

    const current = await AiConsentDisclosure.findCurrent(platform);
    if (current && compareVersions(version, current.version) <= 0) {
      return res.status(409).json({
        success: false,
        message: `version must be higher than the current ${platform} version ${current.version}`,
      });
    }

    const disclosure = await AiConsentDisclosure.create({
      platform,
      version,
      text,
      created_by: req.admin?.username || "",
    });

    return res.status(201).json({ success: true, disclosure });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "That version already exists for this platform" });
    }
    logger.error("[publishDisclosure] error:", error);
    return res.status(500).json({ success: false, message: "Failed to publish disclosure" });
  }
};
