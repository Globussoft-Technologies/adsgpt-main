import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
// The BrandIQ onboarding dialog previously rendered here. It is kept, not
// deleted, until the new creative-studio flow (setup → thinking → brand
// profile) is complete and this route is confirmed as its home.
// import OnBoardBrandDialog from '../BrandIQ/Actions/OnBoardBrandDialog';
import BrandSetup from '../BrandSetup/BrandSetup';
import Workspace from '../BrandSetup/Workspace';
import ClipView from '../BrandSetup/ClipView';
import { toMediaUrl } from '../BrandSetup/ImageEditPanel';
import {
  readRun,
  rememberRun,
  clearRun,
  rememberClipBoard,
  readClipBoard,
  clearClipBoard,
  readEdits,
  rememberEdits,
} from '../BrandSetup/runStorage';
// Dropped entirely from a production bundle — `import.meta.env.DEV` is a
// literal `false` there, so the branch below and this import go with it.
import DevSessionSwitcher from '../BrandSetup/DevSessionSwitcher';
import { initSocket } from '@/store/reducers/socket/socketSlice';
import {
  runStarted,
  runAccepted,
  runResumed,
  runResolved,
  runFailed,
  jobEvent,
  videoStarted,
  videoAccepted,
  videoRejected,
  videoLoaderReady,
  videosHydrated,
  resetRun,
} from '@/store/reducers/brandSetup/brandSetupSlice';
import {
  getOnboardingJob,
  getOnboardingContext,
  getOnboardingSession,
  getJobStatus,
  loadMoreTemplates,
  refreshTemplates,
  generateVideo,
  buildVideoLoader,
  getOnboardingEligibility,
  exitOnboarding,
  skipOnboardingWithoutSession,
} from '@/apis/onboarding/onboardingApi';

/**
 * Host for the creative-studio onboarding flow.
 *
 *   setup      the form, over video
 *   thinking   the form lifts away, the reasoning stack rises in its place
 *   workspace  the brand profile, and the rails that come next
 *
 * setup → thinking happens INSIDE BrandSetup, so the video never blinks and it
 * reads as one surface changing its mind. thinking → workspace is a real change
 * of screen and unmounts it.
 *
 * ── Resume ───────────────────────────────────────────────────────────────
 * A run can only be paid for once, so a reload must never drop the user back on
 * an empty form. BrandSetup writes {jobId, sessionId} to storage the instant the
 * 202 lands; on mount this component reads them back and rejoins:
 *
 *   finished  → straight to the workspace, brand loaded from GET /context/:id
 *   running   → back to the stack, current state from GET /jobs/:id, live
 *               events continuing over the socket as before
 *
 * The steps that streamed before the reload are gone — they were live-only —
 * so the stack resumes from wherever the job is now rather than replaying a
 * history it never saw.
 */
// How often the workspace re-reads the session, and for how long. Frames take
// tens of seconds; the ceiling is there so a failed image job cannot leave this
// tab polling forever.
const POLL_EVERY_MS = 4000;

// "Start over" is a testing control. Shown only when the onboarding guard is
// switched off (`VITE_ONBOARDING_GUARD_OFF=true`, the same flag
// `pages/OnBoard/OnboardingRoute.jsx` reads) — i.e. dev/QA builds where anyone
// can re-run onboarding. Production keeps it hidden.
const START_OVER_ENABLED = String(import.meta.env.VITE_ONBOARDING_GUARD_OFF) === 'true';
const POLL_MAX_MS = 5 * 60 * 1000;

// ── How many failed reads in a row before we say something ────────────────
//
// Counted in READS, not seconds, because the two polls tick at different
// rates (3s while thinking, 4s in the workspace) and the honest threshold is
// "several attempts in a row", not a wall-clock figure.
//
// Five is roughly fifteen seconds. Short enough that a user is not left
// wondering, long enough that a redeploy or one dropped request passes
// unnoticed — which is the whole reason the old code ignored failures.
const OFFLINE_AFTER = 5;

// Forty is about two minutes. A brand run takes thirty to sixty seconds, so a
// backend that has been unreachable for twice that is not coming back inside
// this user's patience. Only the thinking phase gives up at this point: the
// workspace already has the brand profile on screen and nothing to give up on.
const GIVE_UP_AFTER = 40;

/** True when a storyboards result carries at least one drawn, renderable frame. */
const hasReadyFrame = (result) =>
  (result?.storyboards || []).some((b) =>
    (b.images || []).some((i) => i.status === 'ready' && i.src)
  );

/**
 * One rail, from the two places that can describe it.
 *
 * `session` is the durable read; `live` is the last socket `done` event. The
 * naive merge was `{...session, ...live}`, and that is what kept the frames off
 * the screen: `storyboard.generate` finishes when the SCRIPTS are written, so
 * its terminal event carries boards with no pictures — and spreading it over
 * the session REPLACED a polled result that already had them. The images only
 * appeared on reload, because a reload has no live event to lose to.
 *
 * So the status comes from whichever is newer, and the RESULT is whichever one
 * actually has frames. Nothing that has been drawn is ever thrown away.
 */
/**
 * Re-runs template matching whenever an existing session is (re)opened —
 * a reload, a resume, or coming back after a skip. Upstream's media links
 * rotate, so the stored list is refreshed rather than trusted. Fire-and-forget:
 * the new list arrives on the socket and replaces the old one in place.
 * NOT called for a fresh run — Node's chain already fires templates then.
 */
const kickTemplateRefresh = (sessionId) => {
  if (!sessionId) return;
  refreshTemplates(sessionId).catch(() => {
    // The stored list stays on screen; a failed refresh is not worth a banner.
  });
};

