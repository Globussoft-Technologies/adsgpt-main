import React from 'react';
import { Check, Info } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Switch } from '@/components/Autopilot/_atoms';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Panel, PanelBody, PanelFooter, PanelHeader, PrimaryBtn } from './Panel';
import { useMotionPresets } from './_motion';

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
// The cadence reads as a sentence in pills — EVERY week, AT 9:00, N pairs — and
// the connection reads as a checklist, because "is this actually hooked up to
// my ad account" is the question standing between a user and pressing the
// button.
//
// The template note is not decoration. Scheduling used to dead-end for anyone
// without a saved Meta template; saying so here is what tells the user they
// don't need one.
// ----------------------------------------------------------------------------

const FREQUENCIES = [
  { value: 'daily', label: 'day' },
  { value: 'weekly', label: 'week' },
  { value: 'biweekly', label: '2 weeks' },
  { value: 'monthly', label: 'month' },
];

export default function KeepTheseComing({
  enabled,
  onToggle,
  frequency = 'weekly',
  onFrequencyChange,
  onActivate,
  activating = false,
  isMetaConnected = false,
  connection = {},
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

  const tz =
    timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'your timezone';

  // Narrower than the stages around it, and centred. This is a commitment, not
  // a browse — the column is short so the whole decision is in one glance.
  return (
    <div className="mx-auto w-full max-w-xl">
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
            <PanelBody className="flex flex-col gap-4">
            {/* Cadence, as a sentence rather than a form. */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Same shadcn Select as everywhere else, trimmed to sit inside
                  the pill: no border or background of its own, because the
                  Pill already provides both. A native <select> here rendered
                  an OS-drawn list that ignored the dark palette. */}
              <Pill label="EVERY">
                <Select value={frequency} onValueChange={(v) => onFrequencyChange?.(v)}>
                  <SelectTrigger className="h-auto! w-auto gap-1.5 border-0 bg-transparent p-0 text-13 font-bold text-gray-900 shadow-none focus:ring-0 dark:text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-9999 border border-black/10 bg-white text-gray-900 dark:border-white/20 dark:bg-[#14181D] dark:text-white">
                    {FREQUENCIES.map((f) => (
                      <SelectItem
                        key={f.value}
                        value={f.value}
                        className="text-13 dark:focus:bg-white/10"
                      >
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Pill>
              <Pill label="AT">
                <b className="tabular-nums">{clock(hour)}</b>
                <span className="text-gray-400 dark:text-white/45">{shortZone(tz)}</span>
              </Pill>
              <Pill>
                <b className="tabular-nums">{pairsPerCycle}</b>
                <span className="text-gray-400 dark:text-white/45">pairs per run</span>
              </Pill>
            </div>

            {/* What it runs against. */}
            <dl className="flex flex-col border-t border-gray-200 pt-1 dark:border-white/10">
              <Row label="Ad account" value={connection.adAccountLabel || connection.adAccountId} />
              <Row label="Facebook Page" value={connection.pageLabel || connection.pageId} />
              <Row
                label="Campaign"
                value="Built for you"
                hint={[
                  objectiveLabel,
                  budget ? `${currencySymbol}${Number(budget).toLocaleString('en-IN')}/day` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                done={false}
              />
            </dl>

            <div className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/6">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/45" />
              <p className="text-xs leading-relaxed text-gray-500 dark:text-white/60">
                No saved Meta template needed — we build one from your objective and budget,
                and it stays editable in Ads Manager afterwards.
              </p>
            </div>
            </PanelBody>

            <PanelFooter>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
              <p className="text-xs text-gray-500 dark:text-white/55">
                {creditsPerCycle != null && (
                  <>
                    ~<b className="tabular-nums text-gray-900 dark:text-white/90">{creditsPerCycle}</b>{' '}
                    credits per cycle
                    {firstRunLabel ? ' · ' : ''}
                  </>
                )}
                {firstRunLabel && (
                  <>
                    first run <b className="text-gray-900 dark:text-white/90">{firstRunLabel}</b>
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
    </div>
  );
}

function Pill({ label, children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-13 text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">
      {label && (
        <span className="text-10 font-extrabold tracking-wider text-gray-400 dark:text-white/45">
          {label}
        </span>
      )}
      {children}
    </span>
  );
}

// A row reads as done only when we actually have the id — an unconnected
// account showing a tick is the one thing that would make this checklist
// worthless.
function Row({ label, value, hint, done }) {
  const isDone = done ?? Boolean(value);
  return (
    <div className="flex items-center gap-3 border-b border-gray-200 py-2.5 text-13 last:border-b-0 dark:border-white/10">
      <dt className="w-30 shrink-0 text-gray-500 dark:text-white/55">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-white">
        {value || <span className="font-normal text-gray-400 dark:text-white/40">Not selected</span>}
      </dd>
      {hint && (
        <span className="shrink-0 text-xs text-gray-400 dark:text-white/45">{hint}</span>
      )}
      {isDone && (
        <span className="inline-flex shrink-0 items-center gap-1 text-11 font-bold text-emerald-600 dark:text-emerald-400">
          <Check className="h-3 w-3" />
          connected
        </span>
      )}
    </div>
  );
}

// 9 → "9:00 AM". The pill reads as a sentence, and 24-hour time in the middle
// of one reads as a setting rather than a time of day.
function clock(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '';
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
}

// "Asia/Kolkata" → "IST"-ish. Falls back to the last path segment rather than
// printing a full IANA name into a pill.
function shortZone(tz) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || tz.split('/').pop();
  } catch {
    return String(tz).split('/').pop();
  }
}
