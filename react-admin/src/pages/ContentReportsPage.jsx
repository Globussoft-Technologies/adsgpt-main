import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flag, Image as ImageIcon, Users, Video } from "lucide-react";
import StatCard from "@/components/StatCard.jsx";
import SearchInput from "@/components/SearchInput.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const LIMIT = 20;
const ALL_TIME = { preset: "lifetime", from: "", to: "" };

// Media saved as a path ("/creatives/GPT-409/….webp") lives on the content CDN.
const CDN = (import.meta.env.VITE_S3_BASE_URL || "https://contents.adsgpt.io").replace(/\/+$/, "");

// generatedMedia stores image/video either as a URL string or an object.
function mediaUrl(item) {
  const v = item.type === "video" ? item.video : item.image;
  const url = typeof v === "string" ? v : v?.url || v?.base_image_with_logo || v?.base_image || "";
  if (!url || /^(https?:|data:|blob:)/i.test(url)) return url;
  return `${CDN}/${url.replace(/^\/+/, "")}`;
}

function Preview({ item }) {
  const url = mediaUrl(item);
  if (!url) return <div className="h-16 w-16 rounded-lg bg-slate-100" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg bg-slate-100">
      {item.type === "video" ? (
        <video src={url} muted className="h-full w-full object-cover" />
      ) : (
        <img src={url} alt="" className="h-full w-full object-cover" />
      )}
    </a>
  );
}

const selectCls = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

// Read-only list of user reports. A report hides the item for the user who
// reported it; nothing is decided here.
export default function ContentReportsPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [model, setModel] = useState("");
  const [range, setRange] = useState(ALL_TIME);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, summary: null, models: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    adminApi
      .contentReports({
        q: q || undefined,
        type: type || undefined,
        model: model || undefined,
        from: range.from || undefined,
        to: range.to || undefined,
        page,
        limit: LIMIT,
      })
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }, [q, type, model, range.from, range.to, page]);

  const pages = Math.max(1, Math.ceil((data.total || 0) / LIMIT));
  const filtered = !!(q || type || model || range.from || range.to);
  const s = data.summary;
  const reset = (fn) => (v) => { fn(v); setPage(1); };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Content Reports</h1>
        <p className="text-sm text-slate-500">
          Generated images and videos users reported. A reported item is hidden for the user who reported it.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total reports" value={s ? s.total : "—"} icon={Flag} accent="rose" />
        <StatCard label="Images" value={s ? s.images : "—"} icon={ImageIcon} accent="indigo" />
        <StatCard label="Videos" value={s ? s.videos : "—"} icon={Video} accent="sky" />
        <StatCard label="Users who reported" value={s ? s.users : "—"} icon={Users} accent="amber" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onSearch={reset(setQ)}
          placeholder="Search name, email or user ID"
          className="w-72"
        />
        <select value={type} onChange={(e) => reset(setType)(e.target.value)} className={selectCls}>
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
        <select value={model} onChange={(e) => reset(setModel)(e.target.value)} className={`${selectCls} max-w-56`}>
          <option value="">All models</option>
          {data.models?.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <DateRangePicker
          preset={range.preset}
          from={range.from}
          to={range.to}
          onChange={reset(setRange)}
          ariaLabel="Reported date range"
        />
        {filtered ? (
          <button
            onClick={() => { setQ(""); setType(""); setModel(""); setRange(ALL_TIME); setPage(1); }}
            className="px-2 py-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Media</th>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Reason</th>
                <th className="px-5 py-3">Reported</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td colSpan={5} className="px-5 py-3">
                      <div className="h-16 animate-pulse rounded-md bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    {filtered ? "No reports match these filters" : "No reports yet"}
                  </td>
                </tr>
              ) : (
                data.items.map((item) => (
                  <tr key={item._id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-start gap-3">
                        <Preview item={item} />
                        <div>
                          <div className="font-medium text-slate-900">{item.model}</div>
                          <div className="text-xs text-slate-500">
                            {item.type}
                            {item.source ? ` · ${item.source}` : ""}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{item._id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Link to={`/users/${encodeURIComponent(item.userId)}`} className="font-medium text-indigo-600 hover:underline">
                        {item.user?.name || item.userId}
                      </Link>
                      {item.user?.email ? <div className="text-xs text-slate-500">{item.user.email}</div> : null}
                      {item.user?.name ? <div className="text-xs text-slate-400">{item.userId}</div> : null}
                    </td>
                    <td className="max-w-sm px-5 py-3 text-slate-700">
                      {item.report_reason ? (
                        <span className="whitespace-pre-line break-words">{item.report_reason}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Flag className="h-3.5 w-3.5 text-rose-500" />
                        {formatDate(item.reported_at)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(item.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          {filtered ? `${data.total || 0} of ${s?.total ?? 0} reports match` : `${data.total || 0} reports`}
        </span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Prev</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
