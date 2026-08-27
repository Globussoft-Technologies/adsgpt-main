import React from 'react';
import { Pause, Play } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '@/components/Autopilot/_atoms';

import { Panel, PanelFooter, PanelHeader, PrimaryBtn, GhostBtn, Notice } from './Panel';
import CadencePills from './CadencePills';
import AlertEmails from './AlertEmails';
import LaunchConnection from './LaunchConnection';
import { FieldBlock, Section, SectionRule } from './briefFields';
import { useMotionPresets } from './_motion';
import {
  CONTROL_H,
  FAINT,
  FOCUS_WITHIN,
  MUTED,
  NUM,
  PLACEHOLDER,
  RULE_BORDER,
  VALUE,
} from './_tokens';

// ----------------------------------------------------------------------------
// Why the daily budget lives HERE and nowhere else.
//
// It used to sit beside Generate, which was the wrong button entirely:
// generating spends CREDITS, and no code path anywhere reads the budget during
// generation. What actually needs it is the schedule —
// `briefToJobPayload` throws "Set a daily budget" unless
// `delivery.budget.daily` is a positive number, because the synthesised
// template expresses the money as an AD SET budget on the campaign it creates
// for you. (The manual "post into an existing ad set" path never reads it: that
// ad set brings its own budget, targeting and schedule.)
//
// So it is asked for at the one moment it is required, and "Start deliveries"
// is disabled without it rather than letting the server refuse after the click.
// ----------------------------------------------------------------------------

