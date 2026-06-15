import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Camera,
  Check,
  ClipboardList,
  Eye,
  Globe,
  LayoutGrid,
  LayoutTemplate,
  Lock,
  RotateCw,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { Card, GhostBtn, GradBtn } from './_atoms';
import { resolveScreenshotUrl } from './helpers';

const CYAN = '#15DCFF';
const GREEN = '#27e0a0';
const CRIT = '#ef4444';
const BLUE = '#7c93ff';

// The fixed analysis pipeline (matches the Landing Page Health event spec).
const PIPELINE = [
  { key: 'SCRAPING_START', label: 'Connecting to page', icon: Globe },
  { key: 'SCRAPING_PAGE_LOADED', label: 'Page loaded', icon: LayoutTemplate },
  { key: 'SCREENSHOT_CAPTURING', label: 'Capturing screenshot', icon: Camera },
  { key: 'SCRAPING_COMPLETE', label: 'Content extracted', icon: Eye },
  { key: 'LLM_ANALYSIS_START', label: 'AI analysis started', icon: Sparkles },
  { key: 'LLM_ANALYSIS_PROCESSING', label: 'Evaluating dimensions', icon: BarChart3 },
  { key: 'LLM_ANALYSIS_COMPLETE', label: 'AI analysis complete', icon: Sparkles },
  { key: 'SCORE_CALCULATION', label: 'Calculating score', icon: LayoutGrid },
  { key: 'SCORE_COMPLETE', label: 'Score complete', icon: Target },
  { key: 'FINALIZING', label: 'Finalizing results', icon: ClipboardList },
  { key: 'COMPLETE', label: 'Scan complete', icon: Check },
];
const idxOf = (key) => PIPELINE.findIndex((p) => p.key === key);

const fmtTime = (t) => {
  if (!t) return '—';
  try {
    return new Date(t).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return '—';
  }
};

// ─── progress card ───────────────────────────────────────────────────────────
function ProgressCard({ latest, isError, lastGood }) {
  const p = isError ? lastGood : latest ? latest.progress : 0;
  const done = !isError && p >= 100;
  return (
    <Card
      className="p-5"
      style={isError ? { borderColor: 'rgba(239,68,68,0.4)' } : undefined}
    >
      <div className="flex items-center gap-3">
        {isError ? (
          <span className="grid h-6 w-6 place-items-center rounded-full border border-red-500 bg-red-500/15 text-red-500">
            <X className="h-3.5 w-3.5" strokeWidth={2.6} />
          </span>
        ) : done ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-linear-to-r from-[#15DCFF] to-[#6b72f8] text-white">
            <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
          </span>
        ) : (
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-white/20"
            style={{ borderTopColor: CYAN }}
          />
        )}
        <span
          className={`flex-1 text-base font-bold leading-snug ${isError ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}
        >
          {latest ? latest.message : 'Starting…'}
        </span>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${Math.max(0, p)}%`,
            background: isError ? CRIT : 'linear-gradient(to right, #15DCFF, #6b72f8)',
            boxShadow: isError ? 'none' : '0 0 12px rgba(53,160,230,0.5)',
          }}
        />
      </div>

      <div className="mt-3 flex justify-between text-13 text-gray-500 dark:text-white/55">
        <span>
          {isError ? (
            <span className="font-bold text-red-500">Scan failed</span>
          ) : p >= 100 ? (
            <span className="font-bold" style={{ color: GREEN }}>
              All checks complete
            </span>
          ) : (
            'Analyzing in real time…'
          )}
        </span>
        <span
          className="font-extrabold tabular-nums text-gray-900 dark:text-white"
          style={isError ? { color: CRIT } : undefined}
        >
          {isError ? '—' : `${Math.max(0, p)}%`}
        </span>
      </div>
    </Card>
  );
}

