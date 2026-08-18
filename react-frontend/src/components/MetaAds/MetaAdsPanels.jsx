import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  DollarSign,
  RefreshCw,
  ExternalLink,
  Play,
  Image as ImageIcon,
  Activity,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  ShieldAlert,
  AlertTriangle,
  Lightbulb,
  Calendar,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  getAdSetAds,
  getAdSets,
  getAnalyticsData,
  getAuditData,
  updateAdStatus,
} from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import {
  CHART_COLORS,
  getActionVal,
  METRIC_ICONS,
  formatMetricValue,
} from './metaAdsUtils';
import { StatusBadge, Spinner, EmptyState, ChartTooltip } from './MetaAdsAtoms';

// ─── ad card ──────────────────────────────────────────────────────────────────

export const AdCard = ({ ad }) => {
  const [expanded, setExpanded] = useState(false);
  const { creative, name, status, created_time, bid_type } = ad;
  const [currentStatus, setCurrentStatus] = useState(status);
  const [toggling, setToggling] = useState(false);
  const isVideo = creative?.object_type === 'VIDEO';

  const handleToggleStatus = async (e) => {
    e.stopPropagation();
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setToggling(true);
    try {
      const res = await updateAdStatus('ad', ad.id, newStatus);
      setCurrentStatus(newStatus);
      globalToast.success(res?.message);
    } catch {
      globalToast.error('Failed to update ad status');
    } finally {
      setToggling(false);
    }
  };

  const bodyVariants = creative?.asset_feed_spec?.bodies ?? [];
  const titleVariants = creative?.asset_feed_spec?.titles ?? [];
  const hasVariants = bodyVariants.length > 1 || titleVariants.length > 1;

  const destLink = creative?.object_story_spec?.video_data?.call_to_action?.value?.link ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full shrink-0 overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#EDE7DF] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05),0_2px_6px_-1px_rgba(80,70,58,0.03)] transition-all hover:border-[#DDD7CD] dark:border-white/10 dark:bg-[#161616] dark:hover:border-white/10"
    >
      {/* ── collapsed row ── */}
      <div className="flex flex-1 gap-3 2xl:gap-4 p-3 2xl:p-4">
        {/* thumbnail */}
        <div className="relative max-w-[100px] 2xl:max-w-[120px] flex-1 flex-shrink-0 overflow-hidden rounded-lg bg-gray-50 dark:bg-[#1A1A1A]">
          {creative?.thumbnail_url ? (
            <img src={creative.thumbnail_url} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-5 w-5 text-gray-400 dark:text-[#444]" />
            </div>
          )}
          {isVideo && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                <Play className="h-2.5 w-2.5 fill-white text-white" />
              </div>
            </div>
          )}
        </div>

        {/* main info */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 2xl:gap-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-1 text-xs 2xl:text-sm font-bold text-gray-900 dark:text-white">{name}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StatusBadge status={currentStatus} />
              <button
                onClick={handleToggleStatus}
                disabled={toggling}
                className={`relative h-4 w-8 rounded-full transition-colors duration-200 ${currentStatus === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500'} ${toggling ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${currentStatus === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-1.5 2xl:gap-x-2 gap-y-1 2xl:flex-nowrap">
            <span className="font-mono text-[10px] 2xl:text-xs text-gray-500 dark:text-[#BEBEBE]"> ID:{ad.id}</span>
            {bid_type && (
              <span className="text-[10px] 2xl:text-xs whitespace-nowrap text-gray-500 dark:text-[#BEBEBE]">
                Bid Type : <span className="text-gray-500 dark:text-[#BEBEBE] text-[10px] 2xl:text-xs">{bid_type.replace(/_/g, ' ')}</span>
              </span>
            )}
            <span className="text-[10px] 2xl:text-xs whitespace-nowrap text-gray-500 dark:text-[#BEBEBE]">
              {new Date(created_time).toLocaleDateString()}
            </span>
          </div>

          <div className="mt-2 flex flex-1 flex-col gap-0.5 rounded-lg">
            {creative?.title && (
              <p className="line-clamp-1 text-[11px] 2xl:text-sm font-medium text-gray-500 dark:text-[#BEBEBE]">{creative.title}</p>
            )}

            <div className="flex mb-2 flex-wrap items-center rounded-lg">
              {creative?.call_to_action_type && (
                <span className="mt-1 rounded-md border border-gray-200 py-1.5 px-2 2xl:p-2 text-[9px] 2xl:text-xs font-semibold whitespace-nowrap dark:border-white/20">
                  CTA: <span className="">{creative.call_to_action_type.replace(/_/g, ' ')}</span>
                </span>
              )}
            </div>

            <div className="mt-auto flex w-full items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {creative?.instagram_permalink_url && (
                  <a
                    href={creative.instagram_permalink_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] 2xl:text-[11px] text-[#3fc7fe] hover:text-[#15DCFF]"
                  >
                    Instagram <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {destLink && (
                  <a
                    href={destLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] 2xl:text-[11px] text-[#6b72f8]/70 hover:text-[#6b72f8]"
                  >
                    Destination <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {(creative?.body || hasVariants) && (
                <button
                  onClick={() => setExpanded((p) => !p)}
                  className="flex shrink-0 items-center gap-1 self-start rounded-lg px-2.5 py-1 text-[10px] 2xl:text-[11px] font-semibold text-[#3fc7fe] transition-all duration-200 hover:border-[#15DCFF]/40 hover:bg-[#15DCFF]/10"
                >
                  See {expanded ? 'Less' : 'More'}
                  {/* <ChevronDown
                      className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                    /> */}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── expanded detail ── */}
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 dark:border-white/5">
              {creative?.body && (
                <div className="rounded-xl bg-gray-100 p-3 dark:bg-white/[0.02]">
                  <p className="mb-0.5 2xl:mb-2 text-[10px] 2xl:text-xs font-semibold tracking-widest text-gray-900 uppercase dark:text-white">
                    Ad Copy
                  </p>
                  <p className="text-[10px] 2xl:text-xs leading-relaxed text-gray-500 dark:text-[#BEBEBE]">{creative.body}</p>
                </div>
              )}

              {bodyVariants.length > 1 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold tracking-widest text-gray-900 uppercase dark:text-white">
                    Body Variants <span className="text-gray-500 dark:text-[#BEBEBE]">({bodyVariants.length})</span>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {bodyVariants.map((b, i) => (
                      <div key={i} className="flex gap-2 rounded-xl bg-gray-100 px-3 py-2 dark:bg-white/[0.02]">
                        <span className="mt-0.5 flex-shrink-0 text-[10px] font-bold text-[#6b72f8]">
                          {i + 1}
                        </span>
                        <p className="text-xs leading-relaxed text-gray-500 dark:text-[#BEBEBE]">{b.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {titleVariants.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold tracking-widest text-gray-500 uppercase dark:text-[#BEBEBE]">
                    Headline Variants / Titles{' '}
                    <span className="text-gray-500 dark:text-[#BEBEBE]">({titleVariants.length})</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {titleVariants.map((t, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-[10px] font-medium text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white/70"
                      >
                        {t.text}
                      </span>
                    ))}
                  </div>
                </div>
              )}
        </div>
      )}
    </motion.div>
  );
};

// ─── ad-set row ───────────────────────────────────────────────────────────────

export const AdSetRow = ({ adSet }) => {
  const [expanded, setExpanded] = useState(false);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(adSet.status);
  const [toggling, setToggling] = useState(false);

  const handleToggleStatus = async (e) => {
    e.stopPropagation();
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setToggling(true);
    try {
      const res = await updateAdStatus('adset', adSet.id, newStatus);
      setCurrentStatus(newStatus);
      globalToast.success(res?.message);
    } catch {
      globalToast.error('Failed to update ad set status');
    } finally {
      setToggling(false);
    }
  };

  const toggle = async () => {
    if (!expanded) {
      setExpanded(true);
      if (ads.length === 0) {
        setLoading(true);
        try {
          const res = await getAdSetAds(adSet.id);
          setAds(res.ads || []);
        } catch {
          /* noop */
        } finally {
          setLoading(false);
        }
      }
    } else {
      setExpanded(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#1c1c1c]">
      <button
        onClick={toggle}
        className={`flex w-full items-center gap-2 p-3 text-left hover:bg-gray-100 dark:hover:bg-white/[0.04] ${expanded ? 'bg-gray-100 dark:bg-white/[0.04]' : ''}`}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 flex-shrink-0 text-gray-500 transition-transform duration-200 dark:text-[#BEBEBE] ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs 2xl:text-sm font-bold text-gray-900 dark:text-white">
                {adSet.name}{' '}
                <span className="font-mono text-xs text-gray-500 dark:text-[#BEBEBE]"> ID:{adSet.id}</span>
              </span>
              <StatusBadge status={currentStatus} />
              <button
                onClick={handleToggleStatus}
                disabled={toggling}
                className={`relative h-4 w-8 rounded-full transition-colors duration-200 ${currentStatus === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500'} ${toggling ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${currentStatus === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] 2xl:text-xs text-gray-500 dark:text-[#BEBEBE]">
            {adSet.daily_budget && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Daily Budget: {adSet.daily_budget}
              </span>
            )}

            {adSet.budget_remaining && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Budget Remaining: {adSet.budget_remaining}
              </span>
            )}

            {adSet.billing_event && (
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                Billing Event: {adSet.billing_event}
              </span>
            )}
            {adSet.start_time && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(adSet.start_time).toLocaleDateString()}
              </span>
            )}

            {adSet.optimization_goal && (
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3" />
                Optimization Goal: {adSet.optimization_goal.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div>
          {loading && <Spinner />}
          {!loading && ads.length === 0 && <EmptyState message="No ads in this ad set" />}
          <div className="max-h-[400px] overflow-y-auto border-t border-gray-200 p-3 dark:border-white/4">
            {/* mobile: single column */}
            <div className="flex flex-col gap-2 2xl:hidden">
              {ads.map((ad) => <AdCard key={ad.id} ad={ad} />)}
            </div>
            {/* desktop: two independent columns */}
            <div className="hidden 2xl:flex gap-2">
              <div className="flex flex-1 flex-col gap-2">
                {ads.filter((_, i) => i % 2 === 0).map((ad) => <AdCard key={ad.id} ad={ad} />)}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {ads.filter((_, i) => i % 2 !== 0).map((ad) => <AdCard key={ad.id} ad={ad} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── campaign row ─────────────────────────────────────────────────────────────

export const CampaignRow = ({ campaign, adAccountId, onInsights, isActive }) => {
  const [expanded, setExpanded] = useState(false);
  const [adSets, setAdSets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(campaign?.status);
  const [toggling, setToggling] = useState(false);

  const handleToggleStatus = async (e) => {
    e.stopPropagation();
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setToggling(true);
    try {
      const res = await updateAdStatus('campaign', campaign.id, newStatus);
      setCurrentStatus(newStatus);

      globalToast.success(res?.message);
    } catch {
      globalToast.error('Failed to update campaign status');
    } finally {
      setToggling(false);
    }
  };

  const toggle = async () => {
    if (!expanded) {
      setExpanded(true);
      if (adSets.length === 0) {
        setLoading(true);
        try {
          const res = await getAdSets(campaign.id, adAccountId);
          setAdSets(res.adSets || []);
        } catch {
          /* noop */
        } finally {
          setLoading(false);
        }
      }
    } else {
      setExpanded(false);
    }
  };

  return (
    <motion.div
      // initial={{ opacity: 0, y: 8 }}
      // animate={{ opacity: 1, y: 0 }}
      className={`group relative overflow-hidden rounded-2xl border ${isActive ? 'border-[#15DCFF]/30 bg-[#15DCFF]/[0.03]' : 'border-[#DDD7CD] bg-[#EDE7DF] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05)] hover:border-[#DDD7CD] dark:border-white/[0.12] dark:bg-[#161616] dark:hover:border-white/20'}`}
    >
      {isActive && (
        <div className="absolute top-0 left-0 h-full w-0.5 bg-gradient-to-b from-[#15DCFF] to-[#6b72f8]" />
      )}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={toggle} className="flex-shrink-0">
          <ChevronDown
            className={`h-4 w-4 text-gray-500 transition-transform duration-200 dark:text-[#BEBEBE] ${expanded ? '' : '-rotate-90'}`}
          />
        </button>
        <button onClick={toggle} className="flex min-w-0 flex-1 flex-col text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm 2xl:text-base font-semibold text-gray-900 dark:text-white">{campaign?.name}</span>
            <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-[#BEBEBE]/60"> ID:{campaign?.id}</span>
            <StatusBadge status={currentStatus} />
            <button
              onClick={handleToggleStatus}
              disabled={toggling}
              className={`relative h-4 w-8 shrink-0 rounded-full transition-colors duration-200 ${currentStatus === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500'} ${toggling ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${currentStatus === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] 2xl:text-xs text-gray-500 dark:text-[#BEBEBE]">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {campaign?.objective}
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Daily Budget: {campaign?.daily_budget}
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Budget Remaining : {campaign?.budget_remaining}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(campaign?.start_time).toLocaleDateString()}
            </span>
          </div>
        </button>
        <button
          onClick={() => onInsights(campaign?.id)}
          className={`flex flex-shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
            isActive
              ? 'border-[#15DCFF]/30 bg-[#15DCFF]/10 text-[#15DCFF]'
              : 'border-gray-200 bg-gray-100 text-gray-500 hover:border-gray-300 hover:text-gray-900 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-[#BEBEBE] dark:hover:border-white/10 dark:hover:text-white'
          }`}
        >
          <BarChart2 className="h-3 w-3" />
          Analytics
        </button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-gray-200 p-4 dark:border-white/10">
          {loading && <Spinner />}
          {!loading && adSets.length === 0 && (
            <EmptyState message="No ad sets in this campaign" />
          )}
          {adSets.map((s) => (
            <AdSetRow key={s.id} adSet={s} />
          ))}
        </div>
      )}
    </motion.div>
  );
};

// ─── change chip (analytics helper) ──────────────────────────────────────────

const ChangeChip = ({ change }) => {
  const n = parseFloat(change);
  if (isNaN(n) || n === 0) return null;
  const up = n > 0;
  return (
    <span
      className={`flex items-center gap-0.5 text-[9px] font-semibold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {up ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
      {Math.abs(n).toFixed(1)}%
    </span>
  );
};

// ─── analytics panel ─────────────────────────────────────────────────────────

// `metricsCatalog`/`visibleMetricKeys` come from MetaAdsDashboard.jsx's
// one-time fetch of GET /meta-ads/analytics/metrics-catalog + the user's
// saved preference (see MetricsPicker.jsx for the picker itself). Default to
// empty arrays so this still renders sensibly before that fetch resolves.
export const AnalyticsPanel = ({ analyticsData, loading, metricsCatalog = [], visibleMetricKeys = [] }) => {
  const [chartMetric, setChartMetric] = useState('spend');

  if (loading) return <Spinner />;
  if (!analyticsData)
    return <EmptyState message="No analytics data for the selected account and period" />;

  const { stats, chartData = [], actions = [] } = analyticsData;

  const hasData = stats && Object.values(stats).some((s) => parseFloat(s?.val) > 0);
  if (!hasData) {
    return (
      <div className="flex w-full flex-col items-center justify-center px-4 py-12 text-center">
        <div className="flex flex-col items-center justify-center">
          <p className="text-sm font-semibold text-gray-900 sm:text-base dark:text-white">No data for this period</p>
          <p className="mt-2 max-w-[90%] text-xs leading-relaxed text-gray-500 sm:max-w-md sm:text-sm dark:text-[#BEBEBE]">
            There were no impressions, clicks, or spend recorded for the selected date range. Try a
            different date preset or account.
          </p>
        </div>
      </div>
    );
  }

  // Catalog-driven KPI cards — replaces the old hardcoded 8-metric array.
  // `visibleMetricKeys` (the user's saved selection, defaulting to today's
  // original 8 metrics) picks which catalog entries render; `stats` (keyed
  // by the same catalog `key`s — see getAnalyticsData) supplies the values.
  // Falls back to whatever keys `stats` actually has if the catalog hasn't
  // loaded yet, so cards still render (unlabeled-icon-less) rather than
  // going blank while the catalog fetch is in flight.
  const visibleEntries = metricsCatalog.length
    ? metricsCatalog.filter((m) => visibleMetricKeys.includes(m.key))
    : Object.keys(stats).map((key) => ({ key, label: key, format: 'decimal2', icon: null }));
  const kpiCards = visibleEntries.map((entry) => ({
    key: entry.key,
    icon: METRIC_ICONS[entry.icon] || TrendingUp,
    label: entry.label,
    value: formatMetricValue(entry.format, stats[entry.key]?.val),
    change: stats[entry.key]?.change,
  }));
  // The card design is sized for the default 8 metrics (2 rows). Now that a
  // user can select dozens, keeping that size turns the KPI block into a
  // wall that pushes the charts below the fold. Past 8, switch to a denser
  // card + more columns so ~20 metrics occupy roughly the space 8 used to.
  // At or below 8 the markup is byte-identical to before, so the default
  // dashboard is unchanged.
  const compact = kpiCards.length > 8;

  const ACTION_LABELS = {
    video_view: 'Video Views',
    link_click: 'Link Clicks',
    landing_page_view: 'Landing Pages',
    page_engagement: 'Page Engagements',
    post_engagement: 'Post Engagements',
    'offsite_conversion.fb_pixel_custom': 'Pixel Custom',
  };
  const PIE_KEYS = ['video_view', 'link_click', 'landing_page_view', 'page_engagement'];
  const actionPieData = PIE_KEYS.map((key) => ({
    name: ACTION_LABELS[key] ?? key,
    value: getActionVal(actions, key),
  })).filter((r) => r.value > 0);

  const sortedActions = [...actions]
    .map((a) => ({
      type: (ACTION_LABELS[a.action_type] ?? a.action_type).replace(/_/g, ' '),
      value: parseInt(a.value, 10),
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col gap-5">
      {/* KPI cards — one wrapping grid (not pre-chunked rows) so the column
          count can flex with the metric count. gap-y-5 in the roomy variant
          preserves the row spacing the old two-grid layout produced. */}
      <div
        className={`grid grid-cols-2 ${
          compact
            ? 'gap-3 lg:grid-cols-4 xl:grid-cols-6'
            : 'gap-x-3 gap-y-5 lg:grid-cols-4'
        }`}
      >
        {kpiCards.map(({ key, icon, label, value, change }) => (
          <div
            key={key}
            className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#EDE7DF] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05)] transition-all duration-300 hover:border-[#DDD7CD] dark:border-white/8 dark:bg-[#161616] dark:hover:border-white/15 dark:hover:bg-white/3 ${
              compact ? 'p-3' : 'p-4 2xl:p-5'
            }`}
          >
            {/* top row: icon left, label right */}
            <div className="flex items-start justify-between gap-1.5">
              <div
                className={`flex shrink-0 items-center justify-center rounded-xl bg-[#d8dee5] dark:bg-white/5 ${
                  compact ? 'h-7 w-7' : 'h-9 w-9'
                }`}
              >
                {React.createElement(icon, {
                  className: `text-gray-700 dark:text-white/50 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`,
                })}
              </div>
              <p
                title={label}
                className={`font-semibold tracking-[0.12em] uppercase text-gray-600 dark:text-white/35 ${
                  compact ? 'line-clamp-2 text-right text-10 leading-tight' : 'text-xs'
                }`}
              >
                {label}
              </p>
            </div>

            {/* bottom row: value left, change chip right */}
            <div className={`flex items-end justify-between gap-1.5 ${compact ? 'mt-2.5' : 'mt-4'}`}>
              <p
                className={`truncate font-bold leading-none text-gray-900 dark:text-white ${
                  compact ? 'text-base 2xl:text-lg' : 'text-xl 2xl:text-2xl'
                }`}
              >
                {value}
              </p>
              <ChangeChip change={change} />
            </div>
          </div>
        ))}
      </div>

      {/* charts row: bar chart left, pie + actions right */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">

      {/* spend / clicks bar chart */}
      <div className="flex flex-col rounded-2xl border border-[#DDD7CD] bg-[#EDE7DF] p-5 shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05)] backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FCFAF7] ring-1 ring-[#DDD7CD] dark:bg-white/5 dark:ring-0">
              <TrendingUp className="h-5 w-5 text-[#24211D] dark:text-white/50" />
            </div>
            <p className="text-base 2xl:text-lg font-bold text-[#24211D] dark:text-white">Performance over time</p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] p-1 dark:border-white/6 dark:bg-[#111]/60">
            {[
              { v: 'spend', l: 'Spend' },
              { v: 'clicks', l: 'Clicks' },
            ].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => setChartMetric(v)}
                className={`rounded-lg px-3 py-1 text-10 font-semibold transition-all ${chartMetric === v ? 'bg-[#EDE7DF] text-[#24211D] shadow-xs dark:bg-white/10 dark:text-white' : 'text-[#7A7369] hover:text-[#24211D] dark:text-white/40 dark:hover:text-white/70'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-45">
          <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGradSpend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#15DCFF" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#15DCFF" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="areaGradClicks" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6b72f8" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#6b72f8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: '#BEBEBE', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: '#BEBEBE', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ReTooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey={chartMetric}
              name={chartMetric === 'spend' ? 'Spend (₹)' : 'Clicks'}
              stroke={chartMetric === 'spend' ? '#15DCFF' : '#6b72f8'}
              strokeWidth={2}
              fill={chartMetric === 'spend' ? 'url(#areaGradSpend)' : 'url(#areaGradClicks)'}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: chartMetric === 'spend' ? '#15DCFF' : '#6b72f8' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* right column: pie + actions stacked */}
      <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4">
        {/* action pie */}
        <div className="rounded-2xl border border-[#DDD7CD] bg-[#EDE7DF] p-4 shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05)] backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FCFAF7] ring-1 ring-[#DDD7CD] dark:bg-white/5 dark:ring-0">
              <Target className="h-5 w-5 text-[#24211D] dark:text-white/50" />
            </div>
            <p className="text-base font-bold text-[#24211D] dark:text-white">Key Actions</p>
          </div>
          {actionPieData.length > 0 ? (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <defs>
                      {CHART_COLORS.map((c, i) => (
                        <radialGradient key={i} id={`pg${i}`} cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={c} stopOpacity={0.9} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.5} />
                        </radialGradient>
                      ))}
                    </defs>
                    <Pie
                      data={actionPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={46}
                      outerRadius={76}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {actionPieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={`url(#pg${i % CHART_COLORS.length})`}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <ReTooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-2 pr-1">
                {actionPieData.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-xs whitespace-nowrap text-gray-600 dark:text-[#BEBEBE]">{item.name}</span>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white">
                      {item.value.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState message="No action data" />
          )}
        </div>

        {/* all actions table */}
        <div className="overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#EDE7DF] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05)] backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]">
          <div className="border-b border-[#DDD7CD] px-4 py-3 dark:border-white/4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FCFAF7] ring-1 ring-[#DDD7CD] dark:bg-white/5 dark:ring-0">
                <Layers className="h-5 w-5 text-[#24211D] dark:text-white/50" />
              </div>
              <p className="text-base font-bold text-[#24211D] dark:text-white">All Actions</p>
            </div>
          </div>
          <div className="scrollbar-thin max-h-65 p-2 pb-3 overflow-y-auto">
            {sortedActions.map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-black/10 px-4 py-2 last:border-b-0 hover:bg-black/5 dark:border-white/2 dark:hover:bg-white/2"
              >
                <span className="truncate pr-4 text-sm text-gray-600 capitalize dark:text-[#BEBEBE]">{a.type}</span>
                <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-white">
                  {a.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>   {/* end inner grid (pie + actions) */}
      </div>   {/* end right flex-col */}
      </div>   {/* end outer charts grid */}
    </div>
  );
};

// ─── audit tab ───────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical:    { icon: ShieldAlert,    color: 'text-red-400',    accent: 'bg-red-400',      barColor: 'rgb(248,113,113)',  label: 'Critical' },
  warning:     { icon: AlertTriangle,  color: 'text-amber-400',  accent: 'bg-amber-400',    barColor: 'rgb(251,191,36)',   label: 'Warning' },
  opportunity: { icon: Lightbulb,      color: 'text-[#15DCFF]',  accent: 'bg-[#15DCFF]/60', barColor: 'rgb(21,220,255)',   label: 'Opportunity' },
};

const ENTITY_LABELS = { campaign: 'Campaign', adset: 'Ad Set', ad: 'Ad' };

export const AuditTab = ({ adAccountId }) => {
  const [auditData, setAuditData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Default to 'all' so the user always sees something on landing — defaulting
  // to a severity bucket that's empty (e.g. 'critical' when there are zero
  // critical findings) makes the tab look broken.
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!adAccountId) return;
    setLoading(true);
    setAuditData(null);
    try {
      const res = await getAuditData(adAccountId);
      setAuditData(res);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner />;
  if (!auditData) return <EmptyState message="No audit data available for this account" />;

  const { summary, findings = [], account_name } = auditData;
  const filtered = filter === 'all' ? findings : findings.filter((f) => f.severity === filter);

  const grouped = filtered.reduce((acc, f) => {
    const key = f.entity_id;
    if (!acc[key]) acc[key] = { entity_name: f.entity_name, entity_type: f.entity_type, items: [] };
    acc[key].items.push(f);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-5">
      {/* account header */}
      

      {/* filter pills */}
      <div className="flex items-center gap-2">
        {['all', 'critical', 'warning', 'opportunity'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-all ${
              filter === f
                ? 'border-gray-300 bg-gray-200 text-gray-900 dark:border-white/20 dark:bg-white/10 dark:text-white'
                : 'border-gray-200 bg-transparent text-gray-500 hover:text-gray-600 dark:border-white/6 dark:bg-transparent dark:text-[#BEBEBE] dark:hover:text-[#BEBEBE]'
            }`}
          >
            {f === 'all' ? `All (${findings.length})` : `${f} (${summary[f]})`}
          </button>
        ))}
      </div>

      {/* findings grid */}
      {Object.keys(grouped).length === 0 ? (
        <EmptyState message="No findings for the selected filter" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.values(grouped).flatMap((group, gi) =>
            group.items.map((finding, fi) => {
              const cfg = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.opportunity;
              const FindingIcon = cfg.icon;
              return (
                <motion.div
                  key={`${gi}-${fi}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (gi * 4 + fi) * 0.02 }}
                  className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 pl-5 transition-all hover:border-gray-300 dark:border-white/8 dark:bg-[#161616] dark:hover:border-white/15"
                >
                  {/* left accent bar */}
                  <div className="absolute top-0 left-0 bottom-0 w-0.5 rounded-l-2xl" style={{ background: `linear-gradient(to bottom, transparent 0%, ${cfg.barColor} 40%, ${cfg.barColor} 60%, transparent 100%)` }} />

                  {/* top row: severity label + rule id */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FindingIcon className={`h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                      <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <span className="rounded border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-400 dark:border-white/8 dark:bg-white/4 dark:text-white/40">
                      {finding.rule_id}
                    </span>
                  </div>

                  {/* message */}
                  <p className="flex-1 text-sm leading-relaxed text-gray-600 dark:text-white/80">{finding.message}</p>

                  {/* entity footer */}
                  <div className="flex items-center gap-1.5 border-t border-gray-200 pt-3 dark:border-white/8">
                    <span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wide text-gray-400 dark:border-white/8 dark:bg-white/4 dark:text-white/40">
                      {ENTITY_LABELS[group.entity_type] ?? group.entity_type}
                    </span>
                    <span className="truncate text-xs text-gray-400 dark:text-white/40">{group.entity_name}</span>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
