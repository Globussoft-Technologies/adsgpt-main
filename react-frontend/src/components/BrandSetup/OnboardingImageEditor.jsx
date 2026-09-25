/**
 * The full-screen image editor on the onboarding clip screen.
 *
 * Filerobot, the same library the AdCreative editor (`pages/Editor/ImageEditor/
 * FilerobotEditor`) uses — but NOT that component. That one is wired to the
 * `editor` Redux slice and mounted by `Layout`, and onboarding lives outside
 * `Layout`; reusing it would mean faking a slice's worth of state to get a
 * crop box. This wrapper is image in, URL out, nothing else.
 *
 * Everything happens in the browser. The only network calls are loading the
 * image (through the CORS proxy, so the canvas can export) and uploading the
 * result. Filing it in MySpace is the caller's job — see `ImageEditPanel`.
 *
 * Opened by `ImageEditPanel`, one button per starting tab. Every tab is always
 * available once it is open; the button only picks where it lands.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor';
import { useDispatch, useSelector } from 'react-redux';
import useImage from 'use-image';
import toast from 'react-hot-toast';
import { uploadToS3 } from '@/utils/imageUpload';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';
import { proxied } from '../AdStudio/AdVideoNew/pages/MySpaceLogoEditor';

/**
 * Crop presets for the placements an ad from here actually goes to. Filerobot's
 * own defaults are photo formats (4:3, 21:9); a user cropping an ad wants the
 * shapes Meta will accept.
 */
const AD_CROP_PRESETS = [
  { titleKey: 'square', descriptionKey: '1:1', ratio: 1 },
  { titleKey: 'portrait', descriptionKey: '4:5', ratio: 4 / 5 },
  { titleKey: 'story', descriptionKey: '9:16', ratio: 9 / 16 },
  { titleKey: 'landscape', descriptionKey: '1.91:1', ratio: 1.91 },
];

/**
 * Fonts the Text tool offers. Only ones that draw without a network fetch:
 * Konva paints text onto a canvas, and a web font that has not loaded yet
 * silently falls back — the user would pick "Oswald" and get Times. Public Sans
 * and Quicksand are already loaded by `index.css`; the rest are system fonts.
 */
const TEXT_FONTS = [
  { label: 'Public Sans', value: 'Public Sans' },
  { label: 'Quicksand', value: 'Quicksand' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Trebuchet', value: 'Trebuchet MS' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times', value: 'Times New Roman' },
  { label: 'Impact', value: 'Impact' },
  { label: 'Courier', value: 'Courier New' },
];

/**
 * Starting colours for the drawing tools. Filerobot's default is black at 1px,
 * which vanishes on the dark ads this screen mostly shows — and its colour
 * picker for Pen/Line/Arrow is tucked inside the "stroke" option, so a user
 * who cannot see the line never finds out it can be recoloured.
 */
const DRAW = { stroke: '#15DCFF', strokeWidth: 6 };

/** The onboarding surface's own dark ground, so the editor is not a new product. */
const PALETTE = {
  'bg-primary': '#131317',
  'bg-secondary': '#1B1B21',
  'bg-primary-active': '#232329',
  'accent-primary': '#15DCFF',
  'accent-primary-active': '#0FB8D6',
  'icons-primary': '#ffffff',
  'icons-secondary': 'rgba(255,255,255,0.7)',
  'borders-primary': 'rgba(255,255,255,0.09)',
  'borders-secondary': 'rgba(255,255,255,0.09)',
  'borders-strong': 'rgba(255,255,255,0.16)',
  'light-shadow': 'rgba(0,0,0,0.4)',
  warning: '#FFB74D',
  success: '#5CE08A',
  error: '#FF7A7A',
  'text-primary': '#ffffff',
  'text-secondary': 'rgba(255,255,255,0.7)',
};

/** Which tab (and tool) each panel button lands on. */
export const EDITOR_START = {
  crop: { tab: TABS.ADJUST, tool: TOOLS.CROP },
  adjust: { tab: TABS.FINETUNE, tool: TOOLS.BRIGHTNESS },
  filters: { tab: TABS.FILTERS, tool: TOOLS.FILTERS },
  text: { tab: TABS.ANNOTATE, tool: TOOLS.TEXT },
  resize: { tab: TABS.RESIZE, tool: TOOLS.RESIZE },
};

/**
 * @param src      the image being edited (the one on the stage)
 * @param start    a key of EDITOR_START
 * @param onSaved  called with the uploaded URL; the editor closes itself after
 * @param onClose  dismiss without saving
 */
