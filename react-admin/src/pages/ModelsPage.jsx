import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleOff,
  Copy,
  Cpu,
  Eye,
  Loader2,
  Plus,
  Pencil,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Badge from "@/components/Badge.jsx";
import Select from "@/components/Select.jsx";
import { adminApi } from "@/lib/api";

const FALLBACK_SURFACES = ["ad_creative", "ad_factory", "ai_ads", "ugc", "broll", "avatar", "clone"];
const MODEL_TYPES = ["image", "video", "text", "vision", "audio", "internal"];
const QUALITY_NAMES = ["low", "medium", "high", "ultra_high"];

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";

function csv(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function parseCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function hasRenderableIcon(icon) {
  return /^(data:image\/|https?:\/\/|\/)/i.test(String(icon || ""));
}

function displayCredits(model) {
  if (model.type === "image" && model.credits != null) return Number(model.credits) || 0;
  if (model.type === "image" && Array.isArray(model.qualityTiers) && model.qualityTiers.length) {
    return Math.max(...model.qualityTiers.map((tier) => Number(tier.credits) || 0));
  }
  return Number(model.credits) || 0;
}

function enabledModules(model) {
  return Object.entries(model.surfaces || {})
    .filter(([, config]) => config?.enabled === true)
    .map(([surface]) => surface);
}

function billingLabel(model) {
  if (model.type === "image") return "Per image";
  if (model.type === "video") return "Per second";
  return "Per unit";
}

function creditDetails(model) {
  if (model.type === "image" && model.qualityTiers?.length) {
    return `Quality-wise: ${model.qualityTiers
      .slice()
      .sort((a, b) => (Number(a.credits) || 0) - (Number(b.credits) || 0))
      .map((tier) => `${tier.quality}: ${Number(tier.credits) || 0}`)
      .join(" · ")}`;
  }
  return `Single: ${displayCredits(model)} / ${billingLabel(model).replace("Per ", "").toLowerCase()}`;
}

function blankModel(surfaces) {
  return {
    canonicalKey: "",
    displayName: "",
    icon: "",
    adminNotes: "",
    type: "image",
    aliases: "",
    enabled: true,
    isPremium: false,
    blockedPlanIds: [],
    credits: "",
    pricePerImage: "",
    pricePerSecond: "",
    extraCharges: [],
    qualityTiers: [],
    surfaces: Object.fromEntries((surfaces.length ? surfaces : FALLBACK_SURFACES).map((surface) => [surface, {
      enabled: false,
      aspectRatios: "",
      durations: "",
      qualities: "",
    }])),
  };
}

function modelToForm(model, surfaces) {
  const form = {
    canonicalKey: model.canonicalKey || "",
    displayName: model.displayName || "",
    icon: hasRenderableIcon(model.icon) ? model.icon : "",
    adminNotes: model.adminNotes || "",
    type: model.type || "image",
    aliases: csv(model.aliases),
    enabled: model.enabled !== false,
    isPremium: model.isPremium === true,
    blockedPlanIds: model.blockedPlanIds || [],
    credits: model.credits == null ? "" : String(model.credits),
    pricePerImage: model.type === "image" ? String(model.pricing?.per_image ?? "") : "",
    pricePerSecond: model.type === "video" ? String(model.pricing?.per_second ?? "") : "",
    extraCharges: (model.extraCharges || []).map((charge, index) => ({
      editorId: `extra-charge-${index}-${crypto.randomUUID()}`,
      type: String(charge.type || ""),
      unit: charge.unit || (charge.type === "ai_ads_scene_regen_image" ? "image" : charge.costPerSecond != null ? "second" : "request"),
      credits: String(charge.credits ?? 0),
      usdPerUnit: charge.usdPerUnit == null ? (charge.costPerSecond == null ? "" : String(charge.costPerSecond)) : String(charge.usdPerUnit),
    })),
    qualityTiers: (model.qualityTiers || []).map((tier) => ({
      quality: tier.quality,
      credits: String(tier.credits ?? 0),
      pricePerImage: String(tier.pricing?.per_image ?? ""),
    })),
    surfaces: {},
  };
  for (const surface of surfaces.length ? surfaces : FALLBACK_SURFACES) {
    const config = model.surfaces?.[surface] || {};
    form.surfaces[surface] = {
      enabled: config.enabled === true,
      aspectRatios: csv(config.aspectRatios),
      durations: csv(config.durations),
      qualities: csv(config.qualities),
    };
  }
  return form;
}

function toPayload(form) {
  const qualityTiers = form.qualityTiers.map((tier) => {
    const pricePerImage = Number(tier.pricePerImage);
    if (!Number.isFinite(pricePerImage) || pricePerImage < 0) throw new Error(`Price for ${tier.quality} must be a non-negative number`);
    return { quality: tier.quality, credits: Number(tier.credits), pricing: { per_image: pricePerImage } };
  });
  const extraCharges = form.extraCharges.map((charge) => {
    const type = charge.type.trim();
    const credits = Number(charge.credits);
    const usdPerUnit = charge.usdPerUnit === "" ? undefined : Number(charge.usdPerUnit);
    if (!type) throw new Error("Extra charge type is required");
    if (!Number.isFinite(credits) || credits < 0) throw new Error(`Credits for ${type} must be a non-negative number`);
    if (!["image", "second", "request"].includes(charge.unit)) throw new Error(`Unit for ${type} must be image, second, or request`);
    if (usdPerUnit !== undefined && (!Number.isFinite(usdPerUnit) || usdPerUnit < 0)) throw new Error(`USD per unit for ${type} must be a non-negative number`);
    return { type, unit: charge.unit, credits, ...(usdPerUnit === undefined ? {} : { usdPerUnit }) };
  });
  if (form.type !== "image" && (!Number.isFinite(Number(form.credits)) || Number(form.credits) < 0)) throw new Error("Credits must be a non-negative number");
  if (form.type === "image" && form.credits !== "" && (!Number.isFinite(Number(form.credits)) || Number(form.credits) < 0)) throw new Error("Default image credits must be a non-negative number");
  if (form.type === "image" && form.pricePerImage !== "" && (!Number.isFinite(Number(form.pricePerImage)) || Number(form.pricePerImage) < 0)) throw new Error("Default image USD price must be a non-negative number");
  if (form.type === "video" && (!Number.isFinite(Number(form.pricePerSecond)) || Number(form.pricePerSecond) < 0)) throw new Error("USD per second must be a non-negative number");
  if (qualityTiers.some((tier) => !Number.isFinite(tier.credits) || tier.credits < 0)) throw new Error("Quality credits must be non-negative numbers");
  const surfaces = Object.fromEntries(Object.entries(form.surfaces).map(([surface, config]) => [surface, {
    enabled: config.enabled,
    aspectRatios: parseCsv(config.aspectRatios),
    durations: parseCsv(config.durations).map(Number),
    qualities: parseCsv(config.qualities),
  }]));
  return {
    canonicalKey: form.canonicalKey.trim(),
    displayName: form.displayName.trim(),
    icon: form.icon || null,
    adminNotes: form.adminNotes,
    type: form.type,
    aliases: parseCsv(form.aliases),
    enabled: form.enabled,
    isPremium: form.isPremium,
    blockedPlanIds: form.blockedPlanIds,
    ...(form.type === "image"
      ? {
          ...(form.credits === "" ? {} : { credits: Number(form.credits) }),
          ...(form.pricePerImage === "" ? {} : { pricing: { per_image: Number(form.pricePerImage) } }),
        }
      : { credits: Number(form.credits), pricing: form.type === "video" ? { per_second: Number(form.pricePerSecond) } : {} }),
    qualityTiers,
    extraCharges,
    surfaces,
  };
}

function StatusDot({ active }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} />;
}

