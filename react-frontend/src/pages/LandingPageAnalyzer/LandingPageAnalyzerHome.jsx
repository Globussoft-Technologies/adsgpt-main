import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Globe, ImageOff, Loader2, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createAnalysis,
  deleteAnalysis,
  getAnalyses,
} from '@/apis/landingPageAnalyzer/landingPageAnalyzerApi';
import { Card, GradBtn } from '@/components/LandingPageAnalyzer/_atoms';
import {
  prettyDate,
  prettyHost,
  resolveScreenshotUrl,
  scoreBand,
} from '@/components/LandingPageAnalyzer/helpers';

const STATUS = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  processing: 'border-[#15DCFF]/30 bg-[#15DCFF]/10 text-cyan-600 dark:text-cyan-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  failed: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
};
const STATUS_LABEL = {
  completed: 'Completed',
  processing: 'Analyzing',
  pending: 'Queued',
  failed: 'Failed',
};

const PAGE_SIZE = 12;

// Pre-flight URL check. The backend tries to normalise / fetch whatever we
// send and 500s on inputs like "oihl" (no protocol, no TLD, no host) — that
// surfaces as "Internal server error" to the user. Catching the obviously
// invalid cases client-side keeps that message out of the UI.
//
// Accepted shapes:
//   example.com           → assumed https
//   www.example.com/path  → assumed https
//   http(s)://example.com → parsed as-is
//
// Rejected:
//   "" / whitespace / single labels / non-ASCII (emoji) / IPs / TLDs that
//   aren't at least 2 alphabetic chars.
function isValidLandingPageUrl(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // No internal whitespace allowed — even though we trim, paste could carry
  // mid-string spaces (a common typo).
  if (/\s/.test(trimmed)) return false;
  // Block emojis and other non-ASCII codepoints from sneaking past the URL
  // constructor (which is permissive about Unicode hostnames).
  if (/[^\p{ASCII}]/u.test(trimmed)) return false;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  const host = parsed.hostname;
  if (!host || host.length < 3) return false;
  // Must have at least one dot — rejects "oihl", "localhost", bare words.
  if (!host.includes('.')) return false;
  // Last label must look like a TLD (two or more alpha chars). Rejects raw
  // IPs (e.g. 1.2.3.4 → TLD "4") and accidental ".123" suffixes.
  const tld = host.split('.').pop();
  if (!/^[a-z]{2,}$/i.test(tld)) return false;

  return true;
}

