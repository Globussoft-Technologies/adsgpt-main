import { useState } from 'react';
import { Check, Copy, Download, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import toMediaUrl from '@/utils/mediaUrl';
import { handleDownload } from '@/utils/download';
import ImageLightbox from './ImageLightbox';

// Color accent per angle. Falls back to a neutral chip for unknown angles.
const ANGLE_ACCENT = {
  emotional: { dot: 'bg-white/70', text: 'text-white/70' },
  direct_value: { dot: 'bg-white/70', text: 'text-white/70' },
  playful: { dot: 'bg-white/70', text: 'text-white/70' },
  urgency: { dot: 'bg-white/70', text: 'text-white/70' },
  authority: { dot: 'bg-white/70', text: 'text-white/70' },
};
const DEFAULT_ACCENT = { dot: 'bg-white/40', text: 'text-white/70' };

const CopyButton = ({ text, label = 'copy' }) => {
  const [copied, setCopied] = useState(false);
  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        toast.success(`${label} copied`);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => toast.error('Copy failed'));
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Copy ${label}`}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/85"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
};

const VariantCard = ({ variant, index, onOpenImage }) => {
  const accent = ANGLE_ACCENT[(variant.angle || '').toLowerCase()] || DEFAULT_ACCENT;
  const headline = (variant.headline || '').trim();
  const body = (variant.body || '').trim();
  const cta = (variant.cta || '').trim();
  const hashtags = Array.isArray(variant.hashtags) ? variant.hashtags : [];
  const fullCopyText = [
    headline,
    body,
    cta ? `CTA: ${cta}` : '',
    hashtags.length ? hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ') : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return (
    <article className="group flex w-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0F0F0F] transition-colors duration-200 hover:border-white/15 hover:bg-[#141414]">
      {/* Header: angle label + variant index */}
      <div className="flex items-center justify-between px-3 pt-3">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${accent.dot}`} />
          <span className={`text-[11px] font-medium tracking-wide uppercase ${accent.text}`}>
            {variant.angle_label || variant.angle || `Variant ${index + 1}`}
          </span>
        </div>
        <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/45">
          {String.fromCharCode(65 + index)}
        </span>
      </div>

      {/* Image */}
      {variant.image_url && (
        <button
          type="button"
          onClick={() => onOpenImage?.(variant.image_url)}
          className="mt-3 block w-full bg-black"
          title="View full-size"
        >
          <img
            src={toMediaUrl(variant.image_url)}
            alt={headline || `Ad variant ${index + 1}`}
            loading="lazy"
            className="block w-full select-none"
          />
        </button>
      )}

      {/* Copy */}
      <div className="flex flex-1 flex-col gap-2 px-3 pt-3 pb-2">
        {headline && (
          <p className="text-[15px] leading-snug font-semibold text-white">{headline}</p>
        )}
        {body && <p className="text-[12.5px] leading-relaxed text-white/70">{body}</p>}
        {(cta || hashtags.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {cta && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[10.5px] font-medium tracking-wide text-white/85">
                <Sparkles className="h-3 w-3" />
                {cta}
              </span>
            )}
            {hashtags.slice(0, 4).map((t) => {
              const tag = t.startsWith('#') ? t : `#${t}`;
              return (
                <span
                  key={tag}
                  className="text-[10.5px] tracking-wide text-white/45"
                >
                  {tag}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] px-3 py-2">
        <div className="flex items-center gap-1">
          <CopyButton text={headline} label="headline" />
          <CopyButton text={fullCopyText} label="all copy" />
        </div>
        {variant.image_url && (
          <button
            type="button"
            onClick={() => handleDownload(toMediaUrl(variant.image_url))}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/85"
            title="Download image"
          >
            <Download className="h-3 w-3" />
            <span>image</span>
          </button>
        )}
      </div>
    </article>
  );
};

const AdCreativePackage = ({ pack }) => {
  const [lightboxSrc, setLightboxSrc] = useState(null);
  if (!pack || !Array.isArray(pack.variants) || pack.variants.length === 0) return null;
  return (
    <div className="mt-4 w-full">
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pack.variants.map((v, i) => (
          <VariantCard
            key={`${v.angle || 'v'}-${i}`}
            variant={v}
            index={i}
            onOpenImage={setLightboxSrc}
          />
        ))}
      </div>
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
};

export default AdCreativePackage;
