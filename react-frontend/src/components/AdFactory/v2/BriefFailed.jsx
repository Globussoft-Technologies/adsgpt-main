import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { GhostBtn, Notice, Panel, PanelBody, PanelFooter, PanelHeader, PrimaryBtn } from './Panel';
import { MUTED } from './_tokens';

// ----------------------------------------------------------------------------
// BriefFailed — when reading the page didn't work.
//
// This screen exists because its absence was a real bug: a brief whose
// inference failed fell straight through to the editable brief screen and
// rendered as an EMPTY FORM with no explanation. The user's reasonable reading
// of that is "the product is broken and won't say why".
//
// Two failure shapes, and the difference matters to what the user should do:
//
//   failed      — our side, or the reader was down. Retrying is worth it.
//   needs_input — the page was read but yielded too little. Retrying the same
//                 URL changes nothing; a different URL or a saved brand will.
//
// Either way the user is never left without a next step — that dead end is the
// exact thing Ad Factory 2.0 exists to remove.
// ----------------------------------------------------------------------------

export default function BriefFailed({
  status,
  reason,
  url,
  onRetry,
  onStartOver,
  retrying = false,
}) {
  const isRetryable = status !== 'needs_input';

  return (
    <div className="mx-auto w-full max-w-2xl px-4">
      <Panel>
        <PanelHeader
          title={
            isRetryable ? "We couldn't read that page" : "We didn't get much from that page"
          }
          subtitle={url}
        />

        <PanelBody>
          <Notice tone="warn" icon={AlertCircle}>
            {reason ||
              (isRetryable
                ? 'Our page reader is unavailable right now. Try again in a moment.'
                : "There wasn't enough on that page to build a brief from.")}
          </Notice>
        </PanelBody>

        <PanelFooter>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className={`max-w-100 ${MUTED}`}>
              {isRetryable
                ? 'Nothing was charged, and nothing was lost — your budget is still saved.'
                : 'A product or landing page with real copy on it works best. A saved brand works too.'}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <GhostBtn onClick={onStartOver}>Use a different URL or brand</GhostBtn>
              {isRetryable && onRetry && (
                <PrimaryBtn icon={RotateCcw} onClick={onRetry} busy={retrying}>
                  {retrying ? 'Trying again…' : 'Try again'}
                </PrimaryBtn>
              )}
            </div>
          </div>
        </PanelFooter>
      </Panel>
    </div>
  );
}