// ─── live step feed ──────────────────────────────────────────────────────────
function LiveFeed({ events, isError }) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);
  const good = events.filter((e) => e.progress >= 0);
  const byKey = {};
  good.forEach((e) => {
    byKey[e.event] = e;
  });
  const lastKey = good.length ? good[good.length - 1].event : null;
  const reached = lastKey ? idxOf(lastKey) : -1;
  const complete = good.length ? good[good.length - 1].progress >= 100 : false;
  const errEvent = isError ? events[events.length - 1] : null;

  useEffect(() => {
    if (containerRef.current && activeRef.current) {
      containerRef.current.scrollTop = Math.max(0, activeRef.current.offsetTop - 90);
    }
  }, [events.length]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col p-5">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="relative h-2 w-2">
          <span
            className="absolute inset-0 rounded-full"
            style={{ background: isError ? CRIT : GREEN }}
          />
          {!complete && !isError && (
            <span
              className="lpa-pulse absolute -inset-1 rounded-full border"
              style={{ borderColor: GREEN }}
            />
          )}
        </span>
        <span className="text-13 font-extrabold tracking-widest text-gray-900 dark:text-white">
          ANALYSIS STEPS
        </span>
        <span className="ml-auto text-13 tabular-nums text-gray-400 dark:text-white/45">
          {good.length} / {PIPELINE.length}
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative flex flex-1 flex-col overflow-y-auto scrollbar-thin pr-1"
      >
        {PIPELINE.map((stage, i) => {
          const ev = byKey[stage.key];
          const cancelled = isError && i > reached;
          const status =
            i < reached || (i === reached && complete)
              ? 'done'
              : i === reached && !isError
                ? 'active'
                : 'pending';
          const isActive = status === 'active';
          const isLast = i === PIPELINE.length - 1 && !isError;
          const Stage = stage.icon;
          return (
            <div
              key={stage.key}
              ref={isActive ? activeRef : null}
              className="flex gap-3 transition-opacity duration-300"
              style={{ opacity: status === 'pending' ? (cancelled ? 0.32 : 0.5) : 1 }}
            >
              <div className="flex flex-col items-center">
                {isActive ? (
                  <span
                    className="relative grid h-6 w-6 place-items-center rounded-full border bg-[#6b72f8]/10"
                    style={{ borderColor: CYAN }}
                  >
                    <span
                      className="absolute -inset-1 animate-spin rounded-full border-2 border-transparent"
                      style={{ borderTopColor: CYAN }}
                    />
                    <Stage className="h-3 w-3" style={{ color: CYAN }} />
                  </span>
                ) : (
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full ${
                      status === 'done'
                        ? 'bg-linear-to-r from-[#15DCFF] to-[#6b72f8] text-white'
                        : 'border border-gray-200 bg-gray-100 text-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-white/40'
                    }`}
                  >
                    {status === 'done' ? (
                      <Check className="h-3 w-3" strokeWidth={2.6} />
                    ) : (
                      <Stage className="h-3 w-3" />
                    )}
                  </span>
                )}
                {!isLast && (
                  <span
                    className="my-1 w-0.5 flex-1"
                    style={{
                      minHeight: 12,
                      background:
                        i < reached
                          ? 'linear-gradient(to bottom, #15DCFF, #6b72f8)'
                          : 'rgba(255,255,255,0.08)',
                    }}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-13 font-bold ${status === 'pending' ? 'text-gray-400 dark:text-white/45' : 'text-gray-900 dark:text-white'}`}
                  >
                    {stage.label}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-gray-400 dark:text-white/40">
                    {ev ? fmtTime(ev._t) : cancelled ? 'skipped' : '—'}
                  </span>
                </div>
                <div className="mt-1 text-13 leading-snug text-gray-500 dark:text-white/55">
                  {ev ? ev.message : cancelled ? 'Skipped' : 'Waiting…'}
                  {ev && (
                    <span className="ml-2 text-[11px] font-bold tabular-nums" style={{ color: BLUE }}>
                      {ev.progress}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isError && errEvent && (
          <div ref={activeRef} className="flex gap-3">
            <span className="grid h-6 w-6 place-items-center rounded-full border border-red-500 bg-red-500/15 text-red-500">
              <X className="h-3 w-3" strokeWidth={2.6} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-red-500">
                  {String(errEvent.event || 'Error').replace(/_/g, ' ').replace(/^ERROR /, '')}
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-gray-400 dark:text-white/40">
                  {fmtTime(errEvent._t)}
                </span>
              </div>
              <div className="mt-1 text-13 leading-snug text-red-400">{errEvent.message}</div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── browser preview ─────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="lpa-shim h-13 border-b border-white/[0.06]" />
      <div className="px-7 py-6">
        <div className="lpa-shim h-7 w-[46%] rounded-lg" />
        <div className="lpa-shim mt-4 h-4 w-[66%] rounded" />
        <div className="lpa-shim mt-2.5 h-4 w-[58%] rounded" />
        <div className="mt-6 flex gap-3">
          <div className="lpa-shim h-10 w-32 rounded-[10px]" />
          <div className="lpa-shim h-10 w-28 rounded-[10px]" />
        </div>
        <div className="mt-8 grid grid-cols-3 gap-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="lpa-shim h-30 rounded-xl" />
          ))}
        </div>
        <div className="lpa-shim mt-7 h-3.5 w-[90%] rounded" />
        <div className="lpa-shim mt-2.5 h-3.5 w-[80%] rounded" />
      </div>
    </div>
  );
}

function Preview({ image, latest, isError, url, onRetry, relaunching }) {
  const [imgErr, setImgErr] = useState(false);
  const p = latest ? latest.progress : 0;
  const scanning = !isError && p < 100;
  const src = resolveScreenshotUrl(image);
  const showImg = src && !imgErr && !isError;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/10">
        <div className="flex gap-2">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex max-w-96 flex-1 items-center justify-center gap-2 rounded-lg bg-gray-100 px-3.5 py-2 dark:bg-white/5">
          <Lock className="h-3.5 w-3.5 text-gray-400 dark:text-white/45" />
          <span className="truncate text-sm text-gray-500 dark:text-white/60">{url}</span>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-[#0e0e13]">
        <Skeleton />
        {showImg && (
          <img
            src={src}
            alt=""
            onError={() => setImgErr(true)}
            className="absolute inset-0 h-full w-full bg-[#0e0e13] object-cover object-top"
          />
        )}

        {scanning && (
          <div
            className="lpa-scan pointer-events-none absolute inset-x-0 h-[90px] border-t"
            style={{
              borderTopColor: 'rgba(53,200,255,0.5)',
              background: 'linear-gradient(180deg, transparent, rgba(53,160,230,0.28), transparent)',
            }}
          />
        )}

        {isError && (
          <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 backdrop-blur-sm">
            <div className="max-w-xs text-center">
              <span className="mx-auto grid h-13 w-13 place-items-center rounded-2xl border border-red-500 bg-red-500/15 text-red-500">
                <AlertTriangle className="h-6 w-6" />
              </span>
              <div className="mt-4 text-lg font-bold text-white">Couldn't analyze this page</div>
              <div className="mt-2 text-sm leading-relaxed text-white/60">
                {latest ? latest.message : 'Something went wrong.'}
              </div>
              <div className="mt-5 flex justify-center">
                <GradBtn icon={RotateCw} spinning={relaunching} onClick={onRetry} disabled={relaunching}>
                  Try again
                </GradBtn>
              </div>
            </div>
          </div>
        )}

        {!isError && (
          <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3.5 py-2 backdrop-blur-md">
            <span
              className={`h-2 w-2 rounded-full ${scanning ? 'lpa-pulse' : ''}`}
              style={{ background: scanning ? CYAN : GREEN }}
            />
            <span className="text-13 font-semibold text-white">
              {showImg
                ? scanning
                  ? 'Analyzing captured page'
                  : 'Capture complete'
                : 'Capturing screenshot…'}
            </span>
          </div>
        )}
        {showImg && (
          <div
            className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/75 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide backdrop-blur-md"
            style={{ color: GREEN }}
          >
            <Camera className="h-3.5 w-3.5" style={{ color: GREEN }} />
            Screenshot captured
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── monitor ─────────────────────────────────────────────────────────────────
// `events` is the accumulated live-event stream ({ event, message, progress, image, _t }).
export default function AnalyzingMonitor({
  events = [],
  url,
  sessionId,
  onRetry,
  relaunching,
  className = '',
}) {
  const latest = events.length ? events[events.length - 1] : null;
  const isError = !!latest && latest.progress === -1;
  const good = events.filter((e) => e.progress >= 0);
  const lastGood = good.length ? good[good.length - 1].progress : 0;
  const complete = !isError && !!latest && latest.progress >= 100;
  const image = [...events].reverse().find((e) => e.image)?.image || null;

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white 2xl:text-[28px]">
            Analyzing Your Page
          </h1>
          <p className="mt-1.5 max-w-md text-13 leading-relaxed text-gray-500 dark:text-white/60">
            Scanning 60+ conversion criteria. This page updates live as each step completes.
          </p>
        </div>
        {sessionId && (
          <span className="font-mono text-[11px] text-gray-400 dark:text-white/40">
            session {sessionId}
          </span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 items-stretch gap-6 xl:grid-cols-[420px_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <ProgressCard latest={latest} isError={isError} lastGood={lastGood} />
          <LiveFeed events={events} isError={isError} />
          {isError ? (
            <GradBtn icon={RotateCw} spinning={relaunching} onClick={onRetry} disabled={relaunching}>
              Retry scan
            </GradBtn>
          ) : complete ? (
            <div
              className="flex items-center justify-center gap-2.5 rounded-xl border px-4 py-3"
              style={{ borderColor: 'rgba(39,224,160,0.3)', background: 'rgba(39,224,160,0.08)' }}
            >
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/20"
                style={{ borderTopColor: GREEN }}
              />
              <span className="text-sm font-semibold" style={{ color: GREEN }}>
                Results ready — opening your report…
              </span>
            </div>
          ) : null}
        </div>

        <Preview
          image={image}
          latest={latest}
          isError={isError}
          url={url}
          onRetry={onRetry}
          relaunching={relaunching}
        />
      </div>
    </div>
  );
}
