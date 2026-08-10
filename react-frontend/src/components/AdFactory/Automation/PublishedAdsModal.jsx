import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import {
  X,
  Inbox,
  Check,
  AlertTriangle,
  EllipsisVertical,
  ImageOff,
  Loader2,
  RefreshCcw,
  ThumbsUp,
  MessageCircle,
  Share2,
  ChevronDown,
} from 'lucide-react';
import {
  closePublishedAds,
  selectActivityWithPending,
  selectAutomationEntry,
  selectPublishedAdsOpenFor,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import { fetchActivity } from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import DateRangeFilter from '@/components/AdStudio/AdVideoNew/DateRangeFilter';
import CreativeGeneratingLoader from '@/components/AdStudio/AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';

// ----------------------------------------------------------------------------
// PublishedAdsModal — full-screen dialog that lists ads produced by an
// active automation, bucketed by the day they posted.
//
// Data source: GET /ads-factory/autopilot/jobs/:campaignId/activity. Each run's
// `creatives[]` is flattened so every assembled creative becomes one card.
// Posting state drives the card variant (green "Posted" badge vs red "Failed"
// + run error reason). Filters operate over the flattened list.
// ----------------------------------------------------------------------------

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'Success' },
  { id: 'failed', label: 'Failed' },
];

const TIME_FILTERS = [
  { id: 'all', label: 'All time' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'custom', label: 'Custom' },
];

