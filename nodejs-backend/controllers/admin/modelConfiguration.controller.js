const AIModelConfiguration = require("../../Module/aiModel/aiModelConfiguration");
const AIModelConfigurationAudit = require("../../Module/aiModel/aiModelConfigurationAudit");
const modelConfigurationService = require("../../services/modelConfigurationService");
const { SURFACE_SLUGS } = require("../../config/surfaceCatalog");
const { validateModelPayload } = require("../../config/aiModelConfigurationValidation");

const WRITABLE_FIELDS = ["canonicalKey", "displayName", "type", "aliases", "enabled", "archived", "sortOrder", "icon", "description", "adminNotes", "credits", "pricing", "qualityTiers", "extraCharges", "aggregationCreditDefault", "capabilities", "surfaces", "metadata"];

function pickWritable(body) {
  return Object.fromEntries(WRITABLE_FIELDS.filter((field) => body?.[field] !== undefined).map((field) => [field, body[field]]));
}

function duplicateMessage(error) {
  if (error?.code !== 11000) return null;
  return error.keyPattern?.canonicalKey ? "A model with this canonicalKey already exists" : "A model with this value already exists";
}

function createModelConfigurationController({ model = AIModelConfiguration, auditModel = AIModelConfigurationAudit, configurationService = modelConfigurationService } = {}) {
  async function listModels(req, res) {
    try {
      const { type, enabled, archived, surface, search } = req.query || {};
      const rows = await model.find({}).sort({ sortOrder: 1, canonicalKey: 1 }).lean();
      const term = typeof search === "string" ? search.trim().toLowerCase() : "";
      const models = rows.filter((row) => {
        if (type && row.type !== type) return false;
        if (enabled !== undefined && row.enabled !== (enabled === "true" || enabled === "1")) return false;
        if (archived !== undefined && row.archived !== (archived === "true" || archived === "1")) return false;
        if (surface && row.surfaces?.[surface]?.enabled !== true) return false;
        if (term && ![row.canonicalKey, row.displayName, ...(row.aliases || [])].some((value) => String(value).toLowerCase().includes(term))) return false;
        return true;
      });
      return res.json({ success: true, surfaces: SURFACE_SLUGS, models });
    } catch (error) {
      console.error("List AI models error:", error);
      return res.status(500).json({ success: false, message: "Failed to load models" });
    }
  }

  async function getModel(req, res) {
    try {
      const row = await model.findOne({ canonicalKey: String(req.params.canonicalKey) }).lean();
      if (!row) return res.status(404).json({ success: false, message: "Model not found" });
      return res.json({ success: true, model: row });
    } catch (error) {
      console.error("Get AI model error:", error);
      return res.status(500).json({ success: false, message: "Failed to load model" });
    }
  }

  async function writeAudit(action, req, canonicalKey, before, after) {
    await auditModel.create({ action, canonicalKey, adminUsername: req.admin?.username, before, after });
  }

  async function refresh() {
    configurationService.invalidateCache();
    await configurationService.refreshCache();
  }

  async function createModel(req, res) {
    try {
      const body = req.body || {};
      const validationError = validateModelPayload(body);
      if (validationError) return res.status(400).json({ success: false, message: validationError });
      const created = await model.create({ canonicalKey: body.canonicalKey.trim(), ...pickWritable(body) });
      const result = created.toObject ? created.toObject() : created;
      await writeAudit("create", req, result.canonicalKey, null, result);
      await refresh();
      return res.status(201).json({ success: true, model: result });
    } catch (error) {
      const duplicate = duplicateMessage(error);
      if (duplicate) return res.status(409).json({ success: false, message: duplicate });
      console.error("Create AI model error:", error);
      return res.status(500).json({ success: false, message: "Failed to create model" });
    }
  }

  async function updateModel(req, res) {
    try {
      const canonicalKey = String(req.params.canonicalKey);
      const existing = await model.findOne({ canonicalKey }).lean();
      if (!existing) return res.status(404).json({ success: false, message: "Model not found" });
      const changes = pickWritable(req.body || {});
      const nextCanonicalKey = changes.canonicalKey !== undefined ? String(changes.canonicalKey).trim() : canonicalKey;
      const validationError = validateModelPayload({ ...changes, canonicalKey: nextCanonicalKey }, { partial: true });
      if (validationError) return res.status(400).json({ success: false, message: validationError });
      if (!Object.keys(changes).length) return res.status(400).json({ success: false, message: "Nothing to update" });
      if (nextCanonicalKey !== canonicalKey) {
        const conflict = await model.findOne({ canonicalKey: nextCanonicalKey }).lean();
        if (conflict) return res.status(409).json({ success: false, message: "A model with this canonicalKey already exists" });
      }
      const update = { $set: changes };
      const updated = await model.findOneAndUpdate({ canonicalKey }, update, { new: true, runValidators: true }).lean();
      await writeAudit(changes.surfaces ? "surface_update" : "update", req, nextCanonicalKey, existing, updated);
      await refresh();
      return res.json({ success: true, model: updated });
    } catch (error) {
      const duplicate = duplicateMessage(error);
      if (duplicate) return res.status(409).json({ success: false, message: duplicate });
      console.error("Update AI model error:", error);
      return res.status(500).json({ success: false, message: "Failed to update model" });
    }
  }

  async function setStatus(req, res) {
    const enabled = req.params.status === "enable";
    if (!enabled && req.params.status !== "disable") return res.status(400).json({ success: false, message: "Status must be enable or disable" });
    return updateModel({ ...req, body: { enabled } }, res);
  }

  async function updateSurfaces(req, res) {
    return updateModel({ ...req, body: { surfaces: req.body?.surfaces } }, res);
  }

  async function archiveModel(req, res) {
    return updateModel({ ...req, body: { enabled: false, archived: true } }, res);
  }

  async function unarchiveModel(req, res) {
    return updateModel({ ...req, body: { enabled: true, archived: false } }, res);
  }

  async function uploadIcon(req, res) {
    try {
      const canonicalKey = String(req.params.canonicalKey);
      const existing = await model.findOne({ canonicalKey }).lean();
      if (!existing) return res.status(404).json({ success: false, message: "Model not found" });
      if (!req.file) return res.status(400).json({ success: false, message: "Icon file is required" });

      const icon = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      const updated = await model.findOneAndUpdate(
        { canonicalKey },
        { $set: { icon } },
        { new: true, runValidators: true },
      ).lean();
      await writeAudit("icon_update", req, canonicalKey, existing, updated);
      return res.json({ success: true, model: updated });
    } catch (error) {
      console.error("Upload AI model icon error:", error);
      return res.status(500).json({ success: false, message: "Failed to upload model icon" });
    }
  }

  async function removeIcon(req, res) {
    try {
      const canonicalKey = String(req.params.canonicalKey);
      const existing = await model.findOne({ canonicalKey }).lean();
      if (!existing) return res.status(404).json({ success: false, message: "Model not found" });
      const updated = await model.findOneAndUpdate(
        { canonicalKey },
        { $set: { icon: null } },
        { new: true, runValidators: true },
      ).lean();
      await writeAudit("icon_remove", req, canonicalKey, existing, updated);
      return res.json({ success: true, model: updated });
    } catch (error) {
      console.error("Remove AI model icon error:", error);
      return res.status(500).json({ success: false, message: "Failed to remove model icon" });
    }
  }

  return { listModels, getModel, createModel, updateModel, setStatus, updateSurfaces, archiveModel, unarchiveModel, uploadIcon, removeIcon };
}

const controller = createModelConfigurationController();
module.exports = { ...controller, createModelConfigurationController, pickWritable };