export default function OnboardingImageEditor({ src, start = 'crop', onSaved, onClose }) {
  const dispatch = useDispatch();
  const userId = useSelector((s) => s.socket?.userData?.user_id);
  const myBrands = useSelector((s) => s.brandIQTabs?.myBrands);
  const [saving, setSaving] = useState(false);

  // An element, not a URL: loaded with `crossOrigin` through the proxy so the
  // canvas is not tainted and Save can export it. Same route the logo editor
  // takes, which is why `proxied` is borrowed from it.
  const [image, status] = useImage(proxied(src), 'Anonymous');

  // The brand's logos, offered in the Watermark tab. The same list the
  // AdCreative editor offers, fetched only if nothing has loaded it yet.
  useEffect(() => {
    if (userId && !(Array.isArray(myBrands) && myBrands.length)) dispatch(fetchBrands(userId));
  }, [dispatch, userId, myBrands]);
  const logos = (Array.isArray(myBrands) ? myBrands : []).flatMap((b) =>
    (b?.logoUrls || []).map((url) => url)
  );

  // Esc is Filerobot's own business while it is open; the body scroll is ours.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleSave = async (edited) => {
    if (saving) return;
    setSaving(true);
    const toastId = toast.loading('Saving your edit…');
    try {
      const blob = await (await fetch(edited.imageBase64)).blob();
      const file = new File([blob], edited.fullName || 'edited-ad.png', {
        type: blob.type || 'image/png',
      });
      // `isUser = true` skips the legacy uploads-collection write that the
      // default makes: the caller files this in MySpace itself, and two rows
      // for one edit would show up as a duplicate.
      const url = await uploadToS3(file, userId, true);
      if (!url) throw new Error('upload returned no url');
      toast.dismiss(toastId);
      onSaved?.(url);
    } catch (err) {
      console.error('[onboarding] image edit save failed:', err);
      toast.error('Couldn’t save your edit. Try again.', { id: toastId });
      setSaving(false);
    }
  };

  const begin = EDITOR_START[start] || EDITOR_START.crop;

  return createPortal(
    <div className="onb-image-editor fixed inset-0 z-[200] flex flex-col" style={{ background: '#0f0f0f' }}>
      {/* Filerobot's annotation options (opacity, colour & width, shadow) are
          bare icons with only a hover `title`. Printing that title beside each
          icon is what makes "change the pen colour" findable. Scoped to this
          wrapper so the AdCreative editor is unaffected. */}
      <style>{`
        .onb-image-editor .FIE_annotation-option-triggerer {
          display: inline-flex; align-items: center; width: auto; gap: 6px;
          padding: 4px 8px; border-radius: 6px;
        }
        .onb-image-editor .FIE_annotation-option-triggerer::after {
          content: attr(title); font-size: 12px; white-space: nowrap;
          color: rgba(255,255,255,0.75);
        }
      `}</style>
      {status === 'loaded' && image ? (
        <FilerobotImageEditor
          source={image}
          onSave={handleSave}
          // `false` skips Filerobot's "name and format" dialog and saves
          // straight away — the name is never seen, and PNG is the only format
          // an ad with a logo on it should be flattened to.
          onBeforeSave={() => false}
          onClose={() => !saving && onClose?.()}
          closeAfterSave={false}
          disableSaveIfNoChanges
          defaultSavedImageType="png"
          defaultSavedImageName="edited-ad"
          tabsIds={[
            TABS.ADJUST,
            TABS.FINETUNE,
            TABS.FILTERS,
            TABS.ANNOTATE,
            TABS.WATERMARK,
            TABS.RESIZE,
          ]}
          defaultTabId={begin.tab}
          defaultToolId={begin.tool}
          Crop={{ presetsItems: AD_CROP_PRESETS, autoResize: true }}
          Rotate={{ angle: 90, componentType: 'slider' }}
          Text={{
            text: 'Your text',
            fontFamily: 'Public Sans',
            fonts: TEXT_FONTS,
            fontSize: 48,
            fill: '#ffffff',
          }}
          annotationsCommon={{ fill: '#ffffff' }}
          Pen={{ ...DRAW, lineCap: 'round' }}
          Line={{ ...DRAW, lineCap: 'round' }}
          Arrow={{ ...DRAW, fill: DRAW.stroke, lineCap: 'round' }}
          Rect={{ fill: '#15DCFF' }}
          Ellipse={{ fill: '#15DCFF' }}
          Polygon={{ fill: '#15DCFF' }}
          Watermark={{
            gallery: logos,
            imageScalingRatio: 0.25,
            textScalingRatio: 0.33,
            onUploadWatermarkImgClick: (loadAndSetWatermarkImg) => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/png, image/jpeg, image/webp';
              input.onchange = (e) => {
                const f = e.target.files?.[0];
                if (f) loadAndSetWatermarkImg(URL.createObjectURL(f), true);
              };
              input.click();
            },
          }}
          translations={{
            // The option triggerers' labels (shown by the CSS below). "Stroke"
            // is where Pen/Line/Arrow keep their COLOUR, so it says so.
            stroke: 'Colour & width',
            opacity: 'Opacity',
            shadow: 'Shadow',
            position: 'Position',
            square: 'Square',
            portrait: 'Portrait',
            story: 'Story',
            landscape: 'Landscape',
          }}
          theme={{ palette: PALETTE, typography: { fontFamily: 'Public Sans, Arial, sans-serif' } }}
        />
      ) : status === 'failed' ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <p className="text-[13.5px] font-semibold text-white/90">Couldn&rsquo;t open this image</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-lg border px-3 py-1.5 text-[12px] font-semibold text-white/70 hover:text-white"
              style={{ background: '#232329', borderColor: 'rgba(255,255,255,0.16)' }}
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center text-[12.5px] text-white/60">Opening editor…</div>
      )}
    </div>,
    document.body
  );
}