function ModelPreview({ model, onClose, onEdit, onClone }) {
  if (!model) return null;
  const surfaces = model.surfaces || {};
  const tiers = model.qualityTiers || [];
  const charges = model.extraCharges || [];
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
    <section className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{hasRenderableIcon(model.icon) ? <img src={model.icon} alt="" className="h-full w-full object-contain p-2" /> : <Cpu className="h-5 w-5 text-slate-400" />}</div><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">Model preview</div><h2 className="mt-1 text-xl font-semibold text-slate-900">{model.displayName}</h2><p className="mt-1 font-mono text-xs text-slate-500">{model.canonicalKey}</p></div></div><div className="flex items-center gap-2"><button type="button" onClick={onClone} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"><Copy className="h-3.5 w-3.5" /> Clone</button><button type="button" onClick={onEdit} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700"><Pencil className="h-3.5 w-3.5" /> Edit</button><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-4 w-4" /></button></div></header>
      <div className="space-y-5 overflow-y-auto p-5">
        <div className="grid gap-3 sm:grid-cols-4"><div className="rounded-xl border border-slate-200 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-400">Type</div><div className="mt-1 font-semibold capitalize text-slate-800">{model.type}</div></div><div className="rounded-xl border border-slate-200 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-400">Status</div><div className="mt-1 font-semibold text-emerald-600">{model.enabled ? "Active" : "Disabled"}</div></div><div className="rounded-xl border border-slate-200 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-400">Aliases</div><div className="mt-1 truncate text-sm text-slate-700">{(model.aliases || []).join(", ") || "—"}</div></div><div className="rounded-xl border border-slate-200 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-400">Modules</div><div className="mt-1 font-semibold text-slate-800">{Object.values(surfaces).filter((item) => item?.enabled).length} enabled</div></div></div>
        <section><h3 className="mb-2 text-sm font-semibold text-slate-900">Pricing and credits</h3>{model.type === "image" ? <div className="overflow-hidden rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Quality</th><th className="px-4 py-3">Credits / image</th><th className="px-4 py-3">USD / image</th></tr></thead><tbody className="divide-y divide-slate-100">{tiers.length ? tiers.map((tier) => <tr key={tier.quality}><td className="px-4 py-3 font-medium capitalize text-slate-800">{tier.quality}</td><td className="px-4 py-3 text-slate-600">{tier.credits ?? 0}</td><td className="px-4 py-3 text-slate-600">${Number(tier.pricing?.per_image || 0).toFixed(3)}</td></tr>) : <tr><td colSpan="3" className="px-4 py-4 text-center text-slate-400">No quality tiers configured</td></tr>}</tbody></table></div> : <div className="overflow-hidden rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Billing</th><th className="px-4 py-3">Credits</th><th className="px-4 py-3">USD</th></tr></thead><tbody><tr><td className="px-4 py-3 text-slate-700">Per second</td><td className="px-4 py-3 text-slate-600">{model.credits ?? 0}</td><td className="px-4 py-3 text-slate-600">${Number(model.pricing?.per_second || 0).toFixed(3)}</td></tr></tbody></table></div>}</section>
        <section><h3 className="mb-2 text-sm font-semibold text-slate-900">Extra charges</h3><div className="overflow-hidden rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Charge type</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Credits / unit</th><th className="px-4 py-3">USD / unit</th></tr></thead><tbody className="divide-y divide-slate-100">{charges.length ? charges.map((charge) => <tr key={charge.type}><td className="px-4 py-3 font-mono text-xs text-slate-700">{charge.type}</td><td className="px-4 py-3 capitalize text-slate-600">{charge.unit || (charge.costPerSecond != null ? "second" : "request")}</td><td className="px-4 py-3 text-slate-600">{charge.credits ?? 0}</td><td className="px-4 py-3 text-slate-600">{charge.usdPerUnit != null || charge.costPerSecond != null ? `$${Number(charge.usdPerUnit ?? charge.costPerSecond).toFixed(3)}` : "—"}</td></tr>) : <tr><td colSpan="4" className="px-4 py-4 text-center text-slate-400">No extra charges configured</td></tr>}</tbody></table></div></section>
        <section><h3 className="mb-2 text-sm font-semibold text-slate-900">Module availability</h3><div className="overflow-hidden rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Module</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Capabilities</th></tr></thead><tbody className="divide-y divide-slate-100">{Object.entries(surfaces).map(([name, config]) => <tr key={name}><td className="px-4 py-3 font-mono text-xs text-slate-700">{name}</td><td className={`px-4 py-3 font-medium ${config?.enabled ? "text-emerald-600" : "text-slate-400"}`}>{config?.enabled ? "Available" : "Hidden"}</td><td className="px-4 py-3 text-xs text-slate-500">{config?.enabled ? [config.aspectRatios?.length ? `${config.aspectRatios.length} aspect ratios` : "", config.durations?.length ? `${config.durations.length} durations` : "", config.qualities?.length ? `${config.qualities.length} qualities` : ""].filter(Boolean).join(" · ") || "Configured" : "—"}</td></tr>)}</tbody></table></div></section>
        {model.adminNotes ? <section><h3 className="mb-2 text-sm font-semibold text-slate-900">Admin notes</h3><p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{model.adminNotes}</p></section> : null}
      </div>
    </section>
  </div>;
}

