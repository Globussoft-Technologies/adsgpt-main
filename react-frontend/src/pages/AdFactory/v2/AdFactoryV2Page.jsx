import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Images, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AnimatePresence, motion } from 'framer-motion';

import SourceInput from '@/components/AdFactory/v2/SourceInput';
import Inferring from '@/components/AdFactory/v2/Inferring';
import BriefSummary from '@/components/AdFactory/v2/BriefSummary';
import AdjustPanel from '@/components/AdFactory/v2/AdjustPanel';
import OutputPanel from '@/components/AdFactory/v2/OutputPanel';
import CreativePreview from '@/components/AdFactory/v2/CreativePreview';
import RunGallery from '@/components/AdFactory/v2/RunGallery';
import BriefFailed from '@/components/AdFactory/v2/BriefFailed';
import BriefList from '@/components/AdFactory/v2/BriefList';
import RunPicker, { CURRENT } from '@/components/AdFactory/v2/RunPicker';
import RunTimeline from '@/components/AdFactory/v2/RunTimeline';
import SchedulePanel from '@/components/AdFactory/v2/SchedulePanel';
import KeepTheseComing from '@/components/AdFactory/v2/KeepTheseComing';
import ShipTheseAds from '@/components/AdFactory/v2/ShipTheseAds';
import { emptyConnection, isConnectionComplete } from '@/components/AdFactory/v2/LaunchConnection';
import { Notice, PrimaryBtn } from '@/components/AdFactory/v2/Panel';
import {
  BTN_GHOST,
  BTN_LINK,
  CARD,
  FAINT,
  MUTED,
  NUM,
  RULE_BORDER,
  SECTION,
} from '@/components/AdFactory/v2/_tokens';
import { useMotionPresets } from '@/components/AdFactory/v2/_motion';
import emitter from '@/utils/eventEmitter';
import { emitWhenConnected } from '@/utils/socketEmitter';

