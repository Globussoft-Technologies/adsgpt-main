// Brand setup — the live state of one onboarding run.
//
// Named `brandSetup`, not `onboarding`, because that name is already taken:
// `store/reducers/onboarding/onboardingSlice.js` is the product TOUR (welcome
// modal, step index, hasCompleted). Two different features, and putting them in
// one slice would be a merge conflict waiting to happen. The API client under
// `apis/onboarding/` does belong to this feature — that one is correctly named.
//
// Everything here is fed by a single socket event, `aiJobUpdate`, registered in
// socketSlice. Node emits it for both of its ingest paths — the live SSE bridge
// and Python's webhook — in exactly the same shape, so this reducer neither
// knows nor cares which delivered a given update.
//
// One rule shapes the whole file: BRAND DATA IS NEVER PAINTED EARLY. Progress,
// reasoning and sources stream in; the profile appears once, from the terminal
// event. The scraper's first guess at a brand name is not the merged answer,
// and showing it early means showing something that silently changes later.

import { createSlice } from '@reduxjs/toolkit';

// Python reports the same step under more than one slug — the stream opens with
// `running` before `starting`, and emits a bare `stored` alongside `storing`.
// Folding them here is what stops the canvas growing two nodes for one step.
const STAGE_ALIAS = { running: 'starting', queued: 'starting', stored: 'storing', done: 'finalizing' };

// The word that appears on the node. Short by necessity — it is drawn beside a
// small circle, not in a paragraph.
const STAGE_NODE_LABEL = {
  starting: 'start',
  recalling_sessions: 'history',
  researching_and_scraping: 'research',
  merging: 'merge',
  categorizing: 'category',
  embedding: 'index',
  storing: 'save',
  finalizing: 'ready',
};

const initialState = {
  /** idle → running → succeeded | failed */
  status: 'idle',

  jobId: '',
  sessionId: '',

  /** Latest progress line. `message` is upstream copy — rendered verbatim. */
  stage: '',
  message: '',
  percent: 0,

  /**
   * Every stage seen, in order — `[{ key, label }]`. The canvas names its outer
   * nodes from this, so the picture is labelled with the run's own steps rather
   * than with anything invented here. Kept separately from `stage` because that
   * one is only ever the CURRENT step.
   */
  stagesSeen: [],

  /**
   * The reasoning, as one chronological list — `[{ id, eyebrow, text }]`.
   *
   * The UI shows a depth stack: newest card at the front, earlier ones receding
   * behind it. That only reads correctly if the steps are already in the order
   * they happened, so they are merged HERE rather than stitched back together
   * from three separate arrays at render time.
   */
  steps: [],

  /** Reasoning sentences, in arrival order. The "decoding" text. */
  thoughts: [],

  /** One entry per search / site / source read. Drives the outer nodes. */
  sources: [],

  /** Prior sessions matched on this brand. */
  recalls: [],

  /** Populated only on a successful terminal event. */
  result: null,
  error: '',

  /**
   * Results from the follow-on jobs. They share the onboarding session with the
   * brand job but have their own job ids (and template matching has none), so
   * they must not be filtered through the brand-job correlation rule above.
   */
  modules: {
    templates: {},
    storyboards: {},
  },

  /**
   * Module 4, per storyboard concept — `{ [boardId]: { … } }`.
   *
   * Not part of `modules`, because it is not one job with one result. A person
   * renders concepts individually, so this holds several independent renders at
   * once and every one of them has its own status, its own progress line and
   * its own clip. A single `videos: { status, result }` could only ever describe
   * whichever job finished last.
   */
  videos: {
    byBoard: {},
    /**
     * `{ [jobId]: boardId }`.
     *
     * The live SSE bridge forwards non-terminal frames as
     * `{ job_id, event, data }` with NO `kind` — only the terminal ones carry
     * it. So a `progress` frame cannot be recognised as a video's by its shape,
     * and correlating on the brand job id would drop it as a stale event from
     * another run. This map is the correlation: we learn the job id when the
     * render is accepted, and every frame carrying it belongs to that board.
     */
    jobToBoard: {},
  },

  /**
   * Bumped on every module completion. A plain counter, because the two things
   * that could otherwise identify an update do not: the storyboards rail is
   * written by TWO jobs (scripts, then images) that both report `succeeded`, so
   * a watcher keyed on status alone never sees the second one land — which is
   * precisely the event that says the frames exist.
   */
  modulesSeq: 0,

  /** Wall-clock start, for the elapsed readout. */
  startedAt: 0,
  /** Every event received, for the debug panel and for "did it all arrive?". */
  eventCount: 0,
};

