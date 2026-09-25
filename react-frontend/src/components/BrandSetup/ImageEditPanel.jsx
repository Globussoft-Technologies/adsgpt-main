/**
 * The Edit block in the clip screen's side panel — images only.
 *
 * Takes the place of Versions for a still. Versions meant nothing there:
 * regeneration is off, so it only ever listed one entry. What a user does next
 * with a finished image ad is touch it up, so that is what the space holds.
 *
 * Every edit is a NEW image, never a change to this one:
 *   1. the editor flattens and uploads it (S3) and hands back a URL;
 *   2. it is filed in MySpace as its own record (`POST /image/save-edited`,
 *      the endpoint MySpace's own logo edit uses — no credits, original kept);
 *   3. `onEdited` puts it in the strip as the newest card and opens it.
 * Step 2 failing does not stop step 3: the user still has the image on screen
 * to download or post; they are told it did not reach MySpace.
 *
 * Tools:
 *   Quick logo, Fit to placement → `QuickImageTools` (plain canvas, one click)
 *   Logo editor                  → `MySpaceLogoEditor`, exactly as MySpace has it
 *   everything else              → `OnboardingImageEditor` (Filerobot), on a tab
 *   Edit in Canva                → MySpace's `useCanvaEdit`, in a NEW tab
 *
 * Canva is the odd one out: it is one-way. The image is uploaded to the user's
 * Canva account and they finish there — nothing comes back, so it makes no
 * card and no My Space record, and the button says so.
 */

import { useState } from 'react';
import {
  Crop,
  ImagePlus,
  SlidersHorizontal,
  Sparkles,
  Type,
  Scaling,
  Stamp,
  Ratio,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useCanvaEdit } from '@/hooks/useCanvaEdit';
import canvaIconLogo from '@/assets/layouts/Canva Icon logo_32x32.png';
import toast from 'react-hot-toast';
import { saveEditedImage } from '@/apis/image/imageApi';
import MySpaceLogoEditor from '../AdStudio/AdVideoNew/pages/MySpaceLogoEditor';
import OnboardingImageEditor from './OnboardingImageEditor';
import { FitToPlacement, QuickLogo } from './QuickImageTools';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

/**
 * An uploaded edit's address, as something an `<img>` can load.
 *
 * `upload-image` answers with an S3 KEY (`/creatives/<user>/<file>.webp`), not
 * a URL — MySpace stores that key on the record and prefixes it at render time
 * (ImageCard's `resolveUrl`). Used raw, the browser asked the app's own host for
 * it and the edited card showed a broken image. Full URLs pass through, so this
 * is safe on edits stored before the fix.
 */
export const toMediaUrl = (url) =>
  !url || /^(https?:|blob:|data:)/.test(url) ? url || '' : `${S3_BASE_URL}${url}`;

const SURF2 = '#232329';
const LINE_STRONG = 'rgba(255,255,255,0.16)';

// The one-click tools first: they are what most people want from this panel,
// and the full editors are there for anything they cannot do.
const TOOLS = [
  { key: 'quicklogo', label: 'Quick logo', icon: Stamp },
  { key: 'placement', label: 'Fit to placement', icon: Ratio },
  { key: 'logo', label: 'Logo editor', icon: ImagePlus },
  { key: 'crop', label: 'Crop & rotate', icon: Crop },
  { key: 'adjust', label: 'Adjust', icon: SlidersHorizontal },
  { key: 'filters', label: 'Filters', icon: Sparkles },
  { key: 'text', label: 'Text & shapes', icon: Type },
  { key: 'resize', label: 'Resize', icon: Scaling },
];

/**
 * @param src       the image on the stage — the one every tool starts from
 * @param model     the model that made the original, carried onto the record
 * @param prompt    what the MySpace record is described as
 * @param onEdited  `(url) => void`, after the edit is uploaded
 */
export default function ImageEditPanel({ src, model, prompt, onEdited }) {
  const [open, setOpen] = useState(null); // a TOOLS key, or null
  const { editInCanva, isCanvaLoading } = useCanvaEdit();
  const canvaBusy = isCanvaLoading(src);

  const handleSaved = (url) => {
    setOpen(null);
    // Not awaited: the new card should appear the moment the upload lands, not
    // after a second round-trip the user cannot see.
    saveEditedImage({
      // The key, as MySpace's own edits store it — its grid resolves it.
      url,
      // Same `type` the recreate itself was filed under (templateAdResult's
      // `fileIntoMySpace`), so MySpace treats the edit like its original.
      inputs: {
        type: 'template_recreate',
        model: model || undefined,
        numberOfImages: 1,
        userPrompt: prompt || 'Edited from onboarding',
      },
    })
      .then(() => toast.success('Saved to My Space'))
      .catch((err) => {
        console.error('[onboarding] save-edited failed:', err?.response?.data || err);
        toast.error('Your edit is ready, but it couldn’t be saved to My Space.');
      });
    onEdited?.(toMediaUrl(url));
  };

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {TOOLS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setOpen(key)}
            className="flex items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left text-[12.5px] font-semibold text-white/80 transition hover:border-[rgba(21,220,255,0.35)] hover:text-white"
            style={{ background: SURF2, borderColor: LINE_STRONG }}
          >
            <Icon size={14} className="shrink-0 text-[#15DCFF]" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* Full width and set apart: it leaves this page for Canva (in a new tab,
          so the session here is untouched) and its edits stay in Canva. */}
      <button
        type="button"
        disabled={canvaBusy}
        // `src` is always a full URL here — the backend downloads it itself.
        onClick={(e) => editInCanva(src, e, { newTab: true })}
        className="mt-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left text-[12.5px] font-semibold text-white/80 transition hover:border-[rgba(21,220,255,0.35)] hover:text-white disabled:opacity-60"
        style={{ background: SURF2, borderColor: LINE_STRONG }}
      >
        {canvaBusy ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-[#15DCFF]" />
        ) : (
          <img src={canvaIconLogo} alt="" className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="flex-1 truncate">Edit in Canva</span>
        <ExternalLink size={13} className="shrink-0 text-white/45" />
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">
        Opens in a new tab. Canva edits are saved in your Canva account.
      </p>

      {open === 'logo' && (
        <MySpaceLogoEditor
          baseImageUrl={src}
          onClose={() => setOpen(null)}
          onSaved={handleSaved}
        />
      )}
      {open === 'quicklogo' && (
        <QuickLogo src={src} onClose={() => setOpen(null)} onSaved={handleSaved} />
      )}
      {open === 'placement' && (
        <FitToPlacement src={src} onClose={() => setOpen(null)} onSaved={handleSaved} />
      )}
      {open && !['logo', 'quicklogo', 'placement'].includes(open) && (
        <OnboardingImageEditor
          src={src}
          start={open}
          onClose={() => setOpen(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
