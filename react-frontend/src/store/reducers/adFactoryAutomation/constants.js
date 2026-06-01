// Status enum for an AdFactory campaign's automation lifecycle.
// Kept in its own file so the slice and the thunks don't form a cycle.
//
// Values mirror the backend's `status` strings on the job document so the
// API response can be stored directly without translation. The two
// frontend-only entries (IDLE, STOPPED) cover states the backend doesn't
// emit but the UI needs.

export const AUTOMATION_STATUS = Object.freeze({
  IDLE: 'idle',             // never configured (frontend-only)
  DRAFT: 'draft',           // wizard in progress / saved draft (backend can return this too)
  ACTIVE: 'active',         // running on schedule
  PAUSED: 'paused',         // temporarily halted, config preserved
  COMPLETED: 'completed',   // finished (e.g. endDate passed or maxRuns hit)
  FAILED: 'failed',         // backend-side failure; needs user attention
  ARCHIVED: 'archived',     // backend-archived; treat as stopped on the client
  STOPPED: 'stopped',       // user-stopped (frontend-only — backend doesn't emit this)
});

// Map a backend status string to one of our enum values. Backend's enum is a
// superset of what we render distinctly; unknown values fall back to ACTIVE
// so the canvas still shows something rather than disappearing silently.
export function mapApiStatusToLocal(apiStatus) {
  if (!apiStatus) return AUTOMATION_STATUS.ACTIVE;
  const v = String(apiStatus).toLowerCase();
  if (Object.values(AUTOMATION_STATUS).includes(v)) return v;
  return AUTOMATION_STATUS.ACTIVE;
}

// True when the automation should be visible on the React Flow canvas as the
// unified Automation Active node (vs the manual cluster). Includes terminal
// states so the user sees outcome rather than the canvas silently flipping
// back to manual mode.
export function isAutomationVisibleStatus(status) {
  return [
    AUTOMATION_STATUS.ACTIVE,
    AUTOMATION_STATUS.PAUSED,
    AUTOMATION_STATUS.COMPLETED,
    AUTOMATION_STATUS.FAILED,
  ].includes(status);
}
