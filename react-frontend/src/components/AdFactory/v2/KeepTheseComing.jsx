import React from 'react';
import { Info } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '@/components/Autopilot/_atoms';

import { Panel, PanelFooter, PanelHeader, PrimaryBtn } from './Panel';
import CadencePills from './CadencePills';
import AlertEmails from './AlertEmails';
import LaunchConnection from './LaunchConnection';
import { Section, SectionRule } from './briefFields';
import { useMotionPresets } from './_motion';
import { CONTROL, FAINT, MUTED, NUM, RULE_BORDER } from './_tokens';

// ----------------------------------------------------------------------------
// KeepTheseComing — the subscription, and the moment the product's promise
// actually lands.
//
// The thesis of Quick setup is that Ad Factory is not a workflow builder, it is
// a subscription: you say what to advertise and how often, and ads keep
// appearing. That makes this the most important screen in the flow, so it says
// what will happen in plain words and shows what it will run against, rather
// than presenting a form.
//
// ─── One card, not two ───────────────────────────────────────────────────────
//
// The account pickers used to sit in a SECOND card underneath this one, while
// this card carried a read-only checklist reporting "Ad account — Not selected"
// and "Facebook Page — Not selected". Two boxes, the same two facts: one asking
// and one reporting, with the reporting one on top. The user had to read down
// past the summary to find the controls that would change it, and the two cards
// were different widths besides.
//
// So the pickers moved in here, and the checklist rows they duplicated are
// gone — a picker showing its own selection IS the status, and a tick beside it
// is a second thing to keep in sync for no gain. What survives from the
// checklist is the one row no picker covers: the campaign we build for you.
//
// The bands, in the order the decision is actually made:
//
//   How often     the cadence, as a sentence you can edit
//   Where         the Meta account, ad account and Page it publishes through
//   Who hears     alert emails — optional, and last because it is
//   ─────────
//   footer        what it costs per cycle, when it first runs, and the button
//
// ─── Width ───────────────────────────────────────────────────────────────────
//
// This was max-w-2xl and centred, on a page whose every other card runs the
// full max-w-375 container — so it sat in a narrow gutter-flanked column with
// roughly 400px of dead space either side, looking like it belonged to a
// different screen. It takes the page's width now, and the two independent
// halves of the decision sit side by side rather than stacked: WHEN it runs on
// the left, WHERE it publishes on the right, divided by one vertical hairline.
// That roughly halves the height, which matters because the footer holds the
// button and the whole point is to see the commitment and the button together.
//
// They stack again below lg — two 350px columns would be worse than one.
// ----------------------------------------------------------------------------

export default function KeepTheseComing({
  enabled,
  onToggle,
  frequency = 'weekly',
  custom,
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
  budget,
  currencySymbol = '₹',
  hour = 9,
  timezone,
  creditsPerCycle,
  firstRunLabel,
  objectiveLabel,
}) {
  const M = useMotionPresets();

  const campaignHint = [
    objectiveLabel,
    budget ? `${currencySymbol}${Number(budget).toLocaleString('en-IN')}/day` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Panel>
        <PanelHeader
          title="Keep these coming"
          subtitle="New ads from this brief, on a schedule. Pause or stop any time."
          right={
            <Switch
              checked={enabled}
              onChange={(next) => onToggle?.(next)}
              ariaLabel="Keep these coming"
            />
          }
        />

        {/* Flipping the switch reveals the whole commitment — cadence, what it
            runs against, and the button that starts spending. It has to unfold
            from the switch rather than appear beneath it. */}
        <AnimatePresence initial={false}>
          {enabled && (
            <motion.div key="body" {...M.expand}>
              {/* WHEN on the left, WHERE on the right. The two are independent
                  — neither answer changes the other — so stacking them only
                  made the card tall. */}
              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div className="flex flex-col">
                  {/* ── How often ── as a sentence rather than a form, and
                      editable. Every value here was previously fixed text, so
                      the hour and timezone silently stayed on the schema
                      defaults and every schedule ran at 9:00 UTC. */}
                  <Section title="How often">
                    <CadencePills
                      frequency={frequency}
                      hour={hour}
                      timezone={timezone}
                      pairsPerCycle={pairsPerCycle}
                      custom={custom}
                      endDate={endDate}
                      onChange={onCadenceChange}
                      disabled={activating}
                    />
                  </Section>

                  <SectionRule />

                  {/* ── Who hears ── optional, so it sits under the cadence
                      rather than competing with the account pickers. */}
                  <Section>
                    <AlertEmails
                      value={alertEmails}
                      onChange={onAlertEmailsChange}
                      disabled={activating}
                    />
                  </Section>
                </div>

                {/* ── Where ── the pickers themselves, not a report of them. */}
                <div className={`border-t lg:border-t-0 lg:border-l ${RULE_BORDER}`}>
                  <Section title="Where these publish">
                    <div className="flex flex-col gap-4">
                      <LaunchConnection
                        value={connection}
                        onChange={onConnectionChange}
                        disabled={activating}
                      />

                      {/* The one line the pickers don't cover: we synthesise
                          the campaign, so there is nothing to choose. */}
                      <div
                        className={`flex items-center gap-3 border-t pt-3.5 text-13 ${RULE_BORDER}`}
                      >
                        <span className="shrink-0 text-[#6B7280] dark:text-[#8B939E]">
                          Campaign
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-[#111827] dark:text-[#ECEFF3]">
                          Built for you
                        </span>
                        {campaignHint && (
                          <span className={`shrink-0 ${FAINT}`}>{campaignHint}</span>
                        )}
                      </div>

                      <div className={`flex items-start gap-2.5 px-3.5 py-3 ${CONTROL}`}>
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF] dark:text-[#8B939E]" />
                        <p className={`leading-relaxed ${MUTED}`}>
                          No saved Meta template needed — we build one from your objective and
                          budget, and it stays editable in Ads Manager afterwards.
                        </p>
                      </div>
                    </div>
                  </Section>
                </div>
              </div>

              <PanelFooter>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                  <p className={MUTED}>
                    {creditsPerCycle != null && (
                      <>
                        ~
                        <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>
                          {creditsPerCycle}
                        </b>{' '}
                        credits per cycle
                        {firstRunLabel ? ' · ' : ''}
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

                  <PrimaryBtn onClick={onActivate} busy={activating} disabled={!isMetaConnected}>
                    {isMetaConnected ? 'Start deliveries' : 'Connect Meta to start'}
                  </PrimaryBtn>
                </div>
              </PanelFooter>
            </motion.div>
          )}
        </AnimatePresence>
    </Panel>
  );
}
