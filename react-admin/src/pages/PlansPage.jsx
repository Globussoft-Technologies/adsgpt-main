import { useEffect, useState } from "react";
import { Check, Layers, Loader2 } from "lucide-react";
import { adminApi } from "@/lib/api";

// Columns are generated from the limit registry the API returns
// (nodejs-backend/config/planLimitsRegistry.js) — adding a limit there makes
// a column appear here with no change to this file. Limits are grouped by
// product surface ("Meta Ads", "TikTok Ads", …) in the header so a wide
// matrix stays readable; the table scrolls horizontally once there are more
// limits than fit.

// "" in the input means unlimited (null on the wire) — 0 is a real, distinct
// value (the plan can manage nothing at all), so it must round-trip too.
function toInputValue(n) {
  return n === null || n === undefined ? "" : String(n);
}

function rowIsDirty(edit, plan, limitDefs) {
  return limitDefs.some((def) => edit[def.key] !== toInputValue(plan.limits?.[def.key]));
}

function editStateFor(plan, limitDefs) {
  return Object.fromEntries(
    limitDefs.map((def) => [def.key, toInputValue(plan.limits?.[def.key])]),
  );
}

export default function PlansPage() {
  const [limitDefs, setLimitDefs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [edits, setEdits] = useState({}); // planId -> { [limitKey]: string }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  function loadPlans() {
    setLoading(true);
    setError("");
    adminApi
      .plans()
      .then((res) => {
        const defs = res.data?.limits || [];
        const list = res.data?.plans || [];
        setLimitDefs(defs);
        setPlans(list);
        setEdits(Object.fromEntries(list.map((p) => [p.planId, editStateFor(p, defs)])));
      })
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadPlans();
  }, []);

  function handleFieldChange(planId, limitKey, value) {
    // Digits only — an empty string (unlimited) is still allowed through.
    if (value !== "" && !/^\d+$/.test(value)) return;
    setEdits((prev) => ({ ...prev, [planId]: { ...prev[planId], [limitKey]: value } }));
    setRowErrors((prev) => ({ ...prev, [planId]: "" }));
  }

  async function handleSave(plan) {
    const edit = edits[plan.planId] || {};
    setSavingId(plan.planId);
    setRowErrors((prev) => ({ ...prev, [plan.planId]: "" }));
    try {
      const res = await adminApi.updatePlanLimit(plan.planId, {
        limits: Object.fromEntries(
          limitDefs.map((def) => [def.key, edit[def.key] ?? ""]),
        ),
        planName: plan.planName,
      });
      setPlans((prev) =>
        prev.map((p) => (p.planId === plan.planId ? { ...p, limits: res.data.limits } : p)),
      );
      setSavedId(plan.planId);
      setTimeout(() => setSavedId((id) => (id === plan.planId ? null : id)), 1500);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [plan.planId]: err?.response?.data?.message || err.message,
      }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Plans &amp; Limits</h1>
        <p className="text-sm text-slate-500">
          Cap what a user on each subscription plan may manage. Leave a field empty for unlimited.
          Only active (non-disabled, non-archived) aMember plans are listed.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Plan</th>
                {limitDefs.map((def) => (
                  <th key={def.key} className="px-5 py-3" title={def.description}>
                    <div className="whitespace-nowrap">{def.label}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-normal normal-case text-slate-400">
                      {def.group}
                      {def.enforcement === "advisory" ? (
                        <span
                          className="rounded bg-slate-100 px-1 py-px text-slate-500"
                          title="Shown to the user as a usage warning, but nothing is blocked"
                        >
                          advisory
                        </span>
                      ) : null}
                    </div>
                  </th>
                ))}
                <th className="w-28 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td colSpan={limitDefs.length + 2} className="px-5 py-3">
                      <div className="h-9 animate-pulse rounded-md bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : plans.length === 0 ? (
                <tr>
                  <td colSpan={limitDefs.length + 2} className="px-5 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Layers className="h-6 w-6 text-slate-300" />
                      No active plans found in aMember
                    </div>
                  </td>
                </tr>
              ) : (
                plans.map((plan) => {
                  const edit = edits[plan.planId] || {};
                  const dirty = rowIsDirty(edit, plan, limitDefs);
                  const saving = savingId === plan.planId;
                  return (
                    <tr key={plan.planId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-900">{plan.planName}</div>
                        <div className="text-xs text-slate-400">ID {plan.planId}</div>
                      </td>
                      {limitDefs.map((def) => (
                        <td key={def.key} className="px-5 py-3">
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Unlimited"
                            aria-label={`${plan.planName} — ${def.label}`}
                            value={edit[def.key] ?? ""}
                            onChange={(e) => handleFieldChange(plan.planId, def.key, e.target.value)}
                            className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                          />
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => handleSave(plan)}
                          disabled={!dirty || saving}
                          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : savedId === plan.planId ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : null}
                          {saving ? "Saving…" : savedId === plan.planId ? "Saved" : "Save"}
                        </button>
                        {rowErrors[plan.planId] ? (
                          <div className="mt-1 text-xs text-rose-600">{rowErrors[plan.planId]}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
