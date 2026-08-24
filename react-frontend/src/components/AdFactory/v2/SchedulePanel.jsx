import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pause, Pencil, Play } from 'lucide-react';

import { Panel, PanelBody, PanelHeader, GhostBtn, PrimaryBtn } from './Panel';
import CadencePills from './CadencePills';
import AlertEmails from './AlertEmails';
import { MUTED, RULE_BORDER } from './_tokens';

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
  onScheduleUpdate,
  onPause,
  onResume,
  onRestartSetup,
  restartSetupOpen = false,
  runNowQueued = false,
  busy = false,
  saving = false,
  syncWarning,
}) {
  const [editing, setEditing] = useState(false);
  const [draftCadence, setDraftCadence] = useState(null);
  const [draftEmails, setDraftEmails] = useState(alertEmails || []);

  const live = status === 'active';
  const paused = status === 'paused';
  const over = !live && !paused;
  const cadenceValue = draftCadence || {
    frequency,
    hour,
    timezone,
    pairsPerCycle,
    custom,
    startDate,
    endDate,
  };

  useEffect(() => {
    if (editing) return;
    setDraftCadence(null);
    setDraftEmails(alertEmails || []);
  }, [alertEmails, custom, editing, endDate, frequency, hour, pairsPerCycle, startDate, timezone]);

  const beginEdit = () => {
    setDraftCadence({
      frequency,
      hour,
      timezone,
      pairsPerCycle,
      custom,
      startDate,
      endDate,
    });
    setDraftEmails(alertEmails || []);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftCadence(null);
    setDraftEmails(alertEmails || []);
  };

  const submitEdit = () => {
    if (onScheduleUpdate) {
      onScheduleUpdate({ cadence: draftCadence || cadenceValue, alertEmails: draftEmails || [] });
    } else {
      if (draftCadence) onCadenceChange?.(draftCadence);
      onAlertEmailsChange?.(draftEmails || []);
    }
    setEditing(false);
  };

  return (
    <Panel>
      <PanelHeader
        title="Schedule"
        subtitle={
          over
            ? 'Deliveries have ended. Your past runs are below.'
            : nextRunAt
              ? `Next run ${when(nextRunAt)}`
              : 'Paused - nothing is scheduled'
        }
        right={
          <span className="flex items-center gap-2">
            {saving && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9CA3AF] dark:text-[#8B939E]" />
            )}
            {live && (
              <GhostBtn onClick={onPause} disabled={busy || editing}>
                <Pause className="h-3.5 w-3.5" />
                <span>Pause</span>
              </GhostBtn>
            )}
            {paused && (
              <GhostBtn onClick={onResume} disabled={busy || editing}>
                <Play className="h-3.5 w-3.5" />
                <span>Resume</span>
              </GhostBtn>
            )}
            {over && onRestartSetup && !restartSetupOpen && (
              <PrimaryBtn onClick={onRestartSetup}>
                <span>Set up deliveries again</span>
              </PrimaryBtn>
            )}
            {!over && !editing && (
              <GhostBtn onClick={beginEdit} disabled={busy}>
                <Pencil className="h-3.5 w-3.5" />
                <span>Edit</span>
              </GhostBtn>
            )}
          </span>
        }
      />

      <PanelBody className="flex flex-col gap-3">
        <CadencePills
          frequency={cadenceValue.frequency}
          hour={cadenceValue.hour}
          timezone={cadenceValue.timezone}
          pairsPerCycle={cadenceValue.pairsPerCycle}
          custom={cadenceValue.custom}
          startDate={cadenceValue.startDate}
          endDate={cadenceValue.endDate}
          onChange={(change) =>
            setDraftCadence((current) => ({
              ...(current || cadenceValue),
              ...change,
            }))
          }
          disabled={over || busy || !editing}
        />

        {runNowQueued && (
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-3.5 py-3">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-13 leading-relaxed text-emerald-700 dark:text-emerald-400">
              A run is queued. It&apos;ll appear below once it starts - this is an extra cycle, so
              your schedule is unchanged.
            </p>
          </div>
        )}

        {!over && (
          <div className={`border-t pt-4 ${RULE_BORDER}`}>
            <AlertEmails
              value={draftEmails}
              onChange={setDraftEmails}
              disabled={busy || !editing}
            />
          </div>
        )}

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
            Changes apply from the next run. Pausing keeps the automation ready to resume.
          </p>
        )}

        {editing && (
          <div className={`flex flex-wrap items-center justify-end gap-2 border-t pt-4 ${RULE_BORDER}`}>
            <GhostBtn onClick={cancelEdit} disabled={busy || saving}>
              <span>Cancel</span>
            </GhostBtn>
            <PrimaryBtn onClick={submitEdit} busy={saving} disabled={busy}>
              <span>Update automation</span>
            </PrimaryBtn>
          </div>
        )}
      </PanelBody>
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
