import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import SourceInput from '@/components/AdFactory/v2/SourceInput';
import InferringWithBudget from '@/components/AdFactory/v2/InferringWithBudget';
import BriefSummary from '@/components/AdFactory/v2/BriefSummary';
import AdjustPanel from '@/components/AdFactory/v2/AdjustPanel';
import CreativePreview from '@/components/AdFactory/v2/CreativePreview';
import BriefFailed from '@/components/AdFactory/v2/BriefFailed';
import BriefList from '@/components/AdFactory/v2/BriefList';
import PreviousRuns from '@/components/AdFactory/v2/PreviousRuns';
import RunTimeline from '@/components/AdFactory/v2/RunTimeline';
import KeepTheseComing from '@/components/AdFactory/v2/KeepTheseComing';
import LaunchConnection, {
  emptyConnection,
  isConnectionComplete,
} from '@/components/AdFactory/v2/LaunchConnection';
import { Notice, PrimaryBtn } from '@/components/AdFactory/v2/Panel';
import AdFactoryBgEffect from '@/components/AdFactory/NodeForms/AdFactoryBgEffect';
import { useMotionPresets } from '@/components/AdFactory/v2/_motion';

import {
  startBriefFromUrl,
  startBriefFromBrand,
  fetchBrief,
  saveBriefEdits,
  generateAds,
  activateAutomation,
  setAutomationPaused,
  fetchBriefs,
  removeBrief,
  fetchTimeline,
  BRIEF_STATUS,
  STEP,
  applyLocalEdit,
  briefReady,
  clearBriefError,
  clearNeedsRefetch,
  resetBrief,
  setPendingBudget,
  selectBrief,
  selectBriefId,
  selectBriefError,
  selectBriefErrorCode,
  selectInferStartedAt,
  selectIsGenerating,
  selectIsInferring,
  selectNeedsRefetch,
  selectPendingBudget,
  selectRun,
  selectEstimate,
  selectHistory,
  selectStep,
  selectTimeline,
  selectIsPausing,
  selectBriefs,
  selectBriefsLoading,
} from '@/store/reducers/adFactoryBrief/adFactoryBriefSlice';
import { getSocket } from '@/store/reducers/socket/socketSlice';

// ----------------------------------------------------------------------------
// Quick setup, on one page.
//
// The five stages the user meets, in order:
//
//   1  SourceInput          a URL, or a saved brand
//   2  InferringWithBudget  the ~35s read, spent collecting input 2 of 2
//   3  BriefSummary + CreativePreview   the ads, with the brief as ONE LINE
//   4  KeepTheseComing      the subscription
//   5  RunTimeline          deliveries — the home of a live brief
//
// Which one renders is DERIVED from the brief's status (`selectStep`), never
// tracked separately. Two sources of truth for "where am I" is how a wizard
// ends up on the preview screen for a brief that failed.
//
// Stage 3 is the correction over the previous attempt. That version put a
// twenty-field grid between the read and the ads; here the brief is a summary
// line, the ads are the page, and the fields live behind `Adjust`.
//
// Completion arrives on `adFactoryBriefReady` — a socket emit from our own
// backend at the end of inference, because autofill emits nothing but we know
// when we finished. The slow poll is the safety net for a client that
// reconnected mid-read, not the mechanism.
// ----------------------------------------------------------------------------

const BRIEF_READY_EVENT = 'adFactoryBriefReady';
const INFER_POLL_MS = 3000;
// Generation runs for minutes, not seconds — polling it as eagerly as inference
// would be dozens of pointless round trips per run.
const GENERATION_POLL_MS = 15000;

