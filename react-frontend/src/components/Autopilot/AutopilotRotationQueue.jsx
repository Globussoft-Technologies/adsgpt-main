import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  RefreshCw,
  Loader2,
  PlayCircle,
  Layers,
  CheckCheck,
  Clock,
} from 'lucide-react';
import {
  getRotationQueue,
  triggerRotation,
  approveGeneratedDraft,
} from '@/apis/autopilot/autopilotApi';
import { getAdAccounts } from '@/apis/metaAds/metaAdsApi';
import { Dropdown, KpiCard } from '@/components/MetaAds/MetaAdsAtoms';
import {
  Section,
  SectionHeader,
  PrimaryButton,
  SecondaryButton,
  Banner,
} from './_atoms';

/**
 * Rotation Queue tab — Phase 4 + Phase 9 readout.
 *
 * Shows for the selected ad account:
 *   - Queue depth: total drafts, ready-for-rotation, auto-generated awaiting
 *     human review (Phase 10 once that ships).
 *   - List of drafts (creative id, name, ad-set pin, age, status).
 *   - "Run rotation (dry-run)" button → preview what would rotate.
 *   - One-click "Approve" on auto-generated drafts (Phase 10 review path).
 *
 * Does NOT trigger live writes. Live rotation requires both
 * AUTOPILOT_ROTATION_ENABLED and AUTOPILOT_LIVE_ACTIONS_ALLOWED to be 'true'
 * on the backend.
 */
