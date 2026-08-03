import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowDownWideNarrow,
  ChevronRight,
  Filter,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import Badge from "@/components/Badge.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import Select from "@/components/Select.jsx";
import { adminApi } from "@/lib/api";
import { formatDate, formatNumber, formatUsd } from "@/lib/utils";
import { getStoredDateRange, setStoredDateRange } from "@/lib/dateRangeStore";

const SORT_OPTIONS = [
  { value: "cost", label: "Highest cost" },
  { value: "generations", label: "Most generations" },
  { value: "credits", label: "Most credits" },
  { value: "recent", label: "Recent activity" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
];

const ALL_MODEL_OPTION = { value: "all", label: "All models" };
const ALL_PLAN_OPTION = { value: "all", label: "All plans" };

const EMPTY_FILTERS = {
  type: "all",
  model: "all",
  plan: "all",
  generationsMin: "",
  generationsMax: "",
  creditsMin: "",
  creditsMax: "",
  costMin: "",
  costMax: "",
};

function pruneEmptyParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && value !== null),
  );
}

function planTone(plan) {
  if (!plan) return "slate";
  const p = plan.toLowerCase();
  if (p.includes("enterprise") || p.includes("pro")) return "violet";
  if (p.includes("plus") || p.includes("growth")) return "indigo";
  if (p.includes("free") || p.includes("trial")) return "amber";
  return "sky";
}

function formatRangeLabel(min, max, suffix = "") {
  if (min && max) return `${min}${suffix} - ${max}${suffix}`;
  if (min) return `>= ${min}${suffix}`;
  if (max) return `<= ${max}${suffix}`;
  return "";
}

function sanitizeNumericInput(value, allowDecimal = false) {
  const cleaned = value.replace(allowDecimal ? /[^0-9.]/g : /\D/g, "");
  if (!allowDecimal) return cleaned;

  const [first, ...rest] = cleaned.split(".");
  return rest.length ? `${first}.${rest.join("")}` : first;
}

function readUsersStateFromSearch(searchString) {
  const rawSearch = searchString.replace(/^\?/, "");
  const hasUrlState = rawSearch.length > 0;
  const params = new URLSearchParams(rawSearch);
  const storedRange = getStoredDateRange();
  const parsedPage = Number.parseInt(params.get("page") || "1", 10);
  const sort = params.get("sort") || "cost";
  const type = params.get("type") || EMPTY_FILTERS.type;

  return {
    range: hasUrlState
      ? { from: params.get("from") || "", to: params.get("to") || "" }
      : storedRange,
    search: params.get("search") || "",
    sort: SORT_OPTIONS.some((option) => option.value === sort) ? sort : "cost",
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    filters: {
      ...EMPTY_FILTERS,
      type: TYPE_OPTIONS.some((option) => option.value === type) ? type : EMPTY_FILTERS.type,
      model: params.get("model") || EMPTY_FILTERS.model,
      plan: params.get("plan") || EMPTY_FILTERS.plan,
      generationsMin: params.get("generationsMin") || "",
      generationsMax: params.get("generationsMax") || "",
      creditsMin: params.get("creditsMin") || "",
      creditsMax: params.get("creditsMax") || "",
      costMin: params.get("costMin") || "",
      costMax: params.get("costMax") || "",
    },
  };
}

function buildUsersSearchParams({ range, search, sort, page, filters }) {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  if (search) params.set("search", search);
  if (sort && sort !== "cost") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));

  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== EMPTY_FILTERS[key]) params.set(key, value);
  });

  return params;
}

