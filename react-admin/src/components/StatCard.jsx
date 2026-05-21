const ACCENTS = {
  indigo: {
    icon: "bg-indigo-100 text-indigo-600",
    bar: "from-indigo-500/10 to-indigo-500/0",
  },
  emerald: {
    icon: "bg-emerald-100 text-emerald-600",
    bar: "from-emerald-500/10 to-emerald-500/0",
  },
  amber: {
    icon: "bg-amber-100 text-amber-600",
    bar: "from-amber-500/10 to-amber-500/0",
  },
  rose: {
    icon: "bg-rose-100 text-rose-600",
    bar: "from-rose-500/10 to-rose-500/0",
  },
  sky: {
    icon: "bg-sky-100 text-sky-600",
    bar: "from-sky-500/10 to-sky-500/0",
  },
  slate: {
    icon: "bg-slate-100 text-slate-600",
    bar: "from-slate-500/10 to-slate-500/0",
  },
};

export default function StatCard({ label, value, hint, icon: Icon, accent = "indigo" }) {
  const tone = ACCENTS[accent] || ACCENTS.indigo;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-linear-to-br ${tone.bar} blur-2xl`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
          {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
        </div>
        {Icon ? (
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone.icon}`}>
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
