import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  ChevronRight,
  ShieldAlert,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Loader2,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { listAIAudits } from '@/apis/autopilot/llmAuditApi';

// relative time helper
const rel = (iso) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

function EmptyList({ onRun, running }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-5 sm:py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#15DCFF]/20 bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
        <Sparkles className="h-7 w-7 text-[#15DCFF]" />
      </div>
      <div className="max-w-md">
        <h2 className="text-lg font-bold text-white">No audits yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/50">
          Run your first AI audit on this account. Our model analyzes the last 14 days of activity
          and suggests specific, executable fixes.
        </p>
      </div>
      <div className="grid w-full grid-cols-1 gap-3 sm:w-auto sm:grid-cols-3">
        {[
          {
            icon: ShieldAlert,
            iconFg: 'text-red-400',
            iconBg: 'bg-red-500/10',
            iconRing: 'border-red-500/25',
            title: 'Detect waste',
            desc: 'Flags campaigns burning budget with no return.',
          },
          {
            icon: AlertTriangle,
            iconFg: 'text-amber-400',
            iconBg: 'bg-amber-500/10',
            iconRing: 'border-amber-500/25',
            title: 'Catch regressions',
            desc: 'Rising CPM, dropping ROAS, audience fatigue.',
          },
          {
            icon: Lightbulb,
            iconFg: 'text-[#15DCFF]',
            iconBg: 'bg-[#15DCFF]/10',
            iconRing: 'border-[#15DCFF]/25',
            title: 'Find opportunities',
            desc: 'Scale candidates and underfunded top performers.',
          },
        ].map(({ icon: Icon, iconFg, iconBg, iconRing, title, desc }) => (
          <div
            key={title}
            className="flex flex-col rounded-2xl border border-white/12 bg-white/4 p-4 text-left transition-all hover:border-white/20 hover:bg-white/6 2xl:p-5"
          >
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl border ${iconRing} ${iconBg} 2xl:h-10 2xl:w-10`}
            >
              <Icon className={`h-4 w-4 2xl:h-4.5 2xl:w-4.5 ${iconFg}`} />
            </div>
            <p className="mt-2.5 text-sm font-bold text-white 2xl:text-15">{title}</p>
            <p className="mt-0.75 text-xs text-white/70 2xl:text-13">{desc}</p>
          </div>
        ))}
      </div>
      <button
        onClick={onRun}
        disabled={running}
        className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 py-3 text-sm font-bold text-black shadow-lg shadow-[#15DCFF]/10 transition-all hover:brightness-110 disabled:opacity-50"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {running ? 'Running…' : 'Run AI Audit'}
      </button>
      <p className="text-xs text-white/70 sm:text-white/70">Takes 5–20 seconds · uses live Meta data</p>
    </div>
  );
}

function AuditRow({ audit, onSelect }) {
  const { summary = {}, statusBreakdown = {}, total = 0 } = audit;
  const appliedFrac = total ? Math.round(((statusBreakdown.applied || 0) / total) * 100) : 0;

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onSelect(audit)}
      className="group flex w-full items-center gap-4 rounded-2xl border border-white/12 bg-[#14181D] p-4 text-left transition-all hover:border-white/15 hover:bg-white/[0.02]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
        <Sparkles className="h-5 w-5 text-[#15DCFF]" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-white">
            Audit · {rel(audit.createdAt)}
          </span>
          <span className="font-mono text-[10px] text-white/40">
            {audit.auditId?.slice(0, 8)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/50">
          <span className="flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 text-red-400" />
            <span className="font-semibold text-white">{summary.critical || 0}</span> critical
          </span>
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            <span className="font-semibold text-white">{summary.warning || 0}</span> warnings
          </span>
          <span className="flex items-center gap-1">
            <Lightbulb className="h-3 w-3 text-[#15DCFF]" />
            <span className="font-semibold text-white">{summary.opportunity || 0}</span> opportunities
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            <span className="font-semibold text-white">
              {statusBreakdown.applied || 0}/{total}
            </span>{' '}
            applied ({appliedFrac}%)
          </span>
        </div>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-white/30 transition-all group-hover:text-white/60" />
    </motion.button>
  );
}

export default function AuditsList({ adAccountId, onSelect, onRunNew, running }) {
  const [loading, setLoading] = useState(false);
  const [audits, setAudits] = useState([]);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    if (!adAccountId) return;
    setLoading(true);
    try {
      const res = await listAIAudits(adAccountId);
      setAudits(res.audits || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // expose refresh via a prop imperative handle? Simpler: parent re-mounts or calls via key change.
  // We'll just refresh on mount — parent bumps a key via `refreshKey` prop when a new audit is run.

  if (loading && audits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-white/40" />
      </div>
    );
  }

  if (audits.length === 0) {
    return <EmptyList onRun={onRunNew} running={running} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#15DCFF]/20 bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
            <Sparkles className="h-5 w-5 text-[#15DCFF]" />
          </div>
          <div>
            <p className="text-base font-bold text-white 2xl:text-lg">AI Audits</p>
            <p className="text-[11px] text-white/40">
              {audits.length} audit{audits.length === 1 ? '' : 's'} for this account
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshToken((t) => t + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-xs font-medium text-white/70 transition-all hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={onRunNew}
            disabled={running}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-3 py-2 text-xs font-bold text-black transition-all hover:brightness-110 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Run new audit
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {audits.map((a) => (
          <AuditRow key={a.auditId} audit={a} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
