import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
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
import CreativePreview from '@/components/AdFactory/v2/CreativePreview';
import BriefFailed from '@/components/AdFactory/v2/BriefFailed';
import BriefList from '@/components/AdFactory/v2/BriefList';
import RunPicker, { CURRENT } from '@/components/AdFactory/v2/RunPicker';
import RunTimeline from '@/components/AdFactory/v2/RunTimeline';
import SchedulePanel from '@/components/AdFactory/v2/SchedulePanel';
import KeepTheseComing from '@/components/AdFactory/v2/KeepTheseComing';
import ShipTheseAds from '@/components/AdFactory/v2/ShipTheseAds';
import {
  emptyConnection,
  isConnectionComplete,
} from '@/components/AdFactory/v2/LaunchConnection';
import { Notice, PrimaryBtn } from '@/components/AdFactory/v2/Panel';
import {
  BTN_LINK,
  CARD,
  CONTROL_H,
  FAINT,
  FOCUS_WITHIN,
  LABEL,
  MUTED,
  NUM,
  PLACEHOLDER,
  VALUE,
} from '@/components/AdFactory/v2/_tokens';
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
  const [shipOn, setShipOn] = useState(false);
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
    return { status: 'success', pairs: past.pairs || [], pending: 0, failed: 0, requested: past.adCount };
  }, [viewRun, run, history]);

  // Starting a new run always snaps back to it; watching a two-minute
  // generation from inside last week's batch is not what anyone means by
  // pressing Regenerate.
  const isViewingPast = viewRun !== CURRENT;

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
  const budget = useMemo(
    () => {
      if (pendingBudget !== '' && pendingBudget != null) return pendingBudget;
      const saved = brief?.delivery?.budget?.daily;
      const savedNumber = Number(saved);
      if (
        Number.isFinite(savedNumber)
        && savedNumber > 0
        && savedNumber < MIN_DAILY_BUDGET_INR
      ) {
        return MIN_DAILY_BUDGET_INR;
      }
      return saved ?? '';
    },
    [brief, pendingBudget],
  );

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
      }),
    );
    return dispatch(
      saveBriefEdits({
        briefId,
        patch: { delivery: { budget: { daily, currency: 'INR' } } },
      }),
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
    [dispatch, briefId],
  );

  const handleGenerate = useCallback(async () => {
    if (!briefId) return;
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
    [searchParams, setSearchParams],
  );

  // Deleting takes the campaign with it, so it is worth one question. The
  // server refuses outright if an automation is still delivering.
  const handleDeleteBrief = useCallback(
    (id, label) => {
      setDeletingBrief({ id, label });
    },
    [],
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
    setShipOn(false);
    setScheduleOn(true);
    requestAnimationFrame(() => {
      scheduleRef.current?.scrollIntoView({
        behavior: M.reduce ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }, [M.reduce]);

  // Opening one closes the other. Scrolls for the same reason the schedule
  // card does: summoning something below the fold looks like nothing happened.
  const shipRef = useRef(null);
  const handleWantShip = useCallback(() => {
    setScheduleOn(false);
    setShipOn(true);
    requestAnimationFrame(() => {
      shipRef.current?.scrollIntoView({
        behavior: M.reduce ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }, [M.reduce]);

  const handlePublish = useCallback(
    ({ mode, campaignId, adSetId }) => {
      if (!briefId) return;
      dispatch(publishNow({ briefId, connection, mode, campaignId, adSetId }));
    },
    [dispatch, briefId, connection],
  );

  const handlePause = useCallback(
    (paused) => {
      if (!brief?.jobId) return;
      dispatch(setAutomationPaused({ jobId: brief.jobId, paused }));
    },
    [dispatch, brief?.jobId],
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
        dispatch(applyLocalEdit({ section: 'delivery', field: 'pairsPerCycle', value: pairsPerCycle }));
      }

      dispatch(saveBriefEdits({ briefId, patch: { delivery: patch } }));
    },
    [dispatch, briefId, brief?.delivery?.frequency],
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
        dispatch(applyLocalEdit({ section: 'delivery', field: 'pairsPerCycle', value: pairsPerCycle }));
      }

      patch.alertEmails = emails;
      dispatch(applyLocalEdit({ field: 'alertEmails', value: emails }));
      const result = await dispatch(saveBriefEdits({ briefId, patch }));
      if (saveBriefEdits.fulfilled.match(result)) {
        dispatch(fetchTimeline(briefId));
      }
    },
    [dispatch, briefId, brief?.delivery?.frequency],
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
    ],
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
      }),
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
    [dispatch, briefId],
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

  const budgetNumber = Number(budget);
  const budgetTooLow =
    Number.isFinite(budgetNumber) && budgetNumber > 0 && budgetNumber < MIN_DAILY_BUDGET_INR;
  const canGenerate = Number.isFinite(budgetNumber) && budgetNumber >= MIN_DAILY_BUDGET_INR;

  // ── Render ────────────────────────────────────────────────────────────────
  // No header here: the page title comes from TopHeader and the mode switch is
  // owned by AdFactoryPage, so both modes share exactly one of each.
  return (
    <div className="relative isolate flex h-full w-full flex-col gap-5 overflow-y-auto pt-2 pb-10">
      {/* The same background Full control uses — one Ad Factory, one backdrop.
          Mounted per-surface, which is the pattern every v1 screen already
          follows (NoCompaignScreen, StartForm, NodeModal all mount their own).
          It is `fixed`, so it stays put while this column scrolls.

          The wrapper is load-bearing, not tidiness. AdFactoryBgEffect's own
          elements are `fixed z-0`, and a POSITIONED element at z-0 paints above
          non-positioned content regardless of document order — so the blue
          gradient and the bottom-effect SVG were being drawn ON TOP of every
          card on this page. The cards are solid #14181D; they only looked
          washed out and semi-transparent because a full-opacity glow was
          sitting over them.

          A positioned wrapper with a negative z-index makes its own stacking
          context and pulls the fixed children into it, putting the whole
          backdrop behind the content. Wrapping here rather than editing
          AdFactoryBgEffect keeps v1 — which mounts the same component into
          differently stacked screens — untouched.

          `isolate` on the page root above is the other half. Without it the
          negative z-index would resolve against the ROOT stacking context and
          the glow would paint behind `.layout_container`'s light-mode
          background — visible in dark, gone in light. Isolating scopes it to
          this page, so both themes keep the backdrop they had. */}
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <AdFactoryBgEffect />
      </div>

      {error && !(hasCreatives && scheduleOn) && (
        <div className="mx-auto w-full max-w-375 px-4 2xl:px-8">
          <Notice tone="warn" icon={AlertCircle}>
            <span className="flex flex-col items-start gap-1">
              <span>{error}</span>
              {errorCode === 'NO_BASE_PLAN' ? (
                // The trial user's first real moment. An upgrade path, not a
                // dead end.
                <a
                  href="/pricing"
                  className={BTN_LINK}
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
            className="inline-flex items-center gap-1.5 text-13 text-[#6B7280] transition-colors hover:text-[#111827] dark:text-[#AFB6C0] dark:hover:text-[#ECEFF3]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All briefs
          </button>
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
                  onEditFields={handleEditMany}
                  saving={saving}
                  estimate={estimate}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Before the first run: the budget and one button. This is the only
              thing standing between a read page and ads, and it is input 2 of
              2 — normally already answered on the wait screen.

              One bar, one row, controls aligned on a baseline: what it costs
              per day, what this press costs once, and the press. It used to be
              a two-column card with a stacked caption under the input and an
              uppercase micro-label over every value, which put four
              differently-sized pieces of type around a single button. */}
          {!generating && !hasCreatives && (
            <div className={`flex flex-wrap items-end gap-x-8 gap-y-4 ${CARD} px-5 py-4`}>
              <div className="flex flex-col gap-2">
                <span className={LABEL}>Daily budget</span>
                <div
                  className={`flex ${CONTROL_H} w-40 items-center gap-1.5 rounded-lg border bg-white px-3 ${FOCUS_WITHIN} dark:bg-[#1E232A] ${canGenerate
                    ? 'border-[#E5E7EB] dark:border-[#2E353E]'
                    : 'border-[#F59E0B]/45 dark:border-[#F59E0B]/35'
                    }`}
                >
                  <span className={FAINT}>₹</span>
                  <input
                    type="number"
                    min={MIN_DAILY_BUDGET_INR}
                    inputMode="numeric"
                    value={budget ?? ''}
                    onChange={(e) => dispatch(setPendingBudget(e.target.value))}
                    onBlur={persistBudget}
                    placeholder="800"
                    className={`w-full min-w-0 bg-transparent outline-none ${VALUE} ${PLACEHOLDER} ${NUM}`}
                  />
                  <span className={`shrink-0 ${FAINT}`}>/day</span>
                </div>
                {budgetTooLow && (
                  <span className="text-[11px] font-medium text-[#F59E0B]">
                    Minimum ₹{MIN_DAILY_BUDGET_INR}/day
                  </span>
                )}
              </div>

              {/* What this click costs, BEFORE it is clicked.
                  The estimate has been served with the brief all along and was
                  only rendered once generation had already started — which is
                  the one moment it is too late to be useful. Priced by the same
                  projection the freeze uses, so the quote and the charge cannot
                  disagree; `null` means unpriceable, and we say nothing rather
                  than imply it is free. */}
              {estimate?.total != null && (
                <div className="flex flex-col gap-2">
                  <span className={LABEL}>This run costs</span>
                  <span className={`flex ${CONTROL_H} items-baseline gap-2`}>
                    <span
                      className={`text-[17px] font-semibold tracking-[-0.017em] text-[#111827] dark:text-[#ECEFF3] ${NUM}`}
                    >
                      {estimate.total}
                    </span>
                    <span className={MUTED}>
                      credits
                      {estimate.counts
                        ? ` · ${estimate.counts.image} images + ${estimate.counts.text} copies`
                        : ''}
                    </span>
                  </span>
                </div>
              )}

              <span className="grow" />

              <div className="flex flex-col items-end gap-2">
                <span className={FAINT}>Nothing spends until you start deliveries.</span>
                <PrimaryBtn onClick={handleGenerate} disabled={!canGenerate} busy={saving}>
                  Generate ads
                </PrimaryBtn>
              </div>
            </div>
          )}

          <RunPicker
            history={history}
            value={viewRun}
            onChange={setViewRun}
            currentCount={run?.pairs?.length || 0}
            currentPending={isViewingPast ? 0 : run?.pending || 0}
          />

          <CreativePreview
            run={viewedRun}
            callToAction={ctaLabel}
            ratio={brief.delivery?.ratios?.[0] || '4:5'}
            onRegenerate={handleGenerate}
            onContinue={handleWantSchedule}
            onShip={isViewingPast ? undefined : handleWantShip}
            shipping={publishing}
            regenerating={generating}
            creditsHeld={isViewingPast ? null : estimate?.total ?? null}
            estimate={isViewingPast ? null : estimate?.total ?? null}
            readOnly={isViewingPast}
          />

          {/* The manual half — post the ads on screen, once. Rendered only
              when asked for, from the preview strip's own button, and never
              alongside the schedule card. */}
          {hasCreatives && shipOn && (
            <div ref={shipRef}>
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
                onDismissResult={() => {
                  setShipOn(false);
                  dispatch(clearPublishState());
                }}
                onClose={() => {
                  setShipOn(false);
                  dispatch(clearPublishState());
                }}
              />
            </div>
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
                hour={cadence.hour}
                timezone={cadence.timezone}
                objectiveLabel={objectiveLabel}
                creditsPerCycle={estimate?.total ?? null}
                firstRunLabel={nextRunLabel}
                activationError={activationError}
                status={brief?.status === 'live' || brief?.jobId ? (timeline?.summary?.status || (brief?.status === 'paused' ? 'paused' : 'active')) : brief?.status}
                onPause={() => handlePause(true)}
                onResume={() => handlePause(false)}
                onStop={handleStop}
                busy={pausing}
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
                  onEditFields={handleEditMany}
                  saving={saving}
                  estimate={estimate}
                />
              </motion.div>
            )}
          </AnimatePresence>
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
      )}

      <Dialog open={!!deletingBrief} onOpenChange={(open) => !open && setDeletingBrief(null)}>
        <DialogContent className="max-w-sm border border-[#E5E7EB] bg-white text-gray-900 shadow-lg dark:border-[#2E353E] dark:bg-[#14181D] dark:text-white animate-in zoom-in-95 duration-150">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">Delete brief?</DialogTitle>
            <DialogDescription className="text-sm text-gray-500 dark:text-[#8B939E]">
              Are you sure you want to delete “{deletingBrief?.label}”? This removes the brief and its ads setup.
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
              className="rounded-md bg-red-650 px-4 py-2 text-white hover:bg-red-700 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
