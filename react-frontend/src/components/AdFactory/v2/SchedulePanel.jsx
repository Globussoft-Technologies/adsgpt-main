import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pause, Play, Square, Zap } from 'lucide-react';

import { Panel, PanelBody, PanelHeader, GhostBtn } from './Panel';
import CadencePills from './CadencePills';
import AlertEmails from './AlertEmails';
import { MUTED, RULE_BORDER } from './_tokens';

// ----------------------------------------------------------------------------
// SchedulePanel — the cadence of a LIVE brief, and the controls that change it.
//
// This is the half of automation Quick setup didn't have. Once a brief went
// live the schedule became unreachable: the setup card only renders before
// activation, so there was no way to move the time, change how often, or stop —
// only pause. v1 had Edit and Stop on its active node from day one.
//
// The edit path is not a second implementation. It is the same CadencePills the
// setup card uses, and the same PATCH — the server now forwards job-owned
// fields onto the running job (services/adFactory/briefToJobPatch). Before that
// existed, editing here would have saved, rendered, and changed nothing.
//
// `syncWarning` is how that honesty reaches the screen. `updateJob` refuses
// while a cycle is mid-run, and a refusal the user cannot see is the exact bug
// this whole change is fixing, one layer further out.
// ----------------------------------------------------------------------------

export default function SchedulePanel({
  status,
  frequency,
  hour,
  timezone,
  pairsPerCycle,
  custom,
  startDate,
  endDate,
  alertEmails,
  onAlertEmailsChange,
  nextRunAt,
  onCadenceChange,
  onPause,
  onResume,
  onStop,
  onRunNow,
  runningNow = false,
  runNowQueued = false,
  busy = false,
  saving = false,
  syncWarning,
}) {
  const [confirmingStop, setConfirmingStop] = useState(false);

  const live = status === 'active';
  const paused = status === 'paused';
  // Archived or completed: nothing left to schedule, and editing a cadence that
  // will never run again would be theatre.
  const over = !live && !paused;

  return (
    <Panel>
      <PanelHeader
        title="Schedule"
        subtitle={
          over
            ? 'Deliveries have ended. Your past runs are below.'
            : nextRunAt
              ? `Next run ${when(nextRunAt)}`
              : 'Paused — nothing is scheduled'
        }
        right={
          <span className="flex items-center gap-2">
            {saving && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9CA3AF] dark:text-[#8B939E]" />
            )}
            {live && (
              <GhostBtn onClick={onPause} disabled={busy}>
                <Pause className="h-3.5 w-3.5" />
                <span>Pause</span>
              </GhostBtn>
            )}
            {paused && (
              <GhostBtn onClick={onResume} disabled={busy}>
                <Play className="h-3.5 w-3.5" />
                <span>Resume</span>
              </GhostBtn>
            )}
            {!over && (
              <GhostBtn onClick={() => setConfirmingStop(true)} disabled={busy}>
                <Square className="h-3.5 w-3.5" />
                <span>Stop</span>
              </GhostBtn>
            )}
          </span>
        }
      />

      <PanelBody className="flex flex-col gap-3">
        <CadencePills
          frequency={frequency}
          hour={hour}
          timezone={timezone}
          pairsPerCycle={pairsPerCycle}
          custom={custom}
          startDate={startDate}
          endDate={endDate}
          onChange={onCadenceChange}
          disabled={over || busy}
        />

        {/* Queued, not finished. Nothing appears in the timeline until the
            orchestrator picks it up, so this says what actually happened
            rather than implying ads exist. */}
        {runNowQueued && (
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-3.5 py-3">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-13 leading-relaxed text-emerald-700 dark:text-emerald-400">
              A run is queued. It&apos;ll appear below once it starts — this is an extra cycle, so
              your schedule is unchanged.
            </p>
          </div>
        )}

        {!over && (
          <div className={`border-t pt-4 ${RULE_BORDER}`}>
            <AlertEmails
              value={alertEmails}
              onChange={onAlertEmailsChange}
              disabled={busy}
            />
          </div>
        )}

        {/* The one message that must never be swallowed: the brief now says one
            thing and the running job still does another. */}
        {syncWarning && (
          <div className="flex items-start gap-2.5 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-3.5 py-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B45309] dark:text-[#E8A33D]" />
            <p className="text-13 leading-relaxed text-[#92400E] dark:text-[#E8A33D]">
              {syncWarning} Your change is saved, but the schedule running right now hasn&apos;t
              changed yet.
            </p>
          </div>
        )}

        {!over && !syncWarning && (
          <p className={MUTED}>
            Changes apply from the next run. Pausing keeps everything; stopping ends deliveries for
            good.
          </p>
        )}
      </PanelBody>

      {/* Stopping is irreversible and spends nothing to confirm, so it asks.
          Inline rather than a modal: it belongs to this panel, and a dialog over
          the whole page for one sentence is heavier than the decision. */}
      {confirmingStop && (
        <div className={`border-t px-5 py-4 ${RULE_BORDER} 2xl:px-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`max-w-150 ${MUTED}`}>
              Stop deliveries for good? Ads already live stay live, and your run history is kept —
              but restarting means setting the schedule up again.
            </p>
            <span className="flex shrink-0 items-center gap-2">
              <GhostBtn onClick={() => setConfirmingStop(false)} disabled={busy}>
                <span>Keep running</span>
              </GhostBtn>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmingStop(false);
                  onStop?.();
                }}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/8 px-3.5 text-13 font-medium text-red-600 transition-colors hover:bg-red-500/15 disabled:opacity-50 dark:text-red-400"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Stop deliveries
              </button>
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function when(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
