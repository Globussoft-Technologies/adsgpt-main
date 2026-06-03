import { useMemo, useState } from 'react';
import { BadgeCheck, ExternalLink } from 'lucide-react';
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaPinterest,
  FaReddit,
  FaYoutube,
} from 'react-icons/fa';
import { SiGoogleads } from 'react-icons/si';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';

const NETWORK_META = {
  facebook: { Icon: FaFacebook, color: 'text-[#1877F2]', label: 'Facebook' },
  instagram: { Icon: FaInstagram, color: 'text-[#E4405F]', label: 'Instagram' },
  youtube: { Icon: FaYoutube, color: 'text-[#FF0000]', label: 'YouTube' },
  pinterest: { Icon: FaPinterest, color: 'text-[#E60023]', label: 'Pinterest' },
  linkedin: { Icon: FaLinkedin, color: 'text-[#0A66C2]', label: 'LinkedIn' },
  reddit: { Icon: FaReddit, color: 'text-[#FF4500]', label: 'Reddit' },
  google_display_ads: { Icon: SiGoogleads, color: 'text-[#4285F4]', label: 'Google' },
  google: { Icon: SiGoogleads, color: 'text-[#4285F4]', label: 'Google' },
  meta: { Icon: FaFacebook, color: 'text-[#1877F2]', label: 'Meta' },
};

// Deterministic-but-pleasant background for the initials-avatar fallback.
const AVATAR_PALETTE = [
  'bg-[#7C3AED]', 'bg-[#0EA5E9]', 'bg-[#F59E0B]', 'bg-[#EF4444]',
  'bg-[#10B981]', 'bg-[#EC4899]', 'bg-[#6366F1]', 'bg-[#14B8A6]',
];
const colorForBrand = (s = '') => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
};
const initialsOf = (s = '?') =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';

// Render a short relative-ish label for `last_seen` / `first_seen`. Falls back
// to the raw string if parsing fails so the user still sees SOMETHING.
const formatLastSeen = (raw) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 24);
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

const truncate = (s = '', n) => (s.length > n ? `${s.slice(0, n).trim()}…` : s);

// Build the ordered list of image URLs to try (videos use `video_url` directly
// and these are just for the poster / image-only ads).
const imageCandidatesFor = (ad) => {
  const list = [];
  if (Array.isArray(ad.image_candidates)) list.push(...ad.image_candidates);
  if (ad.thumbnail_url) list.push(ad.thumbnail_url);
  if (ad.image_url) list.push(ad.image_url);
  const seen = new Set();
  return list.filter((u) => u && !seen.has(u) && seen.add(u));
};