const mergeRail = (session = {}, live = {}) => {
  if (!live.status) return session;
  const merged = { ...session, ...live };
  const keepSession = hasReadyFrame(session.result) && !hasReadyFrame(live.result);
  merged.result = keepSession ? session.result : live.result || session.result || null;
  return merged;
};

/**
 * The one thing that can be said when the backend is unreachable.
 *
 * Deliberately not an error screen. The run continues server-side while this is
 * up — Python keeps working and the session keeps its state — so replacing the
 * page with a failure would be a lie that also throws away everything already
 * on screen. A strip that admits the problem and keeps the content is the
 * truthful version, and it disappears by itself the moment a read succeeds.
 */
function ConnectionLostBanner() {
  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 px-4 py-1.5 text-[12px] font-medium text-amber-100"
      style={{ background: 'rgba(120,53,15,0.92)' }}
      role="status"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" className="shrink-0 animate-spin" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" stroke="rgba(255,255,255,0.25)" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" strokeWidth="3" strokeLinecap="round" stroke="rgba(255,255,255,0.8)" />
      </svg>
      Can&rsquo;t reach the server — still trying. Your work is saved.
    </div>
  );
}

const OnBoardHome = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const run = useSelector((state) => state.brandSetup);
  const [phase, setPhase] = useState('booting'); // booting | setup | thinking | workspace | clip
  // Which concept the clip view is showing. A phase rather than a route: this
  // is the same session one level down, and a route would mean re-reading the
  // whole session on every open and back.
  const [clipBoardId, setClipBoardId] = useState('');
  // Boards a recreate invented, by key. Kept separate from the session's own
  // storyboards because they are not storyboards — they are only ever looked up
  // when the clip view needs a heading for a render that has no concept behind
  // it. Client-side and not persisted: the RENDER is on the session (Node wrote
  // it with `markBoardStarted`), and this is just its label.
  const [recreateBoards, setRecreateBoards] = useState({});
  // Image edits saved on the clip screen, by id (`edit:<ms>`). Each is its own
  // card in the strip, after the render it came from. Unlike `recreateBoards`
  // these ARE persisted (runStorage `rememberEdits`): an edit has no server-side
  // render to hydrate from, so without it a reload would silently drop it from
  // the strip. Lazily seeded from the remembered run so a reload straight onto
  // an edited card finds it on the first paint.
  const [edits, setEdits] = useState(() => readEdits(readRun()?.sessionId));
  // The full session document — brand, templates, storyboards, videos. Held
  // separately from `run.result`, which is the brand context alone and cannot
  // describe the other rails no matter how well they completed.
  const [session, setSession] = useState(null);
  const settleTimer = useRef(null);

  // ── Is the backend reachable? ────────────────────────────────────────────
  //
  // Nothing on the server can answer this: a server that is down cannot report
  // that it is down. The only evidence is the client's own requests failing,
  // repeatedly, so both polls below count consecutive failures into this.
  //
  // One failed read means nothing — a dropped packet, a redeploy mid-flight —
  // which is why the old silent `catch` was right to ignore it. What it got
  // wrong was never distinguishing that from a backend that has been gone for
  // two minutes, so the screen shimmered for ever either way.
  const [offline, setOffline] = useState(false);
  const failStreak = useRef(0);

  // Every read that fails passes through here; every read that succeeds clears
  // it. Returns true once the run should be given up on entirely.
  const noteReadFailure = () => {
    failStreak.current += 1;
    if (failStreak.current >= OFFLINE_AFTER) setOffline(true);
    return failStreak.current >= GIVE_UP_AFTER;
  };

  const noteReadSuccess = () => {
    failStreak.current = 0;
    // Self-healing on purpose: the work continued server-side the whole time,
    // so a backend that comes back should simply resume the screen rather than
    // leave the user on an error for something that fixed itself.
    setOffline((was) => (was ? false : was));
  };

  // This route is mounted OUTSIDE RunBackLog (see routes/router.jsx — it has to
  // be, or AuthWrapper bounces an already-onboarded user away mid-render). That
  // is also the only place `initSocket` is dispatched, so without this the
  // socket never opens here and the stack would sit empty forever.
  // `initSocket` no-ops when a socket already exists, so this is safe.
  useEffect(() => {
    dispatch(initSocket(import.meta.env.VITE_SOCKET_URL));
  }, [dispatch]);

  // ── resume, once, on mount ───────────────────────────────────────────────
  //
  // `localStorage` is a CACHE here, not the truth. It saves a round trip on a
  // fast reload, and that is all it is trusted for: it cannot survive a cleared
  // browser, a second device, or a phone opened mid-run, and in each of those
  // the user's session used to become unreachable while the server knew about
  // it the whole time. When it is empty — or when the offer bar sent us here
  // with an explicit `?session=` — the server decides where to land.
  useEffect(() => {
    let cancelled = false;
    // The bar hands us the session it owes the user. It outranks storage: this
    // tab may hold a pointer to some other, later run.
    const requested = new URLSearchParams(window.location.search).get('session');
    const stored = requested ? null : readRun();

    if (!stored) {
      (async () => {
        const el = await getOnboardingEligibility();
        if (cancelled) return;

        const sessionId = requested || el?.resumeSessionId;
        // Genuinely nothing to come back to. The form is the right answer, and
        // it is also the answer for a brand-new user.
        if (!sessionId || el?.resumePhase === 'setup') {
          setPhase('setup');
          return;
        }

        try {
          // The same path the dev switcher uses — it already reads the session,
          // resolves the context and repopulates the store. Resuming from the
          // server was always one call away; nothing was wired to make it.
          await openExistingSession(
            sessionId,
            el.resumePhase === 'clip' && el.resumeBoardId ? 'clip' : 'board',
            el.resumeBoardId
          );
        } catch {
          if (!cancelled) setPhase('setup');
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const snapshot = await getOnboardingJob(stored.jobId);
        if (cancelled) return;

        if (snapshot?.status === 'succeeded') {
          // The context read is authoritative; the job's own copy may be a
          // slimmer projection depending on which path finished it.
          const context = await getOnboardingContext(stored.sessionId).catch(() => snapshot.result);
          if (cancelled) return;
          dispatch(runResumed({ ...stored, status: 'succeeded' }));
          dispatch(runResolved(context));
          kickTemplateRefresh(stored.sessionId);

          // A remembered clip screen wins over the workspace. This is what
          // brings the user back where they were after the Facebook OAuth
          // redirect — the session read that fills in the clip is the poll
          // effect below, which runs for this phase too.
          const clipBoard = readClipBoard();
          if (clipBoard) {
            setClipBoardId(clipBoard);
            setPhase('clip');
            return;
          }

          setPhase('workspace');
          return;
        }

        if (snapshot?.status === 'failed' || snapshot?.status === 'cancelled') {
          // Nothing to rejoin and nothing to show. Let them start over rather
          // than stranding them on a dead run.
          clearRun();
          setPhase('setup');
          return;
        }

        // Python's snapshot says WHETHER the job finished; it carries no
        // progress at all. Node's own row does — the SSE bridge writes stage,
        // message and percent to it as the stream arrives — so a resumed run
        // picks up where it actually is rather than on a blank card.
        const node = await getJobStatus(stored.jobId).catch(() => null);
        if (cancelled) return;

        dispatch(
          runResumed({
            ...stored,
            status: 'running',
            percent: node?.progress?.percent,
            stage: node?.progress?.stage,
            message:
              node?.progress?.message || 'Rejoining your run — this picks up where it left off.',
          })
        );
        setPhase('thinking');
      } catch {
        // The job is unreadable — expired, deleted, or belongs to someone else
        // now. A stale pointer must not block the form.
        if (cancelled) return;
        clearRun();
        setPhase('setup');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // ── the safety net ───────────────────────────────────────────────────────
  //
  // The live channel is the SSE bridge on Node, and it is not guaranteed. It
  // dies with a `pm2 restart`, it has already finished if the job completed
  // before this tab reloaded, and a socket that falls back to long-polling can
  // miss the window entirely. None of that stops the WORK — Python finishes and
  // persists regardless — so the only thing at risk is our knowing about it.
  //
  // A slow poll closes that hole. It is not the progress mechanism; it is the
  // backstop that guarantees a finished run is never left on screen as a
  // spinner. It stops the moment the job is terminal, or the socket beats it.
  useEffect(() => {
    if (phase !== 'thinking' || run.status !== 'running' || !run.jobId) return undefined;

    let cancelled = false;
    const id = setInterval(async () => {
      try {
        // Node's row, not Python's snapshot: this one carries progress, so a
        // run with a dead socket still advances on screen instead of sitting
        // on one card until it finishes.
        const node = await getJobStatus(run.jobId, run.percent ? undefined : 0);
        // Reached the server, whatever it said. A 204 is a healthy answer.
        noteReadSuccess();
        if (cancelled || !node) return; // 204 — nothing newer than we have

        if (node.status === 'succeeded') {
          const context = await getOnboardingContext(run.sessionId).catch(() => node.result);
          if (!cancelled) dispatch(runResolved(context));
          return;
        }
        if (node.status === 'failed' || node.status === 'cancelled') {
          if (!cancelled) dispatch(runFailed(node.error || 'The run did not finish.'));
          return;
        }
        // Still running: feed the progress in through the same reducer path the
        // socket uses, so there is one shape and one code path either way.
        if (node.progress?.message) {
          dispatch(
            jobEvent({ job_id: run.jobId, event: 'progress', seq: node.seq, data: node.progress })
          );
        }
      } catch {
        // A transient read failure is not a reason to give up on the run — but
        // a backend that has not answered in two minutes is. Counting is what
        // separates the two; ignoring both is what left this screen spinning
        // for ever with nothing to say.
        if (noteReadFailure() && !cancelled) {
          dispatch(
            runFailed(
              'We lost contact with the server. Your run may still have finished — reload to check.'
            )
          );
        }
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, run.status, run.jobId, run.sessionId, dispatch]);

  // ── done → workspace, after a beat ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'thinking' || run.status !== 'succeeded') return undefined;
    // The last card ("Your brand profile is ready") needs a moment to be read.
    // Cutting away the instant the event lands makes the finish feel like a
    // glitch rather than a conclusion.
    settleTimer.current = setTimeout(() => setPhase('workspace'), 1400);
    return () => clearTimeout(settleTimer.current);
  }, [phase, run.status]);

  // ── the rails ────────────────────────────────────────────────────────────
  //
  // Templates and storyboards are fired server-side the moment onboarding
  // succeeds, so by the time the workspace opens they are usually already done.
  // They are not in `run.result` — that is the brand context — so the workspace
  // reads them from the session document instead.
  //
  // Re-read while either rail is still working: both are chained jobs the user
  // never started from this tab, so there is no local event that says they
  // finished.
  //
  // ── Why a section status is not enough to stop on ──
  // `storyboards` goes `succeeded` when the SCRIPTS are written. The pictures
  // come from a second job (`storyboard.images.generate`) that runs after it and
  // writes back into the same section without moving its status. Stopping on
  // status alone therefore stopped polling at exactly the moment the frames were
  // still being drawn — the workspace showed voiceovers and empty boxes, and the
  // only way to see the images was to reload, which is what a reload was
  // secretly doing: one more read.
  //
  // So the poll also waits on the FRAMES themselves.
  //
  // And on renders started from THIS tab. By the time a user presses Generate
  // both rails are usually done, so the poll has already stopped — and nothing
  // restarted it, leaving the clip to arrive only on the socket. A frame that
  // carried an unresolved link then showed a 0:00 player that only a reload
  // fixed. Keyed on which boards are rendering, so each Generate (and retry)
  // restarts the loop with a fresh deadline; `clipsPending` below keeps it going
  // until the server has the clip.
  const renderingBoardsKey = Object.entries(run.videos?.byBoard || {})
    .filter(([, v]) => v?.status === 'running')
    .map(([id]) => id)
    .sort()
    .join(',');

  useEffect(() => {
    // The clip view reads from the same session document — it is the recovery
    // path for a render whose socket dropped, and the only way a reload finds a
    // clip that landed while the tab was gone.
    if ((phase !== 'workspace' && phase !== 'clip') || !run.sessionId) return undefined;

    let cancelled = false;
    let timer;
    const deadline = Date.now() + POLL_MAX_MS;

    const load = async () => {
      // Decided in the try, in the catch, and acted on in the finally — so a
      // failure cannot silently end the loop.
      let keepPolling = false;
      try {
        const doc = await getOnboardingSession(run.sessionId);
        noteReadSuccess();
        if (cancelled) return;
        setSession(doc);
        // Stored clips win over whatever the tiles believe — see
        // `videosHydrated`. Cheap, and it is what makes a dropped socket
        // invisible.
        if (doc?.videos) dispatch(videosHydrated(doc.videos));
        // The same fold for recreates. They live in their own section
        // server-side — two different maps, two different status derivations —
        // but the browser keeps ONE `byBoard`, so both hydrate into it.
        if (doc?.recreates) dispatch(videosHydrated(doc.recreates));

        const sectionsPending = ['templates', 'storyboards'].some((k) =>
          ['queued', 'running'].includes(doc?.[k]?.status)
        );

        // Every board should end up with at least one ready frame. Until then
        // the run is not finished no matter what the section status says.
        const boards = doc?.storyboards?.result?.storyboards || [];
        const framesPending =
          boards.length > 0 &&
          boards.some((b) => !(b.images || []).some((i) => i.status === 'ready' && i.src));

        // A deadline, because the wait is now on data that can legitimately
        // never arrive — an image job that failed silently would otherwise have
        // this tab polling for the rest of the session.
        // A render in flight is its own reason to keep reading. It is the
        // slowest thing on this screen — the better part of a minute — and the
        // socket that normally reports it does not survive a deploy.
        // BOTH board-keyed sections, for the same reason the hydration above
        // folds both: a recreate renders exactly like a storyboard clip and is
        // just as slow, but it lives in its own section server-side. Reading
        // only `videos` meant a lone recreate — every other rail already
        // finished — counted as nothing pending, so the poll stopped while the
        // render it was waiting for was still going.
        const clipsPending = [doc?.videos?.boards, doc?.recreates?.boards].some((boards) =>
          Object.values(boards || {}).some((b) => b?.status === 'running')
        );

        keepPolling = (sectionsPending || framesPending || clipsPending) && Date.now() < deadline;
      } catch {
        // A failed read leaves the rails on their placeholders rather than
        // taking down a workspace whose brand profile is already correct — the
        // brand IS correct, and it is already on screen.
        //
        // What it must not do is stop. The reschedule used to live inside the
        // `try`, above, so the first failed read skipped it and the poll was
        // dead for good: a backend that came back thirty seconds later found
        // nobody asking, and only a page reload recovered. Now the decision to
        // keep going is made here too, and applied in `finally`.
        noteReadFailure();
        keepPolling = Date.now() < deadline;
      } finally {
        // One place that schedules the next read, reached from both the happy
        // and the failed path. This is the line whose absence froze the screen.
        if (!cancelled && keepPolling) timer = setTimeout(load, POLL_EVERY_MS);
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The module statuses are dependencies on purpose. A terminal socket event
    // for either rail restarts this effect, which re-reads the session AT ONCE
    // instead of waiting out the current four-second tick — and, because the
    // deadline is recomputed with it, gives the image job that follows the
    // script job a fresh window to be polled through. That second job is why a
    // rail going `succeeded` is not the end of the wait.
  }, [phase, run.sessionId, run.modulesSeq, renderingBoardsKey, dispatch]);

  /**
   * Generate — render one concept into a clip.
   *
   * Two calls, fired together and deliberately not chained: the render, and the
   * blurred placeholder built from that concept's own keyframes. The
   * placeholder is only needed twenty seconds in, but it is asked for NOW so it
   * is there when the sequence reaches it — and it is never awaited, because a
   * loader that fails or takes its time must not hold up the render or the
   * screen change.
   *
   * The view opens immediately, before either answers. The wait is what the
   * screen is for, so there is nothing to gain by spending the first second of
   * it on the workspace.
   */
  // `quote` is `{ maxWalletCredits }` when a split confirmation was shown. It
  // is passed straight through to billing, which refuses (409) rather than
  // charging more than the figure the user agreed to.
  //
  // Returns `{ priceChanged, quote }` on that refusal, so the caller can re-ask
  // with the real numbers. Nothing has been charged at that point, and nothing
  // about this render's state has moved — which is why the phase switch and the
  // optimistic dispatches below are undone for it.
  const startVideo = async (board, quote) => {
    // A storyboard's own id is `id`; `board_id` is what the video payloads call
    // the same value when they point back at it. The map here is keyed the
    // video contract's way, because that is what arrives on the socket.
    const boardId = board?.id;
    if (!boardId || !run.sessionId) return;

    const existing = run.videos?.byBoard?.[boardId];

    setClipBoardId(boardId);
    setPhase('clip');
    // So the Facebook OAuth round-trip comes back to THIS clip rather than to
    // the board — see `rememberClipBoard`.
    rememberClipBoard(boardId);

    // Already rendered, or already rendering. Opening the view is the whole of
    // what a click means here — asking again would be refused server-side
    // anyway, and paying for a second render is the one mistake this flow must
    // not make by accident.
    if (existing?.status === 'ready' || existing?.status === 'running') return;

    dispatch(videoStarted(boardId));

    buildVideoLoader(run.sessionId, boardId)
      .then((res) => {
        if (res?.ok) dispatch(videoLoaderReady({ boardId, loader: res.loader }));
      })
      // `ok: false` and a thrown request are the same thing here: no
      // placeholder, so the view keeps its own shimmer.
      .catch(() => {});

    try {
      const res = await generateVideo(run.sessionId, boardId, quote);
      if (res?.accepted) dispatch(videoAccepted({ boardId, jobId: res.jobId }));
      else dispatch(videoRejected({ boardId, reason: res?.reason, jobId: res?.jobId }));
    } catch (error) {
      // 409: the onboarding budget moved between the quote and the charge, so
      // the server took NOTHING. Not a failure of this render — it has not
      // started yet — so the board is put back the way it was and the caller
      // re-asks. Treating it as a rejection would leave a dead tile behind a
      // dialog the user is about to see again.
      if (error?.response?.status === 409) {
        dispatch(videoRejected({ boardId, reason: 'price_changed' }));
        setPhase('workspace');
        setClipBoardId('');
        return {
          priceChanged: true,
          quote: error?.response?.data?.quote,
        };
      }
      // 402 / 403: it cannot be paid for, so it never started. Handled exactly
      // like the quote above — put the board back and let the caller say so
      // WHERE THE USER IS. Previously this fell through to `videoRejected` on a
      // clip screen we had already navigated to, so the news arrived one screen
      // away from the board, from the plan, and from anything that could fix
      // it.
      if (error?.response?.status === 402 || error?.response?.status === 403) {
        dispatch(videoRejected({ boardId, reason: error?.response?.data?.reason || 'insufficient' }));
        setPhase('workspace');
        setClipBoardId('');
        clearClipBoard();
        return {
          insufficient: true,
          needsPlan: error?.response?.status === 403,
          // `{ total, allowance, walletNeeded, walletBalance }` when billing
          // could describe the gap — see `securePayment`. Absent for a refusal
          // that never got as far as pricing (no plan at all).
          shortfall: error?.response?.data?.shortfall,
        };
      }
      // Node answers a refusal with a `reason` even on the error statuses —
      // 501 when the deployment has no video generation, 502 when upstream is
      // not answering. Reading it back is what lets the tile say WHICH, rather
      // than telling everyone to try again including the people for whom that
      // cannot help.
      dispatch(
        videoRejected({
          boardId,
          reason:
            error?.response?.data?.reason ||
            (error?.response?.status === 501 ? 'not_configured' : 'error'),
        })
      );
    }
  };

  /**
   * A recreate has been accepted. Take the user to the SAME place a storyboard
   * render takes them.
   *
   * Everything after this point is the storyboard flow, reused as it stands:
   * `videoStarted`/`videoAccepted` register the job so the socket's frames find
   * a home, and the clip view renders whatever that board ends up holding. The
   * only new thing is the board itself, which is synthetic — a recreate has no
   * storyboard concept behind it, so one is made from the template.
   *
   * Called by the sheet with the 202 it got back.
   */
  const startRecreate = ({ jobId, boardId, kind, template }) => {
    if (!jobId || !boardId) return;

    setRecreateBoards((prev) => ({
      ...prev,
      [boardId]: {
        id: boardId,
        // What is being rendered, known from the 202 — BEFORE any result
        // arrives. The clip view needs it to choose a loading state, and the
        // result's own `mime_type` does not exist yet while that state is on
        // screen.
        kind: kind === 'image' ? 'image' : 'video',
        // What the clip view puts in its heading. A recreate's own words are
        // the template's, because that is all it has — and "Recreated ad" beats
        // an empty title or a raw id.
        title: template?.content_type || template?.video_kind_label || 'Recreated ad',
        angle: (template?.tags || template?.tone || []).slice(0, 2).join(' · '),
      },
    }));

    setClipBoardId(boardId);
    setPhase('clip');
    rememberClipBoard(boardId);

    dispatch(videoStarted(boardId));
    dispatch(videoAccepted({ boardId, jobId }));
  };

  /**
   * Open a concept's clip view WITHOUT starting anything.
   *
   * `startVideo` starts a render for any board that isn't ready or running —
   * including a FAILED one. Wiring the card's "open" affordances to it meant
   * Back to board → open a failed card silently fired a new render (and walked
   * straight past the retry UI). Opening is only ever this. Bug 2026-09-15.
   */
  // A different session (start over, the dev switcher) has different edits.
  useEffect(() => {
    if (run.sessionId) setEdits(readEdits(run.sessionId));
  }, [run.sessionId]);

  /**
   * An image edit was saved on the clip screen (ClipView → ImageEditPanel).
   *
   * It becomes the newest card and opens on the stage, the way a new image
   * lands at the front of MySpace. The source card is left exactly as it was,
   * so the original and every step after it stay one click away. Titles do not
   * stack "(edited)" when an edit is edited again.
   */
  const addEdit = (parentId, parentTitle, url, model) => {
    if (!url) return;
    const id = `edit:${Date.now()}`;
    const base = String(parentTitle || 'Your ad').replace(/ \(edited\)$/, '');
    setEdits((prev) => {
      const next = {
        ...prev,
        [id]: { id, parentId, src: url, title: `${base} (edited)`, model, at: Date.now() },
      };
      rememberEdits(run.sessionId, next);
      return next;
    });
    setClipBoardId(id);
    rememberClipBoard(id);
  };

  const openClip = (board) => {
    const boardId = board?.id;
    if (!boardId) return;
    setClipBoardId(boardId);
    setPhase('clip');
    rememberClipBoard(boardId);
  };

  /**
   * The header's "See your ads": the clip screen, on the NEWEST render.
   *
   * Newest by `startedAt` rather than by position in the map — insertion order
   * is whatever hydration happened to produce on a reload, and the user's idea
   * of "my latest ad" is the one they started last.
   *
   * Falls back to the newest render of ANY status, so a run that is still going
   * opens on itself rather than on an older finished clip. Only reachable once
   * something is ready, so the fallback is a safety net, not the normal case.
   */
  const viewLatestAd = () => {
    const entries = Object.entries(run.videos?.byBoard || {});
    if (!entries.length) return;
    const newest = (list) =>
      list.sort((a, b) => (Number(b[1]?.startedAt) || 0) - (Number(a[1]?.startedAt) || 0))[0];
    const ready = entries.filter(([, v]) => v?.status === 'ready');
    const pick = newest(ready.length ? ready : entries);
    if (!pick) return;
    setClipBoardId(pick[0]);
    setPhase('clip');
    rememberClipBoard(pick[0]);
  };

  /**
   * The next page of template recommendations.
   *
   * Upstream matches five per call and takes a cursor, so this is the same
   * trigger with `skip` moved along; Node folds the page into the stored list
   * and emits the whole thing, so nothing here has to merge anything.
   *
   * The session is re-read straight after acceptance rather than waiting for
   * the socket, because the only local signal that the request landed is the
   * section going `queued` — and that is what puts the rail's spinner up.
   */
  const requestMoreTemplates = async () => {
    if (!run.sessionId) return false;
    const { accepted } = (await loadMoreTemplates(run.sessionId)) || {};
    // Returned so the dock can drop its spinner at once when the server
    // declines — otherwise it waited for a page that was never coming.
    if (!accepted) return false;
    try {
      const doc = await getOnboardingSession(run.sessionId);
      setSession(doc);
    } catch {
      // The page is still coming; the socket event will bring it. A failed
      // refresh costs the spinner, not the result.
    }
    return true;
  };

  /**
   * Open a session that already ran.
   *
   * No longer dev-only: this IS the resume path. The mount effect calls it with
   * the session the server named, and the dev switcher calls it with a pasted
   * id — same two reads, same order. The context is the brand profile, the
   * session document is the other two rails. It also writes the run to storage,
   * so a reload stays on the session that was opened rather than snapping back
   * to whichever one this browser last STARTED — which is what made switching
   * sessions feel broken the moment you refreshed.
   *
   * Throws on failure so the switcher can show why; it must not leave a half
   * loaded workspace on screen.
   */
  const openExistingSession = async (sessionId, view = 'board', preferBoardId = '') => {
    const doc = await getOnboardingSession(sessionId);
    // The context read is authoritative, but it proxies upstream and can fail
    // for a session whose upstream copy has aged out. The mirror's own copy of
    // the brand result is the fallback — stale by design, and still the right
    // thing to show over an error.
    const context = await getOnboardingContext(sessionId).catch(() => doc?.brand?.result || null);

    const jobId = doc?.brand?.jobId || '';
    if (jobId) rememberRun({ jobId, sessionId, status: 'succeeded', startedAt: Date.now() });

    dispatch(resetRun());
    dispatch(runResumed({ jobId, sessionId, status: 'succeeded' }));
    dispatch(runResolved(context));
    setSession(doc);
    kickTemplateRefresh(sessionId);

    // The clip view is a phase, not a route, so a resume has to reconstruct it
    // rather than navigate to it. Hydrating first is what makes it land on a
    // finished clip rather than an empty spinner.
    if (view === 'clip' && (doc?.videos || doc?.recreates)) {
      // Both sections, and in this order so neither can be missed. The poll
      // folds both into one `byBoard`; a resume that folded only `videos` left
      // a reloaded RECREATE with no entry at all — the screen opened on a board
      // the store had never heard of and sat on a spinner that nothing would
      // ever finish, because the only record of that render was in the section
      // this line skipped.
      if (doc?.videos) dispatch(videosHydrated(doc.videos));
      if (doc?.recreates) dispatch(videosHydrated(doc.recreates));
      // Whichever concept actually has a clip. Failing that, any board a render
      // was ever started for; failing that, the first concept — so the screen
      // still opens and shows its own state rather than silently doing nothing.
      const attempted = [
        ...Object.entries(doc.videos?.boards || {}),
        ...Object.entries(doc.recreates?.boards || {}),
      ];
      const withClip = attempted.find(([, entry]) => entry?.status === 'succeeded');
      const boardId =
        // The server said which board the user was on. It knows better than any
        // heuristic here, which can only guess from what finished.
        preferBoardId ||
        withClip?.[0] ||
        attempted[0]?.[0] ||
        (doc.storyboards?.result?.storyboards || [])[0]?.id ||
        '';
      if (boardId) {
        setClipBoardId(boardId);
        setPhase('clip');
        rememberClipBoard(boardId);
        return;
      }
    }

    setPhase('workspace');
  };

  /** BrandSetup hands back {jobId, sessionId, status, startedAt}. */
  const handleStarted = (accepted) => {
    dispatch(runStarted());
    dispatch(
      runAccepted({
        job_id: accepted.jobId,
        session_id: accepted.sessionId,
        status: accepted.status,
      })
    );
    setPhase('thinking');
  };

  const startOver = () => {
    clearClipBoard();
    clearRun();
    dispatch(resetRun());
    setPhase('setup');
  };

  /**
   * Leave onboarding early, from any phase.
   *
   * Distinct from Finish in exactly one consequence: the free render is still
   * unspent, so the offer bar stays up and comes back to THIS session rather
   * than starting a fresh one. Onboarding is never forced on the user again
   * either way.
   *
   * Deliberately does NOT `clearRun()`. Storage is only a fast-reload cache
   * now, but leaving the pointer in place means coming back through the bar
   * lands on this session without waiting for a round trip — and the server
   * would have said the same thing anyway.
   */
  const skipOnboarding = () => {
    // No session yet (skipped from the brand-setup form): record the per-user
    // flag directly, or the first-run redirect brings them back next login.
    if (run.sessionId) exitOnboarding(run.sessionId, 'skipped');
    else skipOnboardingWithoutSession();
    navigate('/adstudio');
  };

  /**
   * Leave having got a clip. `completed` retires the offer bar for good — no
   * free render is still owed. Shared by the clip view and the workspace's
   * "Go to dashboard". Not awaited: bookkeeping must not hold the user here.
   */
  const finishOnboarding = () => {
    if (run.sessionId) exitOnboarding(run.sessionId, 'completed');
    clearClipBoard();
    clearRun();
    navigate('/adstudio');
  };

  // A blank frame while storage is read. Rendering the form first and swapping
  // it out a moment later would show the one screen a returning user must not
  // see.
  // One instance, rendered beside whatever phase is on screen — it is `fixed`,
  // so it does not belong to any of them and must not unmount when they swap.
  // HIDE-MARK - dev session dropdown off. One line to restore: swap `null` for
  // the original ternary below. Every `{devSwitcher}` render site stays as it
  // is, so nothing else has to move.
  // Rendered beside whatever phase is on screen, exactly like `devSwitcher`:
  // it is `fixed`, so it belongs to none of them and must not unmount when
  // they swap.
  const connectionBanner = offline ? <ConnectionLostBanner /> : null;

  // Dev session switcher (the bottom-right "dev" pill): same gate as Start over,
  // `VITE_ONBOARDING_GUARD_OFF=true` (user decision 2026-09-15). Previously
  // `import.meta.env.DEV`, which showed it on every local dev server regardless
  // of the onboarding flag.
  const devSwitcher = START_OVER_ENABLED ? (
    <DevSessionSwitcher onOpen={openExistingSession} currentId={run.sessionId} />
  ) : null;

  if (phase === 'booting')
    return (
      <div className="min-h-screen bg-[#0A0A0C]">
        {connectionBanner}
        {devSwitcher}
      </div>
    );

  if (phase === 'clip') {
    const boards = session?.storyboards?.result?.storyboards || [];
    const boardIndex = boards.findIndex((b) => b?.id === clipBoardId);
    // A recreate has no storyboard behind it, so its board comes from the map
    // above. Looked up second, so a real concept always wins.
    const isRecreate = boardIndex < 0 && clipBoardId.startsWith('recreate:');
    // `recreateBoards` is client state and does not survive a reload, so a
    // resumed recreate gets a stand-in. The RENDER survives — it is on the
    // session — and this is only the heading above it.
    // An edit is shown through the same view as a finished image render: a
    // board that says "image", and a state that is already ready. Nothing in
    // ClipView needs to know it is an edit.
    const edit = edits[clipBoardId];
    const clipBoard = edit
      ? { id: edit.id, title: edit.title, kind: 'image' }
      : boardIndex >= 0
        ? boards[boardIndex]
        : recreateBoards[clipBoardId] ||
          (isRecreate ? { id: clipBoardId, title: 'Recreated ad' } : undefined);
    const clipState = edit
      ? {
          status: 'ready',
          video: { video: { src: toMediaUrl(edit.src), mime_type: 'image/png', model: edit.model } },
        }
      : run.videos?.byBoard?.[clipBoardId] || {};
    // What an edit was made from, for ClipView's before/after slider: another
    // edit, or the render it started from.
    const parentClip = edit && run.videos?.byBoard?.[edit.parentId]?.video?.video;
    const compareSrc = !edit
      ? ''
      : edits[edit.parentId]
        ? toMediaUrl(edits[edit.parentId].src)
        : parentClip?.src || parentClip?.url || parentClip?.local_url || '';
    /* Every render this session has produced, for the strip under the stage.
       ONE map holds both kinds — a storyboard clip and a template recreate are
       the same thing to the browser (see `videoAccepted`) — so this is simply
       everything in it, oldest first.

       In-flight renders are included deliberately: a card that is still going
       is the one the user is most curious about, and leaving it out made the
       strip disagree with the render they had just started. Sorted on
       `startedAt` so a card never changes place as others finish. */
    const stripItems = Object.entries(run.videos?.byBoard || {})
      .map(([id, st]) => {
        const concept = boards.find((b) => b?.id === id);
        const recreated = recreateBoards[id];
        const c = st?.video?.video || null;
        return {
          id,
          title:
            concept?.title ||
            recreated?.title ||
            (id.startsWith('recreate:') ? 'Recreated ad' : 'Your ad'),
          status: st?.status || 'running',
          src: c?.src || c?.url || '',
          poster: st?.poster || '',
          // The board's kind is the reliable read — `mime_type` is only there
          // once the render has landed, and the card exists before that.
          isImage:
            recreated?.kind === 'image' ||
            String(c?.mime_type || '').startsWith('image/'),
          // The SERVER's timestamp when there is one, this tab's clock only as
          // a fallback for a render started in this session that the server has
          // not written back yet. Sorting on `startedAt` alone put the strip in
          // map-iteration order after every reload.
          at: Number(st?.serverAt) || Number(st?.startedAt) || 0,
        };
      })
      // Edits join as cards of their own. Stamped when saved, so they sort in
      // after the render they came from — the newest one last, like any render.
      .concat(
        Object.values(edits).map((e) => ({
          id: e.id,
          title: e.title,
          status: 'ready',
          src: toMediaUrl(e.src),
          poster: '',
          isImage: true,
          at: Number(e.at) || 0,
        }))
      )
      .sort((a, b) => a.at - b.at);

    return (
      <>
        <ClipView
          board={clipBoard}
          index={boardIndex >= 0 ? boardIndex + 1 : 1}
          state={clipState}
          compareSrc={compareSrc}
          stripItems={stripItems}
          // Switching cards is the same move as opening one from the board:
          // remember it, so a reload comes back to the one being looked at.
          onSelectClip={(id) => {
            if (!id || id === clipBoardId) return;
            setClipBoardId(id);
            rememberClipBoard(id);
          }}
          // Return to the board without clearing the run or its render state.
          onBack={() => {
            clearClipBoard();
            setPhase('workspace');
          }}
          // A recreate cannot be retried from here: retrying it means the
          // sheet's form again — a product image and an instruction — which
          // this screen does not have. Passing nothing is what makes the view
          // offer "try another" instead of a Retry that could not work.
          onRetry={isRecreate ? undefined : () => startVideo(boards[boardIndex])}
          // HIDE-MARK - Start over: only when the onboarding guard is off.
          onStartOver={START_OVER_ENABLED ? startOver : undefined}
          // The exit. Onboarding ends here and the product begins.
          //
          // `completed` is what retires the offer bar for good — the user got
          // their clip, so there is no free render still owed. Not awaited:
          // they are already leaving, and bookkeeping must not hold them on a
          // screen they have finished with.
          onFinish={finishOnboarding}
          onSkip={skipOnboarding}
          onEdited={(url) =>
            addEdit(clipBoardId, clipBoard?.title, url, clipState?.video?.video?.model)
          }
        />
        {connectionBanner}
        {devSwitcher}
      </>
    );
  }

  if (phase === 'workspace') {
    return (
      <>
        <Workspace
          // The whole result, not just `context` — `source_urls` and the rest of
          // the provenance sit beside it, not inside it.
          result={run.result || {}}
          // The other two rails. Separate prop because they are separate modules
          // with their own status, not part of the brand result.
          // `session` is the durable snapshot/poll fallback. `run.modules` is
          // merged over it so a terminal webhook socket event repaints the rail
          // immediately, before the next four-second session read arrives.
          session={{
            ...(session || {}),
            templates: mergeRail(session?.templates, run.modules?.templates),
            storyboards: mergeRail(session?.storyboards, run.modules?.storyboards),
          }}
          // HIDE-MARK - Start over: only when the onboarding guard is off.
          onStartOver={START_OVER_ENABLED ? startOver : undefined}
          // Always available, from the workspace on. Leaving here costs the
          // user nothing: no render has been started, so no credits and no free
          // claim are in play.
          onSkip={skipOnboarding}
          onFinish={finishOnboarding}
          // Per concept. Opens the clip view and starts the render together —
          // see `startVideo`.
          onGenerateVideo={startVideo}
          // A recreate accepted in the sheet lands on the SAME clip screen a
          // storyboard render does — see `startRecreate`.
          onRecreateStarted={startRecreate}
          // View a concept's clip screen without starting a render.
          onOpenVideo={openClip}
          // The header shortcut back into everything they have made.
          onViewAds={viewLatestAd}
          videosByBoard={run.videos?.byBoard || {}}
          // Template matching runs once, for five, when the brand lands. This
          // asks for the next five. It answers 202 and nothing else — the page
          // itself arrives on the socket and is folded into the stored list
          // server-side, which is what bumps `modulesSeq` and re-reads here.
          onLoadMoreTemplates={requestMoreTemplates}
        />
        {connectionBanner}
        {devSwitcher}
      </>
    );
  }

  return (
    <>
      <BrandSetup
        onStarted={handleStarted}
        resumed={phase === 'thinking'}
        // A failed run backing out to the form. The phase has to follow, or the
        // next successful start would be judged against a stale 'thinking'.
        onFailedReset={() => setPhase('setup')}
        onSkip={skipOnboarding}
      />
      {connectionBanner}
        {devSwitcher}
    </>
  );
};

export default OnBoardHome;
