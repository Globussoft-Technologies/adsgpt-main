import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertCircle,
  Check,
  Download,
  Eye,
  ImageOff,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  X,
} from 'lucide-react';
import { FaFacebookF } from 'react-icons/fa6';
import { FcGoogle } from 'react-icons/fc';

import { downloadMediaFromUrl } from '@/store/actions/adVideoNew/Advideoactions';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import MobilePreview from '@/components/AdFactory/AdPreview/MobilePreview';
import GoogleMobilePreview from '@/components/AdFactory/AdPreview/GoogleMobilePreview';
import AddImageDialog from '@/components/AdFactory/AdPreview/AddImageDialog';
import {
  PublishError,
  PublishResult,
  PublishTargetFields,
  usePublishTarget,
} from './ShipTheseAds';
import {
  isGoogleAccountConnected,
  isGoogleConnectionComplete,
} from './GoogleLaunchConnection';
import { IS_GOOGLE_AUTOMATION_ENABLED } from '@/utils/featureFlags';
import { GhostBtn, PrimaryBtn } from './Panel';
import { CARD, FAINT, MUTED, NUM, RULE_BORDER, SECTION, TITLE } from './_tokens';

const S3 = import.meta.env.VITE_S3_BASE_URL || '';

const srcOf = (data) => {
  const s = String(data || '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `${S3}${s}`;
};

const aspectOf = (ratio) => {
  const [w, h] = String(ratio || '')
    .split(':')
    .map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `${w} / ${h}` : '4 / 5';
};

const when = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

// ----------------------------------------------------------------------------
// RunGallery — every ad this brief has made, and the one place any selection of
// them goes live.
// ----------------------------------------------------------------------------

export default function RunGallery({
  open,
  onOpenChange,
  runs = [],
  ratio = '4:5',
  callToAction = 'Learn more',
  brandName,
  linkUrl,
  connection,
  onConnectionChange,
  platforms = [],
  googleConnection,
  onGoogleConnectionChange,
  onPublish,
  publishing = false,
  publishResult = null,
  publishError = null,
  onDismissResult,
}) {
  // Keyed by image url — the same identity the server filters on, and stable
  // across a refetch that hands back new pair objects.
  const [selected, setSelected] = useState(() => new Set());
  const [previewing, setPreviewing] = useState(null);
  const [platform, setPlatform] = useState('meta');
  const [galleryFilter, setGalleryFilter] = useState('all'); // 'all' | 'meta' | 'google'
  const [editedCopies, setEditedCopies] = useState({}); // { [imageUrl]: { headline, primaryText, ... } }
  const [previewPlatform, setPreviewPlatform] = useState('meta');
  const [customPairs, setCustomPairs] = useState([]);
  const [addImageOpen, setAddImageOpen] = useState(false);

  const userData = useSelector((state) => state.auth?.userData || state.socket?.userData);
  const userId = userData?.user_id;

  const handleAddCustomImage = useCallback(
    (img) => {
      if (!img?.src) return;
      const defaultHeadline = brandName ? `${brandName}` : 'Special Offer';
      const defaultText = 'Experience the difference. Explore our offers and get started today.';
      const newPair = {
        imageUrl: img.src,
        isCustom: true,
        copy: {
          headline: defaultHeadline,
          primaryText: defaultText,
          description: defaultText,
          meta: {
            headline: defaultHeadline,
            primary_text: defaultText,
          },
          google: {
            headline: defaultHeadline.slice(0, 30),
            description: defaultText.slice(0, 90),
          },
        },
      };
      setCustomPairs((prev) => [newPair, ...prev]);
      setSelected((prev) => new Set([...prev, img.src]));
      setAddImageOpen(false);
    },
    [brandName]
  );

  const displayRuns = useMemo(() => {
    if (customPairs.length === 0) return runs;
    if (!runs || runs.length === 0) {
      return [
        {
          key: 'custom-run',
          title: 'Custom ads',
          pairs: customPairs,
          pending: 0,
        },
      ];
    }
    return runs.map((r, i) =>
      i === 0 ? { ...r, pairs: [...customPairs, ...(r.pairs || [])] } : r
    );
  }, [runs, customPairs]);

  const { googleUser } = useSelector((state) => state.adFactoryNew) || {};

  const googleChosen =
    IS_GOOGLE_AUTOMATION_ENABLED &&
    (Array.isArray(platforms) ? platforms : []).includes('google');

  useEffect(() => {
    if (!googleChosen && platform === 'google') setPlatform('meta');
  }, [googleChosen, platform]);

  const target = usePublishTarget({ connection, publishing });

  const isGoogleConnected = isGoogleAccountConnected(googleUser);
  const isGoogleReady = isGoogleConnectionComplete(googleConnection, isGoogleConnected);

  const total = useMemo(() => displayRuns.reduce((sum, r) => sum + (r.pairs?.length || 0), 0), [displayRuns]);
  const pendingTotal = useMemo(
    () => displayRuns.reduce((sum, r) => sum + (r.pending || 0), 0),
    [displayRuns]
  );

  const allUrls = useMemo(
    () => displayRuns.flatMap((r) => (r.pairs || []).map((p) => p.imageUrl).filter(Boolean)),
    [displayRuns]
  );

  // A fresh grid every time it opens. Carrying a selection across an open is
  // how someone posts an ad they picked ten minutes ago and forgot about.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setPreviewing(null);
  }, [open]);

  // A run that regenerates while this is open can retire a selected ad. Drop
  // what no longer exists rather than sending the server a url it will refuse.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(allUrls);
      const next = new Set([...prev].filter((u) => live.has(u)));
      return next.size === prev.size ? prev : next;
    });
  }, [allUrls]);

  const toggle = useCallback((url) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const getEffectiveCopy = useCallback(
    (pair, targetPlatform = galleryFilter) => {
      if (!pair) return {};
      const edited = editedCopies[pair.imageUrl];
      const base = pair.copy || {};
      const metaCopy = edited?.meta || base.meta || null;
      const googleCopy = edited?.google || base.google || null;

      if (targetPlatform === 'google') {
        const headline =
          edited?.google?.headline ||
          edited?.headline ||
          googleCopy?.headline ||
          base.headline ||
          '';
        const primaryText =
          edited?.google?.description ||
          edited?.google?.primaryText ||
          edited?.primaryText ||
          googleCopy?.description ||
          googleCopy?.primaryText ||
          base.primaryText ||
          '';
        return {
          headline,
          primaryText,
          description: primaryText,
        };
      }

      if (targetPlatform === 'meta') {
        const headline =
          edited?.meta?.headline || edited?.headline || metaCopy?.headline || base.headline || '';
        const primaryText =
          edited?.meta?.primary_text ||
          edited?.meta?.primaryText ||
          edited?.primaryText ||
          metaCopy?.primary_text ||
          metaCopy?.primaryText ||
          base.primaryText ||
          '';
        const description =
          edited?.meta?.description ||
          edited?.description ||
          metaCopy?.description ||
          base.description ||
          '';
        return {
          headline,
          primaryText,
          description,
        };
      }

      // 'all'
      const headline =
        edited?.headline ||
        edited?.meta?.headline ||
        edited?.google?.headline ||
        metaCopy?.headline ||
        googleCopy?.headline ||
        base.headline ||
        '';
      const primaryText =
        edited?.primaryText ||
        edited?.meta?.primary_text ||
        edited?.meta?.primaryText ||
        edited?.google?.description ||
        edited?.google?.primaryText ||
        metaCopy?.primary_text ||
        metaCopy?.primaryText ||
        googleCopy?.description ||
        base.primaryText ||
        '';
      const description =
        edited?.description ||
        edited?.meta?.description ||
        edited?.google?.description ||
        metaCopy?.description ||
        googleCopy?.description ||
        base.description ||
        '';
      return {
        headline,
        primaryText,
        description,
      };
    },
    [editedCopies, galleryFilter]
  );

  const count = selected.size;
  const allSelected = total > 0 && count === total;
  const canPost =
    platform === 'google'
      ? isGoogleConnected && isGoogleReady && count > 0 && !publishing
      : target.canPublish(count);

  const handlePublish = useCallback(() => {
    const selectedPairs = displayRuns
      .flatMap((r) => r.pairs || [])
      .filter((p) => selected.has(p.imageUrl))
      .map((p) => {
        const eff = getEffectiveCopy(p, platform);
        return {
          ...p,
          headline: eff.headline,
          description: eff.description || eff.primaryText,
          body: eff.primaryText,
          text: eff.primaryText,
          copy: eff,
        };
      });

    if (platform === 'google') {
      onPublish?.({
        platform: 'google',
        mode: 'existing',
        adAccountId: googleConnection?.adAccountId,
        campaignId: googleConnection?.campaignId,
        adGroupId: googleConnection?.adGroupId,
        googleConnection,
        imageUrls: [...selected],
        pairs: selectedPairs,
      });
    } else {
      onPublish?.({
        platform: 'meta',
        ...target.publishArgs,
        imageUrls: [...selected],
        pairs: selectedPairs,
      });
    }
  }, [platform, onPublish, googleConnection, target.publishArgs, selected, displayRuns, getEffectiveCopy]);

  // What the action bar's button says, in the order the user hits the reasons:
  // nothing picked → no Meta/Google → no ad set/template → go.
  const blocker = !count
    ? 'Select ads to post'
    : platform === 'google'
      ? !isGoogleConnected
        ? 'Connect Google to post'
        : !isGoogleReady
          ? 'Select account, campaign & ad group'
          : ''
      : !target.connected
        ? 'Connect Meta to post'
        : !target.targeted
          ? 'Choose a campaign & ad set'
          : '';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[90vh] w-[90vw]! max-w-[1400px]! sm:max-w-[1400px]! scale-100! flex-col overflow-hidden rounded-xl border-[var(--ws-border)] bg-[var(--ws-bg)] p-0 text-[var(--ws-text-primary)] dark:border-[#2A2A2A] dark:bg-[#0f0f0f] dark:text-[#F4F4F5]"
        >
        {/* ── Header ── */}
        <div
          className={`flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-4 ${RULE_BORDER}`}
        >
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className={TITLE}>All generations</h2>
            <span className={MUTED}>
              <span className={NUM}>{total}</span> {total === 1 ? 'ad' : 'ads'} across{' '}
              <span className={NUM}>{runs.length}</span> {runs.length === 1 ? 'run' : 'runs'}
              {pendingTotal > 0 && (
                <>
                  {' · '}
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#4654D4] dark:text-[#15DCFF]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className={NUM}>{pendingTotal}</span> still generating
                  </span>
                </>
              )}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {total > 0 && !publishResult && (
              <GhostBtn onClick={() => setSelected(allSelected ? new Set() : new Set(allUrls))}>
                {allSelected ? 'Clear selection' : 'Select all'}
              </GhostBtn>
            )}
            <GhostBtn onClick={() => onOpenChange?.(false)} aria-label="Close">
              <X className="h-3.5 w-3.5" />
            </GhostBtn>
          </div>
        </div>

        {/* ── Body ── two panes on lg, one scrolling column below it. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* ── The ads ── */}
          <div className="min-w-0 shrink-0 px-5 pt-4 pb-5 lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto">
            {/* ── Platform Template Toggle (All / Meta / Google) ── */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ws-border)] bg-[var(--ws-surface)] p-2 shadow-xs dark:border-[#2A2A2A] dark:bg-[#141414]">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-[var(--ws-surface-hover)] p-1 dark:bg-[#1f1f1f]">
                  <button
                    type="button"
                    onClick={() => setGalleryFilter('all')}
                    className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      galleryFilter === 'all'
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2C2C2C] dark:text-white'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                    }`}
                  >
                    <span>All</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryFilter('meta')}
                    className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      galleryFilter === 'meta'
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2C2C2C] dark:text-white'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                    }`}
                  >
                    <FaFacebookF className="h-3 w-3 text-[#1877F2] dark:text-[#5B9DF8]" />
                    <span>Meta</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryFilter('google')}
                    className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      galleryFilter === 'google'
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2C2C2C] dark:text-white'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                    }`}
                  >
                    <FcGoogle className="h-3.5 w-3.5" />
                    <span>Google</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setAddImageOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--ws-border)] bg-[var(--ws-surface-hover)] px-3 py-1.5 text-xs font-semibold text-[var(--ws-text-primary)] shadow-2xs transition-all hover:border-[#5867EB]/50 hover:bg-[#5867EB]/10 dark:border-[#2A2A2A] dark:bg-[#1f1f1f] dark:text-white dark:hover:border-[#15DCFF]/50 dark:hover:bg-[#15DCFF]/10 cursor-pointer"
                  title="Add custom image"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add image</span>
                </button>
              </div>

              {/* Template guidance & character caps */}
              <div className="flex items-center gap-2 text-[11px]">
                {galleryFilter === 'google' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-300">
                    <span className="font-semibold">Google template:</span>
                    <span>Headline max 30 chars · Description max 90 chars</span>
                  </span>
                ) : galleryFilter === 'meta' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/25 bg-blue-500/10 px-2.5 py-1 font-medium text-blue-700 dark:text-blue-300">
                    <span className="font-semibold">Meta template:</span>
                    <span>Headline rec 40 chars · Primary text rec 125 chars</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-[#5867EB]/25 bg-[#5867EB]/10 px-2.5 py-1 font-medium text-[#4654D4] dark:border-[#15DCFF]/25 dark:bg-[#15DCFF]/10 dark:text-[#15DCFF]">
                    <span className="font-semibold">All templates:</span>
                    <span>All generations for Meta &amp; Google</span>
                  </span>
                )}
              </div>
            </div>

            {total === 0 && pendingTotal === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className={`text-center ${MUTED}`}>
                  Nothing generated yet. Press Generate and they&apos;ll collect here.
                </p>
                <button
                  type="button"
                  onClick={() => setAddImageOpen(true)}
                  className="flex items-center gap-2 rounded-lg border border-[var(--ws-border)] bg-[var(--ws-surface)] px-4 py-2 text-xs font-semibold text-[var(--ws-text-primary)] shadow-xs transition-colors hover:border-[#5867EB]/50 hover:bg-[#5867EB]/10 dark:border-[#2A2A2A] dark:bg-[#1E1E1E] dark:text-white cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add custom image</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {displayRuns
                  .filter((r) => (r.pairs?.length || 0) > 0 || (r.pending || 0) > 0)
                  .map((run, runIndex) => (
                    <section key={run.key} className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <h3 className={SECTION}>{run.title}</h3>
                        {run.at && <span className={FAINT}>{when(run.at)}</span>}
                        <span className={FAINT}>
                          <span className={NUM}>{run.pairs.length}</span>{' '}
                          {run.pairs.length === 1 ? 'ad' : 'ads'}
                          {run.pending > 0 && (
                            <>
                              {' of '}
                              <span className={NUM}>{run.pairs.length + run.pending}</span>
                            </>
                          )}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-4">
                        {run.pairs.map((pair, i) => (
                          <Tile
                            key={pair.imageUrl || `${run.key}-${i}`}
                            pair={pair}
                            ratio={ratio}
                            callToAction={callToAction}
                            selected={selected.has(pair.imageUrl)}
                            onToggle={() => toggle(pair.imageUrl)}
                            onPreview={() => {
                              setPreviewing(pair);
                              setPreviewPlatform(galleryFilter === 'google' ? 'google' : 'meta');
                            }}
                            activeFilter={galleryFilter}
                            effectiveCopy={getEffectiveCopy(pair, galleryFilter)}
                            onSaveCopy={(newCopy) => {
                              setEditedCopies((prev) => ({
                                ...prev,
                                [pair.imageUrl]: newCopy,
                              }));
                            }}
                          />
                        ))}

                        {Array.from({ length: run.pending || 0 }).map((_, i) => (
                          <SkeletonTile key={`pending-${run.key}-${i}`} ratio={ratio} />
                        ))}
                      </div>
                    </section>
                  ))}
              </div>
            )}
          </div>

          {/* ── Where they go ── */}
          <aside
            className={`flex shrink-0 flex-col border-t ${RULE_BORDER} bg-[var(--ws-surface)]/70 lg:min-h-0 lg:w-90 lg:border-t-0 lg:border-l lg:overflow-y-auto dark:bg-[#171717]/70`}
          >
            <div className="flex flex-col gap-4 px-5 py-4">
              {publishResult ? (
                <PublishResult
                  result={publishResult}
                  adCount={count}
                  adAccountId={target.adAccountId}
                  stacked
                  onDismiss={() => {
                    onDismissResult?.();
                    setSelected(new Set());
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <h3 className={SECTION}>Where these publish</h3>
                    <p className={MUTED}>
                      {count === 0 ? (
                        'Tick the ads on the left, then pick where they go.'
                      ) : (
                        <>
                          <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>
                            {count}
                          </b>{' '}
                          {count === 1 ? 'ad' : 'ads'} ready to post — from any run.
                        </>
                      )}
                    </p>
                  </div>

                  {publishError && <PublishError error={publishError} />}

                  <PublishTargetFields
                    target={target}
                    connection={connection}
                    onConnectionChange={onConnectionChange}
                    publishing={publishing}
                    stacked
                    platforms={platforms}
                    googleValue={googleConnection}
                    onGoogleChange={onGoogleConnectionChange}
                    activePlatform={platform}
                    onActivePlatformChange={setPlatform}
                    hideWhereTitle
                  />
                </>
              )}
            </div>
          </aside>
        </div>

        {/* ── Action bar ── */}
        {!publishResult && (
          <div
            className={`flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t px-5 py-3.5 ${RULE_BORDER}`}
          >
            <p className={MUTED}>
              {count === 0 ? (
                'Nothing selected yet.'
              ) : (
                <>
                  <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>
                    {count}
                  </b>{' '}
                  {count === 1 ? 'ad' : 'ads'} selected · go live immediately · no credits, no
                  schedule
                </>
              )}
            </p>
            <PrimaryBtn
              icon={publishing ? undefined : Rocket}
              onClick={handlePublish}
              busy={publishing}
              disabled={!canPost}
            >
              {publishing ? 'Posting…' : blocker || `Post ${count} ${count === 1 ? 'ad' : 'ads'}`}
            </PrimaryBtn>
          </div>
        )}

        {/* ── The ad preview with Meta / Google template switcher ── */}
        {previewing && (
          <div
            role="presentation"
            onClick={() => setPreviewing(null)}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          >
            <div
              className="relative flex flex-col items-center gap-3"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              {/* Preview Platform Switcher */}
              <div className="flex items-center gap-1 rounded-full border border-white/20 bg-black/70 p-1 shadow-lg backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setPreviewPlatform('meta')}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-all ${
                    previewPlatform === 'meta'
                      ? 'bg-[#1877F2] text-white shadow-sm'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  <FaFacebookF className="h-3 w-3" />
                  <span>Meta Preview</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPlatform('google')}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-all ${
                    previewPlatform === 'google'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  <FcGoogle className="h-3.5 w-3.5" />
                  <span>Google Preview</span>
                </button>
              </div>

              {previewPlatform === 'google' ? (
                <GoogleMobilePreview
                  image={srcOf(previewing.imageUrl)}
                  text={getEffectiveCopy(previewing, 'google')}
                  cta={callToAction}
                  ctaLink={linkUrl}
                  brandName={brandName}
                />
              ) : (
                <MobilePreview
                  image={srcOf(previewing.imageUrl)}
                  text={getEffectiveCopy(previewing, 'meta')}
                  cta={callToAction}
                  ctaLink={linkUrl}
                  brandName={brandName}
                />
              )}

              <button
                type="button"
                onClick={() => setPreviewing(null)}
                aria-label="Close preview"
                className="absolute -top-2 -right-2 rounded-full bg-[#5867EB] p-1.5 text-white shadow-lg transition-transform hover:scale-110 cursor-pointer dark:bg-[#15DCFF] dark:text-[#062024]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <AddImageDialog
      open={addImageOpen}
      onClose={() => setAddImageOpen(false)}
      onAdd={handleAddCustomImage}
      userId={userId}
    />

  </>
  );
}

function Tile({
  pair,
  ratio,
  callToAction,
  selected,
  onToggle,
  onPreview,
  activeFilter = 'all',
  effectiveCopy,
  onSaveCopy,
}) {
  const dispatch = useDispatch();
  const src = srcOf(pair.imageUrl);
  const [broken, setBroken] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [draftHeadline, setDraftHeadline] = useState(effectiveCopy?.headline || '');
  const [draftPrimaryText, setDraftPrimaryText] = useState(effectiveCopy?.primaryText || '');

  useEffect(() => {
    if (!isEditing) {
      setDraftHeadline(effectiveCopy?.headline || '');
      setDraftPrimaryText(effectiveCopy?.primaryText || '');
    }
  }, [effectiveCopy, isEditing]);

  const currentHeadline = isEditing ? draftHeadline : effectiveCopy?.headline || '';
  const currentPrimaryText = isEditing ? draftPrimaryText : effectiveCopy?.primaryText || '';

  // Character caps & guidelines
  const isGoogle = activeFilter === 'google';
  const headlineMax = isGoogle ? 30 : 40;
  const primaryMax = isGoogle ? 90 : 125;

  const headlineOver = isGoogle
    ? currentHeadline.length > 30
    : currentHeadline.length > 40;
  const primaryOver = isGoogle
    ? currentPrimaryText.length > 90
    : currentPrimaryText.length > 125;

  const handleSave = (e) => {
    e?.stopPropagation();
    onSaveCopy?.({
      headline: draftHeadline,
      primaryText: draftPrimaryText,
      description: draftPrimaryText,
      ...(isGoogle
        ? { google: { headline: draftHeadline, description: draftPrimaryText } }
        : {}),
      ...(activeFilter === 'meta'
        ? { meta: { headline: draftHeadline, primary_text: draftPrimaryText } }
        : {}),
    });
    setIsEditing(false);
  };

  const handleCancel = (e) => {
    e?.stopPropagation();
    setDraftHeadline(effectiveCopy?.headline || '');
    setDraftPrimaryText(effectiveCopy?.primaryText || '');
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      handleCancel(e);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSave(e);
    }
  };

  return (
    <article
      className={`group relative flex flex-col overflow-hidden ${CARD} ${
        selected ? 'ring-2 ring-[#5867EB] dark:ring-[#15DCFF]' : ''
      }`}
    >
      {/* Checkbox / image trigger */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? 'Deselect this ad' : 'Select this ad'}
        className="relative block w-full bg-[var(--ws-surface-hover)] dark:bg-[#242424]"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        {broken ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-center">
            <ImageOff className="h-5 w-5 text-[#9C8F7D] dark:text-[#6C7480]" />
            <span className={FAINT}>Image unavailable</span>
          </span>
        ) : (
          <img
            src={src}
            alt={currentHeadline || 'Generated ad'}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        )}

        {/* Selection indicator */}
        <span
          className={`absolute top-2 left-2 grid h-5 w-5 place-items-center rounded-md border transition-colors ${
            selected
              ? 'border-[#5867EB] bg-[#5867EB] text-white dark:border-[#15DCFF] dark:bg-[#15DCFF] dark:text-[#062024]'
              : 'border-white/70 bg-black/30 text-transparent group-hover:border-white'
          }`}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>

        {/* Platform tag badge on card */}
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
          {activeFilter === 'google' ? (
            <>
              <FcGoogle className="h-3 w-3" />
              <span>Google</span>
            </>
          ) : activeFilter === 'meta' ? (
            <>
              <FaFacebookF className="h-2.5 w-2.5 text-[#5B9DF8]" />
              <span>Meta</span>
            </>
          ) : (
            <>
              <FaFacebookF className="h-2.5 w-2.5 text-[#5B9DF8]" />
              <FcGoogle className="h-2.5 w-2.5" />
              <span>All</span>
            </>
          )}
        </span>
      </button>

      {/* Copy / Text area */}
      <div className={`flex flex-1 flex-col gap-2 border-t px-2.5 py-2.5 ${RULE_BORDER}`}>
        {isEditing ? (
          <div
            className="flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            {/* Edit Mode Header */}
            <div className="flex items-center justify-between pb-0.5">
              <span className="flex items-center gap-1 text-[11px] font-bold text-[#5867EB] dark:text-[#15DCFF]">
                <Pencil className="h-3 w-3" />
                <span>Edit Copy</span>
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                Esc to cancel
              </span>
            </div>

            {/* Headline Input */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[10px]">
                <label className="font-semibold text-gray-700 dark:text-gray-200">
                  Headline
                </label>
                <span
                  className={`font-medium ${
                    isGoogle && draftHeadline.length > 30
                      ? 'font-bold text-red-500'
                      : draftHeadline.length > headlineMax
                        ? 'text-amber-500'
                        : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {draftHeadline.length}/{headlineMax} {isGoogle ? 'max' : 'rec'}
                </span>
              </div>
              <input
                type="text"
                autoFocus
                value={draftHeadline}
                onChange={(e) => setDraftHeadline(e.target.value)}
                placeholder="Enter headline..."
                className={`w-full rounded-lg border-2 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-900 shadow-xs outline-none transition-all dark:bg-[#1E1E1E] dark:text-white ${
                  isGoogle && draftHeadline.length > 30
                    ? 'border-red-500 ring-2 ring-red-500/20'
                    : 'border-gray-300 hover:border-gray-400 focus:border-[#5867EB] focus:ring-2 focus:ring-[#5867EB]/25 dark:border-[#444] dark:hover:border-[#666] dark:focus:border-[#15DCFF] dark:focus:ring-[#15DCFF]/25'
                }`}
              />
            </div>

            {/* Primary Text / Caption Input */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[10px]">
                <label className="font-semibold text-gray-700 dark:text-gray-200">
                  {isGoogle ? 'Description' : 'Primary text'}
                </label>
                <span
                  className={`font-medium ${
                    isGoogle && draftPrimaryText.length > 90
                      ? 'font-bold text-red-500'
                      : draftPrimaryText.length > primaryMax
                        ? 'text-amber-500'
                        : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {draftPrimaryText.length}/{primaryMax} {isGoogle ? 'max' : 'rec'}
                </span>
              </div>
              <textarea
                value={draftPrimaryText}
                onChange={(e) => setDraftPrimaryText(e.target.value)}
                rows={3}
                placeholder={isGoogle ? 'Enter description...' : 'Enter primary text...'}
                className={`w-full min-h-[68px] resize-none rounded-lg border-2 bg-white p-2.5 text-xs leading-relaxed text-gray-900 shadow-xs outline-none transition-all dark:bg-[#1E1E1E] dark:text-white ${
                  isGoogle && draftPrimaryText.length > 90
                    ? 'border-red-500 ring-2 ring-red-500/20'
                    : 'border-gray-300 hover:border-gray-400 focus:border-[#5867EB] focus:ring-2 focus:ring-[#5867EB]/25 dark:border-[#444] dark:hover:border-[#666] dark:focus:border-[#15DCFF] dark:focus:ring-[#15DCFF]/25'
                }`}
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(156,163,175,0.6) transparent',
                }}
              />
            </div>

            {/* Action buttons: Cancel & Save */}
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 dark:border-[#444] dark:bg-[#202020] dark:text-gray-200 dark:hover:bg-[#2A2A2A] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1 rounded-md bg-[#5867EB] px-3 py-1 text-[11px] font-semibold text-white shadow-xs hover:bg-[#4755D6] dark:bg-[#15DCFF] dark:text-[#062024] cursor-pointer"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
                <span>Save</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Read Mode: headline & description */}
            <div
              className="group/caption flex flex-col gap-1 cursor-pointer rounded-md p-1 -m-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => setIsEditing(true)}
              title="Click to edit headline & text"
            >
              {currentHeadline ? (
                <b className="line-clamp-2 text-[12px] font-medium leading-snug text-[#111827] transition-colors group-hover/caption:text-[#5867EB] dark:text-[#ECEFF3] dark:group-hover/caption:text-[#15DCFF]">
                  {currentHeadline}
                </b>
              ) : (
                <span className="text-[11px] italic text-gray-400">Click to add headline</span>
              )}

              {currentPrimaryText ? (
                <p className="line-clamp-2 text-[11px] leading-relaxed text-[#6B7280] dark:text-[#AFB6C0]">
                  {currentPrimaryText}
                </p>
              ) : (
                <span className="text-[11px] italic text-gray-400">Click to add primary text</span>
              )}
            </div>

            {/* Platform limit warnings */}
            {isGoogle && (headlineOver || primaryOver) && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                <span>Exceeds Google limit</span>
              </span>
            )}

            {/* Footer action bar */}
            <div className="mt-auto flex items-center justify-between gap-1.5 pt-2">
              <span
                title={(callToAction || 'Learn more').replace(/_/g, ' ')}
                className="inline-flex min-w-0 max-w-[85px] items-center rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface-hover)] px-2 py-0.5 text-[10.5px] font-medium tracking-tight text-[var(--ws-text-primary)] shadow-2xs transition-colors hover:border-[#5867EB]/40 dark:border-[#333] dark:bg-[#202020] dark:text-[#ECEFF3] dark:hover:border-[#15DCFF]/40"
              >
                <span className="truncate">{(callToAction || 'Learn more').replace(/_/g, ' ')}</span>
              </span>

              <div className="flex shrink-0 items-center gap-1">
                <TileAction onClick={() => setIsEditing(true)} title="Edit copy on card">
                  <Pencil className="h-3 w-3" />
                </TileAction>
                <TileAction onClick={onPreview} title="Preview this ad">
                  <Eye className="h-3 w-3" />
                </TileAction>
                <TileAction
                  onClick={() => dispatch(downloadMediaFromUrl(src, 'image'))}
                  title="Download"
                >
                  <Download className="h-3 w-3" />
                </TileAction>
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

// Placeholder for pending slots
function SkeletonTile({ ratio }) {
  return (
    <article className={`flex flex-col overflow-hidden ${CARD}`}>
      <div
        className="relative grid animate-pulse place-items-center bg-[var(--ws-surface-hover)] dark:bg-[#202020]"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        <Loader2 className="h-4 w-4 animate-spin text-[#9C8F7D] dark:text-[#6C7480]" />
      </div>
      <div className={`flex flex-col gap-2 border-t px-3 py-2.5 ${RULE_BORDER}`}>
        <span className="h-2.5 w-3/5 animate-pulse rounded bg-[#EFE6D8] dark:bg-[#22272F]" />
        <span className="h-2 w-full animate-pulse rounded bg-[#EFE6D8] dark:bg-[#22272F]" />
        <span className={`mt-1 ${FAINT}`}>Generating…</span>
      </div>
    </article>
  );
}

function TileAction({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--ws-border)] text-[var(--ws-text-secondary)] transition-colors hover:border-[var(--ws-border-strong)] hover:text-[var(--ws-text-primary)] dark:border-[#2E2E2E] dark:bg-[#1A1A1A] dark:text-[#AFAFAF] dark:hover:border-[#444] dark:hover:text-[#F4F4F5] cursor-pointer"
    >
      {children}
    </button>
  );
}
