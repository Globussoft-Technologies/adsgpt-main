/**
 * FailureCodes — why the refused requests were refused.
 *
 * WHY THIS EXISTS. "1,064 failed requests" is a fact nobody can act on. An
 * expired token, a permission revoked in Business Manager and an app-level
 * rate limit all increment that one number, and they have three different
 * owners and three different fixes. Diagnosing one ad account that was
 * failing 100% of its requests took six ad-hoc database queries and still
 * could not name the cause, because the cause was never written down.
 *
 * Shown on both the platform overview and the per-user drill-down: the
 * overview answers "is anything broken", the drill-down answers "is it this
 * user", and the same breakdown is the evidence for both.
 *
 * Bars scale against the WORST code rather than the failure total, because
 * one cause almost always dominates and scaling to the total would flatten
 * every other row to an invisible sliver.
 */
import { formatNumber } from "@/lib/utils";

export default function FailureCodes({ rows = [] }) {
  const worst = rows.reduce((m, r) => Math.max(m, r.failures || 0), 0);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-800">Why requests failed</h2>
        <p className="text-xs text-slate-500">
          Meta&rsquo;s error code for every refused request in this range. Rate limits are a
          capacity problem; tokens and permissions are an account problem.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">
          No failures recorded in this range.
        </div>
      ) : (
        <ul className="divide-y divide-slate-50">
          {rows.map((row) => (
            <li key={row.code} className="flex items-center gap-4 px-5 py-3">
              <span className="w-20 shrink-0 font-mono text-xs text-slate-500">{row.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-800">{row.label}</span>
                <span className="mt-1 block h-1 rounded-full bg-slate-100">
                  <span
                    className="block h-1 rounded-full bg-rose-400"
                    style={{ width: `${worst > 0 ? (row.failures / worst) * 100 : 0}%` }}
                  />
                </span>
              </span>
              <span className="w-20 shrink-0 text-right text-sm tabular-nums text-slate-900">
                {formatNumber(row.failures)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