export default function KeepTheseComing({
  enabled,
  onToggle,
  frequency = 'weekly',
  custom,
  startDate,
  endDate,
  alertEmails,
  onAlertEmailsChange,
  onCadenceChange,
  onActivate,
  activating = false,
  isMetaConnected = false,
  connection,
  onConnectionChange,
  pairsPerCycle = 3,
  hour = 9,
  timezone,
  budget,
  onBudgetChange,
  onBudgetCommit,
  minBudget = 100,
  currencySymbol = '₹',
  creditsPerCycle,
  firstRunLabel,
  activationError = null,
  status = null,
  onPause,
  onResume,
  busy = false,
}) {
  const M = useMotionPresets();

  const isLive = status === 'active' || status === 'live';
  const isPaused = status === 'paused';
  const isRunning = isLive || isPaused;

  const budgetNumber = Number(budget);
  const budgetOk = Number.isFinite(budgetNumber) && budgetNumber >= minBudget;
  const budgetTooLow = Number.isFinite(budgetNumber) && budgetNumber > 0 && !budgetOk;

  return (
    <Panel>
      <PanelHeader
        title="Keep these coming"
        subtitle={
          isPaused
            ? 'Paused - schedule is stopped'
            : isLive
              ? 'Active - new ads delivered on schedule. Pause any time.'
              : 'New ads from this brief, on a schedule. Pause any time.'
        }
        right={
          <div className="flex items-center gap-2">
            {isLive && onPause && (
              <GhostBtn onClick={onPause} disabled={busy || activating}>
                <Pause className="h-3.5 w-3.5" />
                <span>Pause</span>
              </GhostBtn>
            )}
            {isPaused && onResume && (
              <GhostBtn onClick={onResume} disabled={busy || activating}>
                <Play className="h-3.5 w-3.5" />
                <span>Resume</span>
              </GhostBtn>
            )}
            <Switch
              checked={enabled}
              onChange={(next) => onToggle?.(next)}
              ariaLabel="Keep these coming"
            />
          </div>
        }
      />

      <AnimatePresence initial={false}>
        {enabled && (
          <motion.div key="body" {...M.expand}>
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="flex flex-col">
                <Section title="How often">
                  <CadencePills
                    frequency={frequency}
                    hour={hour}
                    timezone={timezone}
                    pairsPerCycle={pairsPerCycle}
                    custom={custom}
                    startDate={startDate}
                    endDate={endDate}
                    onChange={onCadenceChange}
                    disabled={activating || busy}
                  />
                </Section>

                <SectionRule />

                <Section title="Daily budget">
                  <FieldBlock
                    label="What each ad set spends per day"
                    hint="the campaign we create for you"
                  >
                    <div
                      className={`flex ${CONTROL_H} w-44 items-center gap-1.5 rounded-md border bg-[#FFFDF8] px-3 ${FOCUS_WITHIN} dark:bg-[#1E232A] ${
                        budgetOk
                          ? 'border-[#D9CCB6] dark:border-[#2E353E]'
                          : 'border-[#F59E0B]/45 dark:border-[#F59E0B]/35'
                      }`}
                    >
                      <span className={FAINT}>{currencySymbol}</span>
                      <input
                        type="number"
                        min={minBudget}
                        inputMode="numeric"
                        value={budget ?? ''}
                        disabled={activating || busy}
                        onChange={(e) => onBudgetChange?.(e.target.value)}
                        onBlur={() => onBudgetCommit?.()}
                        placeholder="800"
                        className={`w-full min-w-0 bg-transparent outline-none ${VALUE} ${PLACEHOLDER} ${NUM}`}
                      />
                      <span className={`shrink-0 ${FAINT}`}>/day</span>
                    </div>
                    {budgetTooLow && (
                      <span className="text-[11px] font-medium text-[#B45309] dark:text-[#E8A33D]">
                        Minimum {currencySymbol}
                        {minBudget}/day
                      </span>
                    )}
                  </FieldBlock>
                </Section>

                <SectionRule />

                <Section>
                  <AlertEmails
                    value={alertEmails}
                    onChange={onAlertEmailsChange}
                    disabled={activating || busy}
                  />
                </Section>
              </div>

              <div className={`border-t lg:border-t-0 lg:border-l ${RULE_BORDER}`}>
                <Section title="Where these publish">
                  <LaunchConnection
                    value={connection}
                    onChange={onConnectionChange}
                    disabled={activating || busy}
                  />
                </Section>
              </div>
            </div>

            <PanelFooter>
              {activationError && (
                <div className="mb-4">
                  <Notice tone="error">
                    <span className="flex flex-col items-start gap-1 text-left">
                      <b className="font-semibold text-13">Activation failed</b>
                      <span className="text-xs leading-normal opacity-90">{activationError}</span>
                    </span>
                  </Notice>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                <p className={MUTED}>
                  {creditsPerCycle != null && (
                    <>
                      ~
                      <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>
                        {creditsPerCycle}
                      </b>{' '}
                      credits per cycle
                      {firstRunLabel ? ' - ' : ''}
                    </>
                  )}
                  {firstRunLabel && (
                    <>
                      first run{' '}
                      <b className="font-semibold text-[#111827] dark:text-[#ECEFF3]">
                        {firstRunLabel}
                      </b>
                    </>
                  )}
                  {creditsPerCycle == null && !firstRunLabel && 'Nothing spends until you start.'}
                </p>

                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {isLive && (
                    <GhostBtn onClick={onPause} disabled={busy || activating}>
                      <Pause className="h-3.5 w-3.5" />
                      <span>Pause schedule</span>
                    </GhostBtn>
                  )}

                  {isPaused && (
                    <PrimaryBtn onClick={onResume} busy={busy}>
                      Resume deliveries
                    </PrimaryBtn>
                  )}

                  {/* Both preconditions the server enforces, stated on the
                      button rather than discovered after the click. Meta first:
                      it is the bigger job of the two. */}
                  {!isRunning && (
                    <PrimaryBtn
                      onClick={onActivate}
                      busy={activating}
                      disabled={!isMetaConnected || !budgetOk}
                    >
                      {!isMetaConnected
                        ? 'Connect Meta to start'
                        : !budgetOk
                          ? 'Set a daily budget to start'
                          : 'Start deliveries'}
                    </PrimaryBtn>
                  )}
                </div>
              </div>
            </PanelFooter>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}