const AutopilotRotationQueue = ({ selectedAdAccountId } = {}) => {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(
    selectedAdAccountId
      ? selectedAdAccountId.startsWith('act_')
        ? selectedAdAccountId
        : `act_${selectedAdAccountId}`
      : '',
  );
  const [accountOpen, setAccountOpen] = useState(false);

  // Sync with the page-level picker.
  useEffect(() => {
    if (!selectedAdAccountId) return;
    const next = selectedAdAccountId.startsWith('act_')
      ? selectedAdAccountId
      : `act_${selectedAdAccountId}`;
    if (next !== accountId) setAccountId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdAccountId]);

  const [queue, setQueue] = useState(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueError, setQueueError] = useState(null);

  const [rotateResult, setRotateResult] = useState(null);
  const [rotating, setRotating] = useState(false);

  const [approving, setApproving] = useState(null);

  // Hydrate the account list from the user's own /me/adaccounts.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getAdAccounts();
        if (!alive) return;
        const list = (r?.adAccounts || []).map((a) => ({
          adAccountId: `act_${a.id}`,
          rawId: a.id,
          name: a.name,
        }));
        setAccounts(list);
        if (!accountId && list.length > 0) {
          setAccountId(list[0].adAccountId);
        }
      } catch {
        // Non-fatal.
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadQueue = async () => {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const r = await getRotationQueue({
        adAccountId: accountId,
        includeUsed: false,
      });
      setQueue(r);
    } catch (e) {
      setQueueError(e?.response?.data?.error || e.message || 'Load failed');
      setQueue(null);
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const onDryRunRotate = async () => {
    setRotating(true);
    setRotateResult(null);
    try {
      const r = await triggerRotation({
        adAccountId: accountId,
        dryRun: true,
      });
      setRotateResult(r);
    } catch (e) {
      setRotateResult({
        status: false,
        error: e?.response?.data?.error || e.message,
      });
    } finally {
      setRotating(false);
    }
  };

  const onApprove = async (draftId) => {
    setApproving(draftId);
    try {
      await approveGeneratedDraft(draftId);
      await loadQueue();
    } catch (e) {
      console.error('approve failed', e);
    } finally {
      setApproving(null);
    }
  };

  const selectedAccount = accounts.find((a) => a.adAccountId === accountId);

  return (
    <div className="flex flex-col gap-4 px-5 py-4 2xl:px-6 2xl:py-5">
      {/* Controls — relative+z-20 lifts this above sibling Sections so
          dropdown menus that overflow downward render over the queue/drafts
          tables below. */}
      <Section className="relative z-20">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-10 font-medium uppercase tracking-wider text-white/40">
              Ad account
            </label>
            <Dropdown
              anchor="left"
              open={accountOpen}
              onClose={() => setAccountOpen(false)}
              trigger={
                <button
                  type="button"
                  onClick={() => setAccountOpen((p) => !p)}
                  disabled={loadingQueue || accounts.length === 0}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white transition-all hover:border-white/10 disabled:opacity-50"
                >
                  <span className="max-w-56 truncate font-medium">
                    {selectedAccount
                      ? selectedAccount.name
                      : accounts.length === 0
                        ? 'No ad accounts'
                        : 'Pick one'}
                  </span>
                  <ChevronDown className="h-3 w-3 text-[#BEBEBE]" />
                </button>
              }
            >
              <div className="w-72 p-1">
                <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
                  {accounts.map((a) => (
                    <button
                      key={a.adAccountId}
                      onClick={() => {
                        setAccountId(a.adAccountId);
                        setAccountOpen(false);
                      }}
                      className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-all hover:bg-white/5 ${
                        accountId === a.adAccountId ? 'bg-white/5' : ''
                      }`}
                    >
                      <span
                        className={`text-xs font-medium ${
                          accountId === a.adAccountId
                            ? 'text-[#15DCFF]'
                            : 'text-white'
                        }`}
                      >
                        {a.name}
                      </span>
                      <span className="text-10 font-mono text-white/50">
                        {a.adAccountId}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </Dropdown>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SecondaryButton onClick={loadQueue} disabled={loadingQueue}>
              {loadingQueue ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" /> Refresh
                </>
              )}
            </SecondaryButton>
            <PrimaryButton
              onClick={onDryRunRotate}
              disabled={rotating || loadingQueue || !accountId}
            >
              {rotating ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Running…
                </>
              ) : (
                <>
                  <PlayCircle className="h-3 w-3" /> Run rotation
                </>
              )}
            </PrimaryButton>
          </div>
        </div>
      </Section>

      {queueError && <Banner variant="error">{queueError}</Banner>}

      {/* Queue depth */}
      {queue && (
        <Section>
          <SectionHeader title="Queue depth" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard
              icon={Layers}
              label="Total drafts"
              value={queue.counts?.total ?? 0}
              glowColor="bg-[#15DCFF]"
            />
            <KpiCard
              icon={CheckCheck}
              label="Ready for rotation"
              value={queue.counts?.rotationReady ?? 0}
              glowColor="bg-emerald-400"
            />
            <KpiCard
              icon={Clock}
              label="Auto-gen, awaiting review"
              value={queue.counts?.autoGeneratedAwaitingReview ?? 0}
              glowColor="bg-amber-400"
            />
          </div>
        </Section>
      )}

      {/* Drafts table */}
      {queue && Array.isArray(queue.drafts) && (
        <Section>
          <SectionHeader title="Drafts" />
          {queue.drafts.length === 0 ? (
            <div className="rounded-xl border border-white/6 bg-white/2 p-6 text-center text-sm text-white/50">
              No drafts in this account's rotation queue. Save an ad creative
              as a rotation draft from the Ad Studio (UI coming) or rely on
              Phase 10 auto-generation once enabled.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/6">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/6 bg-white/2 text-left">
                    <Th>Name</Th>
                    <Th>Creative ID</Th>
                    <Th>Adset</Th>
                    <Th>Status</Th>
                    <Th>Created</Th>
                    <Th>{''}</Th>
                  </tr>
                </thead>
                <tbody>
                  {queue.drafts.map((d) => (
                    <tr
                      key={d._id}
                      className="border-b border-white/6 align-top last:border-b-0 hover:bg-white/2"
                    >
                      <td className="px-3 py-2.5 font-medium text-white">
                        {d.name}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-10 text-white/70">
                        {d.creativeId}
                      </td>
                      <td className="px-3 py-2.5 text-white/70">
                        {d.adsetId ? (
                          <span className="font-mono text-10">{d.adsetId}</span>
                        ) : (
                          <span className="italic text-white/40">any</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <DraftStatusPill draft={d} />
                      </td>
                      <td className="px-3 py-2.5 text-10 text-white/60">
                        {d.createdAt
                          ? new Date(d.createdAt).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {d.autoGenerated &&
                          !d.rotationReady &&
                          !d.usedByAutopilotAt && (
                            <PrimaryButton
                              onClick={() => onApprove(d._id)}
                              disabled={approving === d._id}
                            >
                              {approving === d._id ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Approving…
                                </>
                              ) : (
                                'Approve'
                              )}
                            </PrimaryButton>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* Rotation dry-run result */}
      {rotateResult && (
        <Section>
          <SectionHeader title="Rotation dry-run" />
          {rotateResult.error ? (
            <Banner variant="error">{rotateResult.error}</Banner>
          ) : (
            <RotationResultTable result={rotateResult} />
          )}
        </Section>
      )}
    </div>
  );
};

// ─── helpers ───────────────────────────────────────────────────────────────
const Th = ({ children }) => (
  <th className="px-3 py-2 text-10 font-bold uppercase tracking-wider text-white/40">
    {children}
  </th>
);

const DraftStatusPill = ({ draft }) => {
  if (draft.rotationReady) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-10 font-bold uppercase tracking-wide text-emerald-400">
        ready
      </span>
    );
  }
  if (draft.autoGenerated) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-10 font-bold uppercase tracking-wide text-amber-400">
        auto-gen · review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/6 bg-white/5 px-2 py-0.5 text-10 font-bold uppercase tracking-wide text-white/60">
      draft
    </span>
  );
};

const RotationResultTable = ({ result }) => {
  const actions = result.actions || [];
  return (
    <div>
      <div className="mb-2 text-10 text-white/50">
        runId{' '}
        <code className="font-mono text-white/70">{result.runId}</code> ·
        findings {result.findings_count} · evaluated {result.evaluated} ·{' '}
        {result.dryRun ? 'would-rotate' : 'rotated'}{' '}
        {result.dryRun ? result.would_rotate : result.rotated} · skipped{' '}
        {result.skipped} · failed {result.failed} · {result.durationMs}ms
      </div>
      {actions.length === 0 ? (
        <div className="rounded-xl border border-white/6 bg-white/2 p-4 text-center text-sm text-white/50">
          No fatigued ads detected this run.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/6 bg-white/2 text-left">
                <Th>Rule</Th>
                <Th>Fatigued ad</Th>
                <Th>Adset</Th>
                <Th>Outcome</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a, i) => (
                <tr
                  key={`${a.entityId}-${i}`}
                  className="border-b border-white/6 align-top last:border-b-0 hover:bg-white/2"
                >
                  <td className="px-3 py-2 font-mono text-white/80">
                    {a.ruleId}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">
                      {a.entityName || a.entityId}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-10 text-white/60">
                    {a.adsetId || '—'}
                  </td>
                  <td className="px-3 py-2 text-white/70">{a.outcome}</td>
                  <td className="px-3 py-2 text-white/60">
                    {a.skipReason || a.error || a.newAdId || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AutopilotRotationQueue;
