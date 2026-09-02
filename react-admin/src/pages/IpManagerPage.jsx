import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  Check,
  CirclePlus,
  Globe2,
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import Badge from "@/components/Badge.jsx";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const EMPTY_FORM = { value: "", label: "", action: "allow", status: "active", notes: "" };

function SummaryCard({ label, value, icon: Icon, tone }) {
  const colors = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function RuleDialog({ rule, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(rule ? {
    value: rule.value,
    label: rule.label,
    action: rule.action,
    status: rule.status,
    notes: rule.notes || "",
  } : EMPTY_FORM);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        onSubmit={(event) => { event.preventDefault(); onSave(form); }}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{rule ? "Edit IP rule" : "Add IP rule"}</h2>
            <p className="text-xs text-slate-500">Use a single IPv4/IPv6 address or a CIDR range.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">IP address or CIDR</span>
              <input autoFocus required value={form.value} onChange={(e) => setField("value", e.target.value)} placeholder="203.0.113.42 or 10.0.0.0/24" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-600">Label</span>
              <input required maxLength={100} value={form.label} onChange={(e) => setField("label", e.target.value)} placeholder="Head office" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-600">Status</span>
              <select value={form.status} onChange={(e) => setField("status", e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-slate-600">Rule action</legend>
            <div className="grid grid-cols-2 gap-3">
              {[{ value: "allow", label: "Allow", icon: ShieldCheck, style: "border-emerald-300 bg-emerald-50 text-emerald-700" }, { value: "block", label: "Block", icon: ShieldOff, style: "border-rose-300 bg-rose-50 text-rose-700" }].map((option) => (
                <button key={option.value} type="button" onClick={() => setField("action", option.value)} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${form.action === option.value ? option.style : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  <option.icon className="h-4 w-4" /> {option.label}
                  {form.action === option.value ? <Check className="ml-auto h-4 w-4" /> : null}
                </button>
              ))}
            </div>
          </fieldset>

          <label>
            <span className="mb-1.5 block text-xs font-medium text-slate-600">Notes <span className="font-normal text-slate-400">(optional)</span></span>
            <textarea rows={3} maxLength={500} value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="Why this address is listed, owner, or expiry context..." className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
          </label>

          {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {rule ? "Save changes" : "Add rule"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function IpManagerPage() {
  const [rules, setRules] = useState([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, allowed: 0, blocked: 0 });
  const [filters, setFilters] = useState({ search: "", action: "", status: "" });
  const [query, setQuery] = useState({ search: "", action: "", status: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogRule, setDialogRule] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await adminApi.ipRules(Object.fromEntries(Object.entries(query).filter(([, value]) => value)));
      setRules(response.data?.rules || []);
      setSummary(response.data?.summary || { total: 0, active: 0, allowed: 0, blocked: 0 });
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { loadRules(); }, [loadRules]);

  function submitSearch(event) {
    event.preventDefault();
    setQuery(filters);
  }

  async function saveRule(payload) {
    setSaving(true);
    setSaveError("");
    try {
      if (dialogRule) await adminApi.updateIpRule(dialogRule._id, payload);
      else await adminApi.createIpRule(payload);
      setDialogRule(undefined);
      await loadRules();
    } catch (requestError) {
      setSaveError(requestError?.response?.data?.message || requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(rule) {
    try {
      await adminApi.updateIpRule(rule._id, { status: rule.status === "active" ? "inactive" : "active" });
      await loadRules();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError.message);
    }
  }

  async function deleteRule(rule) {
    if (!window.confirm(`Delete the rule for ${rule.value}?`)) return;
    setDeletingId(rule._id);
    try {
      await adminApi.deleteIpRule(rule._id);
      await loadRules();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">IP Manager</h1>
          <p className="mt-1 text-sm text-slate-500">Maintain trusted and blocked IPv4, IPv6, and CIDR entries.</p>
        </div>
        <button onClick={() => { setSaveError(""); setDialogRule(null); }} className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
          <CirclePlus className="h-4 w-4" /> Add IP rule
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total entries" value={summary.total} icon={Globe2} tone="indigo" />
        <SummaryCard label="Active rules" value={summary.active} icon={Check} tone="slate" />
        <SummaryCard label="Allowed" value={summary.allowed} icon={ShieldCheck} tone="emerald" />
        <SummaryCard label="Blocked" value={summary.blocked} icon={Ban} tone="rose" />
      </div>

      <form onSubmit={submitSearch} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={filters.search} onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))} placeholder="Search IP, label, or notes" className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
        </label>
        <select value={filters.action} onChange={(e) => setFilters((current) => ({ ...current, action: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-500">
          <option value="">All actions</option><option value="allow">Allowed</option><option value="block">Blocked</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-500">
          <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <button className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Apply filters</button>
      </form>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3">Address / range</th><th className="px-5 py-3">Label</th><th className="px-5 py-3">Action</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Updated</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 4 }).map((_, index) => <tr key={index} className="border-t border-slate-100"><td colSpan={6} className="px-5 py-3"><div className="h-9 animate-pulse rounded-md bg-slate-100" /></td></tr>) : null}
              {!loading && rules.length === 0 ? <tr><td colSpan={6} className="px-5 py-14 text-center"><Globe2 className="mx-auto mb-3 h-8 w-8 text-slate-300" /><div className="font-medium text-slate-700">No IP rules found</div><div className="mt-1 text-xs text-slate-400">Add a rule or change your filters.</div></td></tr> : null}
              {!loading && rules.map((rule) => (
                <tr key={rule._id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-5 py-4"><div className="font-mono font-medium text-slate-900">{rule.value}</div><div className="mt-0.5 text-xs text-slate-400">IPv{rule.ipVersion} · {rule.kind === "cidr" ? "CIDR range" : "Single address"}</div></td>
                  <td className="max-w-xs px-5 py-4"><div className="font-medium text-slate-800">{rule.label}</div>{rule.notes ? <div className="mt-0.5 truncate text-xs text-slate-400" title={rule.notes}>{rule.notes}</div> : null}</td>
                  <td className="px-5 py-4"><Badge tone={rule.action === "allow" ? "emerald" : "rose"}>{rule.action === "allow" ? "Allow" : "Block"}</Badge></td>
                  <td className="px-5 py-4"><button onClick={() => toggleStatus(rule)} title="Toggle status"><Badge tone={rule.status === "active" ? "indigo" : "slate"}>{rule.status}</Badge></button></td>
                  <td className="px-5 py-4 text-xs text-slate-500"><div>{formatDate(rule.updatedAt)}</div><div className="mt-0.5 text-slate-400">by {rule.updatedBy || "admin"}</div></td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-1"><button onClick={() => { setSaveError(""); setDialogRule(rule); }} className="rounded-lg p-2 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600" aria-label={`Edit ${rule.value}`}><Pencil className="h-4 w-4" /></button><button disabled={deletingId === rule._id} onClick={() => deleteRule(rule)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" aria-label={`Delete ${rule.value}`}>{deletingId === rule._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dialogRule !== undefined ? <RuleDialog key={dialogRule?._id || "new"} rule={dialogRule} saving={saving} error={saveError} onClose={() => !saving && setDialogRule(undefined)} onSave={saveRule} /> : null}
    </div>
  );
}