/** Appends a card to the stack. `eyebrow` is the small label above the line. */
function pushStep(state, eyebrow, text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  // Upstream repeats a line occasionally (a stage re-reported at the same
  // percent). A duplicate card would look like the run stalled.
  const last = state.steps[state.steps.length - 1];
  if (last && last.text === clean) return;
  state.steps.push({ id: state.steps.length, eyebrow, text: clean });
}

/** The board entry, with the fields a fresh render starts from. */
const blankBoard = () => ({
  jobId: '',
  /**
   * How many renders have been STARTED for this board, this one included.
   *
   * The UI allows exactly one retry, so `attempts >= 2` is what turns the retry
   * button into "try another storyboard". The authority is the server —
   * `videos.boards.<id>.attempts` — because a reload rebuilds this state from
   * the session, and a count that lived only here would hand the user a fresh
   * retry on every refresh for a concept that is never going to render.
   */
  attempts: 1,
  /** idle → running → ready | failed */
  status: 'running',
  message: '',
  percent: 0,
  /** The clear first frame, pinned as `<video poster>` once it arrives. */
  poster: '',
  /** The finished clip, in the contract's shape, with `src` already resolved. */
  video: null,
  error: '',
  /**
   * The blurred placeholder GIF, and when its link dies. Built by a separate
   * call that is allowed to fail — when it does, the view keeps its own shimmer
   * and the render is unaffected.
   */
  loader: null,
  /** Wall clock, which is what the loading sequence is timed against. */
  startedAt: 0,
});

/**
 * One socket frame for one board's render.
 *
 * The stream carries more than this view uses. The staggered `board_video_preview`
 * reveal — a blurred first frame, a crossfade, a clear last frame — is upstream's
 * own idea of a placeholder, and this product shows its own three-stage sequence
 * instead. Only the `"poster"` phase is kept, because that one is not decoration:
 * it is the clear first frame of the clip, and pinning it stops the player
 * flashing black before the first frame decodes.
 */
function applyVideoEvent(board, msg) {
  if (!board) return;
  const d = msg.data || {};

  switch (msg.event) {
    case 'progress': {
      // Upstream writes this copy for users; it is shown verbatim.
      if (d.message) board.message = d.message;
      if (typeof d.percent === 'number') board.percent = Math.max(board.percent, d.percent);
      break;
    }

    case 'board_video_preview': {
      if (d.phase === 'poster' && d.local_url) board.poster = d.local_url;
      break;
    }

    case 'board_video': {
      const video = d.video || null;
      // `ready` is upstream's word for "the render finished", which is not the
      // same as "there is something to play": the durable upload can still be
      // in flight. The tile waits for a link rather than showing an empty
      // player.
      if (video?.status === 'ready' && (video.src || video.url || video.local_url)) {
        board.status = 'ready';
        board.video = { board_id: d.board_id, video };
        board.percent = 100;
      } else if (video?.status === 'failed') {
        board.status = 'failed';
        board.error = video.error || 'This concept could not be rendered.';
      }
      break;
    }

    case 'done': {
      // The terminal frame is a reconciliation, not the first news — the clip
      // normally arrived on `board_video` seconds earlier. It matters for the
      // case where it did not.
      const clip = (msg.result?.videos || []).find((v) => v.board_id) || null;
      if (msg.status === 'succeeded' && clip?.video?.status === 'ready') {
        board.status = 'ready';
        board.video = clip;
        board.percent = 100;
      } else if (board.status !== 'ready') {
        board.status = 'failed';
        board.error = msg.error || clip?.video?.error || 'The render did not finish.';
      }
      break;
    }

    case 'error': {
      // The live channel dropped, not the render. Upstream keeps working and
      // the session read will find the clip, so the tile stays on its spinner
      // and only records that it is now flying blind.
      board.message = board.message || 'Still rendering…';
      break;
    }

    default:
      // `board_image` — a keyframe upstream had to redraw before it could
      // render. Nothing here shows keyframes, so it is counted and ignored.
      break;
  }
}

