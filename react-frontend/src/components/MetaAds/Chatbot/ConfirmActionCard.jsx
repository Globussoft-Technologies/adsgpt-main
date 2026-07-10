import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Rendered when the assistant proposes one or more write tool calls (create/
// update/pause/delete/etc.) in a single turn — nothing is sent to Meta until
// the user picks Confirm or Cancel, and the decision applies to every action
// listed. Mirrors the "render a card, replay the turn on the user's choice"
// pattern already used by AIAssistant's choice_form cards.
const ConfirmActionCard = ({ actions = [], onConfirm, onCancel, busy }) => {
  const multiple = actions.length > 1;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex w-full flex-col gap-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {multiple
              ? `Gemini wants to run ${actions.length} actions`
              : 'Gemini wants to run this action'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {multiple
              ? 'These change your live Meta Ads account. Confirm applies to all of them; nothing happens until you confirm.'
              : 'This changes your live Meta Ads account. Nothing happens until you confirm.'}
          </p>
          {actions.map((action, i) => (
            <div key={i} className="mt-1 flex flex-col gap-1">
              <code className="w-fit rounded bg-black/5 px-1 py-0.5 text-xs text-gray-900 dark:bg-white/10 dark:text-white">
                {action.toolName}
              </code>
              {action.args && Object.keys(action.args).length > 0 && (
                <pre className="max-h-40 overflow-auto rounded-md bg-black/5 p-2 text-[11px] text-gray-700 dark:bg-white/5 dark:text-gray-300">
                  {JSON.stringify(action.args, null, 2)}
                </pre>
              )}
            </div>
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
