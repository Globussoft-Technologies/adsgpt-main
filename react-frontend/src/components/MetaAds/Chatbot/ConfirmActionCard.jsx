import React from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { summarizeAction } from './actionSummaries';

// One proposed action, translated to plain English via summarizeAction —
// raw tool name/args are still there, just tucked behind a collapsed
// "View raw request" toggle for whoever wants to double-check exactly what's
// being sent.
const ActionSummary = ({ action, currency }) => {
  const { title, rows } = summarizeAction(action.toolName, action.args, currency);
  const displayTitle = action.displayName
    ? title.replace(String(action.args?.campaign_id ?? ''), `“${action.displayName}” (${action.args.campaign_id})`)
    : title;
  const hasArgs = action.args && Object.keys(action.args).length > 0;
  return (
    <div className="mt-1 min-w-0 flex flex-col gap-1.5 rounded-lg bg-black/5 p-2.5 dark:bg-white/5">
      <p className="break-words text-sm font-medium text-gray-900 dark:text-white">{displayTitle}</p>
      {rows.length > 0 && (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          {rows.map((r, i) => (
            <React.Fragment key={i}>
              <dt className="text-gray-500 dark:text-gray-400">{r.label}</dt>
              <dd className="min-w-0 break-all text-gray-800 dark:text-gray-200">{String(r.value)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {hasArgs && (
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <ChevronDown className="size-3 -rotate-90 transition-transform group-open:rotate-0" />
            View raw request ({action.toolName})
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-black/5 p-2 text-[11px] text-gray-700 dark:bg-white/5 dark:text-gray-300">
            {JSON.stringify(action.args, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

// Rendered when the assistant proposes one or more write tool calls (create/
// update/pause/delete/etc.) in a single turn — nothing is sent to Meta until
// the user picks Confirm or Cancel, and the decision applies to every action
// listed. Mirrors the "render a card, replay the turn on the user's choice"
// pattern already used by AIAssistant's choice_form cards.
const ConfirmActionCard = ({ actions = [], onConfirm, onCancel, busy, currency }) => {
  const multiple = actions.length > 1;
  return (
    <div className="min-w-0 max-w-full flex flex-col gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {multiple
              ? `AdsGPT wants to run ${actions.length} actions`
              : 'AdsGPT wants to run this action'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {multiple
              ? 'These change your live Meta Ads account. Confirm applies to all of them; nothing happens until you confirm.'
              : 'This changes your live Meta Ads account. Nothing happens until you confirm.'}
          </p>
          {actions.map((action, i) => (
            <ActionSummary key={i} action={action} currency={currency} />
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    </div>
  );
};

export default ConfirmActionCard;