// Each density picks a *ceiling* — Tailwind steps down to fewer columns at
// narrower viewports so cards never get so cramped that text collapses into
// "…". E.g. 4x = 4 cols on xl screens, 3 on lg, 2 on sm, 1 below sm.
const DENSITY_OPTIONS = [
  { id: '2x', cols: 'grid-cols-1 sm:grid-cols-2' },
  { id: '3x', cols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' },
  { id: '4x', cols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' },
];

export default function PublishedAdsModal() {
  const dispatch = useDispatch();
  const campaignId = useSelector(selectPublishedAdsOpenFor);
  const entry = useSelector((state) => selectAutomationEntry(state, campaignId));
  // Ticker drives the overdue/stale derivation inside selectActivityWithPending.
  // 10s is the cheapest cadence that still flips placeholders from `pending` to
  // `failed` (after STALE_PENDING_MS) within ~10s of the threshold — fine for a
  // 10-min stale window.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  const activity = useSelector((state) =>
    selectActivityWithPending(state, { campaignId, now }),
  );
  const brandInfo = useSelector((state) => state?.adFactoryNew?.brandInfo);
  // Fallback chain for the header label uses the campaigns dropdown when the
  // activity response hasn't arrived yet (or when there's no job at all).
  const campaignsDropdown = useSelector((state) => state?.adFactoryNew?.campaignsDropdown);

  const [statusFilter, setStatusFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState(['all']);
  const [accountFilter, setAccountFilter] = useState(['all']);
  // Date objects so we don't have to round-trip through dd-MM-yyyy strings
  // every time the filter recomputes.
  const [customRange, setCustomRange] = useState({ startDate: null, endDate: null });
  const [density, setDensity] = useState('4x');
  const [lightboxImage, setLightboxImage] = useState(null);

  // DateRangeFilter emits dd-MM-yyyy strings; parse back to Date for filtering.
  const handleCustomDateChange = (startStr, endStr) => {
    setCustomRange({
      startDate: parseDdMmYyyy(startStr),
      endDate: parseDdMmYyyy(endStr),
    });
  };
  const handleCustomDateClear = () => {
    setCustomRange({ startDate: null, endDate: null });
  };

  // Fetch activity on open / campaign change. Cached results re-render
  // instantly; a fresh refetch happens any time the campaignId changes (e.g.
  // user pops to a different campaign's automation). The endpoint is now
  // keyed by campaignId — one campaign can span multiple jobs (e.g. after a
  // re-activation) and the trace stays continuous.
  useEffect(() => {
    if (!campaignId) return;
    dispatch(fetchActivity({ campaignId }));
  }, [dispatch, campaignId]);

  const loading = activity?.loading ?? Boolean(campaignId);
  const error = activity?.error || null;
  const runs = useMemo(() => (Array.isArray(activity?.runs) ? activity.runs : []), [activity?.runs]);

  // Flatten runs[].creatives[] into per-ad cards. Tag each with platform & account name.
  const allAds = useMemo(() => {
    const flat = [];
    const targets = activity?.targets || entry?.targets || {};
    const metaTargetName = targets.meta?.accountName || targets.meta?.name || targets.meta?.config?.template?.payload?.pageName;
    const defaultMetaAccountName = metaTargetName || (targets.meta?.facebookId ? `Meta (${targets.meta.facebookId})` : 'Meta Account');
    const dedupeFailedCards = (items) => {
      const kept = [];
      items.forEach((item) => {
        if (item?.status !== 'failed' || item?.posted) {
          kept.push(item);
          return;
        }

        const itemTime = item?.postedAt ? new Date(item.postedAt).getTime() : 0;
        const isDup = kept.some((prev) => {
          if (prev?.status !== 'failed' || prev?.posted) return false;
          const prevTime = prev?.postedAt ? new Date(prev.postedAt).getTime() : 0;
          if (prev.platform !== item.platform) return false;
          if ((prev.accountName || '') !== (item.accountName || '')) return false;
          if ((prev.runError || '') !== (item.runError || '')) return false;
          if ((prev.headline || '') !== (item.headline || '')) return false;
          if ((prev.body || '') !== (item.body || '')) return false;
          if ((prev.description || '') !== (item.description || '')) return false;
          if ((prev.callToAction || '') !== (item.callToAction || '')) return false;
          if ((prev.linkUrl || '') !== (item.linkUrl || '')) return false;
          if ((prev.imageUrl || '') !== (item.imageUrl || '')) return false;
          return prevTime && itemTime ? Math.abs(prevTime - itemTime) < 120000 : true;
        });

        if (!isDup) kept.push(item);
      });
      return kept;
    };

    runs.forEach((run) => {
      const list = Array.isArray(run?.creatives) ? run.creatives : [];
      if (list.length === 0) {
        const status = String(run?.status || '').toLowerCase();
        if (status === 'pending') {
          flat.push({
            id: `${run?.runId || 'pending'}-${flat.length}`,
            imageUrl: '',
            imageStatus: 'pending',
            headline: '',
            body: '',
            description: '',
            textStatus: 'pending',
            callToAction: '',
            linkUrl: '',
            posted: false,
            postedAt: run?.startedAt || null,
            status: 'pending',
            runError: null,
            platform: 'meta',
            accountName: defaultMetaAccountName,
          });
        } else if (status && status !== 'success') {
          const runErr = run?.error || `Run ${status}`;
          const runTimeStr = run?.completedAt || run?.startedAt || '';
          const runTime = runTimeStr ? new Date(runTimeStr).getTime() : 0;

          // Prevent rendering duplicate cards for identical preflight failures recorded within 2 minutes of each other
          const isDup = flat.some(
            (prev) =>
              prev.status === 'failed' &&
              prev.runError === runErr &&
              (prev.postedAt ? Math.abs(new Date(prev.postedAt).getTime() - runTime) < 120000 : true)
          );

          if (!isDup) {
            flat.push({
              id: `${run?.runId || 'run'}-failure-${flat.length}`,
              imageUrl: '',
              imageStatus: 'failed',
              headline: '',
              body: '',
              description: '',
              textStatus: 'failed',
              callToAction: '',
              linkUrl: '',
              posted: false,
              postedAt: run?.completedAt || run?.startedAt || null,
              status: 'failed',
              runError: runErr,
              platform: 'meta',
              accountName: defaultMetaAccountName,
            });
          }
        }
        return;
      }
      list.forEach((c, idx) => {
        const ad = c?.ad || {};
        const posting = c?.posting || {};
        const posted = posting.posted === true;
        const platform = (c?.platform || ad?.platform || posting?.platform || 'meta').toLowerCase();

        let accountName = c?.accountName || posting?.accountName || posting?.pageName;
        if (!accountName || accountName === 'Meta Account') {
          if (platform === 'meta') {
            const pageName = targets.meta?.config?.template?.payload?.pageName || targets.meta?.template?.payload?.pageName;
            const pageId = targets.meta?.config?.template?.pageId || targets.meta?.template?.pageId || targets.meta?.template?.payload?.pageId;
            const fbId = targets.meta?.config?.facebookId || targets.meta?.facebookId;
            accountName = pageName ? pageName : (pageId ? `Meta Page (${pageId})` : (fbId ? `Meta (${fbId})` : defaultMetaAccountName));
          } else if (platform === 'google') {
            const customerId = targets.google?.config?.customerId || targets.google?.customerId;
            accountName = customerId ? `Google (${customerId})` : 'Google Account';
          } else {
            accountName = `${platform.charAt(0).toUpperCase() + platform.slice(1)} Account`;
          }
        }

        flat.push({
          id: c?.creativeId || `${run?.runId || 'run'}-${idx}`,
          imageUrl: ad.imageUrl || '',
          imageStatus: ad.imageStatus || 'unknown',
          headline: ad.headline || '',
          body: ad.body || '',
          description: ad.description || '',
          textStatus: ad.textStatus || 'unknown',
          callToAction: ad.callToAction || '',
          linkUrl: ad.linkUrl || '',
          posted,
          postedAt: posting.postedAt || run?.completedAt || run?.startedAt || null,
          status: posted ? 'success' : 'failed',
          runError: posted ? null : run?.error || null,
          platform,
          accountName,
        });
      });
    });
    return dedupeFailedCards(flat);
  }, [runs, activity?.targets, entry?.targets]);

  const availablePlatforms = useMemo(() => {
    const set = new Set();
    allAds.forEach((ad) => {
      if (ad.platform) set.add(ad.platform.toLowerCase());
    });
    const targets = activity?.targets || entry?.targets || {};
    Object.keys(targets).forEach((p) => {
      if (targets[p]?.template || targets[p]?.config) set.add(p.toLowerCase());
    });
    if (set.size === 0) set.add('meta');
    return [
      { id: 'all', label: 'All' },
      ...Array.from(set).map((p) => ({
        id: p,
        label: p === 'meta' ? 'Meta' : p === 'google' ? 'Google' : p.charAt(0).toUpperCase() + p.slice(1),
      })),
    ];
  }, [allAds, activity?.targets, entry?.targets]);

  const availableAccounts = useMemo(() => {
    const set = new Set();
    const isAllPlatforms = platformFilter.includes('all');
    const relevantAds = isAllPlatforms
      ? allAds
      : allAds.filter((ad) => platformFilter.includes(ad.platform?.toLowerCase()));

    relevantAds.forEach((ad) => {
      if (ad.accountName && ad.accountName !== 'Meta Account' && ad.accountName !== 'Google Account') {
        set.add(ad.accountName);
      }
    });

    const targets = activity?.targets || entry?.targets || {};
    if (set.size === 0) {
      if ((isAllPlatforms || platformFilter.includes('meta')) && targets.meta) {
        const pageName = targets.meta?.config?.template?.payload?.pageName || targets.meta?.template?.payload?.pageName;
        const pageId = targets.meta?.config?.template?.pageId || targets.meta?.template?.pageId || targets.meta?.template?.payload?.pageId;
        const fbId = targets.meta?.config?.facebookId || targets.meta?.facebookId;
        const label = pageName || (pageId ? `Meta Page (${pageId})` : (fbId ? `Meta (${fbId})` : null));
        if (label) set.add(label);
      }
      if ((isAllPlatforms || platformFilter.includes('google')) && targets.google) {
        const customerId = targets.google?.config?.customerId || targets.google?.customerId;
        const label = customerId ? `Google (${customerId})` : null;
        if (label) set.add(label);
      }
    }

    if (set.size === 0) {
      relevantAds.forEach((ad) => {
        if (ad.accountName) set.add(ad.accountName);
      });
    }

    return [
      { id: 'all', label: 'All Accounts' },
      ...Array.from(set).map((acc) => ({
        id: acc,
        label: acc,
      })),
    ];
  }, [allAds, platformFilter, activity?.targets, entry?.targets]);

  // Reset accountFilter if active accounts no longer exist in availableAccounts after a platform change
  useEffect(() => {
    if (!accountFilter.includes('all') && accountFilter.length > 0) {
      const valid = accountFilter.filter((accId) => availableAccounts.some((a) => a.id === accId));
      if (valid.length === 0) {
        setAccountFilter(['all']);
      } else if (valid.length !== accountFilter.length) {
        setAccountFilter(valid);
      }
    }
  }, [platformFilter, availableAccounts]);

  const filtered = useMemo(() => {
    let list = allAds;
    if (statusFilter !== 'all') {
      list = list.filter((ad) => ad.status === statusFilter);
    }
    if (platformFilter.length > 0 && !platformFilter.includes('all')) {
      list = list.filter((ad) => platformFilter.includes(ad.platform?.toLowerCase()));
    }
    if (accountFilter.length > 0 && !accountFilter.includes('all')) {
      list = list.filter((ad) => accountFilter.includes(ad.accountName));
    }
    if (timeFilter === '7d') {
      const cutoff = Date.now() - 7 * 86400000;
      list = list.filter((ad) => {
        const t = ad.postedAt ? new Date(ad.postedAt).getTime() : 0;
        return t >= cutoff;
      });
    } else if (timeFilter === 'custom') {
      const fromTime = customRange.startDate ? customRange.startDate.getTime() : -Infinity;
      const toTime = customRange.endDate
        ? customRange.endDate.getTime() + 86400000
        : Infinity;
      list = list.filter((ad) => {
        const t = ad.postedAt ? new Date(ad.postedAt).getTime() : 0;
        return t >= fromTime && t < toTime;
      });
    }
    return list;
  }, [allAds, statusFilter, platformFilter, accountFilter, timeFilter, customRange]);

  const buckets = useMemo(() => bucketByDate(filtered), [filtered]);
  const densityCfg = DENSITY_OPTIONS.find((d) => d.id === density) || DENSITY_OPTIONS[2];

  if (!campaignId) return null;

  const close = () => dispatch(closePublishedAds());
  const closeLightbox = () => setLightboxImage(null);
  const retry = () => {
    if (campaignId) dispatch(fetchActivity({ campaignId }));
  };
  const campaignLabel = resolveCampaignName({
    activityCampaign: activity?.campaign,
    entry,
    campaignsDropdown,
    campaignId,
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={close}
      className="fixed inset-0 z-1001 flex items-center justify-center bg-[#0D0D0D]/70 p-4 backdrop-blur-md sm:p-6"
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0F0F12] text-white shadow-2xl"
      >
        <div className="pointer-events-none absolute -top-32 -right-24 size-72 rounded-full bg-[#15DCFF]/10 blur-3xl" />

        {/* Header */}
        <header className="relative flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-2 py-0.5 text-10 font-semibold tracking-wider text-[#15DCFF] uppercase">
                <span className="size-1.5 rounded-full bg-[#15DCFF]" />
                Posted Ads
              </span>
              <span className="text-xs text-[#AFAFAF]">Campaign · {campaignLabel}</span>
            </div>
            <h2 className="mt-2 flex items-baseline gap-2 text-xl font-semibold text-white">
              History
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-[#AFAFAF]">
                {filtered.length} of {allAds.length}
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-full p-1.5 text-[#AFAFAF] transition hover:bg-white/5 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* Filter bar */}
        <div className="relative flex flex-wrap items-center gap-3 border-b border-white/5 px-6 py-3">
          <FilterRow
            label="Status"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <span className="hidden h-5 w-px bg-white/10 sm:block" />
          <FilterRow
            label="Time"
            options={TIME_FILTERS}
            value={timeFilter}
            onChange={setTimeFilter}
          />
          {timeFilter === 'custom' && (
            <DateRangeFilter
              onDateChange={handleCustomDateChange}
              onClear={handleCustomDateClear}
            />
          )}
          <span className="hidden h-5 w-px bg-white/10 sm:block" />
          <CustomDropdown
            label="Platform"
            options={availablePlatforms}
            value={platformFilter}
            onChange={setPlatformFilter}
          />
          {availableAccounts.length > 1 && (
            <>
              <span className="hidden h-5 w-px bg-white/10 sm:block" />
              <CustomDropdown
                label="Account"
                options={availableAccounts}
                value={accountFilter}
                onChange={setAccountFilter}
              />
            </>
          )}
          <div className="ml-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-white/3 p-0.5">
            {DENSITY_OPTIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDensity(d.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums transition ${
                  density === d.id
                    ? 'bg-white text-[#0F0F12]'
                    : 'text-[#AFAFAF] hover:text-white'
                }`}
              >
                {d.id}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="relative flex-1 overflow-y-auto px-6 py-5">
          {!entry?.jobId ? (
            <EmptyState
              title="No active automation"
              hint="Activate Autopilot on this campaign to start producing posted ads."
            />
          ) : error ? (
            <ErrorState message={error} onRetry={retry} />
          ) : loading && allAds.length === 0 ? (
            <LoadingState />
          ) : buckets.length === 0 ? (
            <EmptyState
              title="No ads match this filter"
              hint="Try widening the time range or clearing the status filter."
            />
          ) : (
            <div className="space-y-8">
              {buckets.map(({ key, label, items }) => (
                <section key={key}>
                  <div className="mb-3 flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-white">{label}</h3>
                    <span className="text-11 text-[#AFAFAF]">
                      {items.length} {items.length === 1 ? 'post' : 'posts'}
                    </span>
                  </div>
                  <div className={`grid gap-4 ${densityCfg.cols}`}>
                    {items.map((ad) => (
                      <PublishedAdCard
                        key={ad.id}
                        ad={ad}
                        brandInfo={brandInfo}
                        onOpenImage={setLightboxImage}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        {lightboxImage && (
          <ShowLightBox
            lightboxImage={lightboxImage}
            closeLightbox={closeLightbox}
          />
        )}
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function FilterRow({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-10 tracking-wider text-[#AFAFAF] uppercase">{label}</span>
      <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/3 p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              value === o.id
                ? 'bg-[#15DCFF]/20 text-[#15DCFF] ring-1 ring-inset ring-[#15DCFF]/30'
                : 'text-[#AFAFAF] hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomDropdown({ label, options, value, onChange, multi = true }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedArr = Array.isArray(value) ? value : [value];
  const isAll = selectedArr.includes('all');

  const getDisplayLabel = () => {
    if (isAll) return 'All';
    if (selectedArr.length === 0) return 'None';
    if (selectedArr.length === 1) {
      const match = options.find((o) => o.id === selectedArr[0]);
      return match?.label || selectedArr[0];
    }
    return `${selectedArr.length} Selected`;
  };

  const handleToggle = (optionId) => {
    if (!multi) {
      onChange(optionId);
      setOpen(false);
      return;
    }

    const nonAllOptionIds = options.filter((o) => o.id !== 'all').map((o) => o.id);

    if (optionId === 'all') {
      if (isAll) {
        onChange([]);
      } else {
        onChange(['all']);
      }
      return;
    }

    const currentSelected = isAll ? [...nonAllOptionIds] : [...selectedArr];
    let next;
    if (currentSelected.includes(optionId)) {
      next = currentSelected.filter((id) => id !== optionId);
    } else {
      next = [...currentSelected, optionId];
    }

    if (nonAllOptionIds.length > 0 && next.length === nonAllOptionIds.length) {
      onChange(['all']);
    } else {
      onChange(next);
    }
  };

  const isOptionSelected = (optionId) => {
    if (!multi) return value === optionId;
    if (optionId === 'all') return isAll;
    if (isAll) return true;
    return selectedArr.includes(optionId);
  };

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/10 hover:border-white/20"
      >
        <span className="text-10 tracking-wider text-[#AFAFAF] uppercase">{label}:</span>
        <span className="text-xs font-semibold text-[#15DCFF]">{getDisplayLabel()}</span>
        <ChevronDown className={`size-3.5 text-[#AFAFAF] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1.5 min-w-48 max-h-60 overflow-y-auto origin-top-left rounded-xl border border-white/10 bg-[#16161B] p-1 shadow-2xl backdrop-blur-xl">
          {options.map((option) => {
            const active = isOptionSelected(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleToggle(option.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs transition ${
                  active
                    ? 'bg-[#15DCFF]/10 font-semibold text-[#15DCFF]'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className="truncate">{option.label}</span>
                {active && <Check className="size-3.5 shrink-0 text-[#15DCFF]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// PublishedAdCard — Meta-style ad card matching MobilePreview.jsx but compact
// for grid use. Renders posted/failed states from the activity payload, plus
// a `pending` skeleton variant for cycles that are mid-run (socket hasn't
// arrived yet).
function PublishedAdCard({ ad, brandInfo, onOpenImage }) {
  const {
    imageUrl,
    imageStatus,
    headline,
    body,
    callToAction,
    linkUrl,
    posted,
    postedAt,
    runError,
    status,
  } = ad;
  const isPending = status === 'pending';

  // Local fallback when an <img> URL 404s post-render. The API status field
  // says the asset was generated but the CDN can still drop it; this catches
  // that case at runtime. Declared before any early return so the hook order
  // stays stable across renders (rules-of-hooks).
  const [imgErrored, setImgErrored] = useState(false);

  // Pending cards short-circuit to the skeleton variant. They share the
  // outer dimensions with real cards so the grid doesn't reflow when one
  // hydrates into a real result.
  if (isPending) {
    return <PendingAdCard brandInfo={brandInfo} />;
  }
  const isFailed = !posted;
  const imageBroken = imageStatus === 'failed' || !imageUrl;
  const textBroken = !body && !headline;
  const ctaLabel = formatCta(callToAction);
  const initial = brandInfo?.brandName?.slice(0, 1)?.toUpperCase() || 'A';

  const showImageFallback = imageBroken || imgErrored;

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-white text-gray-800 shadow-sm transition ${
        isFailed ? 'border-red-400/50' : 'border-white/10'
      }`}
    >
      {/* Header with inline Account badge & Status pill */}
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#167beb] text-xs font-bold text-white">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="truncate text-[12px] leading-tight font-semibold text-gray-900">
                {brandInfo?.brandName || 'Brand'}
              </span>
              {ad.accountName && (
                <span className="truncate rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 border border-gray-200">
                  {ad.platform === 'meta' ? 'Meta' : ad.platform === 'google' ? 'Google' : ad.platform} · {ad.accountName}
                </span>
              )}
            </div>
            {postedAt && (
              <div className="truncate text-10 text-gray-500 mt-0.5">{formatPostedAt(postedAt)}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {posted ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-10 font-semibold text-white shadow">
              <Check className="size-3" /> Posted
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-10 font-semibold text-white shadow">
              <AlertTriangle className="size-3" /> Failed
            </span>
          )}
          <EllipsisVertical className="h-4 w-4 shrink-0 text-gray-400" />
        </div>
      </div>

      {/* Body text */}
      <div className="mt-2 line-clamp-3 px-3 text-[11px] leading-snug text-gray-700">
        {body || (textBroken ? <span className="text-red-500">Text generation failed</span> : '')}
      </div>

      {/* Ad image — `object-contain` so brand text overlays at the top/
          bottom of off-aspect creatives don't get chopped by a 1:1 frame.
          The neutral letterbox bars are absorbed by the parent's bg color. */}
      <div className="mx-3 mt-2 aspect-square overflow-hidden rounded-md bg-[#E4E6EB]">
        {showImageFallback ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-red-50/60 text-center">
            <ImageOff className="size-5 text-red-500" />
            <span className="text-10 font-medium text-red-600">Image unavailable</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenImage?.(imageUrl)}
            className="block h-full w-full cursor-zoom-in"
          >
            <img
              src={imageUrl}
              alt={headline || 'Posted ad'}
              className="h-full w-full object-contain"
              onError={() => setImgErrored(true)}
            />
          </button>
        )}
      </div>

      {/* Link preview */}
      <div className="m-3 flex items-center justify-between gap-2 rounded bg-[#F7F8FA] p-2">
        <div className="min-w-0">
          <div className="line-clamp-1 break-all text-[9px] text-gray-500">
            {linkUrl || 'No link'}
          </div>
          <div className="truncate text-[11px] leading-tight font-semibold text-gray-900">
            {headline || (
              <span className="text-red-500">{textBroken ? 'No headline' : 'Untitled'}</span>
            )}
          </div>
        </div>
        <a
          href={linkUrl || '#'}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (!linkUrl) e.preventDefault();
          }}
          className={`shrink-0 rounded-md px-3 py-1.5 text-10 font-semibold whitespace-nowrap ${
            linkUrl
              ? 'bg-[#E4E6EB] text-[#191919] hover:bg-gray-300'
              : 'cursor-not-allowed bg-gray-100 text-gray-400'
          }`}
        >
          {ctaLabel || 'Learn More'}
        </a>
      </div>

      {/* Social actions row — Like / Comment / Share (visual only) */}
      <div className="mx-3 mb-3 flex items-center justify-around border-t border-gray-200 pt-2 text-gray-500">
        <span className="flex items-center gap-1 text-10 font-medium">
          <ThumbsUp className="size-3.5" />
          Like
        </span>
        <span className="flex items-center gap-1 text-10 font-medium">
          <MessageCircle className="size-3.5" />
          Comment
        </span>
        <span className="flex items-center gap-1 text-10 font-medium">
          <Share2 className="size-3.5" />
          Share
        </span>
      </div>

      {/* Failure reason footer */}
      {isFailed && runError && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-10 leading-tight text-red-700">
          <span className="font-semibold">Reason:</span> {runError}
        </div>
      )}
    </div>
  );
}

// Skeleton card for an in-flight automation cycle. Same outer frame as a
// real card so the grid doesn't reflow when the socket arrives and the
// placeholder is replaced by hydrated content.
function PendingAdCard({ brandInfo }) {
  const initial = brandInfo?.brandName?.slice(0, 1)?.toUpperCase() || 'A';
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-[#5867EB]/40 bg-white text-gray-800 shadow-sm">
      {/* "Generating" pill — mirrors the Posted/Failed slot. */}
      <div className="pointer-events-none absolute top-2 right-2 z-10">
        <span className="flex items-center gap-1 rounded-full bg-[#5867EB] px-2 py-0.5 text-10 font-semibold text-white shadow">
          <Loader2 className="size-3 animate-spin" /> Generating
        </span>
      </div>

      {/* Header — real brand if we have it; otherwise skeleton. */}
      <div className="flex items-start gap-2 px-3 pt-3 pr-20">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#167beb] text-xs font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] leading-tight font-semibold text-gray-900">
            {brandInfo?.brandName || 'Brand'}
          </div>
          <div className="text-10 text-gray-500">Generating now…</div>
        </div>
        <EllipsisVertical className="h-4 w-4 shrink-0 text-gray-500" />
      </div>

      {/* Body shimmer — three lines, last one short. */}
      <div className="mt-2 space-y-1.5 px-3">
        <div className="h-2 w-11/12 animate-pulse rounded bg-gray-200" />
        <div className="h-2 w-10/12 animate-pulse rounded bg-gray-200" />
        <div className="h-2 w-6/12 animate-pulse rounded bg-gray-200" />
      </div>

      {/* Image slot — purple animated "Generating" loader, same square box
          a real image would occupy so the card height stays constant. */}
      <div className="mx-3 mt-2 aspect-square overflow-hidden rounded-md bg-[#E4E6EB]">
        <CreativeGeneratingLoader />
      </div>

      {/* Link preview shimmer. */}
      <div className="m-3 flex items-center justify-between gap-2 rounded bg-[#F7F8FA] p-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="h-1.5 w-7/12 animate-pulse rounded bg-gray-200" />
          <div className="h-2 w-9/12 animate-pulse rounded bg-gray-300" />
        </div>
        <div className="h-6 w-16 shrink-0 animate-pulse rounded-md bg-gray-200" />
      </div>

      {/* Social actions row — kept identical to the real card so the bottom
          of the skeleton matches what's about to render. */}
      <div className="mx-3 mb-3 flex items-center justify-around border-t border-gray-200 pt-2 text-gray-500">
        <span className="flex items-center gap-1 text-10 font-medium">
          <ThumbsUp className="size-3.5" />
          Like
        </span>
        <span className="flex items-center gap-1 text-10 font-medium">
          <MessageCircle className="size-3.5" />
          Comment
        </span>
        <span className="flex items-center gap-1 text-10 font-medium">
          <Share2 className="size-3.5" />
          Share
        </span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full min-h-70 flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="size-6 animate-spin text-[#15DCFF]" />
      <p className="text-sm text-white">Loading posted ads…</p>
      <p className="max-w-65 text-xs text-[#AFAFAF]">
        Fetching the full activity trace for this automation.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex h-full min-h-70 flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/30">
        <AlertTriangle className="size-5 text-red-400" />
      </div>
      <p className="text-sm text-white">Couldn't load posted ads</p>
      <p className="max-w-80 text-xs text-[#AFAFAF]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/10"
      >
        <RefreshCcw className="size-3.5" />
        Try again
      </button>
    </div>
  );
}

function EmptyState({ title, hint }) {
  return (
    <div className="flex h-full min-h-70 flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
        <Inbox className="size-5 text-[#AFAFAF]" />
      </div>
      <p className="text-sm text-white">{title}</p>
      <p className="max-w-65 text-xs text-[#AFAFAF]">{hint}</p>
    </div>
  );
}

// Header label resolver: activity payload's campaign.campaignName is canonical
// when available. Falls back to the AdsGPT campaigns dropdown so the header
// shows a real name before the /activity request resolves. Last resort is just
// "Campaign" — we deliberately never expose the raw Mongo id.
function resolveCampaignName({ activityCampaign, entry, campaignsDropdown, campaignId }) {
  if (activityCampaign?.campaignName) return activityCampaign.campaignName;
  if (entry?.config?.campaignName) return entry.config.campaignName;
  if (entry?.config?.target?.campaignName) return entry.config.target.campaignName;
  if (Array.isArray(campaignsDropdown) && campaignId) {
    const match = campaignsDropdown.find(
      (c) => c?._id === campaignId || c?.campaignId === campaignId || c?.id === campaignId
    );
    if (match?.campaignName) return match.campaignName;
    if (match?.name) return match.name;
  }
  return 'Campaign';
}

// dd-MM-yyyy → Date. DateRangeFilter formats with date-fns format(d, 'dd-MM-yyyy').
function parseDdMmYyyy(s) {
  if (!s) return null;
  const [d, m, y] = s.split('-').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

// "SHOP_NOW" → "Shop Now"
function formatCta(value) {
  if (!value) return '';
  return String(value)
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function formatPostedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function bucketByDate(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86400000);

  const undated = [];
  const groups = new Map();
  for (const item of items) {
    if (!item.postedAt) {
      undated.push(item);
      continue;
    }
    const d = new Date(item.postedAt);
    if (Number.isNaN(d.getTime())) {
      undated.push(item);
      continue;
    }
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, { key, date: d, items: [] });
    groups.get(key).items.push(item);
  }

  const dated = [...groups.values()]
    .sort((a, b) => b.date - a.date)
    .map(({ key, date, items: list }) => {
      let label;
      if (date.getTime() === today.getTime()) label = 'Today';
      else if (date.getTime() === yesterday.getTime()) label = 'Yesterday';
      else
        label = date.toLocaleDateString(undefined, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
      return { key, label, items: list };
    });

  if (undated.length > 0) {
    dated.push({ key: 'unscheduled', label: 'Undated', items: undated });
  }
  return dated;
}
