import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, AlertTriangle, Lightbulb } from 'lucide-react';
import { runGoogleAudit } from '@/apis/googleAds/googleAdsApi';
import { Spinner, EmptyState } from '@/components/MetaAds/MetaAdsAtoms';

const SEVERITY_CONFIG = {
  critical:    { icon: ShieldAlert,   color: 'text-red-400',   barColor: 'rgb(248,113,113)', label: 'Critical'     },
  warning:     { icon: AlertTriangle, color: 'text-amber-400', barColor: 'rgb(251,191,36)',  label: 'Warning'      },
  opportunity: { icon: Lightbulb,     color: 'text-[#4285F4]', barColor: 'rgb(66,133,244)',  label: 'Opportunity'  },
};

export default function GoogleAdsAuditTab({ adAccountId }) {
  const [auditData, setAuditData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!adAccountId) return;
    setLoading(true);
    setAuditData(null);
    try {
      const res = await runGoogleAudit({ adAccountId });
      setAuditData(res);
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;
  if (!auditData) return <EmptyState message="No audit data available for this account" />;

  const { summary = {}, findings = [] } = auditData;
  const filtered = filter === 'all' ? findings : findings.filter((f) => f.severity === filter);

  const grouped = filtered.reduce((acc, f) => {
    const key = f.entity_id ?? f.campaignId ?? f.id ?? String(Math.random());
    if (!acc[key]) acc[key] = { entity_name: f.entity_name ?? f.campaignName ?? '', entity_type: f.entity_type ?? 'campaign', items: [] };
    acc[key].items.push(f);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-5">
      {/* filter pills */}
      <div className="flex items-center gap-2">
        {['all', 'critical', 'warning', 'opportunity'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-all ${
              filter === f
                ? 'border-gray-300 bg-gray-200 text-gray-900 dark:border-white/20 dark:bg-white/10 dark:text-white'
                : 'border-gray-200 bg-transparent text-gray-500 hover:text-gray-600 dark:border-white/6 dark:text-[#BEBEBE] dark:hover:text-[#BEBEBE]'
            }`}
          >
            {f === 'all' ? `All (${findings.length})` : `${f} (${summary[f] ?? 0})`}
          </button>
        ))}
      </div>

      {/* findings grid */}
      {Object.keys(grouped).length === 0 ? (
        <EmptyState message="No findings for the selected filter" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.values(grouped).flatMap((group, gi) =>
            group.items.map((finding, fi) => {
              const cfg = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.opportunity;
              const FindingIcon = cfg.icon;
              return (
                <motion.div
                  key={`${gi}-${fi}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (gi * 4 + fi) * 0.02 }}
                  className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 pl-5 transition-all hover:border-gray-300 dark:border-white/8 dark:bg-[#161616] dark:hover:border-white/15"
                >
                  <div className="absolute top-0 left-0 bottom-0 w-0.5 rounded-l-2xl" style={{ background: `linear-gradient(to bottom, transparent 0%, ${cfg.barColor} 40%, ${cfg.barColor} 60%, transparent 100%)` }} />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FindingIcon className={`h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                      <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    {finding.rule_id && (
                      <span className="rounded border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-400 dark:border-white/8 dark:bg-white/4 dark:text-white/40">
                        {finding.rule_id}
                      </span>
                    )}
                  </div>
                  <p className="flex-1 text-sm leading-relaxed text-gray-600 dark:text-white/80">{finding.message}</p>
                  {group.entity_name && (
                    <div className="flex items-center gap-1.5 border-t border-gray-200 pt-3 dark:border-white/8">
                      <span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wide text-gray-400 dark:border-white/8 dark:bg-white/4 dark:text-white/40">
                        {group.entity_type}
                      </span>
                      <span className="truncate text-xs text-gray-400 dark:text-white/40">{group.entity_name}</span>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
