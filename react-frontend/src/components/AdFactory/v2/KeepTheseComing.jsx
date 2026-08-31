import React from 'react';
import { Pause, Play } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '@/components/Autopilot/_atoms';
import { IS_GOOGLE_AUTOMATION_ENABLED } from '@/utils/featureFlags';

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
  // Google as a second destination. `platforms` is the brief's own
  // delivery.platforms — the panel decides from it whether Google is even a
  // tab; `isGoogleReady` is that tab's readiness, computed by the page from
  // the same predicate the tab's tick uses.
  platforms = [],
  googleConnection,
  onGoogleConnectionChange,
  isGoogleReady = false,
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

  const googleOffered =
    IS_GOOGLE_AUTOMATION_ENABLED &&
    (Array.isArray(platforms) ? platforms : []).includes('google');

  // ONE ready destination starts a schedule — Meta, Google, or both.
  // `briefToJobPayload` validates Meta's ids only when Meta is actually a
  // destination, so a Google-only schedule no longer trips a Facebook check it
  // was never subject to.
  const googleReadyHere = googleOffered && isGoogleReady;
  const canStart = isMetaConnected || googleReadyHere;

  // Where these ads will actually be uploaded, as opposed to which tabs happen
  // to be filled in.
  const destinations = [];
  if (isMetaConnected) destinations.push('Meta');
  if (googleReadyHere) destinations.push('Google');

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
                <Section title="How often" unstyled>
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

                <Section title="Daily budget" unstyled>
                  <FieldBlock
                    label="What each ad set spends per day"
                    hint="the campaign we create for you"
                  >
                    <div
                      className={`flex ${CONTROL_H} w-44 items-center gap-1.5 rounded-md border bg-[var(--ws-surface-control)] px-3 ${FOCUS_WITHIN} dark:bg-[#202020] ${
                        budgetOk
                          ? 'border-[var(--ws-border)] dark:border-[#2A2A2A]'
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

                <Section unstyled>
                  <AlertEmails
                    value={alertEmails}
                    onChange={onAlertEmailsChange}
                    disabled={activating || busy}
                  />
                </Section>
              </div>

              <div className={`border-t lg:border-t-0 lg:border-l ${RULE_BORDER}`}>
                <Section title="Where these publish" unstyled>
                  <LaunchConnection
                    value={connection}
                    onChange={onConnectionChange}
                    disabled={activating || busy}
                    platforms={platforms}
                    googleValue={googleConnection}
                    onGoogleChange={onGoogleConnectionChange}
                  />

                  {/* Where these ads actually land, stated under the tabs that
                      configure it. Two filled-in tabs do not mean two
                      destinations, and a green tick on a tab is a statement
                      about that tab, not about the run — this line is the one
                      place that speaks for the whole schedule. */}
                  <div className="mt-4 flex flex-col gap-1 border-t border-dashed pt-3 border-[#E7DCC9] dark:border-[#252B33]">
                    {destinations.length > 0 ? (
                      <span className={MUTED}>
                        Uploading to{' '}
                        <b className="font-semibold text-[#111827] dark:text-[#ECEFF3]">
                          {destinations.join(' and ')}
                        </b>
                      </span>
                    ) : (
                      <span className={MUTED}>
                        No destination set up yet — these ads won&apos;t be uploaded anywhere.
                      </span>
                    )}
                  </div>
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
                      it is the bigger job of the two.

                      With Google in play the destination test becomes "at
                      least ONE platform is ready", not "Meta is ready" —
                      a Google-only schedule is a legitimate thing to start,
                      and demanding a Facebook account for it would be asking
                      for a connection the job will never use. */}
                  {!isRunning && (
                    <PrimaryBtn
                      onClick={onActivate}
                      busy={activating}
                      disabled={!canStart || !budgetOk}
                    >
                      {!canStart
                        ? googleOffered
                          ? 'Connect Meta or Google to start'
                          : 'Connect Meta to start'
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