export default function AdFactoryV2Page() {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const M = useMotionPresets();

  // Local to the page: which Meta account these publish through, whether the
  // user has flipped "keep these coming", and whether the drawer is open.
  // None of it belongs on the brief — the brief describes WHAT to advertise,
  // not the plumbing or the UI's current state.
  const [connection, setConnection] = useState(emptyConnection);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  // Adjust starts OPEN. Before any ads exist the page is otherwise a summary
  // line and a budget box on a lot of empty space, so the fields may as well be
  // there to check — which is the whole point of showing what we inferred.
  //
  // It is still not the toll gate the previous attempt made it: nothing blocks
  // on it, and it gets out of the way the moment ads become the page (below).
  const [adjustOpen, setAdjustOpen] = useState(true);
  // Whether the default has been resolved for the brief now loaded. Without
  // this the effect below would re-open the panel every time the brief object
  // changes identity, fighting the user each time they closed it.
  const adjustDefaulted = useRef(false);

  const brief = useSelector(selectBrief);
  const briefId = useSelector(selectBriefId);
  const step = useSelector(selectStep);
  const run = useSelector(selectRun);
  const estimate = useSelector(selectEstimate);
  const history = useSelector(selectHistory);
  const error = useSelector(selectBriefError);
  const errorCode = useSelector(selectBriefErrorCode);
  const inferring = useSelector(selectIsInferring);
  const inferStartedAt = useSelector(selectInferStartedAt);
  const pendingBudget = useSelector(selectPendingBudget);
  const generating = useSelector(selectIsGenerating);
  const needsRefetch = useSelector(selectNeedsRefetch);
  const timeline = useSelector(selectTimeline);
  const pausing = useSelector(selectIsPausing);
  const briefs = useSelector(selectBriefs);
  const briefsLoading = useSelector(selectBriefsLoading);
  const { loading, saving, activating } = useSelector((s) => s.adFactoryBrief);

  const urlBriefId = searchParams.get('briefId');

  // Declared HERE, with the state it derives from, because effects below read
  // it in their dependency arrays. It used to sit just above the render, which
  // put it in the temporal dead zone for those effects: the deps array is
  // evaluated during render, so the first paint threw
  // "Cannot access 'hasCreatives' before initialization" and took the whole
  // route down.
  //
  // Neither `vite build` nor eslint caught it — the reference is valid, just
  // too early — which is why it only surfaced when the page was opened.
  const hasCreatives = (run?.pairs?.length || 0) > 0;

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (urlBriefId) dispatch(fetchBrief(urlBriefId));
    return () => {
      dispatch(resetBrief());
    };
    // Once per id — re-running on every render would refetch forever.
  }, [dispatch, urlBriefId]);

  // History is loaded on the front door only — it is the one screen that shows
  // it, and refetching behind the working screens would be pure noise.
  useEffect(() => {
    if (!urlBriefId) dispatch(fetchBriefs());
  }, [dispatch, urlBriefId]);

  // ── Completion signal ─────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onReady = (payload) => dispatch(briefReady(payload));
    socket.on(BRIEF_READY_EVENT, onReady);
    return () => {
      socket.off(BRIEF_READY_EVENT, onReady);
    };
  }, [dispatch]);

  // Safety net only. Deliberately slow; the socket is the real mechanism.
  useEffect(() => {
    if (!inferring || !briefId) return undefined;
    const id = setInterval(() => dispatch(fetchBrief(briefId)), INFER_POLL_MS);
    return () => clearInterval(id);
  }, [dispatch, inferring, briefId]);

  // Generation has no completion event of its own — Python writes results to
  // the campaign and the webhook that receives them is v1's, which knows
  // nothing about briefs. Polling is honest here rather than a fallback.
  useEffect(() => {
    if (run?.status !== 'running' || !briefId) return undefined;
    const id = setInterval(() => dispatch(fetchBrief(briefId)), GENERATION_POLL_MS);
    return () => clearInterval(id);
  }, [dispatch, run?.status, briefId]);

  // The socket event carries only a status, so pull the full document once it
  // lands (or once a reused brief turns out to be already finished).
  useEffect(() => {
    if (needsRefetch && briefId) {
      dispatch(fetchBrief(briefId));
      dispatch(clearNeedsRefetch());
    }
  }, [dispatch, needsRefetch, briefId]);

  // Deliveries, once there is an automation.
  useEffect(() => {
    if (briefId && brief?.jobId) dispatch(fetchTimeline(briefId));
  }, [dispatch, briefId, brief?.jobId, activating]);

  // Keep the URL in step so a refresh resumes rather than restarting.
  useEffect(() => {
    if (briefId && searchParams.get('briefId') !== briefId) {
      const next = new URLSearchParams(searchParams);
      next.set('briefId', briefId);
      setSearchParams(next, { replace: true });
    }
  }, [briefId, searchParams, setSearchParams]);

  // A brief that already has ads, or is live, opens collapsed — there the ads
  // and the delivery history are the page, and twenty fields above them is
  // noise. Resolved once per brief, not on every render.
  useEffect(() => {
    if (!brief || adjustDefaulted.current) return;
    adjustDefaulted.current = true;
    if (hasCreatives || step === STEP.DELIVERIES) setAdjustOpen(false);
  }, [brief, hasCreatives, step]);

  // ── Budget ────────────────────────────────────────────────────────────────
  // Collected on the wait screen before a brief exists, then persisted onto
  // the brief once there is one.
  const budget = useMemo(
    () => brief?.delivery?.budget?.daily ?? pendingBudget ?? '',
    [brief, pendingBudget],
  );

  // Read the SAVED budget as a primitive, not off the whole brief. `brief` gets
  // a new identity on every response, so a callback that closes over the object
  // is re-created constantly — and an effect that depends on that callback then
  // re-runs constantly. See the loop note on the effect below.
  const savedBudget = brief?.delivery?.budget?.daily;

  const persistBudget = useCallback(() => {
    const n = Number(pendingBudget);
    if (!briefId || !Number.isFinite(n) || n <= 0) return;
    if (savedBudget === n) return;
    // Write it locally FIRST. The save response deliberately doesn't merge
    // server state back (it would clobber an edit still in flight), so without
    // this the guard above compares against a value that never changes and the
    // effect below dispatches forever.
    dispatch(
      applyLocalEdit({ section: 'delivery', field: 'budget', value: { daily: n, currency: 'INR' } }),
    );
    dispatch(
      saveBriefEdits({
        briefId,
        patch: { delivery: { budget: { daily: n, currency: 'INR' } } },
      }),
    );
  }, [dispatch, briefId, pendingBudget, savedBudget]);

  // Once inference finishes, write the budget typed during the wait.
  //
  // This effect dispatches, so its dependencies decide whether it terminates.
  // It previously depended on a callback that closed over the whole `brief`:
  // every save produced a new brief object, which produced a new callback,
  // which re-ran the effect — several hundred PATCHes a minute, each one also
  // re-materialising the campaign server-side. Both halves are fixed: the
  // callback now closes over a primitive, and the guard inside it compares
  // against a value that actually updates.
  useEffect(() => {
    if (!inferring && briefId && pendingBudget) persistBudget();
  }, [inferring, briefId, pendingBudget, persistBudget]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleUrl = useCallback(
    (url) => {
      dispatch(clearBriefError());
      dispatch(startBriefFromUrl({ url }));
    },
    [dispatch],
  );

  const handleBrand = useCallback(
    (brandId) => {
      dispatch(clearBriefError());
      dispatch(startBriefFromBrand(brandId));
    },
    [dispatch],
  );

  const handleEdit = useCallback(
    (section, field, value) => {
      dispatch(applyLocalEdit({ section, field, value }));
      if (briefId) {
        dispatch(saveBriefEdits({ briefId, patch: { [section]: { [field]: value } } }));
      }
    },
    [dispatch, briefId],
  );

  const handleGenerate = useCallback(() => {
    if (!briefId) return;
    // Write the budget first: it is the one field the user can still be typing
    // when they press Generate, and the payload is built server-side from the
    // stored brief.
    persistBudget();
    // The ads are about to become the page, so the fields step aside. A clear
    // cause the user just triggered, rather than the panel closing on its own.
    setAdjustOpen(false);
    dispatch(generateAds(briefId));
  }, [dispatch, briefId, persistBudget]);

  // Same URL, fresh read. `failed` means our reader was down, not that the
  // page is unreadable, so the same input is worth trying again.
  const handleRetry = useCallback(() => {
    const url = brief?.source?.url;
    if (!url) return;
    dispatch(clearBriefError());
    dispatch(startBriefFromUrl({ url, forceRefresh: true }));
  }, [dispatch, brief?.source?.url]);

  // Back to the front door. The briefId has to leave the URL too, or the
  // bootstrap effect immediately reloads the brief we just walked away from.
  const handleStartOver = useCallback(() => {
    dispatch(clearBriefError());
    dispatch(resetBrief());
    const next = new URLSearchParams(searchParams);
    next.delete('briefId');
    setSearchParams(next, { replace: true });
  }, [dispatch, searchParams, setSearchParams]);

  const handleActivate = useCallback(() => {
    if (!briefId || !isConnectionComplete(connection)) return;
    dispatch(
      activateAutomation({
        briefId,
        connection: {
          facebookId: connection.facebookId,
          connectionId: connection.connectionId,
          adAccountId: connection.adAccountId,
          pageId: connection.pageId,
        },
      }),
    );
  }, [dispatch, briefId, connection]);

  // Meta's enums are SHOUTY_SNAKE; render them as a human would read them.
  const ctaLabel = useMemo(() => {
    const button = brief?.offer?.cta?.button;
    if (!button) return 'Learn more';
    return String(button)
      .toLowerCase()
      .split('_')
      .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  }, [brief]);

  // "OUTCOME_SALES" + "WEBSITE" -> "Sales · website". Both the summary chip and
  // the campaign row read it, so it is derived once.
  const objectiveLabel = useMemo(() => {
    const o = brief?.offer?.primaryObjective;
    if (!o) return '';
    const name = String(o)
      .replace(/^OUTCOME_/, '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
    const loc = brief?.offer?.conversionLocation;
    return loc ? `${name} · ${String(loc).toLowerCase().replace(/_/g, ' ')}` : name;
  }, [brief]);

  const handleOpenBrief = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      next.set('briefId', id);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  // Deleting takes the campaign with it, so it is worth one question. The
  // server refuses outright if an automation is still delivering.
  const handleDeleteBrief = useCallback(
    (id, label) => {
      if (!window.confirm(`Delete “${label}”? This removes the brief and its ads setup.`)) return;
      dispatch(removeBrief(id));
    },
    [dispatch],
  );

  // "first run Tue 9:00 AM" — the next occurrence of the chosen hour. Derived
  // rather than fetched: the job doesn't exist yet, so there is no nextRunAt to
  // read, and the user is about to commit to this exact time.
  const nextRunLabel = useMemo(() => {
    const hour = brief?.delivery?.frequency?.hour ?? 9;
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [brief?.delivery?.frequency?.hour]);

  // The card lives below the fold on most screens, so summoning it without
  // moving to it just looks like the button did nothing.
  const scheduleRef = useRef(null);
  const handleWantSchedule = useCallback(() => {
    setScheduleOn(true);
    requestAnimationFrame(() => {
      scheduleRef.current?.scrollIntoView({
        behavior: M.reduce ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }, [M.reduce]);

  const handlePause = useCallback(
    (paused) => {
      if (!brief?.jobId) return;
      dispatch(setAutomationPaused({ jobId: brief.jobId, paused }));
    },
    [dispatch, brief?.jobId],
  );

  const host = useMemo(() => {
    const url = brief?.source?.url || '';
    try {
      return url ? new URL(url).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  }, [brief]);

  const canGenerate = Number(budget) > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  // No header here: the page title comes from TopHeader and the mode switch is
  // owned by AdFactoryPage, so both modes share exactly one of each.
  return (
    <div className="relative flex h-full w-full flex-col gap-5 overflow-y-auto pt-2 pb-10">
      {/* The same background Full control uses — one Ad Factory, one backdrop.
          Mounted per-surface, which is the pattern every v1 screen already
          follows (NoCompaignScreen, StartForm, NodeModal all mount their own).
          It is `fixed`, so it stays put while this column scrolls. */}
      <AdFactoryBgEffect />

      {error && (
        <div className="mx-auto w-full max-w-375 px-4 2xl:px-8">
          <Notice tone="warn" icon={AlertCircle}>
            <span className="flex flex-col items-start gap-1">
              <span>{error}</span>
              {errorCode === 'NO_BASE_PLAN' ? (
                // The trial user's first real moment. An upgrade path, not a
                // dead end.
                <a
                  href="/pricing"
                  className="font-semibold text-[#6b72f8] underline underline-offset-2 dark:text-[#aeb6ff]"
                >
                  See plans
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => dispatch(clearBriefError())}
                  className="underline opacity-80 hover:opacity-100"
                >
                  Dismiss
                </button>
              )}
            </span>
          </Notice>
        </div>
      )}

      {/* The way out. Once a brief is open the URL carries ?briefId and there
          was no route back to the front door except editing the address bar —
          the browser's own Back works only if you arrived by navigation, not on
          a reload or a shared link. */}
      {brief && step !== STEP.SOURCE && (
        <div className="mx-auto w-full max-w-375 px-4 2xl:px-8">
          <button
            type="button"
            onClick={handleStartOver}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 transition hover:text-gray-900 dark:text-white/55 dark:hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All briefs
          </button>
        </div>
      )}

      {loading && !brief && !inferring && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400 dark:text-white/45" />
        </div>
      )}

      {/* ── 1 ── */}
      {step === STEP.SOURCE && (
        <>
          <SourceInput onSubmitUrl={handleUrl} onPickBrand={handleBrand} busy={loading} />
          <BriefList
            briefs={briefs}
            loading={briefsLoading}
            onOpen={handleOpenBrief}
            onDelete={handleDeleteBrief}
          />
        </>
      )}

      {/* ── 2 ── */}
      {step === STEP.INFERRING && (
        <InferringWithBudget
          host={host}
          startedAt={inferStartedAt}
          budget={budget}
          onBudgetChange={(v) => dispatch(setPendingBudget(v))}
          onStartOver={handleStartOver}
        />
      )}

      {step === STEP.FAILED && brief && (
        <BriefFailed
          status={brief.status}
          reason={brief.failureReason}
          url={brief.source?.url}
          retrying={loading}
          onRetry={handleRetry}
          onStartOver={handleStartOver}
        />
      )}

      {/* ── 3, 4 ── */}
      {step === STEP.BRIEF && brief && (
        <div className="mx-auto flex w-full max-w-375 flex-col gap-4 px-4 2xl:px-8">
          {brief.status === BRIEF_STATUS.NEEDS_INPUT && (
            <Notice tone="warn" icon={AlertCircle}>
              <span className="flex flex-col items-start gap-1">
                <span>
                  {brief.failureReason ||
                    "We couldn't read much from that page. Fill in what's missing, or start from a saved brand."}
                </span>
                <button
                  type="button"
                  onClick={() => setAdjustOpen(true)}
                  className="font-semibold underline underline-offset-2"
                >
                  Fill it in
                </button>
              </span>
            </Notice>
          )}

          <BriefSummary
            brief={brief}
            budget={budget}
            onAdjust={() => setAdjustOpen((v) => !v)}
            adjusting={adjustOpen}
            busy={saving}
          />

          {/* Expanded in place, right under the summary it belongs to, so the
              fields sit where the chips they correspond to are.

              The height animation is not decoration: this pushes everything
              below it down by several hundred pixels, and a jump that large
              with no transition reads as the page breaking rather than
              responding. */}
          <AnimatePresence initial={false}>
            {adjustOpen && (
              <motion.div key="adjust" {...M.expand}>
                <AdjustPanel
                  brief={brief}
                  open
                  onClose={() => setAdjustOpen(false)}
                  onEditField={handleEdit}
                  saving={saving}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Before the first run: the budget and one button. This is the only
              thing standing between a read page and ads, and it is input 2 of
              2 — normally already answered on the wait screen. */}
          {!generating && !hasCreatives && (
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-4 dark:border-white/10 dark:bg-[#14181D]">
              <div className="flex flex-col gap-1.5">
                <span className="text-10 font-extrabold tracking-wider text-gray-400 uppercase dark:text-white/40">
                  Daily budget
                </span>
                <div
                  className={`flex h-10 w-44 items-center gap-1.5 rounded-xl border bg-gray-100 px-3 focus-within:border-[#15DCFF]/40 dark:bg-white/6 ${
                    canGenerate
                      ? 'border-gray-300 dark:border-white/12'
                      : 'border-amber-500/50 dark:border-amber-500/40'
                  }`}
                >
                  <span className="text-13 text-gray-400 dark:text-white/45">₹</span>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={budget ?? ''}
                    onChange={(e) => dispatch(setPendingBudget(e.target.value))}
                    onBlur={persistBudget}
                    placeholder="800"
                    className="w-full min-w-0 bg-transparent text-13 text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-white/45"
                  />
                  <span className="shrink-0 text-10 text-gray-400 dark:text-white/45">/day</span>
                </div>
                <span className="text-xs text-gray-500 dark:text-white/55">
                  Nothing spends until you start deliveries.
                </span>
              </div>

              <PrimaryBtn onClick={handleGenerate} disabled={!canGenerate} busy={saving}>
                Generate ads
              </PrimaryBtn>
            </div>
          )}

          <CreativePreview
            run={run}
            callToAction={ctaLabel}
            ratio={brief.delivery?.ratios?.[0] || '4:5'}
            onRegenerate={handleGenerate}
            onContinue={handleWantSchedule}
            regenerating={generating}
            creditsHeld={estimate?.total ?? null}
          />

          {/* Under the current ads, never above them — the batch you just made
              is the page; the ones before it are reference. */}
          <PreviousRuns history={history} />

          {/* ── 4 ── Only once there is something to schedule. Asking "keep
              these coming" before any ad exists asks the user to commit to
              something they haven't seen. */}
          {/* Only once asked for. The preview strip's "Keep these coming →" is
              the way in; rendering this card alongside it put two controls with
              the SAME NAME on screen at once, the button merely flipping the
              toggle sitting underneath it.

              That duplication came from flattening the design: stages 3 and 4
              were separate screens in the mockup, so the two never appeared
              together. On one page only one of them can be the control — the
              button leads here, and the toggle in this card's header is how you
              leave again. */}
          {hasCreatives && scheduleOn && (
            <div ref={scheduleRef} className="flex flex-col gap-4">
              <KeepTheseComing
                enabled={scheduleOn}
                onToggle={setScheduleOn}
                frequency={frequency}
                onFrequencyChange={setFrequency}
                onActivate={handleActivate}
                activating={activating}
                isMetaConnected={isConnectionComplete(connection)}
                connection={{
                  adAccountId: connection.adAccountId,
                  adAccountLabel: connection.adAccountName,
                  pageId: connection.pageId,
                  pageLabel: connection.pageName,
                }}
                pairsPerCycle={brief.delivery?.pairsPerCycle ?? 3}
                budget={budget}
                hour={brief.delivery?.frequency?.hour ?? 9}
                timezone={brief.delivery?.frequency?.timezone}
                objectiveLabel={objectiveLabel}
                creditsPerCycle={estimate?.total ?? null}
                firstRunLabel={nextRunLabel}
              />
              <LaunchConnection
                value={connection}
                onChange={setConnection}
                disabled={activating}
              />
            </div>
          )}
        </div>
      )}

      {/* ── 5 ── Deliveries are the page once a brief is live. */}
      {step === STEP.DELIVERIES && brief && (
        <div className="mx-auto flex w-full max-w-375 flex-col gap-4 px-4 2xl:px-8">
          <BriefSummary
            brief={brief}
            budget={budget}
            onAdjust={() => setAdjustOpen((v) => !v)}
            adjusting={adjustOpen}
            busy={saving}
          />
          <AnimatePresence initial={false}>
            {adjustOpen && (
              <motion.div key="adjust" {...M.expand}>
                <AdjustPanel
                  brief={brief}
                  open
                  onClose={() => setAdjustOpen(false)}
                  onEditField={handleEdit}
                  saving={saving}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <RunTimeline
            summary={timeline?.summary}
            rows={timeline?.rows}
            loading={timeline?.loading}
            onRetry={handleGenerate}
            brandName={brief.brand?.name}
            pairsPerCycle={brief.delivery?.pairsPerCycle}
            onPause={() => handlePause(true)}
            onResume={() => handlePause(false)}
            pausing={pausing}
          />
        </div>
      )}

    </div>
  );
}