const BrandAvatar = ({ brand, logoUrl }) => {
  const [failed, setFailed] = useState(!logoUrl);
  if (failed) {
    return (
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white ${colorForBrand(
          brand,
        )}`}
      >
        {initialsOf(brand)}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      onError={() => setFailed(true)}
      className="h-9 w-9 flex-shrink-0 rounded-full border border-white/10 object-cover"
    />
  );
};

const AdCard = ({ ad, onLoadFail }) => {
  const imageCandidates = useMemo(() => imageCandidatesFor(ad), [ad]);
  const [imgIdx, setImgIdx] = useState(0);
  const [imgExhausted, setImgExhausted] = useState(imageCandidates.length === 0);

  const meta = NETWORK_META[(ad.platform || '').toLowerCase()] || NETWORK_META.meta;
  const NetworkIcon = meta.Icon;
  const brand = ad.brand || 'Unknown brand';
  const headline = ad.headline || '';
  const snippet = ad.snippet || '';
  const lastSeen = formatLastSeen(ad.last_seen);
  const isVideo = (ad.ad_type || '').toUpperCase() === 'VIDEO' && !!ad.video_url;
  const adUrl = ad.ad_url || '';

  const handleImgError = () => {
    if (imgIdx + 1 < imageCandidates.length) {
      setImgIdx(imgIdx + 1);
    } else {
      setImgExhausted(true);
      onLoadFail?.(ad);
    }
  };

  // If we can't show media AND there's no text, skip the card entirely.
  if (imgExhausted && !isVideo && !snippet && !headline) return null;

  return (
    <article className="group mb-3 block w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0F0F0F] transition-colors duration-200 hover:border-white/15 hover:bg-[#141414]">
      {/* ── Header: logo, brand, platform, optional external-link icon ───────── */}
      <a
        href={adUrl || undefined}
        target={adUrl ? '_blank' : undefined}
        rel="noreferrer"
        className="flex items-center gap-2.5 px-3 pt-3"
      >
        <BrandAvatar brand={brand} logoUrl={ad.owner_image} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-[13.5px] font-medium text-white">
            <span className="truncate">{truncate(brand, 40)}</span>
            {ad.verified && (
              <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0 text-[#15DCFF]" />
            )}
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-white/45">
            <NetworkIcon className={`h-3 w-3 ${meta.color}`} />
            <span>{meta.label}</span>
            {lastSeen && <span className="text-white/30">·</span>}
            {lastSeen && <span>{lastSeen}</span>}
          </p>
        </div>
        {adUrl && (
          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-white/30 transition-colors duration-150 group-hover:text-white/70" />
        )}
      </a>

      {/* ── Media: <video> for video ads, clickable <img> for image ads ─────── */}
      {isVideo ? (
        <div className="mt-3 bg-black">
          <video
            src={ad.video_url}
            poster={ad.image_url || imageCandidates[0]}
            controls
            playsInline
            preload="metadata"
            className="block w-full select-none"
          />
        </div>
      ) : (
        !imgExhausted && (
          <a
            href={adUrl || imageCandidates[imgIdx]}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block bg-black"
          >
            <img
              src={imageCandidates[imgIdx]}
              alt={headline || brand}
              loading="lazy"
              onError={handleImgError}
              className="block w-full select-none"
            />
          </a>
        )
      )}

      {/* ── Body: headline + description ─────────────────────────────────── */}
      {(headline || snippet) && (
        <div className="px-3 pt-3">
          {headline && (
            <p className="line-clamp-2 text-[13.5px] leading-snug font-medium text-white">
              {headline}
            </p>
          )}
          {snippet && snippet !== headline && (
            <p
              className={`line-clamp-3 text-[12.5px] leading-relaxed text-white/65 ${
                headline ? 'mt-1.5' : ''
              }`}
            >
              {snippet}
            </p>
          )}
        </div>
      )}

      {/* ── Footer: CTA badge + explicit "View ad" link ──────────────────── */}
      {(ad.call_to_action || adUrl) && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2">
          {ad.call_to_action ? (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-white/70 capitalize">
              {ad.call_to_action}
            </span>
          ) : (
            <span />
          )}
          {adUrl && (
            <a
              href={adUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11.5px] font-medium text-white/55 transition-colors duration-150 hover:text-white"
            >
              View ad
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </article>
  );
};

const CompetitorAdsGrid = ({ ads = [] }) => {
  const [hidden, setHidden] = useState(() => new Set());

  if (!ads || ads.length === 0) return null;

  const keyFor = (ad) => ad.ad_url || ad.image_url || JSON.stringify(ad);
  const handleFail = (ad) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(keyFor(ad));
      return next;
    });
  };

  const visible = ads.filter((ad) => !hidden.has(keyFor(ad)));
  if (visible.length === 0) return null;

  return (
    <div className="mt-4 w-full">
      <ResponsiveMasonry
        columnsCountBreakPoints={{ 0: 1, 640: 2, 1024: 2, 1280: 3 }}
        gutterBreakPoints={{ 0: '10px', 1280: '12px' }}
      >
        <Masonry>
          {visible.map((ad, i) => (
            <AdCard key={`${keyFor(ad)}-${i}`} ad={ad} onLoadFail={handleFail} />
          ))}
        </Masonry>
      </ResponsiveMasonry>
    </div>
  );
};

export default CompetitorAdsGrid;
