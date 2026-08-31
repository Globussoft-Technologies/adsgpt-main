import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Video as VideoIcon,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { postGoogleAd } from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import useGenerateGoogleAdCopy from './useGenerateGoogleAdCopy';
import buildGoogleAdPayload from './buildGoogleAdPayload';
import GOOGLE_CTA_OPTIONS from './googleCtaOptions';

const labelize = (s) =>
  s
    ?.split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ') || '';

// Parse user input that may or may not include a protocol so the
// preview can show the real hostname (otherwise "example.com" leaks).
const maybeUrl = (s) => {
  const trimmed = (s || '').trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProto).href;
  } catch {
    return null;
  }
};

const inferFilename = (url) => {
  if (!url) return '';
  try {
    const path = new URL(url).pathname;
    return path.split('/').pop() || url;
  } catch {
    return url.split('/').pop() || url;
  }
};

const buildInitialForm = () => ({
  adName: '',
  prompt: '',
  headline: '',
  longHeadline: '',
  description: '',
  linkUrl: '',
  callToAction: '', // empty = no CTA (legal for both DISPLAY + DEMAND_GEN)
});

// Field-length limits per the Google create-ad spec. The headline cap
// differs between channels — Google's RDA (Display) allows up to 90 for
// the single headline (it's reused as longHeadline server-side), while
// Demand Gen / Video keeps the classic 30-char single line. Branch at
// the call site via `headlineLimitFor(isVideo)` so the input maxLength
// and the hint copy stay in lock-step.
const LIMITS = {
  headlineVideo: 30,
  headlineDisplay: 90,
  longHeadline: 90,
  description: 90,
};
const headlineLimitFor = (isVideo) =>
  isVideo ? LIMITS.headlineVideo : LIMITS.headlineDisplay;

