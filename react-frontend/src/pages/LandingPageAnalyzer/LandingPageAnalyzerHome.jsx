import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Globe, ImageOff, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createAnalysis, getAnalyses } from '@/apis/landingPageAnalyzer/landingPageAnalyzerApi';
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

  const handleAnalyze = async () => {
    const trimmed = url.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await createAnalysis(trimmed);
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {loadingRecent ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-gray-400 dark:text-white/40" />
        </div>
      ) : recent.length === 0 ? (
        <div className="mx-auto flex w-full max-w-375 flex-1 flex-col overflow-y-auto scrollbar-thin px-4 2xl:px-8">
          <EmptyHero
            url={url}
            setUrl={setUrl}
            onAnalyze={handleAnalyze}
            submitting={submitting}
            error={error}
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

          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 dark:border-white/10 dark:bg-white/5">
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
          {error && <p className="text-13 text-red-500">{error}</p>}

          <GradBtn
            icon={submitting ? Loader2 : Search}
            spinning={submitting}
            onClick={handleAnalyze}
            disabled={submitting || !url.trim()}
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
function EmptyHero({ url, setUrl, onAnalyze, submitting, error }) {
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
        <div className="mt-8 flex w-full max-w-xl items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-2 pl-4 dark:border-white/10 dark:bg-white/5">
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
            disabled={submitting || !url.trim()}
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

function AnalysisCard({ analysis: a, index, onOpen }) {
  const [imgErr, setImgErr] = useState(false);
  const src = resolveScreenshotUrl(a.result?.screenshot_url);
  const showImg = src && !imgErr;
  const score = a.result?.overall?.score;
  const band = score != null ? scoreBand(score) : null;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="group text-left"
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
    </motion.button>
  );
}