function FilterField({ label, children, className = "" }) {
  return (
    <div className={"flex min-w-0 flex-1 flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 " + className}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function FilterInput({ value, onChange, placeholder, type = "text", min, numeric = false, decimal = false }) {
  return (
    <input
      type={numeric ? "text" : type}
      min={numeric ? undefined : min}
      inputMode={numeric ? (decimal ? "decimal" : "numeric") : undefined}
      pattern={numeric ? (decimal ? "[0-9]*[.]?[0-9]*" : "[0-9]*") : undefined}
      value={value}
      onChange={(e) => onChange(numeric ? sanitizeNumericInput(e.target.value, decimal) : e.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 shadow-xs outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:ring-3 focus:ring-indigo-100"
    />
  );
}

function RangeFilter({ label, minValue, maxValue, onMinChange, onMaxChange, type = "number", min = "0", decimal = false }) {
  const numeric = type === "number";

  return (
    <FilterField label={label}>
      <div className="grid grid-cols-2 gap-2">
        <FilterInput
          type={type}
          min={min}
          numeric={numeric}
          decimal={decimal}
          value={minValue}
          onChange={onMinChange}
          placeholder="Min"
        />
        <FilterInput
          type={type}
          min={min}
          numeric={numeric}
          decimal={decimal}
          value={maxValue}
          onChange={onMaxChange}
          placeholder="Max"
        />
      </div>
    </FilterField>
  );
}

function ActiveFilterChip({ label, value, onClear }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
      title="Clear filter"
    >
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className="max-w-32 truncate">{value}</span>
      <X className="h-3.5 w-3.5 shrink-0 text-slate-400" />
    </button>
  );
}

function FilterSummary({ chips, loading, error, onClear, hasActiveFilters }) {
  const visibleChips = chips.slice(0, 3);
  const hiddenChips = chips.slice(3);
  const hiddenTitle = hiddenChips.map((chip) => `${chip.label}: ${chip.value}`).join("\n");

  return (
    <div className="flex items-end gap-2 lg:col-span-2">
      <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-3">
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-400" />
        {chips.length ? (
          <>
            <span className="shrink-0 text-xs font-semibold text-slate-500">
              {chips.length} {chips.length === 1 ? "filter" : "filters"}
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              {visibleChips.map((chip) => (
                <ActiveFilterChip key={chip.key} label={chip.label} value={chip.value} onClear={chip.clear} />
              ))}
              {hiddenChips.length ? (
                <span
                  className="inline-flex h-7 shrink-0 items-center rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-500"
                  title={hiddenTitle}
                >
                  +{hiddenChips.length} more
                </span>
              ) : null}
            </div>
          </>
        ) : loading ? (
          <span className="truncate text-sm text-slate-400">Loading filters...</span>
        ) : error ? (
          <span className="truncate text-sm text-rose-500">Some filter options could not load</span>
        ) : (
          <span className="truncate text-sm text-slate-400">No filters applied</span>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={!hasActiveFilters}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <X className="h-4 w-4" />
        Clear
      </button>
    </div>
  );
}

function SummaryMetric({ label, value, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    rose: "text-rose-600",
    indigo: "text-indigo-600",
  };
  return (
    <div className="min-w-28 border-l border-slate-200 pl-4 first:border-l-0 first:pl-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export default function UsersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialState = useMemo(() => readUsersStateFromSearch(location.search), [location.search]);
  const [range, setRange] = useState(initialState.range);
  const [search, setSearch] = useState(initialState.search);
  const [sort, setSort] = useState(initialState.sort);
  const [filters, setFilters] = useState(initialState.filters);
  const [page, setPage] = useState(initialState.page);
  const [data, setData] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ models: [], plans: [] });
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterOptionsError, setFilterOptionsError] = useState("");

  const hasActiveFilters = useMemo(
    () => Object.entries(filters).some(([key, value]) => value && value !== EMPTY_FILTERS[key]),
    [filters],
  );

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  useEffect(() => {
    const nextParams = buildUsersSearchParams({ range, search, sort, page, filters }).toString();
    const currentParams = location.search.replace(/^\?/, "");

    if (nextParams === currentParams) return;

    navigate(
      {
        pathname: location.pathname,
        search: nextParams ? `?${nextParams}` : "",
      },
      { replace: true },
    );
  }, [
    range,
    search,
    sort,
    page,
    filters,
    location.pathname,
    location.search,
    navigate,
  ]);

  const modelOptions = useMemo(
    () => [ALL_MODEL_OPTION, ...filterOptions.models],
    [filterOptions.models],
  );

  const planOptions = useMemo(
    () => [ALL_PLAN_OPTION, ...filterOptions.plans],
    [filterOptions.plans],
  );

  const activeFilterChips = useMemo(() => {
    const chips = [];

    if (filters.model !== "all") {
      chips.push({
        key: "model",
        label: "Model",
        value: modelOptions.find((option) => option.value === filters.model)?.label || filters.model,
        clear: () => updateFilter("model", "all"),
      });
    }
    if (filters.plan !== "all") {
      chips.push({
        key: "plan",
        label: "Plan",
        value: planOptions.find((option) => option.value === filters.plan)?.label || filters.plan,
        clear: () => updateFilter("plan", "all"),
      });
    }
    if (filters.type !== "all") {
      chips.push({
        key: "type",
        label: "Type",
        value: TYPE_OPTIONS.find((option) => option.value === filters.type)?.label || filters.type,
        clear: () => updateFilter("type", "all"),
      });
    }

    const generations = formatRangeLabel(filters.generationsMin, filters.generationsMax);
    if (generations) {
      chips.push({
        key: "generations",
        label: "Generations",
        value: generations,
        clear: () => {
          updateFilter("generationsMin", "");
          updateFilter("generationsMax", "");
        },
      });
    }

    const credits = formatRangeLabel(filters.creditsMin, filters.creditsMax);
    if (credits) {
      chips.push({
        key: "credits",
        label: "Credits",
        value: credits,
        clear: () => {
          updateFilter("creditsMin", "");
          updateFilter("creditsMax", "");
        },
      });
    }

    const cost = formatRangeLabel(filters.costMin, filters.costMax, "$");
    if (cost) {
      chips.push({
        key: "cost",
        label: "Cost",
        value: cost,
        clear: () => {
          updateFilter("costMin", "");
          updateFilter("costMax", "");
        },
      });
    }

    return chips;
  }, [filters, modelOptions, planOptions]);

  useEffect(() => {
    let cancel = false;
    setFilterOptionsLoading(true);
    setFilterOptionsError("");
    adminApi
      .usersFilterOptions({
        from: range.from || undefined,
        to: range.to || undefined,
      })
      .then((res) => {
        if (cancel) return;
        setFilterOptions({
          models: res.data?.data?.models || [],
          plans: res.data?.data?.plans || [],
        });
      })
      .catch((err) => {
        if (!cancel) setFilterOptionsError(err?.response?.data?.message || err.message);
      })
      .finally(() => !cancel && setFilterOptionsLoading(false));
    return () => {
      cancel = true;
    };
  }, [range.from, range.to]);

  useEffect(() => {
    if (filterOptionsLoading) return;
    if (filters.model !== "all" && !filterOptions.models.some((option) => option.value === filters.model)) {
      updateFilter("model", "all");
    }
    if (filters.plan !== "all" && !filterOptions.plans.some((option) => option.value === filters.plan)) {
      updateFilter("plan", "all");
    }
  }, [filterOptionsLoading, filterOptions.models, filterOptions.plans, filters.model, filters.plan]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    adminApi
      .users(pruneEmptyParams({
        from: range.from || undefined,
        to: range.to || undefined,
        search: search || undefined,
        type: filters.type === "all" ? undefined : filters.type,
        model: filters.model === "all" ? undefined : filters.model,
        plan: filters.plan === "all" ? undefined : filters.plan,
        generationsMin: filters.generationsMin,
        generationsMax: filters.generationsMax,
        creditsMin: filters.creditsMin,
        creditsMax: filters.creditsMax,
        costMin: filters.costMin,
        costMax: filters.costMax,
        sort,
        page,
        limit: 25,
      }))
      .then((res) => {
        if (!cancel) setData(res.data);
      })
      .catch((err) => {
        if (!cancel) setError(err?.response?.data?.message || err.message);
      })
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [
    range.from,
    range.to,
    search,
    sort,
    page,
    filters.type,
    filters.model,
    filters.plan,
    filters.generationsMin,
    filters.generationsMax,
    filters.creditsMin,
    filters.creditsMax,
    filters.costMin,
    filters.costMax,
  ]);

  const rows = data?.data || [];
  const total = data?.total || 0;
  const visibleTotals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          generations: acc.generations + (row.generations || 0),
          credits: acc.credits + (row.credits || 0),
          cost: acc.cost + (row.cost || 0),
        }),
        { generations: 0, credits: 0, cost: 0 },
      ),
    [rows],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-500">
            Admin intelligence
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Users</h1>
          <p className="mt-1 text-sm text-slate-500">Per-user generation activity, credits, and cost.</p>
        </div>
        <DateRangePicker
          from={range.from}
          to={range.to}
          onChange={(r) => {
            setRange(r);
            setStoredDateRange(r);
            setPage(1);
          }}
        />
      </header>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid border-b border-slate-200 lg:grid-cols-[minmax(20rem,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by user id, email, name..."
              className="h-14 w-full border-0 bg-white pl-11 pr-4 text-base font-medium text-slate-900 outline-none placeholder:text-sm placeholder:font-normal placeholder:text-slate-400 focus:ring-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-2 lg:border-l lg:border-t-0">
            <Select
              value={filters.type}
              onChange={(value) => updateFilter("type", value)}
              options={TYPE_OPTIONS}
              leadingIcon={Filter}
              className="h-10 min-w-40 rounded-md border-slate-200 shadow-xs"
            />
            <Select
              value={sort}
              onChange={(v) => {
                setSort(v);
                setPage(1);
              }}
              options={SORT_OPTIONS}
              leadingIcon={ArrowDownWideNarrow}
              className="h-10 min-w-44 rounded-md border-slate-200 shadow-xs"
            />
          </div>
        </div>

        <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_1.1fr_1.1fr_1.1fr]">
          <FilterField label="Model">
            <Select
              value={filters.model}
              onChange={(value) => updateFilter("model", value)}
              options={modelOptions}
              className="h-10 w-full min-w-0 max-w-full rounded-md border-slate-200 shadow-xs [&_[data-radix-select-value]]:truncate"
            />
          </FilterField>
          <FilterField label="Plan">
            <Select
              value={filters.plan}
              onChange={(value) => updateFilter("plan", value)}
              options={planOptions}
              className="h-10 w-full min-w-0 max-w-full rounded-md border-slate-200 shadow-xs [&_[data-radix-select-value]]:truncate"
            />
          </FilterField>
          <RangeFilter
            label="Generations"
            minValue={filters.generationsMin}
            maxValue={filters.generationsMax}
            onMinChange={(value) => updateFilter("generationsMin", value)}
            onMaxChange={(value) => updateFilter("generationsMax", value)}
          />
          <RangeFilter
            label="Credits"
            minValue={filters.creditsMin}
            maxValue={filters.creditsMax}
            onMinChange={(value) => updateFilter("creditsMin", value)}
            onMaxChange={(value) => updateFilter("creditsMax", value)}
          />
          <RangeFilter
            label="Cost"
            decimal
            minValue={filters.costMin}
            maxValue={filters.costMax}
            onMinChange={(value) => updateFilter("costMin", value)}
            onMaxChange={(value) => updateFilter("costMax", value)}
          />
          {/* <FilterSummary
            chips={activeFilterChips}
            loading={filterOptionsLoading}
            error={filterOptionsError}
            onClear={clearFilters}
            hasActiveFilters={hasActiveFilters}
          /> */}
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">User activity</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Showing {formatNumber(rows.length)} of {formatNumber(total)} matching users
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <SummaryMetric label="Visible gen" value={formatNumber(visibleTotals.generations)} tone="indigo" />
            <SummaryMetric label="Visible credits" value={formatNumber(visibleTotals.credits)} />
            <SummaryMetric label="Visible cost" value={formatUsd(visibleTotals.cost)} tone="rose" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Plan</th>
                <th className="px-5 py-3 text-right">Generations</th>
                <th className="px-5 py-3 text-right">Img / Vid</th>
                <th className="px-5 py-3 text-right">Credits</th>
                <th className="px-5 py-3 text-right">Cost (USD)</th>
                <th className="px-5 py-3">Last activity</th>
                <th className="w-10 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td colSpan={8} className="px-5 py-3">
                      <div className="h-9 animate-pulse rounded-md bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-500">
                    No users in range
                  </td>
                </tr>
              ) : (
                rows.map((u) => {
                  const display = u.name || u.login || u.userId;
                  return (
                    <tr key={u.userId} className="group border-t border-slate-100 transition hover:bg-indigo-50/30">
                      <td className="px-5 py-3">
                        <Link
                          to={`/users/${encodeURIComponent(u.userId)}`}
                          state={{ usersBackTo: `${location.pathname}${location.search}` }}
                          className="flex items-center gap-3"
                        >
                          <Avatar name={display} seed={u.userId} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900 group-hover:text-indigo-700">
                              {display}
                            </div>
                            <div className="truncate text-xs text-slate-500">{u.email || u.userId}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        {u.plan ? <Badge tone={planTone(u.plan)}>{u.plan}</Badge> : <span className="text-slate-400">-</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                        {formatNumber(u.generations)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">
                        <span className="font-medium text-slate-700">{formatNumber(u.images)}</span>
                        <span className="mx-1 text-slate-300">/</span>
                        <span className="font-medium text-slate-700">{formatNumber(u.videos)}</span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                        {formatNumber(u.credits)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-rose-600">
                        {formatUsd(u.cost)}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{formatDate(u.lastActivity)}</td>
                      <td className="px-5 py-3 text-slate-400">
                        <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
          <div>
            <span className="font-medium text-slate-900">{formatNumber(total)}</span> users
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Prev
            </button>
            <span className="text-slate-500">
              Page <span className="font-medium text-slate-900">{page}</span>
            </span>
            <button
              disabled={!data?.hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : null}
    </div>
  );
}