import {
  startBriefFromUrl,
  startBriefFromBrand,
  fetchBrief,
  saveBriefEdits,
  generateAds,
  activateAutomation,
  setAutomationPaused,
  stopAutomation,
  runNow,
  publishNow,
  fetchBriefs,
  removeBrief,
  fetchTimeline,
  BRIEF_STATUS,
  STEP,
  applyLocalEdit,
  briefReady,
  clearBriefError,
  clearNeedsRefetch,
  clearPublishState,
  resetBrief,
  setPendingBudget,
  selectBrief,
  selectBriefId,
  selectLiveCampaignId,
  selectBriefError,
  selectActivationError,
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
  selectJobSync,
  selectIsPausing,
  selectIsRunningNow,
  selectRunNowQueued,
  selectPublishing,
  selectPublishResult,
  selectPublishError,
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
//   2  Inferring            the ~35s read, and nothing else
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

// One row of the This-run breakdown: what it is on the left, what it costs on
// the right, both on the same baseline so the numbers form a column.
function CostLine({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? MUTED : FAINT}>{label}</span>
      <span
        className={`${NUM} ${
          strong
            ? 'text-[13px] font-semibold text-[var(--ws-text-primary)] dark:text-[#F4F4F5]'
            : 'text-[12px] font-medium text-[var(--ws-text-secondary)] dark:text-[#AFAFAF]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Two controls the gallery replaced ───────────────────────────────────────
//
// Off rather than deleted: flip either to true and it returns exactly as it
// was. Both are switched off for the same reason — "See all generations" does
// the same job in one place, and having a second, weaker version of it on the
// page is how a screen ends up with four controls for two decisions.
//
// SHOW_RUN_PICKER — the "Latest run · 3 ads" dropdown.
//   It swapped WHICH run the page showed, one at a time. The gallery lists
//   every run at once, grouped and labelled, so the thing this chose between
//   is now just scrolling. With it off `viewRun` never leaves CURRENT, so
//   `isViewingPast` stays false and the read-only run branches go quiet.
//
// SHOW_INLINE_SHIP — the full-width "Ship these ads" card.
//   It posts the WHOLE current run. The gallery posts any selection, from any
//   run, through the same form and the same fields — a superset — and it asks
//   for the ad set beside the ads rather than a screen away from them.
const SHOW_RUN_PICKER = false;
const SHOW_INLINE_SHIP = false;

const BRIEF_READY_EVENT = 'adFactoryBriefReady';
const INFER_POLL_MS = 3000;
// Generation runs for minutes, not seconds — polling it as eagerly as inference
// would be dozens of pointless round trips per run.
const GENERATION_POLL_MS = 15000;
const MIN_DAILY_BUDGET_INR = 100;

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
  // The manual path. Mutually exclusive with the schedule card by design —
  // both answer "what happens to these ads next", and two open cards asking
  // that at once is the duplication we just spent a pass removing.
  // NOTE: the cadence is NOT local state. It used to be — `frequency` lived in
  // a useState here — which meant the dropdown changed the UI and nothing else:
  // `activateBrief` builds its payload server-side from the STORED brief, so
  // whatever the user picked was discarded and every job was created weekly.
  // It is read from and written to the brief like every other field.
  // Adjust starts OPEN. Before any ads exist the page is otherwise a summary
  // line and a budget box on a lot of empty space, so the fields may as well be
  // there to check — which is the whole point of showing what we inferred.
  //
  // It is still not the toll gate the previous attempt made it: nothing blocks
  // on it, and it gets out of the way the moment ads become the page (below).
  const [adjustOpen, setAdjustOpen] = useState(true);
  // Which batch the cards are showing. CURRENT = the live run.
  const [viewRun, setViewRun] = useState(CURRENT);
  const [deletingBrief, setDeletingBrief] = useState(null);
  // Every ad this brief has ever made, on top of the page — and the one place
  // a selection spanning several runs can be posted in a single press.
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Whether the default has been resolved for the brief now loaded. Without
  // this the effect below would re-open the panel every time the brief object
  // changes identity, fighting the user each time they closed it.
  const adjustDefaulted = useRef(false);
  // Set when the user presses Generate, cleared the moment that run's first ad
  // lands. See the effect that opens the gallery on it.
  const awaitingRun = useRef(false);

  const brief = useSelector(selectBrief);
  const briefId = useSelector(selectBriefId);
  const liveCampaignId = useSelector(selectLiveCampaignId);
  const step = useSelector(selectStep);
  const run = useSelector(selectRun);
  const estimate = useSelector(selectEstimate);
  const history = useSelector(selectHistory);
  const error = useSelector(selectBriefError);
  const activationError = useSelector(selectActivationError);
  const errorCode = useSelector(selectBriefErrorCode);
  const inferring = useSelector(selectIsInferring);
  const inferStartedAt = useSelector(selectInferStartedAt);
  const pendingBudget = useSelector(selectPendingBudget);
  const generating = useSelector(selectIsGenerating);
  const needsRefetch = useSelector(selectNeedsRefetch);
  const timeline = useSelector(selectTimeline);
  const jobSync = useSelector(selectJobSync);
  const pausing = useSelector(selectIsPausing);
  const runningNow = useSelector(selectIsRunningNow);
  const runNowQueued = useSelector(selectRunNowQueued);
  const publishing = useSelector(selectPublishing);
  const publishResult = useSelector(selectPublishResult);
  const publishError = useSelector(selectPublishError);
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

  // A past run renders through the SAME card component as the live one — the
  // server ships each historical batch in the identical pair shape for exactly
  // that reason. Its status is forced to success: an old batch is finished by
  // definition, so it must never inherit the live run's skeletons.
  const viewedRun = useMemo(() => {
    if (viewRun === CURRENT) return run;
    const past = (history || []).find((h) => String(h.version) === String(viewRun));
    if (!past) return run;
    return {
      status: 'success',
      pairs: past.pairs || [],
      pending: 0,
      failed: 0,
      requested: past.adCount,
    };
  }, [viewRun, run, history]);

  // Starting a new run always snaps back to it; watching a two-minute
  // generation from inside last week's batch is not what anyone means by
  // pressing Regenerate.
  const isViewingPast = viewRun !== CURRENT;

  // ── The gallery ───────────────────────────────────────────────────────────
  // Every run this brief has produced, newest first, in the shape RunGallery
  // renders. The live run is not in `history` — that array is snapshots of
  // FINISHED runs, written before each new generate — so it is prepended
  // rather than looked up, and only when it actually has ads in it.
  const galleryRuns = useMemo(() => {
    const past = (history || [])
      .map((h) => ({
        key: `run-${h.version}`,
        title: h.partial ? 'Earlier ads' : `Run ${h.version}`,
        at: h.at,
        pairs: h.pairs || [],
      }))
      .reverse();

    // Slots this run asked for that haven't landed yet. Carried into the
    // gallery so a generation in flight shows as placeholders filling in one
    // by one, rather than the grid sitting empty until the last one arrives.
    //
    // Read straight off `pending` rather than gating on `status === 'running'`:
    // the count is derived server-side from the run's own pre-allocated slots
    // and falls to zero when the run ends, so it is the more reliable of the
    // two — and CreativePreview has always drawn its skeletons from it alone.
    const pending = run?.pending || 0;

    const live =
      run?.pairs?.length || pending
        ? [
            {
              key: 'current',
              title: 'Latest run',
              at: run?.at || null,
              pairs: run?.pairs || [],
              pending,
            },
          ]
        : [];

    return [...live, ...past];
  }, [run, history]);

  const galleryTotal = useMemo(
    () => galleryRuns.reduce((sum, r) => sum + (r.pairs?.length || 0), 0),
    [galleryRuns]
  );

  // Placeholders count as something to look at — during the first run of a new
  // brief there are no finished ads yet, and a disabled button is the wrong
  // answer to "what is happening".
  const galleryPending = useMemo(
    () => galleryRuns.reduce((sum, r) => sum + (r.pending || 0), 0),
    [galleryRuns]
  );

  // What the account has left, the same arithmetic every other credit-spending
  // surface in the app does (`totalCredits - creditsUsed`, off the socket).
  // `null` when the socket has not delivered a balance yet — showing a bare 0
  // would read as "you are out of credits".
  const credits = useSelector((s) => s.socket?.credits);
  const availableCredits = useMemo(() => {
    const total = Number(credits?.totalCredits);
    const used = Number(credits?.creditsUsed);
    if (!Number.isFinite(total)) return null;
    return Math.max(0, total - (Number.isFinite(used) ? used : 0));
  }, [credits]);

  const balanceAfterRun =
    availableCredits != null && estimate?.total != null
      ? Math.max(0, availableCredits - estimate.total)
      : null;

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

  // Manual Quick setup generation still reports progress through the legacy
  // Ad Factory campaign room. Join it when we know the metadata campaign id so
  // `adFactoryResponse` events can reach this tab too.
  useEffect(() => {
    if (!liveCampaignId) return;
    emitWhenConnected('adFactoryRequest', liveCampaignId).catch(() => {});
  }, [liveCampaignId]);

  // When Python lands another image/text result for THIS quick-setup run,
  // refresh the brief immediately instead of waiting for the next poll tick.
  useEffect(() => {
    if (!briefId || !liveCampaignId) return undefined;
    const onImageResult = (data) => {
      if (!data?.campaignId || String(data.campaignId) !== String(liveCampaignId)) return;
      dispatch(fetchBrief(briefId));
    };
    emitter.on('adfactory:imageResult', onImageResult);
    return () => {
      emitter.off('adfactory:imageResult', onImageResult);
    };
  }, [dispatch, briefId, liveCampaignId]);

  // Generation has no completion event of its own — Python writes results to
  // the campaign and the webhook that receives them is v1's, which knows
  // nothing about briefs. Polling is honest here rather than a fallback.
  useEffect(() => {
    if (run?.status !== 'running' || !briefId) return undefined;
    const id = setInterval(() => dispatch(fetchBrief(briefId)), GENERATION_POLL_MS);
    return () => clearInterval(id);
  }, [dispatch, run?.status, briefId]);

  // ── Take me to the ads ────────────────────────────────────────────────────
  //
  // The chain, end to end: Python finishes an image → our backend emits
  // `adFactoryResponse` → socketSlice relays it onto the app bus as
  // `adfactory:imageResult` → the effect above refetches the brief → `run.pairs`
  // grows → this opens the gallery on it. The gallery renders from that same
  // prop, so everything still generating fills in behind the first arrival
  // without anything further to do here; the 15s poll is only the net for a tab
  // that missed the emit.
  //
  // Once per press, and only for a press: `awaitingRun` is armed in
  // `handleGenerate` and cleared here, so closing the gallery while the rest of
  // the batch lands does not yank it open again, and a scheduled cycle
  // delivering in the background never interrupts what the user is doing.
  useEffect(() => {
    if (!awaitingRun.current) return;
    if ((run?.pairs?.length || 0) === 0) return;
    awaitingRun.current = false;
    setGalleryOpen(true);
  }, [run?.pairs?.length]);

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
    // Adjust used to CLOSE ITSELF once ads existed, on the theory that the
    // creatives should be the page. In practice the brief is what you go back
    // and change when a batch is wrong, and having it fold away the moment the
    // ads landed meant re-opening it every single time. It stays open; Done
    // closes it, and that choice sticks for the session.
    if (!brief || adjustDefaulted.current) return;
    adjustDefaulted.current = true;
  }, [brief, hasCreatives, step]);

  // ── Budget ────────────────────────────────────────────────────────────────
  // Asked ONCE, on the brief screen, next to Generate — the button it pays for.
  //
  // It used to be collected on the wait screen too, on the theory that a 35s
  // read may as well collect input 2 of 2. That asked for a number before there
  // was anything to judge it against, and then showed the same field again a
  // moment later.
  //
  // `pendingBudget` is the in-flight keystrokes; `brief.delivery.budget.daily`
  // is what is saved. The typed value wins while it exists so the input doesn't
  // fight the user mid-edit.
  const budget = useMemo(() => {
    if (pendingBudget !== '' && pendingBudget != null) return pendingBudget;
    const saved = brief?.delivery?.budget?.daily;
    const savedNumber = Number(saved);
    if (Number.isFinite(savedNumber) && savedNumber > 0 && savedNumber < MIN_DAILY_BUDGET_INR) {
      return MIN_DAILY_BUDGET_INR;
    }
    return saved ?? '';
  }, [brief, pendingBudget]);

  // Read the SAVED budget as a primitive, not off the whole brief. `brief` gets
  // a new identity on every response, so a callback that closes over the object
  // is re-created constantly — and an effect that depends on that callback then
  // re-runs constantly. See the loop note on the effect below.
  const savedBudget = brief?.delivery?.budget?.daily;

  const persistBudget = useCallback(() => {
    const raw = pendingBudget !== '' && pendingBudget != null ? pendingBudget : savedBudget;
    const n = Number(raw);
    if (!briefId || !Number.isFinite(n) || n <= 0) return null;
    const daily = Math.max(MIN_DAILY_BUDGET_INR, Math.round(n));
    if (pendingBudget !== '' && String(pendingBudget) !== String(daily)) {
      dispatch(setPendingBudget(String(daily)));
    }
    if (savedBudget === daily) return null;
    // Write it locally FIRST. The save response deliberately doesn't merge
    // server state back (it would clobber an edit still in flight), so without
    // this the guard above compares against a value that never changes and the
    // effect below dispatches forever.
    dispatch(
      applyLocalEdit({
        section: 'delivery',
        field: 'budget',
        value: { daily, currency: 'INR' },
      })
    );
    return dispatch(
      saveBriefEdits({
        briefId,
        patch: { delivery: { budget: { daily, currency: 'INR' } } },
      })
    );
  }, [dispatch, briefId, pendingBudget, savedBudget]);

  // NOTE: there is deliberately no effect flushing `pendingBudget`.
  //
  // One existed to write whatever was typed during the wait, once inference
  // finished. With the wait-screen field gone nothing can set the budget before
  // a brief exists, so it had no job left — and it was actively harmful: it
  // depended on `pendingBudget`, which changes on every keystroke, so typing
  // "800" into the brief screen's budget box dispatched a PATCH for 8, then 80,
  // then 800, each one re-materialising the campaign server-side.
  //
  // The budget is written on blur and again just before Generate, which are the
  // two moments it actually needs to be saved.

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleUrl = useCallback(
    (url) => {
      dispatch(clearBriefError());
      dispatch(startBriefFromUrl({ url }));
    },
    [dispatch]
  );

  const handleBrand = useCallback(
    (brandId) => {
      dispatch(clearBriefError());
      dispatch(startBriefFromBrand(brandId));
    },
    [dispatch]
  );

  const handleEdit = useCallback(
    (section, field, value) => {
      dispatch(applyLocalEdit({ section, field, value }));
      if (briefId) {
        dispatch(saveBriefEdits({ briefId, patch: { [section]: { [field]: value } } }));
      }
    },
    [dispatch, briefId]
  );

  /**
   * Several fields of one section, in ONE request.
   *
   * Calling `handleEdit` twice in a row fires two PATCHes at once, and the
   * server's update is a read-modify-write: it loads the brief, merges the
   * incoming section over it, and saves. The second request reads BEFORE the
   * first has written, so it merges onto a stale document and saves the old
   * value back over the new one — a textbook lost update.
   *
   * "Ads per generate" writes imageCount and textCount together, and that is
   * exactly what it hit: the stepper showed 15 while the server ended up with
   * imageCount 14 and textCount 15, and the estimate that came back priced the
   * 14. One logical edit has to be one request.
   */
  const handleEditMany = useCallback(
    (section, fields) => {
      for (const [field, value] of Object.entries(fields)) {
        dispatch(applyLocalEdit({ section, field, value }));
      }
      if (briefId) {
        dispatch(saveBriefEdits({ briefId, patch: { [section]: fields } }));
      }
    },
    [dispatch, briefId]
  );

  const handleGenerate = useCallback(async () => {
    if (!briefId) return;
    // Armed here and disarmed by the effect below, so the gallery opens itself
    // only for a run THIS user just started — never for a scheduled cycle
    // landing in the background while they are editing the brief.
    awaitingRun.current = true;
    // Write the budget first: it is the one field the user can still be typing
    // when they press Generate, and the payload is built server-side from the
    // stored brief.
    await persistBudget();
    // The ads are about to become the page, so the fields step aside. A clear
    // cause the user just triggered, rather than the panel closing on its own.
    setAdjustOpen(false);
    setViewRun(CURRENT);
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
    // Refetch explicitly rather than relying on the bootstrap effect. That one
    // is keyed on `urlBriefId` changing, so coming back from a brief whose id
    // never reached the URL would not re-run it — and the list the user just
    // added to would be stale anyway.
    dispatch(fetchBriefs());
    const next = new URLSearchParams(searchParams);
    next.delete('briefId');
    setSearchParams(next, { replace: true });
  }, [dispatch, searchParams, setSearchParams]);

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
    [searchParams, setSearchParams]
  );

  // Deleting takes the campaign with it, so it is worth one question. The
  // server refuses outright if an automation is still delivering.
  const handleDeleteBrief = useCallback((id, label) => {
    setDeletingBrief({ id, label });
  }, []);

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

  // `imageUrls` arrives only from the gallery, where the user hand-picked ads
  // that can span several runs. Omitted — which is what "Ship these ads" on the
  // preview screen sends — the server posts the whole run being viewed.
  const handlePublish = useCallback(
    ({ mode, campaignId, adSetId, imageUrls }) => {
      if (!briefId) return;
      dispatch(publishNow({ briefId, connection, mode, campaignId, adSetId, imageUrls }));
    },
    [dispatch, briefId, connection]
  );

  const handlePause = useCallback(
    (paused) => {
      if (!brief?.jobId) return;
      dispatch(setAutomationPaused({ jobId: brief.jobId, paused }));
    },
    [dispatch, brief?.jobId]
  );

  const handleStop = useCallback(() => {
    if (!briefId) return;
    dispatch(stopAutomation(briefId));
  }, [dispatch, briefId]);

  // The cadence, from either place it can be edited.
  //
  // `pairsPerCycle` sits on `delivery`; frequency, hour, timezone, endDate and
  // the custom block all sit on `delivery.frequency` — so one change can span
  // two objects, hence a patch built here rather than the single-field
  // `handleEdit`. The server merges `delivery.frequency` one level deep, so
  // sending only the changed key keeps its siblings.
  //
  // `endDate: null` is a real value, not an omission: clearing the date is how
  // a fixed-length run becomes a standing one.
  //
  // For a LIVE brief this is also what reaches the running job: the PATCH
  // response carries `jobSync`, and SchedulePanel shows it when the job refused.
  const handleCadenceChange = useCallback(
    (change) => {
      if (!briefId) return;

      const { pairsPerCycle, ...scheduleBits } = change;
      const patch = {};

      if (Object.keys(scheduleBits).length) {
        // `frequency` is what the pills call it; `preset` is what the brief
        // calls it. Translating here keeps the control ignorant of the schema.
        const { frequency: preset, ...rest } = scheduleBits;
        const next = {
          ...(brief?.delivery?.frequency || {}),
          ...rest,
          ...(preset ? { preset } : {}),
        };
        if ((preset || next.preset) !== 'custom') {
          delete next.custom;
        }
        patch.frequency = next;
        dispatch(applyLocalEdit({ section: 'delivery', field: 'frequency', value: next }));
      }

      if (pairsPerCycle != null) {
        patch.pairsPerCycle = pairsPerCycle;
        dispatch(
          applyLocalEdit({ section: 'delivery', field: 'pairsPerCycle', value: pairsPerCycle })
        );
      }

      dispatch(saveBriefEdits({ briefId, patch: { delivery: patch } }));
    },
    [dispatch, briefId, brief?.delivery?.frequency]
  );

  const handleScheduleUpdate = useCallback(
    async ({ cadence: change = {}, alertEmails: emails = [] }) => {
      if (!briefId) return;

      const { pairsPerCycle, ...scheduleBits } = change;
      const patch = {};

      if (Object.keys(scheduleBits).length) {
        const { frequency: preset, ...rest } = scheduleBits;
        const next = {
          ...(brief?.delivery?.frequency || {}),
          ...rest,
          ...(preset ? { preset } : {}),
        };
        if ((preset || next.preset) !== 'custom') {
          delete next.custom;
        }
        patch.delivery = { ...(patch.delivery || {}), frequency: next };
        dispatch(applyLocalEdit({ section: 'delivery', field: 'frequency', value: next }));
      }

      if (pairsPerCycle != null) {
        patch.delivery = { ...(patch.delivery || {}), pairsPerCycle };
        dispatch(
          applyLocalEdit({ section: 'delivery', field: 'pairsPerCycle', value: pairsPerCycle })
        );
      }

      patch.alertEmails = emails;
      dispatch(applyLocalEdit({ field: 'alertEmails', value: emails }));
      const result = await dispatch(saveBriefEdits({ briefId, patch }));
      if (saveBriefEdits.fulfilled.match(result)) {
        dispatch(fetchTimeline(briefId));
      }
    },
    [dispatch, briefId, brief?.delivery?.frequency]
  );

  // Read straight off the brief, with the same defaults the schema uses, so the
  // controls show what will actually run rather than a local guess.
  const cadence = useMemo(
    () => ({
      frequency: brief?.delivery?.frequency?.preset || 'weekly',
      hour: brief?.delivery?.frequency?.hour ?? 9,
      timezone: brief?.delivery?.frequency?.timezone || '',
      pairsPerCycle: brief?.delivery?.pairsPerCycle ?? 3,
      custom: brief?.delivery?.frequency?.custom || null,
      startDate: brief?.delivery?.frequency?.startDate || null,
      endDate: brief?.delivery?.frequency?.endDate || null,
    }),
    [
      brief?.delivery?.frequency?.preset,
      brief?.delivery?.frequency?.hour,
      brief?.delivery?.frequency?.timezone,
      brief?.delivery?.frequency?.custom,
      brief?.delivery?.frequency?.startDate,
      brief?.delivery?.frequency?.endDate,
      brief?.delivery?.pairsPerCycle,
    ]
  );

  const handleActivate = useCallback(async () => {
    if (!briefId || !isConnectionComplete(connection)) return;
    const result = await dispatch(
      activateAutomation({
        briefId,
        connection: {
          facebookId: connection.facebookId,
          connectionId: connection.connectionId,
          adAccountId: connection.adAccountId,
          adAccountName: connection.adAccountName,
          pageId: connection.pageId,
          pageName: connection.pageName,
        },
        cadence: {
          frequency: cadence.frequency,
          hour: cadence.hour,
          timezone: cadence.timezone,
          pairsPerCycle: cadence.pairsPerCycle,
          ...(cadence.frequency === 'custom' ? { custom: cadence.custom } : {}),
          startDate: cadence.startDate,
          endDate: cadence.endDate,
        },
      })
    );
    if (activateAutomation.fulfilled.match(result)) {
      setScheduleOn(false);
    }
  }, [dispatch, briefId, connection, cadence]);

  // A list, so it replaces rather than merges — removing a recipient is the
  // main thing anyone does to one.
  const handleAlertEmailsChange = useCallback(
    (emails) => {
      if (!briefId) return;
      dispatch(applyLocalEdit({ field: 'alertEmails', value: emails }));
      dispatch(saveBriefEdits({ briefId, patch: { alertEmails: emails } }));
    },
    [dispatch, briefId]
  );

  const handleRunNow = useCallback(() => {
    if (!briefId) return;
    dispatch(runNow(briefId));
  }, [dispatch, briefId]);

  const host = useMemo(() => {
    const url = brief?.source?.url || '';
    try {
      return url ? new URL(url).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  }, [brief]);

  // Generating spends CREDITS, not budget — no code path reads the budget
  // during generation. It used to gate this button anyway, which meant a brief
  // with no budget could not make a single ad even though nothing it was about
  // to do needed one. The budget is asked for where it IS required: the
  // schedule card, whose synthesised template expresses it as an ad set budget.
  const canGenerate = Boolean(briefId) && !generating;

  // How many ads one press makes. The same number the Output card's stepper
  // sets, so the button can name what it is about to do.
  const adsPerRun = brief?.generation?.imageCount ?? 3;

  const generateLabel = generating
    ? 'Generating…'
    : `${hasCreatives ? 'Regenerate' : 'Generate'} ${adsPerRun} ${adsPerRun === 1 ? 'ad' : 'ads'}`;

  // The rail: what we make (Output) directly above what it costs and the button
  // that spends it. Rendered before the first run too — the wireframe's whole
  // point is that the price of the press is on screen while you are still
  // deciding what to press it with.
  const sidebar = (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-3 lg:self-start">
      <OutputPanel brief={brief} onEditField={handleEdit} onEditFields={handleEditMany} />

      <div className={`${CARD} px-4 py-4`}>
        <h3 className={`mb-3 ${SECTION}`}>This run</h3>

        <div className="flex items-baseline gap-2">
          <span
            className={`text-[24px] leading-none font-semibold text-[var(--ws-text-primary)] dark:text-[#F4F4F5] ${NUM}`}
          >
            {estimate?.total ?? '—'}
          </span>
          <span className={MUTED}>credits</span>
        </div>

        {/* The two lines the total is made of. Priced by the same projection
            the charge freeze uses, so the quote and the invoice cannot
            disagree — see briefCreditEstimate on the server. */}
        {estimate?.counts && (
          <div className="mt-3 flex flex-col gap-1.5">
            <CostLine
              label={`${estimate.counts.image} ${estimate.counts.image === 1 ? 'image' : 'images'}`}
              value={estimate.image}
            />
            <CostLine
              label={`${estimate.counts.text} ${estimate.counts.text === 1 ? 'copy' : 'copies'}`}
              value={estimate.text}
            />
            {balanceAfterRun != null && (
              <div className={`mt-1.5 border-t pt-2 ${RULE_BORDER}`}>
                <CostLine label="Balance after run" value={balanceAfterRun} strong />
              </div>
            )}
          </div>
        )}

        <PrimaryBtn
          onClick={handleGenerate}
          disabled={!canGenerate || isViewingPast}
          busy={saving || generating}
          className="mt-4 w-full"
        >
          {generateLabel}
        </PrimaryBtn>
        <p className={`mt-2 text-center ${FAINT}`}>Nothing spends until you start deliveries.</p>

        {/* Every ad this brief has made, not just the batch on screen. The
            page shows one run at a time by design; this is the way to the
            rest of them, and the only place a single ad can be posted on its
            own. */}
        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          disabled={galleryTotal === 0 && galleryPending === 0}
          className={`mt-3 w-full justify-center ${BTN_GHOST}`}
        >
          <Images className="h-3.5 w-3.5" />
          {galleryTotal === 0 && galleryPending === 0
            ? 'No generations yet'
            : galleryPending > 0
              ? `See all generations (${galleryTotal} + ${galleryPending} coming)`
              : `See all generations (${galleryTotal})`}
        </button>
      </div>
    </aside>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  // No header here: the page title comes from TopHeader and the mode switch is
  // owned by AdFactoryPage, so both modes share exactly one of each.
  return (
    <div className="adfactory-v2-surface relative isolate flex h-full w-full flex-col gap-3 overflow-y-auto bg-[var(--ws-bg)] pt-0 pb-8 text-[var(--ws-text-primary)] dark:bg-[#0f0f0f] dark:text-[#F4F4F5]">
      {error && !(hasCreatives && scheduleOn) && (
        <div className="mx-auto w-full max-w-375 px-4 2xl:px-8">
          <Notice tone="warn" icon={AlertCircle}>
            <span className="flex flex-col items-start gap-1">
              <span>{error}</span>
              {errorCode === 'NO_BASE_PLAN' ? (
                <a href="/pricing" className={BTN_LINK}>
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

      {loading && !brief && !inferring && urlBriefId && (
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
        <Inferring host={host} startedAt={inferStartedAt} onStartOver={handleStartOver} />
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
        <div className="mx-auto flex w-full max-w-375 flex-col gap-3 px-4 2xl:px-8">
          <div>
            <button
              type="button"
              onClick={handleStartOver}
              className="text-13 inline-flex items-center gap-1.5 text-[#6B7280] transition-colors hover:text-[#111827] dark:text-[#AFB6C0] dark:hover:text-[#ECEFF3]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All briefs
            </button>
          </div>
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

          {/* Two columns from the first paint, not only once ads exist. The
              rail holds Output and the price of the press, and both of those
              are decisions made BEFORE the first generate — a layout that
              appears afterwards would move the whole page under the user at the
              exact moment their ads arrive. */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-3">
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
                      onEditFields={handleEditMany}
                      saving={saving}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* The budget bar that used to sit here is gone. It paired a
                  field generation never reads with the button that generates,
                  and it duplicated the cost line the rail now owns. The budget
                  is asked for in the schedule card, which is the one thing that
                  requires it. */}

              {SHOW_RUN_PICKER && (
                <RunPicker
                  history={history}
                  value={viewRun}
                  onChange={setViewRun}
                  currentCount={run?.pairs?.length || 0}
                  currentPending={isViewingPast ? 0 : run?.pending || 0}
                />
              )}

              <CreativePreview
                run={viewedRun}
                callToAction={ctaLabel}
                ratio={brief.delivery?.ratios?.[0] || '4:5'}
                onRegenerate={handleGenerate}
                onContinue={handleWantSchedule}
                shipping={publishing}
                regenerating={generating}
                creditsHeld={isViewingPast ? null : (estimate?.total ?? null)}
                estimate={isViewingPast ? null : (estimate?.total ?? null)}
                readOnly={isViewingPast}
              />

              {/* Posting the WHOLE current run into one ad set — off by
                  default, see SHOW_INLINE_SHIP at the top of this file. The
                  gallery does this and more, beside the ads rather than a
                  screen away from them. */}
              {SHOW_INLINE_SHIP && hasCreatives && !isViewingPast && (
                <ShipTheseAds
                  adCount={run?.pairs?.length || 0}
                  connection={connection}
                  onConnectionChange={setConnection}
                  objectiveLabel={objectiveLabel}
                  budget={budget}
                  onPublish={handlePublish}
                  publishing={publishing}
                  result={publishResult}
                  error={publishError}
                  onDismissResult={() => dispatch(clearPublishState())}
                  onClose={() => dispatch(clearPublishState())}
                />
              )}

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
              {/* ONE card. The account pickers used to be a second panel below
              this one, while this one carried a read-only checklist of the
              same two values — so the page asked and answered the same
              question in two different boxes, in the wrong order. The pickers
              live inside "Where these publish" now, and the derived
              adAccountLabel/pageLabel object that fed the checklist is gone
              with it: the connection state goes straight in. */}
              {hasCreatives && scheduleOn && (
                <div ref={scheduleRef}>
                  <KeepTheseComing
                    enabled={scheduleOn}
                    onToggle={setScheduleOn}
                    frequency={cadence.frequency}
                    custom={cadence.custom}
                    startDate={cadence.startDate}
                    endDate={cadence.endDate}
                    alertEmails={brief.alertEmails}
                    onAlertEmailsChange={handleAlertEmailsChange}
                    onCadenceChange={handleCadenceChange}
                    onActivate={handleActivate}
                    activating={activating}
                    isMetaConnected={isConnectionComplete(connection)}
                    connection={connection}
                    onConnectionChange={setConnection}
                    pairsPerCycle={cadence.pairsPerCycle}
                    budget={budget}
                    onBudgetChange={(v) => dispatch(setPendingBudget(v))}
                    onBudgetCommit={persistBudget}
                    minBudget={MIN_DAILY_BUDGET_INR}
                    hour={cadence.hour}
                    timezone={cadence.timezone}
                    objectiveLabel={objectiveLabel}
                    creditsPerCycle={estimate?.total ?? null}
                    firstRunLabel={nextRunLabel}
                    activationError={activationError}
                    status={
                      brief?.status === 'live' || brief?.jobId
                        ? timeline?.summary?.status ||
                          (brief?.status === 'paused' ? 'paused' : 'active')
                        : brief?.status
                    }
                    onPause={() => handlePause(true)}
                    onResume={() => handlePause(false)}
                    onStop={handleStop}
                    busy={pausing}
                  />
                </div>
              )}
            </div>
            {sidebar}
          </div>
        </div>
      )}

      {/* ── 5 ── Deliveries are the page once a brief is live. */}
      {step === STEP.DELIVERIES && brief && (
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-3 py-3 sm:px-4 2xl:px-5">
          <div>
            <button
              type="button"
              onClick={handleStartOver}
              className="text-13 inline-flex items-center gap-1.5 text-[#6B7280] transition-colors hover:text-[#111827] dark:text-[#AFB6C0] dark:hover:text-[#ECEFF3]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All briefs
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-3">
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
                      onEditFields={handleEditMany}
                      saving={saving}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {hasCreatives && (
                <>
                  {SHOW_RUN_PICKER && (
                    <RunPicker
                      history={history}
                      value={viewRun}
                      onChange={setViewRun}
                      currentCount={run?.pairs?.length || 0}
                      currentPending={isViewingPast ? 0 : run?.pending || 0}
                    />
                  )}
                  <CreativePreview
                    run={viewedRun}
                    callToAction={ctaLabel}
                    ratio={brief.delivery?.ratios?.[0] || '4:5'}
                    onRegenerate={handleGenerate}
                    onContinue={handleWantSchedule}
                    shipping={publishing}
                    regenerating={generating}
                    creditsHeld={isViewingPast ? null : (estimate?.total ?? null)}
                    estimate={isViewingPast ? null : (estimate?.total ?? null)}
                    readOnly={isViewingPast}
                    showActions={false}
                  />
                  {/* A live brief can still post a run by hand. Off by
                      default with SHOW_INLINE_SHIP — "See all generations" in
                      the rail is the way to it, on this screen too. */}
                  {SHOW_INLINE_SHIP && !isViewingPast && (
                    <ShipTheseAds
                      adCount={run?.pairs?.length || 0}
                      connection={connection}
                      onConnectionChange={setConnection}
                      objectiveLabel={objectiveLabel}
                      budget={budget}
                      onPublish={handlePublish}
                      publishing={publishing}
                      result={publishResult}
                      error={publishError}
                      onDismissResult={() => dispatch(clearPublishState())}
                      onClose={() => dispatch(clearPublishState())}
                    />
                  )}
                </>
              )}
              {/* The cadence and the three lifecycle controls. Until this existed
              a live brief could only be paused: the setup card renders before
              activation only, so there was no way to change the time, the
              frequency, or to stop. */}
              {scheduleOn && (
                <div ref={scheduleRef}>
                  <KeepTheseComing
                    enabled={scheduleOn}
                    onToggle={setScheduleOn}
                    frequency={cadence.frequency}
                    custom={cadence.custom}
                    startDate={cadence.startDate}
                    endDate={cadence.endDate}
                    alertEmails={brief.alertEmails}
                    onAlertEmailsChange={handleAlertEmailsChange}
                    onCadenceChange={handleCadenceChange}
                    onActivate={handleActivate}
                    activating={activating}
                    isMetaConnected={isConnectionComplete(connection)}
                    connection={connection}
                    onConnectionChange={setConnection}
                    pairsPerCycle={cadence.pairsPerCycle}
                    budget={budget}
                    onBudgetChange={(v) => dispatch(setPendingBudget(v))}
                    onBudgetCommit={persistBudget}
                    minBudget={MIN_DAILY_BUDGET_INR}
                    hour={cadence.hour}
                    timezone={cadence.timezone}
                    objectiveLabel={objectiveLabel}
                    creditsPerCycle={estimate?.total ?? null}
                    firstRunLabel={nextRunLabel}
                    activationError={activationError}
                    busy={pausing}
                  />
                </div>
              )}
              <SchedulePanel
                status={timeline?.summary?.status}
                frequency={cadence.frequency}
                hour={cadence.hour}
                timezone={cadence.timezone}
                pairsPerCycle={cadence.pairsPerCycle}
                custom={cadence.custom}
                startDate={cadence.startDate}
                endDate={cadence.endDate}
                alertEmails={brief.alertEmails}
                onAlertEmailsChange={handleAlertEmailsChange}
                nextRunAt={timeline?.summary?.nextRunAt}
                onCadenceChange={handleCadenceChange}
                onScheduleUpdate={handleScheduleUpdate}
                onPause={() => handlePause(true)}
                onResume={() => handlePause(false)}
                onStop={handleStop}
                onRestartSetup={handleWantSchedule}
                restartSetupOpen={scheduleOn}
                onRunNow={handleRunNow}
                runningNow={runningNow}
                runNowQueued={runNowQueued}
                busy={pausing}
                saving={saving}
                // Only when the server tried and the job refused — `applied: true`
                // and `null` both mean the screen is telling the truth.
                syncWarning={jobSync && jobSync.applied === false ? jobSync.reason : ''}
              />
              <RunTimeline
                summary={timeline?.summary}
                rows={timeline?.rows}
                loading={timeline?.loading}
                onRetry={handleGenerate}
                brandName={brief.brand?.name}
                pairsPerCycle={cadence.pairsPerCycle}
              />
            </div>
            {sidebar}
          </div>
        </div>
      )}

      {/* Every ad this brief has made, across every run, with any selection of
          them postable in one press through the SAME "Ship these ads" form the
          preview screen uses. Mounted at the page root rather than inside a
          step, so the rail's button works from the brief screen and deliveries
          alike. */}
      <RunGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        runs={galleryRuns}
        ratio={brief?.delivery?.ratios?.[0] || '4:5'}
        callToAction={ctaLabel}
        brandName={brief?.brand?.name}
        linkUrl={brief?.offer?.cta?.url || brief?.source?.url || ''}
        connection={connection}
        onConnectionChange={setConnection}
        onPublish={handlePublish}
        publishing={publishing}
        publishResult={publishResult}
        publishError={publishError}
        onDismissResult={() => dispatch(clearPublishState())}
      />

      <Dialog open={!!deletingBrief} onOpenChange={(open) => !open && setDeletingBrief(null)}>
        <DialogContent className="animate-in zoom-in-95 max-w-sm border border-[#E5E7EB] bg-white text-gray-900 shadow-lg duration-150 dark:border-[#2E353E] dark:bg-[#14181D] dark:text-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">
              Delete brief?
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 dark:text-[#8B939E]">
              Are you sure you want to delete “{deletingBrief?.label}”? This removes the brief and
              its ads setup.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex justify-end gap-2 text-sm font-medium">
            <button
              type="button"
              onClick={() => setDeletingBrief(null)}
              className="rounded-md border border-[#E5E7EB] bg-gray-50 px-4 py-2 hover:bg-gray-100 dark:border-[#2E353E] dark:bg-[#1E232A] dark:hover:bg-[#2E353E]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (deletingBrief) {
                  dispatch(removeBrief(deletingBrief.id));
                  setDeletingBrief(null);
                }
              }}
              className="bg-red-650 rounded-md px-4 py-2 text-white hover:bg-red-700 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