export default function GoogleComposeStep({ payload, selection, onBack, onPosted }) {
  const { url: mediaUrl, isVideo } = payload || {};
  const [form, setForm] = useState(buildInitialForm);
  // Single `posting` flag for both channels — image and video share the
  // same UX (disabled form + spinner on the Post button) even though
  // video posts can take ~2 min while the backend uploads to YouTube.
  const [posting, setPosting] = useState(false);
  const { generate, loading: generating } = useGenerateGoogleAdCopy();

  const filename = useMemo(() => inferFilename(mediaUrl), [mediaUrl]);
  const previewHost = useMemo(() => {
    const resolved = maybeUrl(form.linkUrl);
    if (!resolved) return 'example.com';
    try {
      return new URL(resolved).hostname.replace(/^www\./, '');
    } catch {
      return 'example.com';
    }
  }, [form.linkUrl]);

  const onGenerate = () =>
    generate(
      { prompt: form.prompt, isVideo },
      ({ headline, longHeadline, description, callToAction }) =>
        setForm((f) => ({
          ...f,
          headline,
          // longHeadline only matters for video, but always copying is
          // safe — image form just doesn't render the field.
          longHeadline,
          description,
          callToAction,
        })),
    );

  // headline is REQUIRED for BOTH channels per the create-ads spec —
  // DISPLAY needs it as the single headline (also reused server-side as
  // longHeadline), Demand Gen / Video needs it as the on-card line.
  // DISPLAY additionally requires description; Video's description is
  // optional (backend falls back to "Check it out"). linkUrl is required
  // for both. Everything else is optional.
  const canPost = useMemo(() => {
    if (!mediaUrl || !form.linkUrl.trim()) return false;
    if (!selection?.adAccountId || !selection?.campaignId || !selection?.adGroupId) return false;
    if (posting) return false;
    if (!form.headline.trim()) return false;
    if (!isVideo) {
      // DISPLAY: description is required (video's is optional)
      if (!form.description.trim()) return false;
    }
    return true;
  }, [mediaUrl, form.linkUrl, form.headline, form.description, selection, posting, isVideo]);

  const onPost = async () => {
    if (!canPost) return;
    setPosting(true);

    try {
      const body = buildGoogleAdPayload({
        selection,
        media: { url: mediaUrl, isVideo },
        form,
      });
      // `adAccountId` rides in the body (buildGoogleAdPayload includes
      // it). Endpoint is /adsgpt/google-ads/ads — no path param. For
      // video, the backend uploads to YouTube + polls synchronously
      // (up to ~2 min) — the button stays in its loading state for the
      // whole duration, same as the image flow.
      await postGoogleAd(body);
      globalToast.success('Ad posted successfully');
      onPosted?.();
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Failed to post ad';
      globalToast.error(msg);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-5">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-900 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to selection
        </button>
      )}

      {selection && (
        <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-white/55">
          <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 dark:border-white/8 dark:bg-white/5">
            Ad account · {selection.adAccountId}
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 dark:border-white/8 dark:bg-white/5">
            Campaign · {selection.campaignId}
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 dark:border-white/8 dark:bg-white/5">
            Ad group · {selection.adGroupId}
          </span>
          <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 text-emerald-600 dark:text-emerald-200">
            {isVideo ? 'Demand Gen · video' : 'Display · image'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:gap-6">
        <div className="flex flex-col gap-5 2xl:gap-7">
          <Field label="Ad name">
            <TextInput
              value={form.adName}
              onChange={(v) => setForm((f) => ({ ...f, adName: v }))}
              placeholder="e.g. Spring Sale — Hero Banner"
              maxLength={120}
            />
          </Field>

          <Field label="Media">
            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-white/10 dark:bg-white/2">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gray-200 dark:bg-[#111]">
                {mediaUrl ? (
                  isVideo ? (
                    <video src={mediaUrl} className="h-full w-full object-cover" muted />
                  ) : (
                    <img src={mediaUrl} alt="ad media" className="h-full w-full object-cover" />
                  )
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-white">
                  {isVideo ? (
                    <VideoIcon className="h-3.5 w-3.5 text-gray-400 dark:text-white/55" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 text-gray-400 dark:text-white/55" />
                  )}
                  <span className="truncate">{filename || 'Selected media'}</span>
                </p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-white/40">
                  Prefilled from MySpace · {isVideo ? 'video (auto-uploaded to YouTube)' : 'image'}
                </p>
              </div>
            </div>
          </Field>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 2xl:p-5 dark:border-white/8 dark:bg-white/2">
            <p className="mb-3 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-white/55">
              Ad Copy
            </p>

            <Field label="Prompt" hint="Optional · helps the model write better copy">
              <div className="flex items-stretch gap-2">
                <TextInput
                  value={form.prompt}
                  onChange={(v) => setForm((f) => ({ ...f, prompt: v }))}
                  placeholder="e.g. Onida festive sale, premium washing machines, up to 40% off"
                />
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={generating || !form.prompt.trim()}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition 2xl:text-sm ${
                    generating || !form.prompt.trim()
                      ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-white/8 dark:text-white/40'
                      : 'bg-gray-900 text-white hover:opacity-90 dark:bg-white dark:text-black'
                  }`}
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {generating ? 'Generating' : 'Generate'}
                </button>
              </div>
            </Field>

            <div className="mt-4">
              <Field
                label={
                  <span>
                    Headline <span className="text-red-400">*</span>
                  </span>
                }
                hint={`Max ${headlineLimitFor(isVideo)} chars`}
              >
                <TextInput
                  value={form.headline}
                  onChange={(v) => setForm((f) => ({ ...f, headline: v }))}
                  placeholder="Bold one-liner"
                  maxLength={headlineLimitFor(isVideo)}
                />
              </Field>
            </div>

            {isVideo && (
              <div className="mt-4">
                <Field label="Long headline" hint={`Optional · Max ${LIMITS.longHeadline} chars · video only`}>
                  <TextInput
                    value={form.longHeadline}
                    onChange={(v) => setForm((f) => ({ ...f, longHeadline: v }))}
                    placeholder="A longer, more descriptive headline"
                    maxLength={LIMITS.longHeadline}
                  />
                </Field>
              </div>
            )}

            <div className="mt-4">
              <Field
                label={
                  isVideo ? (
                    'Description'
                  ) : (
                    <span>
                      Description <span className="text-red-400">*</span>
                    </span>
                  )
                }
                hint={`Max ${LIMITS.description} chars`}
              >
                <TextArea
                  value={form.description}
                  onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                  placeholder="What makes this ad worth tapping"
                  rows={2}
                  maxLength={LIMITS.description}
                />
              </Field>
            </div>

            <div className="mt-4">
              <Field label="Call to action" hint="Optional">
                <Select
                  value={form.callToAction || '__none__'}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, callToAction: v === '__none__' ? '' : v }))
                  }
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-white">
                    {/* Children override — same Radix gotcha as Meta */}
                    <SelectValue placeholder="No CTA">
                      {form.callToAction ? labelize(form.callToAction) : 'No CTA'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="z-[9999] border border-gray-200 bg-white text-gray-800 shadow-lg dark:border-white/10 dark:bg-[#1A1A1A] dark:text-white">
                    <SelectItem value="__none__" className="text-sm text-gray-500 dark:text-white/70">
                      No CTA
                    </SelectItem>
                    {GOOGLE_CTA_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt} className="text-sm text-gray-700 dark:text-white">
                        {labelize(opt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <Field
            label={
              <span>
                Destination URL <span className="text-red-400">*</span>
              </span>
            }
          >
            <TextInput
              value={form.linkUrl}
              onChange={(v) => setForm((f) => ({ ...f, linkUrl: v }))}
              placeholder="https://example.com/landing"
            />
          </Field>
        </div>

        {/* live preview — Google ad mockup */}
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-white/55">
            Preview · {isVideo ? 'YouTube / Demand Gen' : 'Google Display'}
          </p>
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0D0D0D]">
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 2xl:px-5 2xl:py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-full bg-white/10 2xl:h-9 2xl:w-9" />
                <div>
                  <p className="text-sm font-semibold text-white 2xl:text-base">Sponsored</p>
                  <p className="text-xs text-white/35 2xl:text-sm">
                    {isVideo ? 'YouTube · Demand Gen' : 'Google Display Network'}
                  </p>
                </div>
              </div>
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 uppercase">
                Ad
              </span>
            </div>

            {/* Media area */}
            <div className={`w-full overflow-hidden bg-[#111] ${isVideo ? 'aspect-video' : 'aspect-[1.91/1]'}`}>
              {mediaUrl ? (
                isVideo ? (
                  <video
                    src={mediaUrl}
                    className="h-full w-full object-cover"
                    controls
                    muted
                    loop
                    playsInline
                  />
                ) : (
                  <img src={mediaUrl} alt="ad preview" className="h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                  <ImageIcon className="h-10 w-10 text-white/15 2xl:h-12 2xl:w-12" />
                  <span className="text-sm text-white/30 2xl:text-base">No media</span>
                </div>
              )}
            </div>

            {/* Copy + CTA */}
            <div className="border-t border-white/5 px-4 py-3 2xl:px-5 2xl:py-4">
              <p className="truncate text-[11px] tracking-wider text-white/35 uppercase 2xl:text-xs">
                {previewHost}
              </p>
              {form.headline && (
                <p className="mt-1 line-clamp-2 text-sm font-bold text-white 2xl:text-base">
                  {form.headline}
                </p>
              )}
              {isVideo && form.longHeadline && (
                <p className="mt-1 line-clamp-2 text-sm text-white/85 2xl:text-base">
                  {form.longHeadline}
                </p>
              )}
              {form.description && (
                <p className="mt-1 line-clamp-2 text-xs text-white/55 2xl:text-sm">
                  {form.description}
                </p>
              )}
              {form.callToAction && (
                <div className="mt-3 flex justify-end">
                  <span className="shrink-0 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white 2xl:px-4 2xl:py-2 2xl:text-sm">
                    {labelize(form.callToAction)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onPost}
          disabled={!canPost}
          title={
            !mediaUrl
              ? 'Missing media'
              : !form.linkUrl.trim()
                ? 'Destination URL is required'
                : !form.headline.trim()
                  ? 'Headline is required'
                  : !isVideo && !form.description.trim()
                    ? 'Description is required for Display ads'
                    : undefined
          }
          className={`flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition 2xl:px-10 2xl:py-3 2xl:text-base ${
            canPost
              ? 'bg-gray-900 text-white hover:opacity-90 dark:bg-white dark:text-black'
              : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-400/30'
          }`}
        >
          {posting && <Loader2 className="h-4 w-4 animate-spin" />}
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-gray-700 2xl:text-base dark:text-white/75">{label}</label>
        {hint && <span className="text-[10px] text-gray-400 2xl:text-xs dark:text-white/40">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, maxLength }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:bg-white 2xl:h-11 2xl:text-base dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:bg-white/8"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, maxLength }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:bg-white 2xl:text-base dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:bg-white/8"
    />
  );
}
