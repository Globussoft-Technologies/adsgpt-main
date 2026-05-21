/**
 * runOptions — pure helper that merges an HTTP request `source`
 * (`req.body || req.query`) with a user's saved AutopilotSettings to
 * produce the effective run options for the manual `/run` and
 * `/run-cycle` endpoints.
 *
 * Precedence (highest first):
 *   1. Caller-supplied query/body (so the UI's explicit "Run dry-run"
 *      button keeps full control).
 *   2. Saved AutopilotSettings (severityFloor, dryRunGlobal, enabled).
 *   3. Hardcoded safe defaults (dryRun=true, severityFloor='critical').
 *
 * Also returns `refusedDisabled` so the controller can decide whether to
 * short-circuit with a 409. It is not the helper's job to throw; the
 * controller maps that boolean to an HTTP response.
 *
 * Pure. No I/O, no globals, no requires beyond Node primitives.
 * Lives in services/ rather than controllers/ so tests can require it
 * without pulling the controller's eager `utils/crypto` and FB SDK
 * dependencies.
 */

function resolveRunOptions(source = {}, settings = {}) {
  const dryRunExplicit =
    source.dryRun !== undefined &&
    source.dryRun !== null &&
    source.dryRun !== "";
  const dryRun = dryRunExplicit
    ? String(source.dryRun).toLowerCase() !== "false"
    : settings.dryRunGlobal !== false;

  const severityFloor =
    source.severityFloor || settings.severityFloor || "critical";

  const refusedDisabled = settings.enabled === false && !dryRun;

  return {
    dryRun,
    severityFloor,
    refusedDisabled,
    settingsApplied: {
      severityFloorFromSettings: !source.severityFloor,
      dryRunFromSettings: !dryRunExplicit,
    },
  };
}

module.exports = { resolveRunOptions };
