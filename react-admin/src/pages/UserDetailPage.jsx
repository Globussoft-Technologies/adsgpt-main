import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Brain,
  DollarSign,
  Image as ImageIcon,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MousePointerClick,
  Play,
  Video,
  Wallet,
} from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import Badge from "@/components/Badge.jsx";
import Select from "@/components/Select.jsx";
import StatCard from "@/components/StatCard.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { adminApi, analyticsApi } from "@/lib/api";
import { formatDate, formatNumber, formatUsd } from "@/lib/utils";
import { getStoredDateRange, setStoredDateRange } from "@/lib/dateRangeStore";

function formatPage(page) {
  if (!page) return "—";
  return page.replace(/^\/+/, "") || "/";
}

function formatSeconds(total) {
  const s = Math.round(Number(total) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
];

const S3_PREFIX = (import.meta.env.VITE_S3_PREFIX || "").replace(/\/$/, "");

function withS3Prefix(url) {
  if (!url || typeof url !== "string") return url || "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (!S3_PREFIX) return url;
  return `${S3_PREFIX}/${url.replace(/^\/+/, "")}`;
}

// image records often arrive as { base_image, base_image_with_logo, logo }
// — prefer the plain base_image so the gallery shows the raw creative.
function urlFromCandidate(c) {
  if (!c) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.length ? urlFromCandidate(c[0]) : "";
  if (typeof c === "object") {
    return c.base_image || c.base_image_with_logo || c.url || c.src || "";
  }
  return "";
}

function pickMediaUrl(item) {
  const candidates = [];
  if (item.type === "image") candidates.push(item.image);
  if (item.type === "video") candidates.push(item.video, item.image);
  for (const c of candidates) {
    const url = urlFromCandidate(c);
    if (url) return withS3Prefix(url);
  }
  return "";
}

function planTone(plan) {
  if (!plan) return "slate";
  const p = plan.toLowerCase();
  if (p.includes("enterprise") || p.includes("pro")) return "violet";
  if (p.includes("plus") || p.includes("growth")) return "indigo";
  if (p.includes("free") || p.includes("trial")) return "amber";
  return "sky";
}

export default function UserDetailPage() {
  const { userId } = useParams();
  const location = useLocation();
  const usersBackTo = location.state?.usersBackTo || "/users";
  const [range, setRange] = useState(() => getStoredDateRange());
  const [type, setType] = useState("all");
  const [model, setModel] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [engagement, setEngagement] = useState(null);
  const [tokenData, setTokenData] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(true);

  // Page-view summary is keyed only on user — no date/type/model filtering.
  useEffect(() => {
    let cancel = false;
    setEngagement(null);
    analyticsApi
      .userSummary(userId)
      .then((res) => {
        if (!cancel) setEngagement(res.data);
      })
      .catch(() => {
        if (!cancel) setEngagement(null);
      });
    return () => {
      cancel = true;
    };
  }, [userId]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    adminApi
      .userDetail(userId, {
        from: range.from || undefined,
        to: range.to || undefined,
        type: type && type !== "all" ? type : undefined,
        model: model || undefined,
        page,
        limit: 24,
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
  }, [userId, range.from, range.to, type, model, page]);

  // Token usage is its own collection/endpoint, keyed only on userId + date
  // range (no type/model/page filters — those apply to generatedMedia).
  useEffect(() => {
    let cancel = false;
    setTokenLoading(true);
    adminApi
      .tokenUsageUserDetail(userId, { from: range.from || undefined, to: range.to || undefined })
      .then((res) => {
        if (!cancel) setTokenData(res.data);
      })
      .catch(() => {
        if (!cancel) setTokenData(null);
      })
      .finally(() => !cancel && setTokenLoading(false));
    return () => {
      cancel = true;
    };
  }, [userId, range.from, range.to]);

  const user = data?.user;
  const credits = data?.credits;
  const summary = data?.summary || { generations: 0, cost: 0, credits: 0, images: 0, videos: 0 };
  const byModel = data?.byModel || [];
  const generations = data?.generations || { data: [], total: 0, hasMore: false };
  const displayName = user?.name || user?.login || userId;

  const tokenTotals = tokenData?.totals || {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unpricedCalls: 0,
  };
  const tokenByModel = tokenData?.byModel || [];
  const tokenByDay = tokenData?.daily || [];

  return (
    <div className="space-y-6">
      <div>
        <Link to={usersBackTo} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
      </div>

      {/* Header card */}
      <header className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
        />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-0.75">
              <div className="rounded-full bg-white p-0.5">
                <Avatar name={displayName} seed={userId} size="xl" />
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">
                {displayName}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                {user?.email ? (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" /> {user.email}
                  </span>
                ) : null}
                {user?.plan ? <Badge tone={planTone(user.plan)}>{user.plan}</Badge> : null}
                {user?.planExpiry ? (
                  <span className="text-xs">expires {formatDate(user.planExpiry)}</span>
                ) : null}
              </div>
              <div className="mt-1 font-mono text-xs text-slate-400">{userId}</div>
            </div>
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
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total cost" value={formatUsd(summary.cost)} accent="rose" icon={DollarSign} />
        <StatCard label="Generations" value={formatNumber(summary.generations)} accent="indigo" icon={Activity} />
        <StatCard label="Images" value={formatNumber(summary.images)} accent="sky" icon={ImageIcon} />
        <StatCard label="Videos" value={formatNumber(summary.videos)} accent="violet" icon={Video} />
      </div>

      {credits ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Credit balance</h2>
              <p className="text-xs text-slate-500">Subscription, rollover, and top-up pools</p>
            </div>
            <Wallet className="h-4 w-4 text-amber-500" />
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
            <CreditPool label="Subscription" pool={credits.subscription} accent="indigo" />
            <CreditPool label="Rollover" pool={credits.rollover} accent="violet" />
            <CreditPool label="Top-up" pool={credits.topup} accent="amber" />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500">
            <div>
              Total allowed:{" "}
              <span className="font-semibold tabular-nums text-slate-900">{formatNumber(credits.total_credits)}</span>
            </div>
            <div>
              Used:{" "}
              <span className="font-semibold tabular-nums text-slate-900">{formatNumber(credits.used_credits)}</span>
            </div>
            <div>
              Remaining:{" "}
              <span className="font-semibold tabular-nums text-emerald-600">{formatNumber(credits.remaining_credits)}</span>
            </div>
          </div>
        </section>
      ) : null}

      {/* <EngagementSection engagement={engagement} /> */}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Cost by model</h2>
          {model ? (
            <button
              onClick={() => {
                setModel("");
                setPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Clear filter: {model}
            </button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Model</th>
                <th className="px-5 py-3 text-right">Generations</th>
                <th className="px-5 py-3 text-right">Credits</th>
                <th className="px-5 py-3 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => {
                const isActive = model === m.model;
                return (
                  <tr key={m.model} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <button
                        onClick={() => {
                          setModel(isActive ? "" : m.model);
                          setPage(1);
                        }}
                        className={`font-medium ${isActive ? "text-indigo-700" : "text-slate-800 hover:text-indigo-700"}`}
                      >
                        {m.model}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(m.generations)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(m.credits)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-rose-600">{formatUsd(m.cost)}</td>
                  </tr>
                );
              })}
              {byModel.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                    No data in range
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="pt-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Token usage</h2>
        <p className="text-sm text-slate-500">This user's LLM API calls and token consumption (Ads Chat).</p>
      </div>

      {tokenLoading ? (
        <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-100/60" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Total tokens" value={formatNumber(tokenTotals.totalTokens)} accent="indigo" icon={Activity} />
            <StatCard label="Input tokens" value={formatNumber(tokenTotals.inputTokens)} accent="sky" icon={LogIn} />
            <StatCard label="Output tokens" value={formatNumber(tokenTotals.outputTokens)} accent="emerald" icon={LogOut} />
            <StatCard label="Thinking tokens" value={formatNumber(tokenTotals.thinkingTokens)} accent="amber" icon={Brain} />
            <StatCard
              label="Est. cost"
              value={formatUsd(tokenTotals.costUsd)}
              hint={tokenTotals.unpricedCalls > 0 ? `${formatNumber(tokenTotals.unpricedCalls)} calls unpriced` : undefined}
              accent="rose"
              icon={DollarSign}
            />
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Tokens by model</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Model</th>
                    <th className="px-5 py-3 text-right">Calls</th>
                    <th className="px-5 py-3 text-right">Input</th>
                    <th className="px-5 py-3 text-right">Output</th>
                    <th className="px-5 py-3 text-right">Thinking</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenByModel.map((m) => (
                    <tr key={m.model} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-medium text-slate-800">{m.model}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(m.calls)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(m.inputTokens)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(m.outputTokens)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(m.thinkingTokens)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-indigo-600">
                        {formatNumber(m.totalTokens)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-rose-600">
                        {m.unpricedCalls > 0 && m.unpricedCalls === m.calls ? "—" : formatUsd(m.costUsd)}
                      </td>
                    </tr>
                  ))}
                  {tokenByModel.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                        No data in range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Tokens by day</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3 text-right">Calls</th>
                    <th className="px-5 py-3 text-right">Input</th>
                    <th className="px-5 py-3 text-right">Output</th>
                    <th className="px-5 py-3 text-right">Thinking</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenByDay.map((d) => (
                    <tr key={d.date} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-medium text-slate-800">{d.date}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(d.calls)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(d.inputTokens)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(d.outputTokens)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(d.thinkingTokens)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-indigo-600">
                        {formatNumber(d.totalTokens)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-rose-600">
                        {d.unpricedCalls > 0 && d.unpricedCalls === d.calls ? "—" : formatUsd(d.costUsd)}
                      </td>
                    </tr>
                  ))}
                  {tokenByDay.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                        No data in range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">
            Generations <span className="text-slate-400">({formatNumber(generations.total)})</span>
          </h2>
          <Select
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={TYPE_OPTIONS}
            leadingIcon={Video}
          />
        </div>

        <div className="p-5">
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : generations.data.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center text-sm text-slate-500">
              No generations match these filters.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {generations.data.map((item) => (
                <MediaCard key={item._id} item={item} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
          <div>
            Page <span className="font-medium text-slate-900">{page}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              disabled={!generations.hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}
    </div>
  );
}

function EngagementSection({ engagement }) {
  if (!engagement) return null;
  // "/" is just the root redirect route (→ /adstudio) — hide it from the report.
  const topPages = (engagement.top_pages || []).filter((p) => p.page !== "/");
  const totalVisits = topPages.reduce((sum, p) => sum + (p.visits || 0), 0);
  const totalTime = topPages.reduce((sum, p) => sum + (p.total_time_spent || 0), 0);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Page activity</h2>
          <p className="text-xs text-slate-500">
            {formatNumber(totalVisits)} visits · {formatSeconds(totalTime)} total time (all-time)
          </p>
        </div>
        <MousePointerClick className="h-4 w-4 text-indigo-500" />
      </div>
      {topPages.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">No page activity tracked for this user yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Page</th>
                <th className="px-5 py-3 text-right">Visits</th>
                <th className="px-5 py-3 text-right">Time spent</th>
              </tr>
            </thead>
            <tbody>
              {topPages.map((row) => (
                <tr key={row.page} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-800">{formatPage(row.page)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(row.visits)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                    {formatSeconds(row.total_time_spent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const POOL_GRADIENT = {
  indigo: "from-indigo-500 to-violet-500",
  violet: "from-violet-500 to-fuchsia-500",
  amber: "from-amber-500 to-orange-500",
};

function CreditPool({ label, pool, accent = "indigo" }) {
  const total = pool?.total || 0;
  const remaining = pool?.remaining || 0;
  const used = pool?.used || 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="text-[11px] tabular-nums text-slate-400">{Math.round(pct)}% used</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(remaining)}</span>
        <span className="text-xs text-slate-500">of {formatNumber(total)}</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full bg-linear-to-r ${POOL_GRADIENT[accent] || POOL_GRADIENT.indigo}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-[11px] text-slate-400">{formatNumber(used)} used</div>
    </div>
  );
}

function MediaCard({ item }) {
  const url = pickMediaUrl(item);
  const isVideo = item.type === "video";
  const [playing, setPlaying] = useState(false);

  return (
    <div className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-square w-full bg-slate-100">
        {url ? (
          isVideo ? (
            playing ? (
              <video
                src={url}
                className="h-full w-full object-contain bg-black"
                controls
                autoPlay
                onEnded={() => setPlaying(false)}
              />
            ) : (
              <>
                <video src={url} className="h-full w-full object-cover" muted preload="metadata" />
                <div
                  className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer transition hover:bg-black/40"
                  onClick={() => setPlaying(true)}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg">
                    <Play className="h-5 w-5 ml-0.5" />
                  </div>
                </div>
              </>
            )
          ) : (
            <img
              src={url}
              alt={item.model}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              loading="lazy"
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            {isVideo ? <Video className="h-7 w-7" /> : <ImageIcon className="h-7 w-7" />}
          </div>
        )}
        {!playing && (
          <span
            className={
              "absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur " +
              (isVideo ? "bg-violet-500/90 text-white" : "bg-sky-500/90 text-white")
            }
          >
            {item.type}
          </span>
        )}
      </div>
      <div className="space-y-1 px-3 py-2.5 text-xs">
        <div className="truncate font-semibold text-slate-800" title={item.model}>
          {item.model}
        </div>
        <div className="flex items-center justify-between text-slate-500">
          <span>{formatDate(item.createdAt)}</span>
          <span className="font-semibold tabular-nums text-rose-600">{formatUsd(item.effective_cost ?? item.cost)}</span>
        </div>
        <div className="flex items-center justify-between text-slate-500">
          <span className="truncate">{item.source || "—"}</span>
          <span className="tabular-nums">
            {item.effective_credit_deduction || item.credit_deduction
              ? `${item.effective_credit_deduction || item.credit_deduction} cr`
              : "—"}
            {item.duration ? ` · ${item.duration}s` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
