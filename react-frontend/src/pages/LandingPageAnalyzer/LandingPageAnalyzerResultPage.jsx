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
  useEffect(() => {
    if (!isDashboard) return undefined;
    const root = containerRef.current;
    const els = RESULT_SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!els.length) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { root, rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [isDashboard]);

  const handleSelect = (sectionId) => {
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
    <Shell containerRef={containerRef}>
      <ResultHeader
        report={report}
        url={pageUrl}
        onRelaunch={handleRelaunch}
        relaunching={relaunching}
      />

      <SectionNav sections={RESULT_SECTIONS} activeId={activeId} onSelect={handleSelect} />

      {relaunchMsg && (
        <div className="mb-6 rounded-xl border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-4 py-2.5 text-13 text-cyan-700 dark:text-cyan-300">
          {relaunchMsg}
        </div>
      )}

      <div className="space-y-14">
        <motion.section id="overview" className="scroll-mt-24" {...reveal}>
          <ExecutiveSummary report={report} />
        </motion.section>

        <motion.section id="section-scores" className="scroll-mt-24" {...reveal}>
          <SectionScores report={report} />
        </motion.section>

        <div className="grid items-start gap-8 xl:grid-cols-[1.15fr_1fr]">
          <motion.section id="on-page-audit" className="scroll-mt-24" {...reveal}>
            <PageOverview report={report} />
          </motion.section>

          <motion.section id="improvement-ideas" className="scroll-mt-24" {...reveal}>
            <ImprovementIdeas report={report} />
          </motion.section>
        </div>

        <motion.section id="technical-seo" className="scroll-mt-24" {...reveal}>
          <TechnicalSeo report={report} />
        </motion.section>

        {/* footer relaunch CTA */}
        <motion.div {...reveal}>
          <Card className="flex flex-wrap items-center gap-4 p-7 2xl:p-8">
            <div className="min-w-55 flex-1">
              <div className="text-xl font-bold text-gray-900 dark:text-white">
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
    </Shell>
  );
}

// ── layout shell (the scroll container) ───────────────────────────────────────
function Shell({ children, containerRef }) {
  const navigate = useNavigate();
  return (
    <div ref={containerRef} className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-375 px-4 pb-24 pt-2 2xl:px-8">
        <button
          type="button"
          onClick={() => navigate('/landing-page-analyzer')}
          className="mt-3 inline-flex items-center gap-1.5 text-13 font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-white/55 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to analyses
        </button>
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
function LoadingState() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between py-4">
        <div className="h-5 w-40 rounded bg-gray-100 dark:bg-white/5" />
        <div className="flex gap-2">
          <div className="h-9 w-44 rounded-xl bg-gray-100 dark:bg-white/5" />
          <div className="h-9 w-24 rounded-xl bg-gray-100 dark:bg-white/5" />
          <div className="h-9 w-40 rounded-xl bg-gray-100 dark:bg-white/5" />
        </div>
      </div>
      <div className="mb-8 h-10 border-b border-gray-200 dark:border-white/10" />
      <div className="h-64 rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#14181D]" />
    </div>
  );
}
