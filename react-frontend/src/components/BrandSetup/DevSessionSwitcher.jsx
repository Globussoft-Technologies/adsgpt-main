// Dev-only: reopen a finished onboarding session instead of running a new one.
//
// A run costs real upstream work — research, scraping, three storyboards and
// their frames — and takes the better part of a minute. Every time this screen
// is touched, the only way to SEE the change was to pay for that again, or to
// dig a session id out of the network tab and hand-edit localStorage. So this
// is a picker: the sessions this user has already run, newest first, plus a box
// for an id somebody pasted in Slack.
//
// ── Why it is safe to ship ──────────────────────────────────────────────────
// The panel is behind `import.meta.env.DEV`, which Vite replaces with a literal
// `false` in a production build — the branch, this import and this whole module
// are dropped by dead-code elimination, so there is no hidden control on the
// live site and nothing to remember to remove.
//
// It also invents no privilege: both endpoints it calls are the ordinary,
// authenticated onboarding reads, and both scope by the caller's own user id.
// The worst it can do is open a session the user already owns.

import { useEffect, useState } from 'react';
import { ChevronUp, X } from 'lucide-react';
import { listOnboardingSessions } from '@/apis/onboarding/onboardingApi';
import { cn } from '@/lib/utils';

const shortDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
        ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/**
 * @param {(sessionId: string, view: 'board'|'clip') => Promise<void>} onOpen
 *   Loads the session. `view` picks which screen it lands on. Async so the row
 *   can show its own pending state rather than the whole screen blinking.
 * @param {string} currentId  Highlighted in the list; not disabled, since
 *   reopening the current one is a legitimate way to force a re-read.
 */
export default function DevSessionSwitcher({ onOpen, currentId = '' }) {
  const [open, setOpen] = useState(false);
  /**
   * Which screen a row opens.
   *
   * The clip view is the hard one to reach: it exists only after somebody
   * presses Generate and waits a minute for a render, and there is no URL for
   * it — it is a phase, not a route. Without this, seeing a change to that
   * screen means paying for another render every time. `clip` opens the
   * session straight onto whichever concept already has a video.
   */
  const [view, setView] = useState('board');
  const [items, setItems] = useState(null); // null = not read yet
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Read on OPEN, not on mount: this is a debug tool and it should not add a
  // request to the first paint of a screen it is not being used on.
  useEffect(() => {
    if (!open || items) return;
    listOnboardingSessions(25)
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setError(e?.response?.data?.error || e.message || 'Could not list sessions.');
      });
  }, [open, items]);

  const load = async (id) => {
    const sessionId = String(id || '').trim();
    if (!sessionId) return;
    setBusy(sessionId);
    setError('');
    try {
      await onOpen(sessionId, view);
      setOpen(false);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Could not open that session.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed right-3 bottom-3 z-[70] flex flex-col items-end gap-2 text-white">
      {open && (
        <div className="flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-white/12 bg-[#121216]/97 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-2">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-white/70 uppercase">
              Sessions · dev
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-white/40 transition hover:text-white"
              aria-label="Close the session switcher"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Which screen a row opens. Above the inputs because it changes what
              every one of them does. */}
          <div className="flex shrink-0 gap-1 border-b border-white/8 p-2.5">
            {[
              ['board', 'Board'],
              ['clip', 'Clip'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  'flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition',
                  view === key
                    ? 'border-[#15DCFF]/40 bg-[#15DCFF]/10 text-[#15DCFF]'
                    : 'border-white/10 bg-black/30 text-white/45 hover:text-white/75'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* The paste box first: when you already have the id, the list is in
              the way. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              load(manual);
            }}
            className="flex shrink-0 gap-1.5 border-b border-white/8 p-2.5"
          >
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="session id…"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-white/12 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/85 outline-none placeholder:text-white/25 focus:border-[#15DCFF]/50"
            />
            <button
              type="submit"
              disabled={!manual.trim() || Boolean(busy)}
              className="shrink-0 rounded-md border border-[#15DCFF]/35 bg-[#15DCFF]/10 px-2.5 text-[11px] font-semibold text-[#15DCFF] transition hover:bg-[#15DCFF]/20 disabled:opacity-40"
            >
              Open
            </button>
          </form>

          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
            {items === null && <p className="px-2 py-3 text-[11px] text-white/35">Reading…</p>}
            {items?.length === 0 && (
              <p className="px-2 py-3 text-[11px] text-white/35">
                No sessions on this account yet.
              </p>
            )}
            {(items || []).map((s) => (
              <button
                key={s.session_id}
                type="button"
                onClick={() => load(s.session_id)}
                disabled={Boolean(busy)}
                className={cn(
                  'block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.06] disabled:opacity-50',
                  s.session_id === currentId && 'bg-[#15DCFF]/[0.08]'
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-white/90">
                    {s.brandName || '(no brand name)'}
                  </span>
                  <span className="shrink-0 text-[9.5px] text-white/35">
                    {busy === s.session_id ? 'opening…' : shortDate(s.createdAt)}
                  </span>
                </div>
                {/* The three rails' statuses, because "which session had the
                    frames" is the actual question being asked of this list. */}
                <div className="mt-0.5 flex gap-1.5 text-[9px] text-white/35">
                  <span>brand: {s.brand?.status || '—'}</span>
                  <span>tpl: {s.templates?.status || '—'}</span>
                  <span>sb: {s.storyboards?.status || '—'}</span>
                  {/* The one that says whether "Clip" has anything to open. */}
                  <span>vid: {s.videos?.status || '—'}</span>
                </div>
                <div className="truncate font-mono text-[9px] text-white/25">{s.session_id}</div>
              </button>
            ))}
          </div>

          {error && (
            <p className="shrink-0 border-t border-white/8 px-3 py-2 text-[10.5px] text-red-300/80">
              {error}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full border border-white/12 bg-[#121216]/90 px-2.5 py-1 text-[10.5px] font-medium text-white/55 shadow-lg backdrop-blur transition hover:border-[#15DCFF]/40 hover:text-white"
      >
        <ChevronUp className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        dev
      </button>
    </div>
  );
}