const brandSetupSlice = createSlice({
  name: 'brandSetup',
  initialState,
  reducers: {
    /** A run is being started. Called before the POST resolves. */
    runStarted: (state) => {
      Object.assign(state, initialState, {
        status: 'running',
        startedAt: Date.now(),
      });
    },

    /** The 202 came back — we now have ids to correlate events against. */
    runAccepted: (state, action) => {
      state.jobId = action.payload.job_id || '';
      state.sessionId = action.payload.session_id || '';
      // An idempotent replay returns a job that already finished; there will be
      // no stream for it, so the caller loads the stored context instead.
      if (action.payload.status === 'succeeded') state.status = 'succeeded';
    },

    /**
     * One `aiJobUpdate` from the socket.
     *
     * Deliberately tolerant: an unrecognised event name is counted and ignored
     * rather than throwing. Python adds event kinds faster than we consume them,
     * and a new one must never break a run that is already on screen.
     */
    jobEvent: (state, action) => {
      const msg = action.payload || {};
      const isCurrentSession = Boolean(
        state.sessionId && msg.session_id && msg.session_id === state.sessionId
      );
      const section =
        msg.kind === 'template.recommend'
          ? 'templates'
          : String(msg.kind || '').startsWith('storyboard.')
            ? 'storyboards'
            : '';
      const isModuleCompletion = isCurrentSession && section && msg.event === 'done';

      // ── module 4, before anything else ───────────────────────────────
      // A video render is its own job with its own id, so the brand-job filter
      // below would throw every one of its frames away. It is recognised by the
      // job id we recorded when the render was accepted — the live bridge does
      // not put `kind` on non-terminal frames, so the id is the only handle
      // that works for progress as well as for the clip.
      const videoBoardId = msg.job_id ? state.videos.jobToBoard[msg.job_id] : '';
      if (videoBoardId) {
        state.eventCount += 1;
        applyVideoEvent(state.videos.byBoard[videoBoardId], msg);
        return;
      }

      // Late events from a previous run share the socket; drop anything that is
      // not the job currently on screen. Follow-on module completions are the
      // exception: they are correlated by session, not by the brand job id.
      if (state.jobId && msg.job_id && msg.job_id !== state.jobId && !isModuleCompletion) return;

      if (isModuleCompletion) {
        state.eventCount += 1;
        state.modulesSeq += 1;
        state.modules[section] = {
          status: msg.status === 'succeeded' ? 'succeeded' : 'failed',
          ...(msg.job_id ? { jobId: msg.job_id } : {}),
          ...(msg.status === 'succeeded' ? { result: msg.result || null } : {}),
          ...(msg.status !== 'succeeded' ? { error: msg.error || 'The run did not finish.' } : {}),
        };
        return;
      }

      state.eventCount += 1;
      const d = msg.data || {};

      switch (msg.event) {
        case 'progress': {
          if (d.stage) {
            state.stage = d.stage;
            const key = STAGE_ALIAS[d.stage] || d.stage;
            if (!state.stagesSeen.some((x) => x.key === key)) {
              state.stagesSeen.push({ key, label: STAGE_NODE_LABEL[key] || key });
            }
          }
          if (d.message) {
            state.message = d.message;
            const key = STAGE_ALIAS[d.stage] || d.stage;
            // Rendered verbatim — upstream writes this copy for users.
            pushStep(state, STAGE_NODE_LABEL[key] || 'Working', d.message);
          }
          // Never let a late or out-of-order event drag the bar backwards.
          if (typeof d.percent === 'number') state.percent = Math.max(state.percent, d.percent);
          break;
        }

        case 'thinking': {
          // Arrives as prose, sometimes several paragraphs, with light markdown.
          String(d.message || '')
            .split(/\n{2,}/)
            .map((t) => t.trim().replace(/\*\*(.+?)\*\*/g, '$1'))
            .filter(Boolean)
            .forEach((text) => {
              state.thoughts.push(text);
              pushStep(state, 'Reasoning', text);
            });
          break;
        }

        case 'research': {
          state.sources.push({
            kind: d.kind || 'source',
            // A search is known by its query, a page by its domain. The raw
            // `uri` is a Google redirect and unreadable, so it is never shown.
            label: d.kind === 'search' ? d.query || d.message : d.title || '',
            message: d.message || '',
            index: d.index || 0,
            total: d.total || 0,
          });
          pushStep(state, d.kind === 'search' ? 'Search' : 'Source', d.message);
          break;
        }

        case 'recall': {
          state.recalls.push({
            label: d.brand_name || '',
            message: d.message || '',
            similarity: typeof d.similarity === 'number' ? d.similarity : null,
            sessionId: d.session_id || '',
          });
          pushStep(state, 'History', d.message);
          break;
        }

        case 'done': {
          pushStep(
            state,
            msg.status === 'succeeded' ? 'Ready' : 'Stopped',
            msg.status === 'succeeded'
              ? 'Your brand profile is ready.'
              : msg.error || 'The run did not finish.'
          );
          state.status = msg.status === 'succeeded' ? 'succeeded' : 'failed';
          state.percent = 100;
          if (msg.status === 'succeeded') state.result = msg.result || null;
          else state.error = msg.error || 'The run did not finish.';
          break;
        }

        case 'error': {
          // The live channel dropped. The run itself is almost certainly fine —
          // Python persists regardless — so this is not a failure, just a lost
          // view of one. The page offers a reload rather than a retry.
          state.error = 'connection_lost';
          break;
        }

        default:
          break;
      }
    },

    /**
     * Rejoins a run already in progress after a reload.
     *
     * The steps that streamed before the refresh are gone — they were live-only
     * — so the stack restarts from wherever the job is now. That is honest: it
     * shows the current step rather than inventing a history it did not see.
     */
    runResumed: (state, action) => {
      const snap = action.payload || {};
      Object.assign(state, initialState, {
        jobId: snap.jobId || '',
        sessionId: snap.sessionId || '',
        status: snap.status === 'succeeded' || snap.status === 'failed' ? snap.status : 'running',
        startedAt: snap.startedAt || Date.now(),
        percent: typeof snap.percent === 'number' ? snap.percent : 0,
        stage: snap.stage || '',
        message: snap.message || '',
        result: snap.result || null,
        error: snap.error || '',
      });
      if (snap.message) pushStep(state, 'Resumed', snap.message);
    },

    /** A terminal state reached through a read rather than the stream. */
    runResolved: (state, action) => {
      state.status = 'succeeded';
      state.percent = 100;
      state.result = action.payload || null;
    },

    runFailed: (state, action) => {
      state.status = 'failed';
      state.error = action.payload || 'Something went wrong.';
    },

    /* ── module 4: one render per storyboard concept ──────────────────── */

    /**
     * A Generate click, before the POST resolves.
     *
     * Re-opening a board that is ALREADY rendering keeps its clock and its job
     * id. Restarting them would drop the view back to the first stage of the
     * waiting sequence — twenty seconds of shimmer for a render that is fifty
     * seconds old — and would forget which job's frames belong to this tile.
     */
    videoStarted: (state, action) => {
      const boardId = action.payload;
      if (!boardId) return;
      const existing = state.videos.byBoard[boardId];
      if (existing?.status === 'running' && existing.startedAt) return;
      state.videos.byBoard[boardId] = {
        ...blankBoard(),
        // Carried across the reset, not restarted by it: this branch runs for
        // a RETRY too, and blanking the count there would make every attempt
        // look like the first.
        attempts: (Number(existing?.attempts) || 0) + 1,
        startedAt: Date.now(),
      };
    },

    /** The 202 came back — from here on, frames carrying this job id are ours. */
    videoAccepted: (state, action) => {
      const { boardId, jobId } = action.payload || {};
      const board = state.videos.byBoard[boardId];
      if (!board || !jobId) return;
      board.jobId = jobId;
      state.videos.jobToBoard[jobId] = boardId;
    },

    /**
     * The render could not be started, or is already running elsewhere.
     *
     * `already_running` is not a failure: another tab, or this one before a
     * reload, has a render in flight for this board and its events will arrive
     * on the same socket. So the tile stays on its spinner and simply adopts
     * the job id it was handed.
     */
    videoRejected: (state, action) => {
      const { boardId, reason, jobId } = action.payload || {};
      const board = state.videos.byBoard[boardId];
      if (!board) return;
      if (reason === 'already_running' && jobId) {
        board.jobId = jobId;
        state.videos.jobToBoard[jobId] = boardId;
        return;
      }
      board.status = 'failed';
      // Told apart on purpose. "Try again" is the right advice for exactly one
      // of these — the rest are conditions a retry cannot change, and offering
      // it anyway sends the user round a loop that was never going to work.
      board.error =
        // Payment refusals first: they are the only two a user can act on, and
        // the action differs. Neither is a retry — the render never started,
        // and nothing was charged or claimed.
        reason === 'NO_BASE_PLAN'
          ? 'You need an active plan to generate video. Upgrade to keep going.'
          : reason === 'INSUFFICIENT'
          ? "You don't have enough credits for this render. Top up and try again."
          : reason === 'not_configured'
          ? 'Video generation is not switched on for this environment yet.'
          : reason === 'upstream_error'
            ? 'The video service is not responding right now. This is on our side — try again in a few minutes.'
            : reason === 'already_rendered'
              ? 'This concept has already been rendered.'
              : reason === 'unknown_board' || reason === 'not_found'
                ? 'We could not find this concept. Reload the page and try again.'
                : 'We could not start this render. Please try again.';
    },

    /** The placeholder GIF is ready. Absent is normal — see `blankBoard`. */
    videoLoaderReady: (state, action) => {
      const { boardId, loader } = action.payload || {};
      const board = state.videos.byBoard[boardId];
      if (board) board.loader = loader || null;
    },

    /**
     * Folds the stored clips from `GET /sessions/:id` over what is in memory.
     *
     * The recovery path: a reload, or a socket that dropped mid-render. A clip
     * the server already holds is the truth and replaces whatever the tile
     * thought; a board that is still `running` server-side keeps its spinner
     * rather than being reset, so a rejoined render carries on looking like one.
     */
    videosHydrated: (state, action) => {
      const section = action.payload || {};
      const boards = section.boards || {};
      const clips = section.result?.videos || [];
      const clipFor = new Map(clips.map((c) => [c.board_id, c]));

      for (const [boardId, entry] of Object.entries(boards)) {
        const existing = state.videos.byBoard[boardId];
        const clip = clipFor.get(boardId);
        const status =
          entry?.status === 'running' ? 'running' : entry?.status === 'failed' ? 'failed' : 'ready';

        // A clip that is `ready` but has no playable link is not ready to a
        // viewer — the durable upload may not have landed and the local copy
        // may have expired. Saying "ready" would show a player with nothing in
        // it.
        const playable = clip?.video?.playable ?? Boolean(clip?.video?.src);

        state.videos.byBoard[boardId] = {
          ...(existing || blankBoard()),
          jobId: entry?.jobId || existing?.jobId || '',
          status: status === 'ready' && !playable ? 'running' : status,
          video: clip || existing?.video || null,
          error: entry?.error || existing?.error || '',
          // The server's count wins. It is the only copy that survived the
          // reload this hydration is answering.
          attempts: Number(entry?.attempts) || existing?.attempts || 1,
          // A render that started before this tab existed still needs a clock
          // for the loading sequence to run against.
          startedAt: existing?.startedAt || Date.now(),
        };
        if (entry?.jobId) state.videos.jobToBoard[entry.jobId] = boardId;
      }
    },

    resetRun: () => initialState,
  },
});

export const {
  runStarted,
  runAccepted,
  runResumed,
  jobEvent,
  runResolved,
  runFailed,
  videoStarted,
  videoAccepted,
  videoRejected,
  videoLoaderReady,
  videosHydrated,
  resetRun,
} =
  brandSetupSlice.actions;

export default brandSetupSlice.reducer;