export default function LandingPageAnalyzerHome() {
  const navigate = useNavigate();
  const [recent, setRecent] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);

  // modal state
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchPage = useCallback(async (p) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (p === 1) setLoadingRecent(true);
    else setLoadingMore(true);
    try {
      const r = await getAnalyses({ page: p, limit: PAGE_SIZE });
      const items = r?.data || [];
      setRecent((prev) => (p === 1 ? items : [...prev, ...items]));
      setHasMore(!!r?.hasMore);
      setPage(p);
    } catch {
      /* ignore */
    } finally {
      loadingRef.current = false;
      setLoadingRecent(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  // Infinite scroll — load the next page when the sentinel nears the scroll box.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          fetchPage(page + 1);
        }
      },
      { root, rootMargin: '300px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, page, fetchPage]);

  const trimmedUrl = url.trim();
  // Empty input is "not yet typed" — show no inline error; just keep the
  // button disabled. Anything non-empty that fails validation surfaces the
  // hint underneath the field so the user knows why submit is blocked.
  const urlTouched = trimmedUrl.length > 0;
  const urlValid = urlTouched && isValidLandingPageUrl(trimmedUrl);
  const inlineError = error || (urlTouched && !urlValid ? 'Enter a valid URL (e.g. example.com or https://example.com).' : '');

  const handleAnalyze = async () => {
    if (!trimmedUrl || submitting) return;
    // Defensive — buttons are already disabled when !urlValid, but a user
    // could hit Enter on the input before the disabled prop applies.
    if (!isValidLandingPageUrl(trimmedUrl)) {
      setError('Enter a valid URL (e.g. example.com or https://example.com).');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await createAnalysis(trimmedUrl);
      const sessionId = res?.data?.sessionId;
      if (sessionId) {
        navigate(`/landing-page-analyzer/${sessionId}`);
      } else {
        setError(res?.error || 'Could not start the analysis. Please try again.');
        setSubmitting(false);
      }
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not start the analysis. Please try again.');
      setSubmitting(false);
    }
  };

  const openModal = () => {
    setUrl('');
    setError('');
    setSubmitting(false);
    setOpen(true);
  };

  const handleDelete = useCallback(
    async (idToDelete) => {
      // Optimistic — drop it from the grid immediately, restore on failure.
      setRecent((prev) => prev.filter((x) => x._id !== idToDelete));
      try {
        await deleteAnalysis(idToDelete);
      } catch {
        fetchPage(1);
      }
    },
    [fetchPage],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {loadingRecent ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-gray-400 dark:text-white/40" />
        </div>
      ) : recent.length === 0 ? (
        // True flex centering — no nested scroll container, no max-w-375
        // (which on this layout's content area was leaving asymmetric gaps
        // and reserving scrollbar gutter the empty state never uses).
        // EmptyHero already does its own internal items-center / justify-
        // center, so we just give it a full-height/full-width centering host.
        // Extra `pb-32` shifts the optical center slightly up — heroes feel
        // better seated a touch above the geometric middle, especially with
        // a heavy headline on top.
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-32 2xl:px-8 2xl:pb-40">
          <EmptyHero
            url={url}
            setUrl={setUrl}
            onAnalyze={handleAnalyze}
            submitting={submitting}
            error={inlineError}
            canSubmit={urlValid && !submitting}
          />
        </div>
      ) : (
        <>
          {/* static header */}
          <div className="mx-auto w-full max-w-375 shrink-0 px-4 pt-6 2xl:px-8">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-[26px] font-extrabold tracking-tight text-gray-900 dark:text-white">
                  Your Analyses
                </h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-white/55">
                  Score any landing page across 60+ conversion criteria.
                </p>
              </div>
              <GradBtn icon={Plus} onClick={openModal}>
                New Analysis
              </GradBtn>
            </div>
          </div>

          {/* scrollable grid */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="mx-auto max-w-375 px-4 pb-10 2xl:px-8">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {recent.map((a, i) => (
                  <AnalysisCard
                    key={a._id}
                    analysis={a}
                    index={i}
                    onOpen={() => navigate(`/landing-page-analyzer/${a._id}`)}
                    onDelete={handleDelete}
                  />
                ))}
              </div>

              {/* infinite-scroll sentinel + loader */}
              {hasMore && <div ref={sentinelRef} className="h-1" />}
              {loadingMore && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400 dark:text-white/40" />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* new-analysis modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold">New Analysis</DialogTitle>
            <DialogDescription>
              Paste a landing-page URL to score its conversion readiness.
            </DialogDescription>
          </DialogHeader>

          <div
            className={`flex items-center gap-2 rounded-xl border bg-gray-50 px-3 transition dark:bg-white/5 ${
              inlineError
                ? 'border-red-400/60 dark:border-red-500/40'
                : 'border-gray-200 dark:border-white/10'
            }`}
          >
            <Search className="h-4.5 w-4.5 shrink-0 text-gray-400 dark:text-white/45" />
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
              placeholder="https://example.com"
              className="min-w-0 flex-1 bg-transparent py-3 text-base text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-white/35"
            />
          </div>
          {inlineError && <p className="text-13 text-red-500">{inlineError}</p>}

          <GradBtn
            icon={submitting ? Loader2 : Search}
            spinning={submitting}
            onClick={handleAnalyze}
            disabled={submitting || !urlValid}
            className="w-full justify-center"
          >
            {submitting ? 'Starting…' : 'Analyze'}
          </GradBtn>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const EXAMPLES = ['stripe.com', 'airbnb.com', 'notion.so', 'spotify.com', 'apple.com'];

// First-run conversion hero (matches the empty-state design): gradient badge,
// gradient headline, inline analyze field, and quick-try example chips.
function EmptyHero({ url, setUrl, onAnalyze, submitting, error, canSubmit }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden py-12 text-center">
      {/* ambient glow */}
      <span className="pointer-events-none absolute left-1/2 top-1/4 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#15DCFF,transparent_70%)] opacity-10 blur-3xl" />
      <span className="pointer-events-none absolute bottom-1/4 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#6b72f8,transparent_70%)] opacity-10 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-center"
      >
        {/* badge */}
        <span className="inline-flex items-center gap-2 rounded-full border border-[#6b72f8]/30 bg-[#6b72f8]/10 px-3.5 py-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[#7c93ff]" />
          <span className="text-[11px] font-extrabold tracking-wider text-[#7c93ff] dark:text-[#aeb6ff]">
            AI CONVERSION AUDIT
          </span>
        </span>

        {/* headline */}
        <h2 className="mt-6 max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          Turn any page into a{' '}
          <span className="bg-linear-to-r from-[#15DCFF] to-[#6b72f8] bg-clip-text text-transparent">
            conversion plan.
          </span>
        </h2>

        {/* subtitle */}
        <p className="mt-5 max-w-lg text-base leading-relaxed text-gray-500 dark:text-white/60">
          No analyses yet. Paste a URL and we'll score it across 60+ criteria — messaging,
          structure, trust, and speed — then hand you a prioritized list of fixes. Takes about 10
          seconds.
        </p>

        {/* input */}
        <div
          className={`mt-8 flex w-full max-w-xl items-center gap-2 rounded-2xl border bg-gray-50 p-2 pl-4 transition dark:bg-white/5 ${
            error
              ? 'border-red-400/60 dark:border-red-500/40'
              : 'border-gray-200 dark:border-white/10'
          }`}
        >
          <Search className="h-5 w-5 shrink-0 text-gray-400 dark:text-white/45" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAnalyze()}
            placeholder="yourpage.com"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-white/35"
          />
          <GradBtn
            icon={submitting ? Loader2 : ArrowRight}
            spinning={submitting}
            onClick={onAnalyze}
            disabled={!canSubmit}
            className="px-5"
          >
            {submitting ? 'Starting…' : 'Analyze'}
          </GradBtn>
        </div>
        {error && <p className="mt-3 text-13 text-red-500">{error}</p>}

        {/* quick-try chips */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-13 text-gray-400 dark:text-white/45">Try:</span>
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setUrl(e)}
              className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-13 font-medium text-gray-500 transition-colors hover:border-[#6b72f8]/40 hover:text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-white/60 dark:hover:text-white"
            >
              {e}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function AnalysisCard({ analysis: a, index, onOpen, onDelete }) {
  const [imgErr, setImgErr] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const src = resolveScreenshotUrl(a.result?.screenshot_url);
  const showImg = src && !imgErr;
  const score = a.result?.overall?.score;
  const band = score != null ? scoreBand(score) : null;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="group cursor-pointer text-left outline-none"
    >
      <Card className="flex h-full flex-col overflow-hidden transition-colors hover:border-[#6b72f8]/40 dark:hover:border-[#6b72f8]/40">
        {/* screenshot */}
        <div className="relative h-44 overflow-hidden border-b border-gray-200 bg-[#0e0e13] dark:border-white/10">
          {showImg ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              onError={() => setImgErr(true)}
              className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full place-items-center text-gray-300 dark:text-white/20">
              <ImageOff className="h-7 w-7" />
            </div>
          )}
          {band && (
            <span
              className={`absolute right-3 top-3 inline-flex items-center rounded-full border px-2.5 py-1 text-13 font-extrabold tabular-nums backdrop-blur-md ${band.bg} ${band.ring}`}
              style={{ color: band.stroke }}
            >
              {score}
            </span>
          )}

          {/* delete (revealed on hover) */}
          <button
            type="button"
            aria-label="Delete analysis"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white/85 opacity-0 backdrop-blur-md transition-all hover:bg-red-500 hover:text-white group-hover:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          {/* confirm overlay */}
          {confirming && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 z-10 grid place-items-center bg-black/80 p-4 text-center backdrop-blur-sm"
            >
              <div>
                <p className="text-sm font-semibold text-white">Delete this analysis?</p>
                <p className="mt-1 truncate text-13 text-white/55">{prettyHost(a.inputUrl)}</p>
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(a._id);
                    }}
                    className="rounded-lg bg-red-500 px-3.5 py-1.5 text-13 font-bold text-white transition-colors hover:bg-red-600"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirming(false);
                    }}
                    className="rounded-lg border border-white/20 px-3.5 py-1.5 text-13 font-medium text-white/80 transition-colors hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* meta */}
        <div className="flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white/70">
            <Globe className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold text-gray-900 dark:text-white">
              {prettyHost(a.inputUrl)}
            </div>
            <div className="text-13 text-gray-400 dark:text-white/45">{prettyDate(a.createdAt)}</div>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-10 font-bold uppercase tracking-wide ${
              STATUS[a.status] || STATUS.pending
            }`}
          >
            {STATUS_LABEL[a.status] || a.status}
          </span>
        </div>
      </Card>
    </motion.div>
  );
}
