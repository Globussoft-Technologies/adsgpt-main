// /brand-preview — the workspace, without the run.
//
// A design harness. Onboarding takes ~30 seconds and can fail outright, which
// makes it a poor way to iterate on the screen that comes after it. This mounts
// the same `Workspace` component the product uses, so anything that looks right
// here looks right in the flow.
//
//   /brand-preview                 the captured sample (same brand every time)
//   /brand-preview?session=<id>    a real session, read from our own database
//
// The second form is the answer to "we use our db right?" — yes: Node persists
// every finished run, so any completed session can be replayed into this screen
// with nothing but its id. The sample is the default only because it always
// renders, with no network and no auth.
//
// NOTHING IMPORTS THIS EXCEPT THE ROUTER. It is not reachable from the product,
// and the sample data lives in its own clearly-named file so it cannot drift
// into anything real.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Workspace from '@/components/BrandSetup/Workspace';
import sampleResult from '@/components/BrandSetup/sampleResult';
import { getOnboardingContext } from '@/apis/onboarding/onboardingApi';

export default function WorkspacePreview() {
  const [params] = useSearchParams();
  const sessionId = params.get('session');
  const [result, setResult] = useState(sampleResult);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;

    getOnboardingContext(sessionId)
      .then((data) => {
        if (cancelled) return;
        // The context endpoint returns the stored record; the workspace wants
        // the result shape, and older records nest it one level down.
        setResult(data?.context ? data : { context: data });
        setNote('');
      })
      .catch(() => {
        if (cancelled) return;
        // Falling back silently would be worse than saying so — you would be
        // designing against the sample while believing it was your session.
        setNote(`Could not load session ${sessionId} — showing the sample instead.`);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <>
      {/* Deliberately hard to miss. A preview that looks exactly like the real
          screen is only safe if it says which one it is. */}
      <div className="fixed top-0 right-0 left-0 z-50 bg-amber-400/90 px-4 py-1 text-center text-[11px] font-medium text-black">
        preview · {sessionId ? `session ${sessionId}` : 'sample data'}
        {note ? ` · ${note}` : ''}
      </div>
      <Workspace
        result={result}
        onRegenerate={() => window.alert('Regenerate is wired in the real flow, not the preview.')}
        onStartOver={() => window.location.assign('/onboarding')}
      />
    </>
  );
}
