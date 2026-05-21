import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, Loader2, ChevronDown, Radio, Coins, Clock } from 'lucide-react';
import {
  runLLMAudit,
  getAIFindings,
  applyAuditFix,
  dismissAuditFinding,
  undoAuditFix,
} from '@/apis/autopilot/llmAuditApi';
import { globalToast } from '@/utils/globalToast';
import { Dropdown, StatusBadge } from '@/components/MetaAds/MetaAdsAtoms';
import ApplyFixModal from './ApplyFixModal';
import AuditsList from './AuditsList';
import AuditFindings from './AuditFindings';

const LOADING_STAGES = [
  'Fetching campaigns and insights…',
  'Crunching 14 days of performance data…',
  'Asking the AI to spot issues and opportunities…',
  'Validating suggested fixes…',
  'Almost ready…',
];

function LoadingState({ label = 'Running AI Audit' }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1)),
      3500,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 animate-ping rounded-full bg-[#15DCFF]/20" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#15DCFF]/30 bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
          <Sparkles className="h-6 w-6 text-[#15DCFF]" />
        </div>
      </div>
      <div>
        <p className="text-sm font-bold text-white">{label}</p>
        <p className="mt-1 max-w-sm text-xs text-white/50">{LOADING_STAGES[stage]}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {LOADING_STAGES.map((_, i) => (
          <span
            key={i}
            className={`h-1 w-6 rounded-full transition-colors ${
              i <= stage ? 'bg-[#15DCFF]' : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function FetchingSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Loader2 className="h-5 w-5 animate-spin text-white/40" />
    </div>
  );
}

// ─── main router ─────────────────────────────────────────────────────────────

export default function AutopilotLLMAudit({ adAccounts = [] }) {
  // The AI Audit tab is the only place that needs a per-account scope, so
  // its picker lives here (was previously page-level — confusingly implied
  // a global filter that didn't exist for the other tabs).
  const [adAccountId, setAdAccountId] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);

  // Default the selection to the first account on mount / when the list
  // hydrates. Preserve a still-valid prior pick if the list refreshes.
  useEffect(() => {
    if (!adAccounts.length) return;
    setAdAccountId((prev) =>
      prev && adAccounts.find((a) => a.id === prev) ? prev : adAccounts[0].id,
    );
  }, [adAccounts]);

  const selectedAccount = adAccounts.find((a) => a.id === adAccountId) || null;
  const currency = selectedAccount?.currency || 'INR';

  // view: 'list' | 'findings'
  const [view, setView] = useState('list');
  const [listRefreshKey, setListRefreshKey] = useState(0);

  // Full audit object when detail is open: { auditId, findings, expiresAt, summary, rejected? }
  const [selectedAudit, setSelectedAudit] = useState(null);

  // Loading states
  const [running, setRunning] = useState(false); // POST /llm-audit
  const [fetchingDetail, setFetchingDetail] = useState(false); // GET /audit/findings/:id

  // Per-finding busy state for apply/dismiss/undo
  const [busyFindingId, setBusyFindingId] = useState(null);

  // Modals
  const [activeFinding, setActiveFinding] = useState(null);

  // When the ad account changes, reset to list view
  useEffect(() => {
    setView('list');
    setSelectedAudit(null);
    setListRefreshKey((k) => k + 1);
  }, [adAccountId]);

  // ─── handlers ──────────────────────────────────────────────────────────────

  const handleRunNew = useCallback(async () => {
    if (!adAccountId) return;
    setRunning(true);
    try {
      const res = await runLLMAudit(adAccountId);
      setSelectedAudit(res);
      setView('findings');
      setListRefreshKey((k) => k + 1);
      globalToast.success(`Found ${res.findings?.length || 0} findings`);
    } catch (err) {
      globalToast.error(err?.response?.data?.details || 'Failed to run audit');
    } finally {
      setRunning(false);
    }
  }, [adAccountId]);

  const handleSelectAudit = useCallback(async (summary) => {
    setFetchingDetail(true);
    try {
      const res = await getAIFindings(summary.auditId);
      setSelectedAudit({
        auditId: summary.auditId,
        findings: res.findings || [],
        summary: summary.summary,
        expiresAt: summary.expiresAt,
      });
      setView('findings');
    } catch (err) {
      globalToast.error(err?.response?.data?.error || 'Failed to load audit');
    } finally {
      setFetchingDetail(false);
    }
  }, []);

  const handleBack = useCallback(() => {
    setSelectedAudit(null);
    setView('list');
    setListRefreshKey((k) => k + 1);
  }, []);

  const updateFindingLocally = (updated) => {
    setSelectedAudit((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.map((f) =>
              f._id === updated._id ? updated : f,
            ),
          }
        : prev,
    );
  };

  const refreshFindings = useCallback(async () => {
    if (!selectedAudit?.auditId) return;
    try {
      const res = await getAIFindings(selectedAudit.auditId);
      setSelectedAudit((prev) =>
        prev ? { ...prev, findings: res.findings || prev.findings } : prev,
      );
    } catch {
      /* noop */
    }
  }, [selectedAudit?.auditId]);

  const handleConfirmFix = async ({ acknowledgeRisk, paramOverrides }) => {
    if (!activeFinding) return;
    const findingId = activeFinding._id;
    setBusyFindingId(findingId);
    try {
      const res = await applyAuditFix(findingId, { acknowledgeRisk, paramOverrides });
      updateFindingLocally(res.finding);
      setActiveFinding(null);
      globalToast.success(res.message || 'Fix applied');
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error || err?.response?.data?.details || 'Failed to apply fix';
      if (status === 410) refreshFindings();
      globalToast.error(msg);
    } finally {
      setBusyFindingId(null);
    }
  };

  const handleDismiss = async (finding) => {
    setBusyFindingId(finding._id);
    try {
      const res = await dismissAuditFinding(finding._id);
      updateFindingLocally(res.finding);
      globalToast.success('Finding dismissed');
    } catch {
      globalToast.error('Failed to dismiss');
    } finally {
      setBusyFindingId(null);
    }
  };

  const handleUndo = async (finding) => {
    setBusyFindingId(finding._id);
    try {
      const res = await undoAuditFix(finding._id);
      updateFindingLocally(res.finding);
      globalToast.success('Fix reverted');
    } catch (err) {
      const msg = err?.response?.data?.error || 'Failed to undo';
      globalToast.error(msg);
    } finally {
      setBusyFindingId(null);
    }
  };

  // ─── render ────────────────────────────────────────────────────────────────

  // Picker — rendered above whatever view is active. Click-to-open dropdown
  // matching the rest of the autopilot/Meta-Ads visual language.
  const picker = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#14181D] px-4 py-2.5 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="text-10 font-medium uppercase tracking-wider text-white/40">
          Account
        </span>
        <Dropdown
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          anchor="left"
          trigger={
            <button
              type="button"
              onClick={() => setAccountOpen((p) => !p)}
              disabled={adAccounts.length === 0}
              className="flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2 text-xs text-white transition-all hover:border-white/10 disabled:opacity-50"
            >
              <Radio className="h-3 w-3 text-emerald-400" />
              <span className="max-w-45 truncate font-medium">
                {selectedAccount?.name ?? 'Pick an account'}
              </span>
              <ChevronDown className="h-3 w-3 text-[#BEBEBE]" />
            </button>
          }
        >
          <div className="w-72 p-1">
            <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
              {adAccounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => {
                    setAdAccountId(acc.id);
                    setAccountOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white/5 ${
                    adAccountId === acc.id ? 'bg-white/5' : ''
                  }`}
                >
                  <div>
                    <p
                      className={`text-xs font-medium ${
                        adAccountId === acc.id ? 'text-[#15DCFF]' : 'text-white'
                      }`}
                    >
                      {acc.name}
                    </p>
                    <p className="text-10 text-white/50">act_{acc.id}</p>
                  </div>
                  <StatusBadge status={acc.status === 1 ? 'ACTIVE' : 'PAUSED'} />
                </button>
              ))}
            </div>
          </div>
        </Dropdown>
      </div>
      {selectedAccount && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-2.5 py-1.5 2xl:px-3 2xl:py-2">
            <Coins className="h-3 w-3 text-[#15DCFF] 2xl:h-3.5 2xl:w-3.5" />
            <span className="text-10 font-medium uppercase tracking-wider text-white/55 2xl:text-[11px]">
              Currency
            </span>
            <span className="text-xs font-bold text-white 2xl:text-13">
              {selectedAccount.currency}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-2.5 py-1.5 2xl:px-3 2xl:py-2">
            <Clock className="h-3 w-3 text-[#15DCFF] 2xl:h-3.5 2xl:w-3.5" />
            <span className="text-10 font-medium uppercase tracking-wider text-white/55 2xl:text-[11px]">
              Timezone
            </span>
            <span className="text-xs font-bold text-white 2xl:text-13">
              {selectedAccount.timezone || '—'}
            </span>
          </span>
        </div>
      )}
    </div>
  );

  // No account selected (yet) — picker visible, nothing else to render.
  if (!adAccountId) {
    return (
      <>
        {picker}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-linear-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
            <Sparkles className="h-6 w-6 text-[#15DCFF]" />
          </div>
          <p className="text-sm text-white/60">
            Pick an account above to start an AI audit.
          </p>
        </div>
      </>
    );
  }

  if (running) return <LoadingState label="Running AI Audit" />;
  if (fetchingDetail) return <FetchingSpinner />;

  return (
    <>
      {picker}

      {view === 'list' && (
        <AuditsList
          key={`list-${adAccountId}-${listRefreshKey}`}
          adAccountId={adAccountId}
          running={running}
          onRunNew={handleRunNew}
          onSelect={handleSelectAudit}
        />
      )}

      {view === 'findings' && selectedAudit && (
        <AuditFindings
          audit={selectedAudit}
          busyFindingId={busyFindingId}
          onBack={handleBack}
          onOpenFix={setActiveFinding}
          onDismiss={handleDismiss}
          onUndo={handleUndo}
        />
      )}

      <ApplyFixModal
        finding={activeFinding}
        currency={currency}
        onClose={() => setActiveFinding(null)}
        onConfirm={handleConfirmFix}
      />
    </>
  );
}
