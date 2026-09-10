// Where an onboarding run is remembered across reloads.
//
// This exists because the run can only be paid for ONCE. The 202 is the only
// time we are ever told the job and session ids, so they are written before
// anything else happens — a refresh a second later has to rejoin that run, not
// start a second one and bill the user twice.
//
// localStorage rather than sessionStorage on purpose: a run survives ~30s of
// work and a user may well close the tab and come back. sessionStorage would
// drop it and they would land on an empty form with a finished brand profile
// sitting unreachable on the server.
//
// Every accessor is guarded. Private mode, a full quota and a corrupted value
// all degrade to "no remembered run", which costs a resume — never a crash on
// the first paint of the app.

const STORAGE_KEY = 'adsgpt.onboarding.run';

/** @typedef {{jobId:string, sessionId:string, status:string, startedAt:number}} StoredRun */

/** @param {StoredRun} run */
export function rememberRun(run) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
  } catch {
    // Losing resume is survivable; failing the submit over it is not.
  }
}

/** @returns {StoredRun|null} */
export function readRun() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw);
    // A stored value without ids cannot be resumed and would strand the user on
    // a spinner, so it is treated as absent.
    if (!run?.jobId || !run?.sessionId) return null;
    return run;
  } catch {
    return null;
  }
}

/** Called when a run is finished with, or when the user starts over. */
export function clearRun() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

// ── which clip screen was open ──────────────────────────────────────────────
//
// The Facebook OAuth round-trip tears the whole page down and brings it back at
// `window.location.href` — which for onboarding is just `/`. Resume then puts
// the user on the workspace, one screen away from the clip they were posting,
// with the post-ad modal's own restored payload pointing at a video no longer
// on screen. This is the missing half: the board they were looking at.
//
// sessionStorage, not localStorage, and deliberately not part of `StoredRun`:
// this is where the user was, not what they paid for. It must not follow them
// into a new tab, and it must not outlive the tab either — a pointer restored
// tomorrow would drop somebody onto a clip screen they never asked for.
const CLIP_KEY = 'adsgpt.onboarding.clipBoard';

/** @param {string} boardId */
export function rememberClipBoard(boardId) {
  try {
    if (boardId) sessionStorage.setItem(CLIP_KEY, boardId);
  } catch {
    // Losing this costs a click back into the clip, nothing more.
  }
}

/** @returns {string} */
export function readClipBoard() {
  try {
    return sessionStorage.getItem(CLIP_KEY) || '';
  } catch {
    return '';
  }
}

export function clearClipBoard() {
  try {
    sessionStorage.removeItem(CLIP_KEY);
  } catch {
    /* nothing to do */
  }
}
