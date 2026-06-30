/**
 * AudienceReachEstimate.jsx — Meta-style audience reach widget.
 *
 * Lives in the wizard's right-side panel; subscribes to the full
 * targeting spec via props. Debounces calls to the backend's
 * `/detailed-targeting/reach-estimate` proxy and renders:
 *
 *   • The narrow/broad gauge (Meta's exact UX)
 *   • Audience-size range ("3.4M – 4.0M people")
 *   • Stale-cache indicator when Meta rate-limits the live call
 *   • "Unavailable" state when no cache + no live data
 *
 * Server-side caching:
 *   • 5min hot key — debounced repeat calls just hit Redis
 *   • 24h fallback key — used when Meta returns code 17 (rate limit)
 *
 * The component is intentionally tolerant: any failure renders as
 * "Estimate unavailable" rather than a red error — reach estimate is
 * advisory, not gating.
 */

import { useEffect, useRef, useState } from 'react';
import { Users, Clock, Loader2 } from 'lucide-react';
import { reachEstimateForTargeting } from '@/apis/metaAds/metaAdsApi';

// Compact audience-size formatter — matches Meta's "3.4M" / "210K".
function fmt(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

// "5 mins ago" / "2 hours ago" — for the stale-cache pill.
function relativeTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const diff = Date.now() - timestamp;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// Position the audience-size marker along the narrow→broad gauge.
// Meta's heuristic: log-scale between 1k and 1B; cap at the ends.
function gaugePosition(lower, upper) {
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  const mid = (lower + upper) / 2;
  if (mid <= 0) return 0;
  const log = Math.log10(mid);
  // 3 (1k) → 0%, 9 (1B) → 100%
  const pct = Math.max(0, Math.min(100, ((log - 3) / 6) * 100));
  return pct;
}

export default function AudienceReachEstimate({
  adAccountId,
  targeting,
  optimizationGoal,
  // Debounce in ms — 1500 by default. Lower bound from Meta's rate-limit
  // (we'd burn the per-account quota fast at <500ms typing).
  debounceMs = 1500,
}) {
  const [state, setState] = useState({
    status: 'idle', // idle | loading | ok | degraded | error
    estimate: null,
    cachedAt: null,
    error: null,
  });
  const lastReqRef = useRef(0);

  useEffect(() => {
    if (!adAccountId || !targeting) {
      setState({ status: 'idle', estimate: null, cachedAt: null, error: null });
      return undefined;
    }

    const reqId = ++lastReqRef.current;
    setState((s) => ({ ...s, status: 'loading' }));

    const t = setTimeout(async () => {
      try {
        const r = await reachEstimateForTargeting({
          adAccountId,
          targeting,
          optimizationGoal,
        });
        // Stale-request guard — drop the response if a newer request has
        // started while this one was in flight.
        if (reqId !== lastReqRef.current) return;
        if (r?.status && r.estimate) {
          setState({
            status: r.degraded ? 'degraded' : 'ok',
            estimate: r.estimate,
            cachedAt: r.cachedAt || null,
            error: null,
          });
        } else {
          setState({
            status: 'error',
            estimate: null,
            cachedAt: null,
            error: r?.error || 'Estimate unavailable',
          });
        }
      } catch (e) {
        if (reqId !== lastReqRef.current) return;
        setState({
          status: 'error',
          estimate: null,
          cachedAt: null,
          error: e?.response?.data?.error || 'Estimate unavailable',
        });
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [adAccountId, targeting, optimizationGoal, debounceMs]);

  const { status, estimate, cachedAt, error } = state;

  // ── Render branches ─────────────────────────────────────────────────────
  const lower = estimate?.lowerBound;
  const upper = estimate?.upperBound;
  const hasNumbers = Number.isFinite(lower) && Number.isFinite(upper);
  const pos = hasNumbers ? gaugePosition(lower, upper) : null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[#1A1A1A]">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-gray-500 dark:text-white/55" />
        <h4 className="text-13 font-semibold text-gray-900 dark:text-white">
          Audience definition
        </h4>
        {status === 'loading' && (
          <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-gray-500 dark:text-white/55" />
        )}
        {status === 'degraded' && cachedAt && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-10 font-medium text-amber-700 dark:bg-amber-400/15 dark:text-amber-200"
            title={`Showing cached estimate from ${relativeTime(cachedAt)} — Meta rate-limited the live call`}
          >
            <Clock className="h-3 w-3" />
            {relativeTime(cachedAt)}
          </span>
        )}
      </div>

      {/* Audience-size range */}
      <div className="mt-3 flex items-baseline gap-2">
        {hasNumbers ? (
          <>
            <span className="text-18 font-semibold text-gray-900 dark:text-white">
              {fmt(lower)} – {fmt(upper)}
            </span>
            <span className="text-11 text-gray-500 dark:text-white/55">people</span>
          </>
        ) : status === 'idle' ? (
          <span className="text-12 text-gray-500 dark:text-white/55">
            Add targeting to see audience size.
          </span>
        ) : status === 'loading' ? (
          <span className="text-12 text-gray-500 dark:text-white/55">Estimating…</span>
        ) : (
          <span className="text-12 text-gray-500 dark:text-white/55">
            {error || 'Estimate unavailable.'}
          </span>
        )}
      </div>

      {/* Narrow / broad gauge — Meta's exact bar with a marker */}
      {hasNumbers && (
        <div className="mt-3">
          <div className="relative h-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-300 via-yellow-300 to-emerald-400 dark:from-amber-400/60 dark:via-yellow-400/60 dark:to-emerald-400/60">
            {Number.isFinite(pos) && (
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gray-900 shadow dark:border-[#1A1A1A] dark:bg-white"
                style={{ left: `${pos}%` }}
              />
            )}
          </div>
          <div className="mt-1 flex justify-between text-10 text-gray-500 dark:text-white/45">
            <span>Narrow</span>
            <span>Broad</span>
          </div>
        </div>
      )}

      {/* Stale-cache footnote */}
      {status === 'degraded' && (
        <p className="mt-2 text-11 text-gray-500 dark:text-white/55">
          Meta's live estimate is rate-limited right now. Refreshes when the quota resets.
        </p>
      )}
    </div>
  );
}