export default function ModelsPage() {
  const [models, setModels] = useState([]);
  const [surfaces, setSurfaces] = useState(FALLBACK_SURFACES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [previewModel, setPreviewModel] = useState(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [plans, setPlans] = useState([]);

  const loadModels = () => {
    setLoading(true);
    setError("");
    adminApi.models()
      .then((res) => {
        const nextModels = (res.data?.models || []).map((model) => ({
          ...model,
          icon: hasRenderableIcon(model.icon) ? model.icon : null,
        }));
        setModels(nextModels);
        setSurfaces(res.data?.surfaces?.length ? res.data.surfaces : FALLBACK_SURFACES);
        if (selectedKey) {
          const selected = nextModels.find((model) => model.canonicalKey === selectedKey);
          if (selected) setForm(modelToForm(selected, res.data?.surfaces || FALLBACK_SURFACES));
        }
      })
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadModels(); }, []);

  useEffect(() => {
    adminApi.plans()
      .then((res) => setPlans(res.data?.plans || []))
      .catch(() => setPlans([]));
  }, []);

  const filteredModels = useMemo(() => models.filter((model) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [model.canonicalKey, model.displayName, ...(model.aliases || [])].some((value) => String(value).toLowerCase().includes(term));
    const matchesType = typeFilter === "all" || model.type === typeFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "disabled" ? model.enabled === false : model.enabled !== false);
    return matchesSearch && matchesType && matchesStatus;
  }), [models, search, typeFilter, statusFilter]);

  function selectModel(model) {
    setSelectedKey(model.canonicalKey);
    setForm(modelToForm(model, surfaces));
    setFormError("");
  }

  function openPreview(model) {
    setPreviewModel(model);
    setFormError("");
  }

  function startCreate() {
    setSelectedKey(null);
    setForm(blankModel(surfaces));
    setFormError("");
  }

  function cloneModel(model) {
    setSelectedKey(null);
    setForm(modelToForm(model, surfaces));
    setFormError("");
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
  }

  function updateSurface(surface, field, value) {
    setForm((current) => ({ ...current, surfaces: { ...current.surfaces, [surface]: { ...current.surfaces[surface], [field]: value } } }));
  }

  async function uploadModelIcon(file) {
    if (!selectedKey || !file) return;
    setIconBusy(true);
    setFormError("");
    try {
      const response = await adminApi.uploadModelIcon(selectedKey, file);
      const saved = response.data?.model;
      setForm((current) => ({ ...current, icon: saved?.icon || "" }));
      setModels((current) => current.map((model) => model.canonicalKey === selectedKey ? { ...model, icon: saved?.icon || null } : model));
    } catch (err) {
      setFormError(err?.response?.data?.message || err.message);
    } finally {
      setIconBusy(false);
    }
  }

  async function removeModelIcon() {
    if (!selectedKey) return;
    setIconBusy(true);
    setFormError("");
    try {
      await adminApi.removeModelIcon(selectedKey);
      setForm((current) => ({ ...current, icon: "" }));
      setModels((current) => current.map((model) => model.canonicalKey === selectedKey ? { ...model, icon: null } : model));
    } catch (err) {
      setFormError(err?.response?.data?.message || err.message);
    } finally {
      setIconBusy(false);
    }
  }

  async function saveModel(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const payload = toPayload(form);
      const response = selectedKey ? await adminApi.updateModel(selectedKey, payload) : await adminApi.createModel(payload);
      const saved = response.data?.model;
      setSelectedKey(saved.canonicalKey);
      setForm(modelToForm(saved, surfaces));
      loadModels();
    } catch (err) {
      setFormError(err?.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  }

  function addTier() {
    setForm((current) => ({ ...current, qualityTiers: [...current.qualityTiers, { quality: "high", credits: "0", pricePerImage: "" }] }));
  }

  function updateTier(index, field, value) {
    setForm((current) => ({ ...current, qualityTiers: current.qualityTiers.map((tier, i) => i === index ? { ...tier, [field]: value } : tier) }));
  }

  function removeTier(index) {
    setForm((current) => ({ ...current, qualityTiers: current.qualityTiers.filter((_, i) => i !== index) }));
  }

  function addExtraCharge() {
    setForm((current) => ({ ...current, extraCharges: [...current.extraCharges, { editorId: `extra-charge-${crypto.randomUUID()}`, type: "", unit: "request", credits: "0", usdPerUnit: "" }] }));
  }

  function updateExtraCharge(index, field, value) {
    setForm((current) => ({ ...current, extraCharges: current.extraCharges.map((charge, i) => i === index ? { ...charge, [field]: value } : charge) }));
  }

  function removeExtraCharge(index) {
    setForm((current) => ({ ...current, extraCharges: current.extraCharges.filter((_, i) => i !== index) }));
  }

  const enabledSurfaces = form
    ? Object.entries(form.surfaces).filter(([, config]) => config.enabled)
    : [];
  const isAdCreativeOnly = enabledSurfaces.length === 1 && enabledSurfaces[0][0] === "ad_creative";
  const registryGrid = form
    ? "grid-cols-[auto_minmax(0,1fr)_auto_auto]"
    : "grid-cols-[auto_minmax(0,1fr)_auto_auto] xl:grid-cols-[auto_minmax(12rem,1.15fr)_minmax(10rem,0.85fr)_minmax(13rem,1fr)_minmax(12rem,1fr)_auto]";
  const registryHeaderDisplay = form ? "hidden sm:grid" : "hidden xl:grid";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600"><Cpu className="h-3.5 w-3.5" /> Configuration registry</div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">AI Models</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Control the canonical model names, credit rules, and module availability used by generation and internal AI flows.</p>
        </div>
        <button onClick={startCreate} className="flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add model</button>
      </header>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <div className={`grid gap-5 xl:items-start ${form ? "xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.85fr)]" : "xl:grid-cols-1"}`}>
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/70 p-3">
            <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search canonical name or alias" className={`${inputClass} pl-9`} /></div>
            <Select value={typeFilter} onChange={setTypeFilter} options={[{ value: "all", label: "All types" }, ...MODEL_TYPES.map((type) => ({ value: type, label: type }))]} className="min-w-36" />
            <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} className="min-w-36" />
          </div>
          {!loading && filteredModels.length > 0 ? <div className={`${registryHeaderDisplay} border-b border-slate-200 bg-slate-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 items-center gap-4 ${registryGrid}`}><span aria-hidden className="h-4 w-9" /><span>Model</span>{!form ? <><span>Comments</span><span>Type &amp; availability</span></> : null}<span className="text-right">Credits</span><span className="text-right">Actions</span></div> : null}
          {loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 animate-pulse bg-slate-100" />)}</div> : filteredModels.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center text-slate-500"><Sparkles className="h-7 w-7 text-slate-300" /><p className="text-sm">No models match these filters.</p></div> : <div className="divide-y divide-slate-200">{filteredModels.map((model) => <div key={model.canonicalKey} role="button" tabIndex={0} onClick={() => openPreview(model)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openPreview(model); }} className={`relative grid min-h-[5rem] cursor-pointer items-center gap-4 px-4 py-3 transition duration-200 before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-0 before:bg-indigo-500 before:transition-[width] before:duration-200 hover:bg-slate-50 ${registryGrid} ${selectedKey === model.canonicalKey ? "bg-indigo-50/60 before:w-0.5" : ""}`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md ${model.enabled ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400"}`}>{hasRenderableIcon(model.icon) ? <img src={model.icon} alt="" className="h-full w-full object-contain p-1.5" /> : <Cpu className="h-4 w-4" />}</div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold text-slate-900">{model.displayName}</span><Badge tone={model.enabled ? "emerald" : "slate"}>{model.enabled ? "active" : "disabled"}</Badge></div><div className="mt-1 truncate font-mono text-xs text-slate-500">{model.canonicalKey}</div></div>
            {!form ? <div className="hidden min-w-0 xl:block"><div className="truncate text-xs text-slate-500" title={model.adminNotes || "No comments"}>{model.adminNotes || <span className="italic text-slate-300">No comments</span>}</div></div> : null}
            {!form ? <div className="hidden min-w-0 xl:block"><div className="flex items-center gap-2"><span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{model.type}</span><span className="truncate text-xs text-slate-500">{enabledModules(model).length} module{enabledModules(model).length === 1 ? "" : "s"}</span></div><div className="mt-1 flex gap-1 overflow-hidden">{enabledModules(model).slice(0, 3).map((surface) => <span key={surface} className="truncate rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{surface}</span>)}{enabledModules(model).length > 3 ? <span className="text-[10px] text-slate-400">+{enabledModules(model).length - 3}</span> : null}</div></div> : null}
            <div className="hidden min-w-0 text-right sm:block"><div className="text-sm font-semibold text-slate-700">{displayCredits(model)} <span className="text-[10px] font-medium text-slate-400">{billingLabel(model).replace("Per ", "/ ").toLowerCase()}</span></div>{model.type === "image" && model.qualityTiers?.length ? <div className="mt-1 flex flex-wrap justify-end gap-1">{model.qualityTiers.slice().sort((a, b) => (Number(a.credits) || 0) - (Number(b.credits) || 0)).map((tier) => <span key={tier.quality} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">{tier.quality} <strong>{Number(tier.credits) || 0}</strong></span>)}</div> : <div className="mt-1 text-xs font-medium text-slate-400">Single charge</div>}</div><div className="flex shrink-0 items-center gap-0.5"><button type="button" onClick={(event) => { event.stopPropagation(); selectModel(model); }} className="rounded-md p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600" title="Edit model"><ChevronRight className="h-4 w-4" /></button><button type="button" onClick={(event) => { event.stopPropagation(); cloneModel(model); }} className="rounded-md p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600" title="Clone model"><Copy className="h-4 w-4" /></button></div>
          </div>)}</div>}
        </section>

        {form ? <form key={`model-editor-${selectedKey || "new"}`} onSubmit={saveModel} className="model-editor-enter min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm xl:flex xl:h-[calc(100vh-11rem)] xl:max-h-[calc(100vh-11rem)] xl:flex-col xl:overflow-hidden">
          <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white/95 p-4 backdrop-blur"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">{selectedKey ? "Edit configuration" : "New configuration"}</div><h2 className="mt-1 text-lg font-semibold text-slate-900">{selectedKey ? form.displayName : "Add an AI model"}</h2></div><div className="flex flex-wrap items-center justify-end gap-1">{selectedKey && <><button type="button" onClick={() => setPreviewModel(models.find((model) => model.canonicalKey === selectedKey) || null)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"><Eye className="h-3.5 w-3.5" /> Preview</button><button type="button" onClick={() => { const selected = models.find((model) => model.canonicalKey === selectedKey); if (selected) cloneModel(selected); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"><Copy className="h-3.5 w-3.5" /> Clone</button></>}<button type="button" onClick={() => { setForm(null); setSelectedKey(null); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button></div></div>
          <div className="space-y-3 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {formError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div> : null}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Model identity</span><div className="flex items-center gap-3"><span className={`rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${form.enabled ? "text-emerald-600" : "text-slate-500"}`}>{form.enabled ? "Active" : "Disabled"}</span><label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={form.enabled} onChange={(e) => updateField("enabled", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /> Enabled</label></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><label className={labelClass}>Canonical model name</label><input required value={form.canonicalKey} onChange={(e) => updateField("canonicalKey", e.target.value)} placeholder="e.g. gemini-3.1-flash-image" className={inputClass} /><p className="mt-1 text-xs text-slate-400">Exact identifier sent to the Python service.</p></div><div><label className={labelClass}>Display name</label><input required value={form.displayName} onChange={(e) => updateField("displayName", e.target.value)} placeholder="Nano Banana 2" className={inputClass} /></div><div><label className={labelClass}>Model type</label><Select value={form.type} onChange={(value) => updateField("type", value)} options={MODEL_TYPES.map((type) => ({ value: type, label: type }))} className="w-full min-w-0" /></div><div className="sm:col-span-2"><label className={labelClass}>Aliases <span className="font-normal normal-case tracking-normal text-slate-400">comma separated</span></label><input value={form.aliases} onChange={(e) => updateField("aliases", e.target.value)} placeholder="legacy-name, display label" className={inputClass} /></div><div className="sm:col-span-2"><label className={labelClass}>Model icon</label><div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{form.icon ? <img src={form.icon} alt="Model icon preview" className="h-full w-full object-contain p-2" /> : <Cpu className="h-5 w-5 text-slate-400" />}</div><div className="min-w-0 flex-1"><input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" disabled={!selectedKey || iconBusy} onChange={(event) => { uploadModelIcon(event.target.files?.[0]); event.target.value = ""; }} className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50" /><p className="mt-1 text-xs text-slate-400">PNG, JPG, WebP or SVG, up to 5 MB. Save the model first to upload an icon.</p></div>{form.icon && selectedKey ? <button type="button" onClick={removeModelIcon} disabled={iconBusy} className="rounded-md px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">Remove</button> : null}</div></div><div className="sm:col-span-2"><label className={labelClass}>Admin notes</label><textarea value={form.adminNotes} onChange={(e) => updateField("adminNotes", e.target.value)} placeholder="Internal notes about this model" rows={2} className={inputClass} /><p className="mt-1 text-xs text-slate-400">Admin-only context; never sent to Python.</p></div></div></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-3"><h3 className="text-sm font-semibold text-slate-800">Access and presentation</h3><p className="text-xs text-slate-500">Premium is shown in every model picker. Checked plans are blocked from using this model.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset><legend className={labelClass}>Model badge</legend><div className="flex gap-2"><label className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${!form.isPremium ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600"}`}><input type="radio" name="premium-status" checked={!form.isPremium} onChange={() => updateField("isPremium", false)} /> Standard</label><label className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${form.isPremium ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600"}`}><input type="radio" name="premium-status" checked={form.isPremium} onChange={() => updateField("isPremium", true)} /> Premium</label></div></fieldset>
                <div><label className={labelClass}>Blocked plans</label><div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">{plans.length ? plans.map((plan) => { const blocked = form.blockedPlanIds.includes(plan.planId); return <label key={plan.planId} className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm ${blocked ? "bg-rose-50 text-rose-700" : "hover:bg-slate-50 text-slate-700"}`}><input type="checkbox" checked={blocked} onChange={() => updateField("blockedPlanIds", blocked ? form.blockedPlanIds.filter((id) => id !== plan.planId) : [...form.blockedPlanIds, plan.planId])} className="sr-only" /><span className={`flex h-4 w-4 items-center justify-center rounded border ${blocked ? "border-rose-500 bg-rose-500 text-white" : "border-slate-300 bg-white"}`}>{blocked ? <X className="h-3 w-3" /> : null}</span><span>{plan.planName}</span><span className="ml-auto font-mono text-[10px] text-slate-400">{plan.planId}</span></label>; }) : <p className="px-2 py-1 text-xs text-slate-400">No active plans found.</p>}</div></div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Billing mode</div><div className="mt-1 text-sm font-semibold text-slate-800">{form.type === "image" ? "Per image" : form.type === "video" ? "Per second" : "Per unit"}</div></div><div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Default / highest credit</div><div className="mt-1 text-sm font-semibold text-slate-800">{form.type === "image" ? (form.credits === "" ? Math.max(0, ...form.qualityTiers.map((tier) => Number(tier.credits) || 0)) : Number(form.credits) || 0) : Number(form.credits) || 0} credits</div></div><div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Modules enabled</div><div className="mt-1 text-sm font-semibold text-slate-800">{Object.values(form.surfaces).filter((surface) => surface.enabled).length}</div></div></div>
            {!isAdCreativeOnly ? <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="mb-2"><h3 className="text-sm font-semibold text-slate-800">Base charging</h3><p className="text-xs text-slate-500">Quality tiers for images; per-second pricing for videos.</p></div>{form.type === "image" ? <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Default credits per image <span className="font-normal normal-case tracking-normal text-slate-400">optional</span></label><input type="number" min="0" step="any" value={form.credits} onChange={(e) => updateField("credits", e.target.value)} placeholder="Used when no quality is selected" className={inputClass} /></div><div><label className={labelClass}>Default USD per image <span className="font-normal normal-case tracking-normal text-slate-400">optional</span></label><input type="number" min="0" step="0.000001" value={form.pricePerImage} onChange={(e) => updateField("pricePerImage", e.target.value)} placeholder="Optional" className={inputClass} /></div><div className="sm:col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800">If a quality is selected, its tier is used. Without a quality, the default is used; if no default exists, the highest tier is used.</div></div> : <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>{form.type === "video" ? "Credits per second" : "Credits per unit"}</label><input type="number" min="0" step="any" value={form.credits} onChange={(e) => updateField("credits", e.target.value)} className={inputClass} /></div>{form.type === "video" ? <div><label className={labelClass}>USD per second</label><input type="number" min="0" step="0.000001" value={form.pricePerSecond} onChange={(e) => updateField("pricePerSecond", e.target.value)} placeholder="0.17" className={inputClass} /></div> : null}</div>}</div> : null}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-800">Extra charges</h3><p className="text-xs text-slate-500">Optional surcharges with an explicit billing unit.</p></div><button type="button" onClick={addExtraCharge} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Add charge</button></div>{form.extraCharges.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">No extra charges configured.</div> : <div className="space-y-2">{form.extraCharges.map((charge, index) => <div key={charge.editorId || `extra-charge-${index}`} className="grid min-w-0 grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.95fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_auto] lg:items-end"><div className="min-w-0"><label className={labelClass}>Charge type</label><input value={charge.type} onChange={(e) => updateExtraCharge(index, "type", e.target.value)} placeholder="ai_ads_scene_regen_image" className={`${inputClass} w-full min-w-0`} /></div><div className="min-w-0"><label className={labelClass}>Billing unit</label><select value={charge.unit} onChange={(e) => updateExtraCharge(index, "unit", e.target.value)} className={`${inputClass} min-w-0`}><option value="image">Image</option><option value="second">Second</option><option value="request">Request</option></select></div><div className="min-w-0"><label className={labelClass}>Credits / unit</label><input type="number" min="0" step="any" value={charge.credits} onChange={(e) => updateExtraCharge(index, "credits", e.target.value)} className={`${inputClass} min-w-0`} /></div><div className="min-w-0"><label className={labelClass}>USD / unit</label><input type="number" min="0" step="0.000001" value={charge.usdPerUnit} onChange={(e) => updateExtraCharge(index, "usdPerUnit", e.target.value)} placeholder="Optional" className={`${inputClass} min-w-0`} /></div><button type="button" onClick={() => removeExtraCharge(index)} className="justify-self-end rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove charge"><Trash2 className="h-4 w-4" /></button></div>)}</div>}</div>
            {form.type === "image" ? <div><div className="mb-3 flex items-end justify-between"><div><h3 className="text-sm font-semibold text-slate-800">Quality tiers</h3><p className="text-xs text-slate-500">Each quality has its own credits and USD price per image.</p></div><button type="button" onClick={addTier} className="flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Add tier</button></div>{form.qualityTiers.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">Add at least one quality tier.</div> : <div className="space-y-2">{form.qualityTiers.map((tier, index) => <div key={`${tier.quality}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"><select value={tier.quality} onChange={(e) => updateTier(index, "quality", e.target.value)} className={inputClass}>{QUALITY_NAMES.map((quality) => <option key={quality}>{quality}</option>)}</select><input type="number" min="0" step="any" value={tier.credits} onChange={(e) => updateTier(index, "credits", e.target.value)} className={inputClass} placeholder="Credits" /><input type="number" min="0" step="0.000001" value={tier.pricePerImage} onChange={(e) => updateTier(index, "pricePerImage", e.target.value)} className={inputClass} placeholder="USD / image" /><button type="button" onClick={() => removeTier(index)} className="self-center rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove tier"><Trash2 className="h-4 w-4" /></button></div>)}</div>}</div> : null}
            <div><div className="mb-3"><h3 className="text-sm font-semibold text-slate-800">Module availability</h3><p className="text-xs text-slate-500">Choose where this canonical model can appear and configure each module’s capabilities.</p></div><div className="space-y-3">{Object.entries(form.surfaces).map(([surface, config]) => <div key={surface} className={`rounded-lg border p-3 transition ${config.enabled ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200 bg-white"}`}><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={config.enabled} onChange={(e) => updateSurface(surface, "enabled", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /><span className="font-mono text-sm font-semibold text-slate-800">{surface}</span><span className="ml-auto flex items-center gap-2 text-xs text-slate-400"><StatusDot active={config.enabled} /> {config.enabled ? "available" : "hidden"}</span></label>{config.enabled ? <div className="mt-3 grid gap-3 border-t border-indigo-100 pt-3 sm:grid-cols-3"><div><label className={labelClass}>Aspect ratios</label><input value={config.aspectRatios} onChange={(e) => updateSurface(surface, "aspectRatios", e.target.value)} placeholder="1:1, 16:9" className={inputClass} /></div><div><label className={labelClass}>Durations</label><input value={config.durations} onChange={(e) => updateSurface(surface, "durations", e.target.value)} placeholder="8, 12" className={inputClass} /></div><div><label className={labelClass}>Qualities</label><input value={config.qualities} onChange={(e) => updateSurface(surface, "qualities", e.target.value)} placeholder="low, high" className={inputClass} /></div></div> : null}</div>)}</div></div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white p-3"><div className="text-[11px] text-slate-400">Changes apply to runtime after saving.</div><div className="flex gap-2"><button type="button" onClick={() => { setForm(null); setSelectedKey(null); }} className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" disabled={saving} className="flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save model"}</button></div></div>
        </form> : <section className="hidden min-h-[32rem] rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center xl:flex xl:flex-col xl:items-center xl:justify-center"><div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Sparkles className="h-6 w-6" /></div><h2 className="text-lg font-semibold text-slate-800">Select a model to edit</h2><p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">Choose a model from the registry or create a new configuration to manage its runtime availability.</p></section>}
      </div>
      {previewModel ? <ModelPreview model={previewModel} onClose={() => setPreviewModel(null)} onEdit={() => { setPreviewModel(null); selectModel(previewModel); }} onClone={() => { setPreviewModel(null); cloneModel(previewModel); }} /> : null}
    </div>
  );
}
