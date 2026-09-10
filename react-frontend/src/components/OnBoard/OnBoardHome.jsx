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
import {
  readRun,
  rememberRun,
  clearRun,
  rememberClipBoard,
  readClipBoard,
  clearClipBoard,
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
  generateVideo,
  buildVideoLoader,
  getOnboardingEligibility,
  exitOnboarding,
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
        const clipsPending = Object.values(doc?.videos?.boards || {}).some(
          (b) => b?.status === 'running'
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
  }, [phase, run.sessionId, run.modulesSeq, dispatch]);

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
  const startVideo = async (board) => {
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
      const res = await generateVideo(run.sessionId, boardId);
      if (res?.accepted) dispatch(videoAccepted({ boardId, jobId: res.jobId }));
      else dispatch(videoRejected({ boardId, reason: res?.reason, jobId: res?.jobId }));
    } catch (error) {
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
    if (!run.sessionId) return;
    const { accepted } = (await loadMoreTemplates(run.sessionId)) || {};
    if (!accepted) return;
    try {
      const doc = await getOnboardingSession(run.sessionId);
      setSession(doc);
    } catch {
      // The page is still coming; the socket event will bring it. A failed
      // refresh costs the spinner, not the result.
    }
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

    // The clip view is a phase, not a route, so a resume has to reconstruct it
    // rather than navigate to it. Hydrating first is what makes it land on a
    // finished clip rather than an empty spinner.
    if (view === 'clip' && doc?.videos) {
      dispatch(videosHydrated(doc.videos));
      // Whichever concept actually has a clip. Failing that, any board a render
      // was ever started for; failing that, the first concept — so the screen
      // still opens and shows its own state rather than silently doing nothing.
      const attempted = Object.entries(doc.videos.boards || {});
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
    if (run.sessionId) exitOnboarding(run.sessionId, 'skipped');
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

  const devSwitcher = null;
  // const devSwitcher = import.meta.env.DEV ? (
  //   <DevSessionSwitcher onOpen={openExistingSession} currentId={run.sessionId} />
  // ) : null;

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
    return (
      <>
        <ClipView
          board={boards[boardIndex]}
          index={boardIndex >= 0 ? boardIndex + 1 : 1}
          state={run.videos?.byBoard?.[clipBoardId] || {}}
          // Return to the board without clearing the run or its render state.
          onBack={() => {
            clearClipBoard();
            setPhase('workspace');
          }}
          onRetry={() => startVideo(boards[boardIndex])}
          // HIDE-MARK - Start over off. Restore by un-commenting the prop.
          // onStartOver={startOver}
          // The exit. Onboarding ends here and the product begins.
          //
          // `completed` is what retires the offer bar for good — the user got
          // their clip, so there is no free render still owed. Not awaited:
          // they are already leaving, and bookkeeping must not hold them on a
          // screen they have finished with.
          onFinish={() => {
            if (run.sessionId) exitOnboarding(run.sessionId, 'completed');
            clearClipBoard();
            clearRun();
            navigate('/adstudio');
          }}
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
          // HIDE-MARK - Start over off. Restore by un-commenting the prop.
          // onStartOver={startOver}
          // Always available, from the workspace on. Leaving here costs the
          // user nothing: no render has been started, so no credits and no free
          // claim are in play.
          onSkip={skipOnboarding}
          // Per concept. Opens the clip view and starts the render together —
          // see `startVideo`.
          onGenerateVideo={startVideo}
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
      />
      {connectionBanner}
        {devSwitcher}
    </>
  );
};

export default OnBoardHome;
