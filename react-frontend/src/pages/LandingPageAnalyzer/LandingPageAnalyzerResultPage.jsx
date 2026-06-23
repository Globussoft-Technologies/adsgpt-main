import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, Globe, RotateCw, Search } from 'lucide-react';
import { getAnalysisById, createAnalysis } from '@/apis/landingPageAnalyzer/landingPageAnalyzerApi';
import { clearLpaSession, getLpaSession } from '@/store/reducers/socket/socketSlice';
import emitter from '@/utils/eventEmitter';
import { RESULT_SECTIONS, prettyHost } from '@/components/LandingPageAnalyzer/helpers';
import { Card, GradBtn } from '@/components/LandingPageAnalyzer/_atoms';
import ResultHeader from '@/components/LandingPageAnalyzer/ResultHeader';
import SectionNav from '@/components/LandingPageAnalyzer/SectionNav';
import ExecutiveSummary from '@/components/LandingPageAnalyzer/ExecutiveSummary';
import SectionScores from '@/components/LandingPageAnalyzer/SectionScores';
import PageOverview from '@/components/LandingPageAnalyzer/PageOverview';
import ImprovementIdeas from '@/components/LandingPageAnalyzer/ImprovementIdeas';
import TechnicalSeo from '@/components/LandingPageAnalyzer/TechnicalSeo';
import AnalyzingMonitor from '@/components/LandingPageAnalyzer/AnalyzingMonitor';

// Fade-up reveal shared by every section.
const reveal = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
};

export default function LandingPageAnalyzerResultPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [relaunchMsg, setRelaunchMsg] = useState('');
  const [activeId, setActiveId] = useState(RESULT_SECTIONS[0].id);
  // Section we're programmatically scrolling to (tab click). While set, the
  // scroll-spy won't flicker through the sections we pass on the way there.
  const lockedRef = useRef(null);
  // Accumulated live-event stream (drives the analysing monitor).
  const [liveEvents, setLiveEvents] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const res = await getAnalysisById(id);
      setDoc(res?.data || null);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates. The global socket handler (socketSlice) buffers every
  // `landingPageAnalysisEvent` per session, so this page replays anything that
  // already fired before it mounted — then mirrors the buffer on each new event.
  // This is what makes early progress events show up instead of being missed.
  useEffect(() => {
    if (!id) return undefined;
    const sync = () => {
      const buf = getLpaSession(id);
      if (buf.events.length) setLiveEvents(buf.events);
      if (buf.result) {
        setRelaunchMsg('');
        setDoc((prev) =>
          prev && prev.result !== buf.result
            ? {
                ...prev,
                result: buf.result,
                status: buf.result?.success ? 'completed' : 'failed',
              }
            : prev,
        );
      }
    };
    sync(); // replay whatever the global buffer already captured
    const onSocket = (payload) => {
      if (payload?.sessionId === id) sync();
    };
    emitter.on('lpa:socket', onSocket);
    return () => emitter.off('lpa:socket', onSocket);
  }, [id]);

  const report = doc?.result;
  const status = doc?.status;
  const pageUrl = doc?.inputUrl || report?.url;
  const isDashboard = report && report.success === true;

  // Scroll-spy: highlight the nav tab for whichever section is in view.
  // Position-based (not IntersectionObserver) on purpose: IO fires on ANY
  // reflow — e.g. the Section-Scores "By category" re-sort animating cards in —
  // which made the active tab flicker to Overview and back. A scroll listener
  // only fires on real scrolling, so content reflows can't move the active tab.
  useEffect(() => {
    if (!isDashboard) return undefined;
    const root = containerRef.current;
    if (!root) return undefined;
    const ids = RESULT_SECTIONS.map((s) => s.id);

    let raf = 0;
    const compute = () => {
      raf = 0;
      // Activation line ~28% down the viewport: the active section is the last
      // one whose top has crossed it.
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.28;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // Bottom of the page can't push the last section past the line — pin it.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        current = ids[ids.length - 1];
      }
      // Mid programmatic scroll: hold the target tab, release once we arrive.
      if (lockedRef.current) {
        if (current === lockedRef.current) lockedRef.current = null;
        return;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    compute(); // initial highlight
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isDashboard]);

  const handleSelect = (sectionId) => {
    lockedRef.current = sectionId; // don't flicker through passed sections
    setActiveId(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleRelaunch = useCallback(async () => {
    if (!pageUrl) return;
    setRelaunching(true);
    setRelaunchMsg('');
    try {
      // forceRefresh → python bypasses its 24h cache and does a fresh scan.
      const res = await createAnalysis(pageUrl, { forceRefresh: true });
      const newId = res?.data?.sessionId;
      // Wipe the buffered old result so it isn't replayed onto the re-scan.
      clearLpaSession(newId || id);
      if (newId && newId !== id) {
        // Failed doc was deleted server-side → fresh doc under a new id.
        navigate(`/landing-page-analyzer/${newId}`);
      } else {
        // Re-scan in place → drop straight into the live analysing monitor.
        setLiveEvents([]);
        setDoc((prev) =>
          prev ? { ...prev, result: null, lastEvent: null, status: 'processing' } : prev,
        );
      }
    } catch {
      setRelaunchMsg('Could not start re-analysis. Please try again.');
    } finally {
      setRelaunching(false);
    }
  }, [pageUrl, id, navigate]);

  // ── states ────────────────────────────────────────────────────────────────
  if (loading) return <Shell><LoadingState /></Shell>;
  if (fetchError) {
    return (
      <Shell>
        <CenteredCard
          icon={AlertTriangle}
          tone="error"
          title="Couldn't load this analysis"
          message="Something went wrong fetching the report. Please try again."
          actionLabel="Retry"
          onAction={load}
          actionIcon={RotateCw}
        />
      </Shell>
    );
  }
  if (!doc) {
    return (
      <Shell>
        <CenteredCard
          icon={Search}
          title="Analysis not found"
          message="This analysis doesn't exist or doesn't belong to your account."
        />
      </Shell>
    );
  }
  if (report && report.success === false) {
    return (
      <Shell>
        <CenteredCard
          icon={AlertTriangle}
          tone="error"
          title="Analysis failed"
          message={report.error || 'We could not analyse this page. Please try again.'}
          subtitle={pageUrl ? prettyHost(pageUrl) : undefined}
          actionLabel={relaunching ? 'Relaunching…' : 'Relaunch Analysis'}
          onAction={handleRelaunch}
          actionDisabled={relaunching}
          actionIcon={RotateCw}
          actionSpinning={relaunching}
        />
      </Shell>
    );
  }
  if (!isDashboard) {
    // pending / processing — show the live analysis monitor. Seed the timeline
    // from the persisted lastEvent if the socket stream hasn't started (reload).
    const events = liveEvents.length
      ? liveEvents
      : doc.lastEvent
        ? [doc.lastEvent]
        : [];
    // Viewport-locked: the page itself doesn't scroll; the step feed scrolls
    // internally, so the whole monitor always fits on one screen.
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-375 flex-1 flex-col px-4 pb-4 pt-2 2xl:px-8">
          <button
            type="button"
            onClick={() => navigate('/landing-page-analyzer')}
            className="mt-3 inline-flex shrink-0 items-center gap-1.5 self-start text-13 font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-white/55 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to analyses
          </button>
          <AnalyzingMonitor
            className="mt-3 flex-1"
            events={events}
            url={pageUrl}
            sessionId={id}
            onRetry={handleRelaunch}
            relaunching={relaunching}
          />
        </div>
      </div>
    );
  }

  // ── dashboard ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Fixed header — back link, title/score, and the section tabs stay put;
          only the content area below scrolls. */}
      <div className="shrink-0">
        <div className="mx-auto w-full max-w-375 px-4 2xl:px-8">
          <button
            type="button"
            onClick={() => navigate('/landing-page-analyzer')}
            className="mt-3 inline-flex items-center gap-1.5 text-13 font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-white/55 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to analyses
          </button>

          <ResultHeader
            report={report}
            url={pageUrl}
            onRelaunch={handleRelaunch}
            relaunching={relaunching}
          />

          <SectionNav sections={RESULT_SECTIONS} activeId={activeId} onSelect={handleSelect} />
        </div>
      </div>

      {/* Scrollable content — the only part that scrolls. */}
      <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-375 px-4 pb-24 2xl:px-8">
          {relaunchMsg && (
            <div className="mb-6 rounded-xl border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-4 py-2.5 text-13 text-cyan-700 dark:text-cyan-300">
              {relaunchMsg}
            </div>
          )}

          <div className="space-y-14 pt-2">
            {/* Hero — one white section heading above a common parent card that
                holds Page Overview + Executive Summary as two equal-height cards. */}
        <motion.div {...reveal}>
          <h2 className="mb-4 text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            Page Overview
          </h2>
          <Card className="p-4 2xl:p-5">
            <div className="grid items-stretch gap-4 xl:grid-cols-[1.05fr_1fr] 2xl:gap-5">
              <section id="on-page-audit" className="scroll-mt-24">
                <PageOverview report={report} showCaption={false} />
              </section>

              <section id="overview" className="scroll-mt-24">
                <ExecutiveSummary report={report} showCaption={false} />
              </section>
            </div>
          </Card>
        </motion.div>

        <motion.section id="section-scores" className="scroll-mt-24" {...reveal}>
          <SectionScores report={report} />
        </motion.section>

        <motion.section id="improvement-ideas" className="scroll-mt-24" {...reveal}>
          <ImprovementIdeas report={report} />
        </motion.section>

        <motion.section id="technical-seo" className="scroll-mt-24" {...reveal}>
          <TechnicalSeo report={report} />
        </motion.section>

        {/* footer relaunch CTA */}
        <motion.div {...reveal}>
          <Card className="flex flex-wrap items-center gap-4 p-7 2xl:p-8">
            <div className="min-w-55 flex-1">
              <div className="text-lg 2xl:text-xl font-bold text-gray-900 dark:text-white">
                Made changes? Relaunch the analysis.
              </div>
              <div className="mt-1 text-sm text-gray-500 dark:text-white/60">
                Re-crawl {prettyHost(pageUrl)} to see how your score moves.
              </div>
            </div>
            <GradBtn icon={RotateCw} spinning={relaunching} onClick={handleRelaunch} disabled={relaunching}>
              {relaunching ? 'Relaunching…' : 'Relaunch Analysis'}
            </GradBtn>
          </Card>
        </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── layout shell (the scroll container) ───────────────────────────────────────
function Shell({ children, containerRef }) {
  const navigate = useNavigate();
  return (
    <div ref={containerRef} className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-375 px-4 pb-24 2xl:px-8">
        {/* Sticky back bar — pins above the (also sticky) section nav. */}
        <div className="sticky top-0 z-30 -mx-4 bg-background/85 px-4 py-3 2xl:-mx-8 2xl:px-8">
          <button
            type="button"
            onClick={() => navigate('/landing-page-analyzer')}
            className="inline-flex items-center gap-1.5 text-13 font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-white/55 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to analyses
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── shared centered card for loading / error / failure / analysing ────────────
function CenteredCard({
  icon: Icon,
  tone,
  spinning,
  title,
  message,
  subtitle,
  actionLabel,
  onAction,
  actionDisabled,
  actionIcon: ActionIcon,
  actionSpinning,
}) {
  const iconWrap =
    tone === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-500'
      : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white/70';
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-lg p-10 text-center">
        <span
          className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border ${iconWrap}`}
        >
          <Icon className={`h-7 w-7 ${spinning ? 'animate-spin' : ''}`} />
        </span>
        {subtitle && (
          <p className="mb-1.5 flex items-center justify-center gap-1.5 text-sm text-gray-400 dark:text-white/45">
            <Globe className="h-4 w-4" />
            {subtitle}
          </p>
        )}
        <h3 className="text-xl font-extrabold text-gray-900 dark:text-white">{title}</h3>
        <p className="mt-2.5 text-sm leading-relaxed text-gray-500 dark:text-white/65">{message}</p>
        {actionLabel && (
          <div className="mt-6 flex justify-center">
            <GradBtn
              icon={ActionIcon}
              spinning={actionSpinning}
              onClick={onAction}
              disabled={actionDisabled}
            >
              {actionLabel}
            </GradBtn>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── first-load skeleton ───────────────────────────────────────────────────────
// Mirrors the loaded hero: header + tabs, the "Page Overview" heading, and the
// two-column parent card (Page Overview screenshot · Executive Summary).
function LoadingState() {
  const bar = 'rounded bg-gray-100 dark:bg-white/5';
  return (
    <div className="animate-pulse">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-3">
          <div className={`h-7 w-40 ${bar}`} />
          <div className="h-6 w-24 rounded-full bg-gray-100 dark:bg-white/5" />
          <div className={`h-4 w-28 ${bar}`} />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-44 rounded-xl bg-gray-100 dark:bg-white/5" />
          <div className="h-9 w-40 rounded-xl bg-gray-100 dark:bg-white/5" />
        </div>
      </div>

      {/* nav tabs */}
      <div className="mb-8 flex gap-8 border-b border-gray-200 pb-4 dark:border-white/10">
        <div className={`h-4 w-16 ${bar}`} />
        <div className={`h-4 w-24 ${bar}`} />
        <div className={`h-4 w-28 ${bar}`} />
        <div className={`h-4 w-24 ${bar}`} />
      </div>

      {/* Page Overview heading */}
      <div className={`mb-4 h-6 w-44 ${bar}`} />

      {/* hero parent card */}
      <Card className="p-4 2xl:p-5">
        <div className="grid items-stretch gap-4 lg:grid-cols-[1.05fr_1fr] 2xl:gap-5">
          {/* left — page overview */}
          <Card className="flex min-h-100 flex-col overflow-hidden">
            <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/10">
              <div className="flex gap-2">
                <span className="h-3 w-3 rounded-full bg-gray-200 dark:bg-white/10" />
                <span className="h-3 w-3 rounded-full bg-gray-200 dark:bg-white/10" />
                <span className="h-3 w-3 rounded-full bg-gray-200 dark:bg-white/10" />
              </div>
              <div className="mx-auto h-7 w-72 max-w-full rounded-lg bg-gray-100 dark:bg-white/5" />
            </div>
            <div className="flex-1 bg-gray-100 dark:bg-white/3" />
          </Card>

          {/* right — executive summary */}
          <Card className="flex flex-col gap-6 p-6">
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <div className="h-[150px] w-[150px] shrink-0 rounded-full border-[12px] border-gray-100 dark:border-white/6" />
              <div className="w-full flex-1 space-y-2.5">
                <div className={`h-3.5 w-full ${bar}`} />
                <div className={`h-3.5 w-[92%] ${bar}`} />
                <div className={`h-3.5 w-[96%] ${bar}`} />
                <div className={`h-3.5 w-[85%] ${bar}`} />
                <div className={`h-3.5 w-3/5 ${bar}`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/3"
                />
              ))}
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );
}
