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
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { postAdV2 } from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import useGenerateAdCopy from './useGenerateAdCopy';
import buildPostAdPayload from './buildPostAdPayload';
import CTA_OPTIONS from './ctaOptions';

const labelize = (s) =>
  s
    ?.split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ') || '';

// Parse user input that may or may not include a protocol. If the user
// types "www.google.com" or "google.com/foo", prepend https:// so the
// URL parses and the preview can show the real hostname (otherwise the
// fallback "example.com" leaks through).
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
  primaryText: '',
  headline: '',
  description: '',
  linkUrl: '',
  callToAction: 'LEARN_MORE',
});

export default function MySpaceComposeStep({ payload, selection, onBack, onPosted }) {
  const { url: mediaUrl, isVideo } = payload || {};
  const [form, setForm] = useState(buildInitialForm);
  const [posting, setPosting] = useState(false);
  const { generate, loading: generating } = useGenerateAdCopy();

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
    generate(form.prompt, ({ primaryText, headline, description, callToAction }) =>
      setForm((f) => ({ ...f, primaryText, headline, description, callToAction })),
    );

  // Gate Post on every required field: media, primary text, headline, CTA,
  // destination URL, and a valid selection (which now carries the picked
  // Facebook account via accountId/facebookId — see MySpaceSelectStep).
  // Description and the optional prompt stay free-form.
  const missingField =
    !mediaUrl
      ? 'Media is required'
      : !form.primaryText.trim()
        ? 'Primary text is required'
        : !form.headline.trim()
          ? 'Headline is required'
          : !form.callToAction
            ? 'Call to action is required'
            : !form.linkUrl.trim()
              ? 'Destination URL is required'
              : '';
  const canPost =
    !missingField &&
    Boolean(
      selection?.accountId &&
        selection?.facebookId &&
        selection?.adAccountId &&
        selection?.pageId &&
        selection?.campaignId &&
        selection?.adSetId,
    ) &&
    !posting;

  const onPost = async () => {
    if (!canPost) return;
    setPosting(true);
    try {
      const body = buildPostAdPayload({
        selection,
        media: { url: mediaUrl, isVideo },
        form,
      });
      await postAdV2(body);
      globalToast.success('Ad posted successfully');
      onPosted?.();
    } catch (err) {
      // Backend error envelope: `{ success:false, error, details?, data? }`.
      // Prefer `error` (human-readable), fall back to `message`, then to a
      // generic string so the user always sees something.
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
          className="flex w-fit items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to selection
        </button>
      )}

      {selection && (
        <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-white/55">
          <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 dark:border-white/8 dark:bg-white/5">
            Ad account · {selection.adAccountId}
          </span>
          <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 dark:border-white/8 dark:bg-white/5">
            Page · {selection.pageId}
          </span>
          <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 dark:border-white/8 dark:bg-white/5">
            Campaign · {selection.campaignId}
          </span>
          <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 dark:border-white/8 dark:bg-white/5">
            Ad set · {selection.adSetId}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:gap-6">
        <div className="flex flex-col gap-5 2xl:gap-7">
          <Field label="Ad name">
            <TextInput
              value={form.adName}
              onChange={(v) => setForm((f) => ({ ...f, adName: v }))}
              placeholder="e.g. Spring Sale — Hero Image"
              maxLength={120}
            />
          </Field>

          <Field label="Media">
            <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-black/5 px-3 py-3 dark:border-white/10 dark:bg-white/2">
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
                <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                  {isVideo ? (
                    <VideoIcon className="h-3.5 w-3.5 text-gray-400 dark:text-white/55" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 text-gray-400 dark:text-white/55" />
                  )}
                  <span className="truncate">{filename || 'Selected media'}</span>
                </p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-white/40">
                  Prefilled from MySpace · {isVideo ? 'video' : 'image'}
                </p>
              </div>
            </div>
          </Field>

          <div className="rounded-2xl border border-black/8 bg-black/[0.02] p-4 dark:border-white/8 dark:bg-white/2 2xl:p-5">
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
                      ? 'cursor-not-allowed bg-black/5 text-gray-400 dark:bg-white/8 dark:text-white/40'
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
                label={<span>Primary text <span className="text-red-400">*</span></span>}
                hint="Shown above the image"
              >
                <TextArea
                  value={form.primaryText}
                  onChange={(v) => setForm((f) => ({ ...f, primaryText: v }))}
                  placeholder="Tell people what makes this ad worth tapping"
                  rows={3}
                  maxLength={2000}
                />
              </Field>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:gap-5">
              <Field label={<span>Headline <span className="text-red-400">*</span></span>}>
                <TextInput
                  value={form.headline}
                  onChange={(v) => setForm((f) => ({ ...f, headline: v }))}
                  placeholder="Bold one-liner"
                  maxLength={255}
                />
              </Field>
              <Field label="Description" hint="Optional">
                <TextInput
                  value={form.description}
                  onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                  placeholder="Sub-headline"
                  maxLength={255}
                />
              </Field>
            </div>

            <div className="mt-4">
              <Field label={<span>Call to action <span className="text-red-400">*</span></span>}>
                <Select
                  value={form.callToAction}
                  onValueChange={(v) => setForm((f) => ({ ...f, callToAction: v }))}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-black/10 bg-black/5 px-3 text-sm text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white">
                    {/* Pass children to SelectValue so the trigger label
                        is derived from `form.callToAction` directly.
                        Radix's default behavior reads the matching
                        SelectItem's text, but those items live inside
                        a Portal that only mounts when the dropdown is
                        opened — so programmatic value changes (e.g.
                        from Generate Ad Copy) leave the trigger
                        showing the previously-selected label. */}
                    <SelectValue placeholder="Choose CTA">
                      {form.callToAction ? labelize(form.callToAction) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="z-[9999] border-black/10 bg-white text-gray-900 dark:border-white/10 dark:bg-[#1A1A1A] dark:text-white">
                    {CTA_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt} className="text-sm">
                        {labelize(opt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <Field label={<span>Destination URL <span className="text-red-400">*</span></span>}>
            <TextInput
              value={form.linkUrl}
              onChange={(v) => setForm((f) => ({ ...f, linkUrl: v }))}
              placeholder="https://example.com/landing"
            />
          </Field>
        </div>

        {/* live preview */}
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-white/55">
            Preview
          </p>
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-gray-50 dark:border-white/8 dark:bg-[#0D0D0D]">
            <div className="flex items-center gap-2.5 border-b border-black/5 px-4 py-3 dark:border-white/5 2xl:px-5 2xl:py-3.5">
              <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-white/10 2xl:h-9 2xl:w-9" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white 2xl:text-base">Sponsored</p>
                <p className="text-xs text-gray-400 dark:text-white/35 2xl:text-sm">Facebook · Feed</p>
              </div>
            </div>
            {form.primaryText && (
              <p className="px-4 pt-3 text-sm leading-relaxed text-gray-800 dark:text-white/85 2xl:px-5 2xl:text-base">
                {form.primaryText}
              </p>
            )}
            <div className="mt-3 aspect-square w-full overflow-hidden bg-gray-200 dark:bg-[#111]">
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
            <div className="flex items-center justify-between gap-3 border-t border-black/5 px-4 py-3 dark:border-white/5 2xl:px-5 2xl:py-4">
              <div className="min-w-0">
                <p className="truncate text-[11px] tracking-wider text-gray-400 uppercase dark:text-white/35 2xl:text-xs">
                  {previewHost}
                </p>
                {form.headline && (
                  <p className="mt-0.5 truncate text-sm font-bold text-gray-900 dark:text-white 2xl:text-base">
                    {form.headline}
                  </p>
                )}
                {form.description && (
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-white/55 2xl:text-sm">
                    {form.description}
                  </p>
                )}
              </div>
              {form.callToAction !== 'NO_BUTTON' && (
                <span className="ml-3 shrink-0 rounded-full border border-black/10 bg-black/5 px-3 py-1.5 text-xs font-semibold text-gray-800 dark:border-white/12 dark:bg-white/8 dark:text-white 2xl:px-4 2xl:py-2 2xl:text-sm">
                  {labelize(form.callToAction)}
                </span>
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
          title={missingField || undefined}
          className={`flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition 2xl:px-10 2xl:py-3 2xl:text-base ${
            canPost
              ? 'bg-gray-900 text-white hover:opacity-90 dark:bg-white dark:text-black'
              : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-400/30 dark:text-gray-400'
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
        <label className="text-sm font-medium text-gray-700 dark:text-white/75 2xl:text-base">{label}</label>
        {hint && <span className="text-[10px] text-gray-400 dark:text-white/40 2xl:text-xs">{hint}</span>}
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
      className="h-10 w-full rounded-xl border border-black/10 bg-black/5 px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-black/20 focus:bg-black/8 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:bg-white/8 2xl:h-11 2xl:text-base"
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
      className="w-full resize-none rounded-xl border border-black/10 bg-black/5 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-black/20 focus:bg-black/8 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:bg-white/8 2xl:text-base"
    />
  );
}
