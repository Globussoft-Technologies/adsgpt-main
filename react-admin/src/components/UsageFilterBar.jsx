/**
 * Filter bar for the Meta usage tables.
 *
 * WHY THE OPTIONS COME FROM THE SERVER. The source list grows whenever a new
 * product surface starts making Meta calls. A hardcoded list would quietly
 * omit exactly the new thing someone is trying to investigate, and it would
 * look like an empty result rather than a missing option.
 *
 * WHY SEARCH IS DEBOUNCED BUT SELECTS ARE NOT. Typing produces a keystroke
 * per character and each one is a round trip; picking from a dropdown is one
 * deliberate act and should feel immediate.
 */
import { useEffect, useState } from "react";
import { Ban, Filter, Search, SlidersHorizontal, User, Wallet, X } from "lucide-react";
import Select from "@/components/Select.jsx";
import { cn } from "@/lib/utils";

export const SORT_OPTIONS = [
  { value: "calls", label: "Most requests" },
  { value: "throttles", label: "Most refused" },
  { value: "failures", label: "Most failures" },
  { value: "peakInsightsAcc", label: "Highest insights meter" },
  { value: "peakBuc", label: "Highest BUC meter" },
  { value: "peakApp", label: "Highest app meter" },
];

const SOURCE_LABELS = {
  audit: "Autopilot audit",
  autopilot: "Autopilot",
  "ads-manager": "Ads Manager",
  "ad-posting": "Ad posting",
  "ad-factory": "Ad Factory",
  "partner-api": "Partner API",
  admin: "Admin panel",
  http: "Other HTTP",
  unknown: "Unattributed",
};
export const sourceLabel = (s) => SOURCE_LABELS[s] || s || "Unattributed";

export const EMPTY_FILTERS = {
  search: "",
  source: "all",
  adAccountId: "all",
  userId: "all",
  sort: "calls",
  onlyThrottled: false,
};

export function hasActiveFilters(f) {
  return (
    !!f.search ||
    f.source !== "all" ||
    f.adAccountId !== "all" ||
    f.userId !== "all" ||
    f.onlyThrottled ||
    f.sort !== "calls"
  );
}

export default function UsageFilterBar({
  filters,
  onChange,
  options,
  showUserFilter = true,
}) {
  const [term, setTerm] = useState(filters.search);

  // Keep the box in step when filters are cleared from outside.
  useEffect(() => {
    setTerm(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (term === filters.search) return;
    const t = setTimeout(() => onChange({ ...filters, search: term }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const set = (patch) => onChange({ ...filters, ...patch });

  const sourceOptions = [
    { value: "all", label: "All sources" },
    ...(options?.sources || []).map((s) => ({ value: s, label: sourceLabel(s) })),
  ];
  const accountOptions = [
    { value: "all", label: "All ad accounts" },
    ...(options?.accounts || []),
  ];
  const userOptions = [
    { value: "all", label: "All users" },
    ...(options?.users || []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="relative min-w-[16rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search account, user, email…"
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
        />
        {term ? (
          <button
            type="button"
            onClick={() => setTerm("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <Select
        value={filters.source}
        onChange={(v) => set({ source: v })}
        options={sourceOptions}
        leadingIcon={Filter}
      />

      <Select
        value={filters.adAccountId}
        onChange={(v) => set({ adAccountId: v })}
        options={accountOptions}
        leadingIcon={Wallet}
      />

      {showUserFilter ? (
        <Select
          value={filters.userId}
          onChange={(v) => set({ userId: v })}
          options={userOptions}
          leadingIcon={User}
        />
      ) : null}

      <Select
        value={filters.sort}
        onChange={(v) => set({ sort: v })}
        options={SORT_OPTIONS}
        leadingIcon={SlidersHorizontal}
      />

      <button
        type="button"
        onClick={() => set({ onlyThrottled: !filters.onlyThrottled })}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium shadow-sm transition",
          filters.onlyThrottled
            ? "border-rose-300 bg-rose-50 text-rose-700"
            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
        )}
      >
        <Ban className="h-4 w-4" />
        Refused only
      </button>

      {hasActiveFilters(filters) ? (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        >
          <X className="h-4 w-4" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
