import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownWideNarrow, ChevronRight, Loader2, Search } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import Badge from "@/components/Badge.jsx";
import DateRangePicker,{ currentMonthRangeISO } from "@/components/DateRangePicker.jsx";
import Select from "@/components/Select.jsx";
import { adminApi } from "@/lib/api";
import { formatDate, formatNumber, formatUsd } from "@/lib/utils";

const SORT_OPTIONS = [
  { value: "cost", label: "Highest cost" },
  { value: "generations", label: "Most generations" },
  { value: "credits", label: "Most credits" },
  { value: "recent", label: "Recent activity" },
];

function planTone(plan) {
  if (!plan) return "slate";
  const p = plan.toLowerCase();
  if (p.includes("enterprise") || p.includes("pro")) return "violet";
  if (p.includes("plus") || p.includes("growth")) return "indigo";
  if (p.includes("free") || p.includes("trial")) return "amber";
  return "sky";
}

export default function UsersPage() {
  const [range, setRange] = useState(() => currentMonthRangeISO());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("cost");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    adminApi
      .users({
        from: range.from || undefined,
        to: range.to || undefined,
        search: search || undefined,
        sort,
        page,
        limit: 25,
      })
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
  }, [range.from, range.to, search, sort, page]);

  const rows = data?.data || [];
  const total = data?.total || 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Users</h1>
          <p className="text-sm text-slate-500">Per-user generation activity and cost.</p>
        </div>
        <DateRangePicker
          from={range.from}
          to={range.to}
          onChange={(r) => {
            setRange(r);
            setPage(1);
          }}
        />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by user id, email, name…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
        </div>
        <Select
          value={sort}
          onChange={(v) => {
            setSort(v);
            setPage(1);
          }}
          options={SORT_OPTIONS}
          leadingIcon={ArrowDownWideNarrow}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500 backdrop-blur">
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
                    <tr key={u.userId} className="group border-t border-slate-100 transition hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link to={`/users/${encodeURIComponent(u.userId)}`} className="flex items-center gap-3">
                          <Avatar name={display} seed={u.userId} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900 group-hover:text-indigo-700">
                              {display}
                            </div>
                            <div className="truncate text-xs text-slate-500">{u.email || u.userId}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        {u.plan ? <Badge tone={planTone(u.plan)}>{u.plan}</Badge> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                        {formatNumber(u.generations)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">
                        <span className="text-slate-700">{formatNumber(u.images)}</span>
                        <span className="mx-1 text-slate-300">/</span>
                        <span className="text-slate-700">{formatNumber(u.videos)}</span>
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
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Prev
            </button>
            <span className="text-slate-500">
              Page <span className="font-medium text-slate-900">{page}</span>
            </span>
            <button
              disabled={!data?.hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}
    </div>
  );
}
