import { Check, Undo2 } from 'lucide-react';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import { labelForLanguage } from '@/apis/voiceSelector/voiceSelectorApi';

// Label a results[] entry from its aiAds metadata, e.g. "Original · Kannada · anushka"
// or "Translate · Hindi · Rachel".
const versionLabel = (r, i) => {
  const rt = r?.aiAds?.regenType;
  const base = rt ? rt.charAt(0).toUpperCase() + rt.slice(1) : 'Original';
  const lang = r?.aiAds?.language ? labelForLanguage(r.aiAds.language) : '';
  const vn = r?.aiAds?.voiceName || '';
  return [`v${i + 1}`, base, lang, vn].filter(Boolean).join(' · ');
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
  const options = results.map((r, i) => ({ value: String(i), label: versionLabel(r, i) }));
  const value = {
    value: String(shownVersion),
    label: versionLabel(results[shownVersion], shownVersion),
  };
  const isPreviewing = shownVersion !== committedVersion;

  return (
    <div
      className="absolute top-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="rounded-full bg-black/50 backdrop-blur">
        <CommonDropdown
          label="Version"
          options={options}
          value={value}
          onChange={(v) => onPreview(Number(v))}
          side="bottom"
        />
      </div>

      {isPreviewing && (
        <>
          <button
            type="button"
            title="Keep this one"
            onClick={() => onKeep(shownVersion)}
            className="flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-700"
          >
            <Check size={13} /> Keep
          </button>
          <button
            type="button"
            title="Back to current version"
            onClick={onRevert}
            className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition hover:bg-white/25"
          >
            <Undo2 size={13} /> Revert
          </button>
        </>
      )}
    </div>
  );
}
