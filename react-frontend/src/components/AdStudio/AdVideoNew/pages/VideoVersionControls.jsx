import { useLayoutEffect, useRef, useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import { labelForLanguage } from '@/apis/voiceSelector/voiceSelectorApi';

// Clean long voice descriptions like "Neelu - Relatable Gujarati Conversations"
// down to just the voice name "Neelu".
const cleanVoice = (name = '') => {
  if (!name) return '';
  const cleaned = name.split(/[-–—(,/]/)[0].trim();
  return cleaned.length > 14 ? `${cleaned.slice(0, 12)}…` : cleaned;
};

// Label a results[] entry from its aiAds metadata, e.g. "V1 · Original",
// "V2 · Translate · Hindi · Rachel", or "V4 · Translate · Gujarati · Neelu".
const versionLabel = (r, i) => {
  const rt = r?.aiAds?.regenType;
  const base = rt ? rt.charAt(0).toUpperCase() + rt.slice(1) : 'Original';
  const lang = r?.aiAds?.language ? labelForLanguage(r.aiAds.language) : '';
  const vn = cleanVoice(r?.aiAds?.voiceName);
  return [`V${i + 1}`, base, lang, vn].filter(Boolean).join(' · ');
};

/**
 * Version switcher for an AI Ads card. Browsing previews a version locally
 * (onPreview); the committed pointer only moves on "Keep this one" (onKeep).
 * Rendered only when a card has more than one version.
 */
export default function VideoVersionControls({
  results = [],
  shownVersion,
  committedVersion,
  onPreview,
  onRevert,
  onKeep,
}) {
  const controlsRef = useRef(null);
  const [menuWidth, setMenuWidth] = useState(256);
  const options = results.map((r, i) => ({ value: String(i), label: versionLabel(r, i) }));
  const value = {
    value: String(shownVersion),
    label: versionLabel(results[shownVersion], shownVersion),
  };
  const isPreviewing = shownVersion !== committedVersion;

  useLayoutEffect(() => {
    const card = controlsRef.current?.closest('.my-space-media-card');
    if (!card) return undefined;

    const updateMenuWidth = () => {
      setMenuWidth(Math.max(0, card.getBoundingClientRect().width - 16));
    };

    updateMenuWidth();
    const observer = new ResizeObserver(updateMenuWidth);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={controlsRef}
      className="pointer-events-none absolute top-2.5 right-12 left-12 z-30 flex min-w-0 flex-col items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="pointer-events-auto max-w-full rounded-full bg-black/50 backdrop-blur"
        title={value.label}
      >
        <CommonDropdown
          label="Version"
          options={options}
          value={value}
          onChange={(v) => onPreview(Number(v))}
          side="bottom"
          className="max-w-full data-[size=default]:h-auto data-[size=default]:min-h-6 [&>div]:min-w-0 [&>div]:max-w-full [&>div]:py-1 [&>div]:justify-center [&>div>span]:truncate [&>div>span]:max-w-full [&>div>span]:text-center [&>div>span]:leading-tight"
          contentAlign="center"
          contentClassName="min-w-0"
          contentStyle={{ width: menuWidth, minWidth: menuWidth, maxWidth: menuWidth }}
        />
      </div>

      {isPreviewing && (
        <div className="pointer-events-auto flex max-w-full items-center justify-center gap-2">
          <button
            type="button"
            title="Keep this one"
            onClick={() => onKeep(shownVersion)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-700"
          >
            <Check size={13} /> Keep
          </button>
          <button
            type="button"
            title="Back to current version"
            onClick={onRevert}
            className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition hover:bg-white/25"
          >
            <Undo2 size={13} /> Revert
          </button>
        </div>
      )}
    </div>
  );
}
