import React from 'react';
import { Pause, Play } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '@/components/Autopilot/_atoms';

import { Panel, PanelFooter, PanelHeader, PrimaryBtn, GhostBtn, Notice } from './Panel';
import CadencePills from './CadencePills';
import AlertEmails from './AlertEmails';
import LaunchConnection from './LaunchConnection';
import { Section, SectionRule } from './briefFields';
import { useMotionPresets } from './_motion';
import { MUTED, NUM, RULE_BORDER } from './_tokens';

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

                  {!isRunning && (
                    <PrimaryBtn onClick={onActivate} busy={activating} disabled={!isMetaConnected}>
                      {isMetaConnected ? 'Start deliveries' : 'Connect Meta to start'}
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
