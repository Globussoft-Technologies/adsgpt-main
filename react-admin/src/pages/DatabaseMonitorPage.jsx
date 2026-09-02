import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  HardDrive,
  Loader2,
  MemoryStick,
  RefreshCw,
  SearchCode,
  Server,
  WifiOff,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Badge from "@/components/Badge.jsx";
import { adminApi } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "operations", label: "Live operations", icon: SearchCode },
  { id: "slow", label: "Slow queries", icon: Clock3 },
];

function valueOrDash(value, suffix = "") {
  return value === null || value === undefined ? "—" : `${formatNumber(value)}${suffix}`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
}

function MetricCard({ label, value, detail, icon: Icon, tone = "indigo" }) {
  const colors = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    sky: "bg-sky-50 text-sky-600",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div></div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      {detail ? <div className="mt-2 text-xs text-slate-400">{detail}</div> : null}
    </div>
  );
}

function Notice({ children, tone = "amber" }) {
  const style = tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-800";
  return <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${style}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;
}

function ChartPanel({ title, children }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-sm font-semibold text-slate-800">{title}</h2><div className="h-64">{children}</div></section>;
}

function Overview({ health }) {
  const samples = useMemo(() => (health?.samples || []).map((sample) => ({
    ...sample,
    time: new Date(sample.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    ops: sample.rates?.ops?.total ?? null,
    readMs: sample.rates?.latencyMs?.reads ?? null,
    writeMs: sample.rates?.latencyMs?.writes ?? null,
    poolInUse: sample.pool?.inUse ?? null,
    poolWaiting: sample.pool?.waiting ?? null,
  })), [health]);
  const pool = health?.pool || {};
  const server = health?.server;
  const rates = health?.rates;

  return <div className="space-y-4">
    {health?.sampler?.warning ? <Notice>{health.sampler.warning}</Notice> : null}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Operations / sec" value={valueOrDash(rates?.ops?.total)} detail="All MongoDB operations" icon={Activity} tone="indigo" />
      <MetricCard label="Pool in use" value={`${pool.inUse ?? 0} / ${pool.maxPoolSize ?? "—"}`} detail={`${valueOrDash(pool.utilisation ? Math.round(pool.utilisation) : 0, "%")} utilised · ${pool.waiting || 0} waiting`} icon={Database} tone={pool.waiting ? "amber" : "emerald"} />
      <MetricCard label="Server connections" value={valueOrDash(server?.connections?.current)} detail={`${valueOrDash(server?.connections?.active)} active`} icon={Server} tone="sky" />
      <MetricCard label="Resident memory" value={valueOrDash(server?.memMb?.resident, " MB")} detail={`Node heap ${valueOrDash(health?.process?.heapUsedMb, " MB")}`} icon={MemoryStick} tone="amber" />
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartPanel title="MongoDB operations per second">
        {samples.length < 2 ? <EmptyChart /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={samples}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="time" minTickGap={36} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={38} /><Tooltip /><Line type="monotone" dataKey="ops" name="Ops/sec" stroke="#4f46e5" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer>}
      </ChartPanel>
      <ChartPanel title="Operation latency">
        {samples.length < 2 ? <EmptyChart /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={samples}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="time" minTickGap={36} tick={{ fontSize: 11 }} /><YAxis unit=" ms" tick={{ fontSize: 11 }} width={58} /><Tooltip /><Legend /><Line type="monotone" dataKey="readMs" name="Reads" stroke="#0284c7" strokeWidth={2} dot={false} connectNulls /><Line type="monotone" dataKey="writeMs" name="Writes" stroke="#ea580c" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer>}
      </ChartPanel>
      <ChartPanel title="Application connection pool">
        {samples.length < 2 ? <EmptyChart /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={samples}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="time" minTickGap={36} tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={38} /><Tooltip /><Legend /><Line type="stepAfter" dataKey="poolInUse" name="In use" stroke="#059669" strokeWidth={2} dot={false} /><Line type="stepAfter" dataKey="poolWaiting" name="Waiting" stroke="#dc2626" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>}
      </ChartPanel>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-800">Server details</h2>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
          <Detail label="MongoDB" value={server?.version || "Unavailable"} />
          <Detail label="Storage engine" value={server?.storageEngine || "—"} />
          <Detail label="Database" value={health?.connection?.database || "—"} />
          <Detail label="Host" value={[health?.connection?.host, health?.connection?.port].filter(Boolean).join(":") || "—"} />
          <Detail label="MongoDB uptime" value={formatUptime(server?.uptimeSec)} />
          <Detail label="Node process uptime" value={formatUptime(health?.process?.uptimeSec)} />
          <Detail label="Network in" value={valueOrDash(rates?.networkKbIn, " KB/s")} />
          <Detail label="Network out" value={valueOrDash(rates?.networkKbOut, " KB/s")} />
        </dl>
      </section>
    </div>
  </div>;
}

function EmptyChart() {
  return <div className="flex h-full items-center justify-center text-sm text-slate-400">Collecting samples… charts appear in a few seconds.</div>;
}

function Detail({ label, value }) {
  return <div><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 truncate font-medium text-slate-700" title={String(value)}>{value}</dd></div>;
}

function Storage({ data, loading, includeIndexes, onToggleIndexes }) {
  if (loading) return <Loading />;
  if (!data) return null;
  const db = data.database || {};
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Data size" value={valueOrDash(db.dataMb, " MB")} detail={`${formatNumber(db.documents || 0)} documents`} icon={Database} />
      <MetricCard label="Allocated storage" value={valueOrDash(db.storageMb, " MB")} detail={`${formatNumber(db.collections || 0)} collections`} icon={HardDrive} tone="sky" />
      <MetricCard label="Index size" value={valueOrDash(db.indexMb, " MB")} detail={`${formatNumber(db.indexes || 0)} indexes`} icon={SearchCode} tone="emerald" />
      <MetricCard label="Filesystem used" value={valueOrDash(db.fsUsedMb, " MB")} detail={db.fsTotalMb != null ? `${valueOrDash(db.fsTotalMb, " MB")} total` : "Not reported by server"} icon={Server} tone="amber" />
    </div>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-800">Collections</h2><p className="text-xs text-slate-400">Sorted by allocated storage</p></div><label className="flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={includeIndexes} onChange={(event) => onToggleIndexes(event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-indigo-600" /> Include index usage</label></div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Collection</th><th className="px-5 py-3 text-right">Documents</th><th className="px-5 py-3 text-right">Data</th><th className="px-5 py-3 text-right">Storage</th><th className="px-5 py-3 text-right">Indexes</th><th className="px-5 py-3 text-right">Read / write avg</th></tr></thead><tbody>{(data.collections || []).map((collection) => <CollectionRow key={collection.name} collection={collection} includeIndexes={includeIndexes} />)}</tbody></table></div>
    </section>
  </div>;
}

function CollectionRow({ collection, includeIndexes }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <tr onClick={() => includeIndexes && collection.indexes?.length && setExpanded((value) => !value)} className={`border-t border-slate-100 ${includeIndexes ? "hover:bg-slate-50" : ""}`}>
      <td className="px-5 py-3 font-mono text-xs font-medium text-slate-800">{collection.name}{collection.error ? <div className="mt-1 font-sans text-rose-600">{collection.error}</div> : null}</td>
      <td className="px-5 py-3 text-right text-slate-600">{valueOrDash(collection.documents)}</td><td className="px-5 py-3 text-right text-slate-600">{valueOrDash(collection.dataMb, " MB")}</td><td className="px-5 py-3 text-right text-slate-600">{valueOrDash(collection.storageMb, " MB")}</td><td className="px-5 py-3 text-right text-slate-600">{valueOrDash(collection.indexMb, " MB")} <span className="text-xs text-slate-400">({collection.indexCount ?? "—"})</span></td><td className="px-5 py-3 text-right text-xs text-slate-500">{valueOrDash(collection.avgReadMs, " ms")} / {valueOrDash(collection.avgWriteMs, " ms")}</td>
    </tr>
    {expanded ? <tr className="bg-slate-50/70"><td colSpan={6} className="px-8 py-3"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{collection.indexes.map((index) => <div key={index.name} className="rounded-lg border border-slate-200 bg-white px-3 py-2"><div className="flex justify-between gap-3"><code className="truncate text-xs font-medium text-slate-700">{index.name}</code><Badge tone={index.accesses === 0 ? "amber" : "emerald"}>{formatNumber(index.accesses)} uses</Badge></div><div className="mt-1 text-[11px] text-slate-400">{valueOrDash(index.sizeMb, " MB")} · since {formatDate(index.since)}</div></div>)}</div></td></tr> : null}
  </>;
}

function Operations({ data, loading, minSecs, onMinSecs, onRefresh }) {
  if (loading) return <Loading />;
  if (!data?.available) return <Notice>{data?.message || "Live operations are unavailable."}</Notice>;
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-800">In-flight operations</h2><p className="text-xs text-slate-400">Query values are redacted; field names and operators remain visible.</p></div><div className="flex items-center gap-2"><label className="text-xs text-slate-500">Minimum seconds <input type="number" min="0" max="86400" value={minSecs} onChange={(e) => onMinSecs(e.target.value)} className="ml-1 w-20 rounded-md border border-slate-300 px-2 py-1.5" /></label><button onClick={onRefresh} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button></div></div>
    <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Namespace</th><th className="px-5 py-3">Operation</th><th className="px-5 py-3 text-right">Running</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Redacted command</th></tr></thead><tbody>{!data.ops?.length ? <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400">No matching active operations</td></tr> : data.ops.map((op) => <tr key={`${op.opid}-${op.ns}`} className="border-t border-slate-100 align-top"><td className="px-5 py-3 font-mono text-xs text-slate-700">{op.ns || "—"}</td><td className="px-5 py-3"><Badge tone={op.waitingForLock ? "amber" : "sky"}>{op.op || op.type || "unknown"}</Badge></td><td className="px-5 py-3 text-right font-medium text-slate-700">{Number(op.secsRunning || 0).toFixed(2)}s</td><td className="px-5 py-3"><Badge tone={op.planSummary?.includes("COLLSCAN") ? "rose" : "slate"}>{op.planSummary || "—"}</Badge></td><td className="max-w-lg px-5 py-3"><pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-2 text-[11px] text-slate-200">{JSON.stringify(op.command, null, 2)}</pre></td></tr>)}</tbody></table></div>
  </section>;
}

function SlowQueries({ data, loading }) {
  if (loading) return <Loading />;
  if (!data?.available) return <Notice>{data?.message || "Profiler status is unavailable."}</Notice>;
  if (!data.enabled) return <div className="space-y-3"><Notice>MongoDB profiling is off. This dashboard intentionally does not enable it because profiling changes database behavior.</Notice>{data.hint ? <pre className="overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-200">{data.hint}</pre> : null}</div>;
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-800">Recent slow queries</h2><p className="text-xs text-slate-400">Profiler level {data.level} · threshold {data.slowms ?? "—"} ms · query values redacted</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Namespace</th><th className="px-5 py-3 text-right">Duration</th><th className="px-5 py-3">Scan</th><th className="px-5 py-3">Plan</th></tr></thead><tbody>{!data.entries?.length ? <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400">No profiler entries found</td></tr> : data.entries.map((entry, index) => <tr key={`${entry.ts}-${index}`} className="border-t border-slate-100"><td className="px-5 py-3 text-xs text-slate-500">{formatDate(entry.ts)}</td><td className="px-5 py-3 font-mono text-xs text-slate-700">{entry.ns || "—"}</td><td className="px-5 py-3 text-right font-semibold text-slate-800">{valueOrDash(entry.millis, " ms")}</td><td className="px-5 py-3 text-xs text-slate-500">{valueOrDash(entry.docsExamined)} docs / {valueOrDash(entry.keysExamined)} keys</td><td className="px-5 py-3"><Badge tone={entry.planSummary?.includes("COLLSCAN") ? "rose" : "slate"}>{entry.planSummary || "—"}</Badge></td></tr>)}</tbody></table></div></section>;
}

function Loading() {
  return <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-20 text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading database metrics…</div>;
}

export default function DatabaseMonitorPage() {
  const [tab, setTab] = useState("overview");
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState("");
  const [stats, setStats] = useState(null);
  const [ops, setOps] = useState(null);
  const [slow, setSlow] = useState(null);
  const [loadingTab, setLoadingTab] = useState(false);
  const [includeIndexes, setIncludeIndexes] = useState(false);
  const [minSecs, setMinSecs] = useState("0");

  const loadHealth = useCallback(async () => {
    try { const response = await adminApi.dbHealth(); setHealth(response.data); setHealthError(""); }
    catch (error) { setHealthError(error?.response?.data?.message || error.message); }
  }, []);

  const loadTab = useCallback(async (target = tab, indexUsage = includeIndexes) => {
    if (target === "overview") return loadHealth();
    setLoadingTab(true);
    try {
      if (target === "storage") setStats((await adminApi.dbStats({ indexes: indexUsage ? 1 : 0 })).data);
      if (target === "operations") setOps((await adminApi.dbOps({ minSecs })).data);
      if (target === "slow") setSlow((await adminApi.dbSlowQueries({ limit: 50 })).data);
      setHealthError("");
    } catch (error) { setHealthError(error?.response?.data?.message || error.message); }
    finally { setLoadingTab(false); }
  }, [tab, includeIndexes, minSecs, loadHealth]);

  useEffect(() => { loadHealth(); const timer = window.setInterval(() => { if (!document.hidden) loadHealth(); }, 10_000); return () => window.clearInterval(timer); }, [loadHealth]);
  useEffect(() => { if (tab !== "overview") loadTab(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleIndexes(value) { setIncludeIndexes(value); loadTab("storage", value); }

  const connected = health?.connection?.state === "connected";
  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Database Monitor</h1><p className="mt-1 text-sm text-slate-500">Read-only MongoDB health, performance, storage, and query diagnostics.</p></div><div className="flex items-center gap-2"><Badge tone={connected ? "emerald" : "rose"} className="gap-1.5 py-1">{connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{health?.connection?.state || "Checking"}</Badge><button onClick={() => loadTab()} disabled={loadingTab} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50" title="Refresh"><RefreshCw className={`h-4 w-4 ${loadingTab ? "animate-spin" : ""}`} /></button></div></header>
    {healthError ? <Notice tone="rose">{healthError}</Notice> : null}
    <div className="overflow-x-auto border-b border-slate-200"><nav className="flex min-w-max gap-1">{TABS.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}><Icon className="h-4 w-4" />{label}</button>)}</nav></div>
    {tab === "overview" ? health ? <Overview health={health} /> : <Loading /> : null}
    {tab === "storage" ? <Storage data={stats} loading={loadingTab} includeIndexes={includeIndexes} onToggleIndexes={toggleIndexes} /> : null}
    {tab === "operations" ? <Operations data={ops} loading={loadingTab} minSecs={minSecs} onMinSecs={setMinSecs} onRefresh={() => loadTab("operations")} /> : null}
    {tab === "slow" ? <SlowQueries data={slow} loading={loadingTab} /> : null}
  </div>;
}
