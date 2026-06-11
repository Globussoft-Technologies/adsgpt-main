import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Instagram } from 'lucide-react';
import { FaFacebookF, FaYoutube } from 'react-icons/fa';
import { SiGoogle } from 'react-icons/si';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import RecreateAdModal from '@/components/AdLibrary/RecreateAdModal';

const platformIcons = {
  facebook: <FaFacebookF className="h-4 w-4" />,
  instagram: <Instagram className="h-4 w-4" />,
  google: <SiGoogle className="h-4 w-4" />,
  youtube: <FaYoutube className="h-4 w-4" />,
};

const platformLabels = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google',
  youtube: 'YouTube',
};



const CompetitorAdCard = ({ ad, onClick }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [isRecreateModalOpen, setIsRecreateModalOpen] = useState(false);

  const MAX_CHARS = 100;

  const platform = ad.platform?.toLowerCase() || 'facebook';
  const platformIcon = platformIcons[platform];
  const platformLabel = platformLabels[platform] || platform;


  const imageUrl = ad.thumbnailUrl || ad.creativeUrl || '';
  const advertiserName = ad.advertiserName || 'Unknown';
  const dateRange = ad.lastSeen
    ? formatDate(ad.lastSeen)
    : ad.firstSeen
      ? formatDate(ad.firstSeen)
      : '';

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="group relative box-border w-full cursor-pointer overflow-hidden rounded-xl border-none bg-[#1a1a1a] shadow-lg transition-all duration-300 ease-out hover:scale-[1.015] hover:shadow-xl"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onClick}
      >
      {/* ── Header bar (hover pe dikhata hai, AdCreative style) ── */}
      <div className="absolute top-0 left-0 z-20 flex h-10 w-full items-center justify-between rounded-none px-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:bg-[#0F0F0F]/80">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          {/* Avatar placeholder */}
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs font-bold text-white uppercase">
            {advertiserName?.slice(0, 2)}
          </div>
          <span className="w-full max-w-[120px] truncate text-xs 2xl:max-w-[150px]">
            {advertiserName}
          </span>
        </div>
        <div className="right_header flex items-center gap-2">
          {/* Platform icon — AdLibrary style tooltip */}
          <ShadcnTooltip label={platformLabel}>
            <button className="flex cursor-pointer items-center justify-center rounded-full text-center text-white/70 transition-all duration-200 hover:scale-110 hover:opacity-80">
              {platformIcon}
            </button>
          </ShadcnTooltip>
        </div>
      </div>

      {/* ── Image / Video ── */}
      <div className="relative w-full overflow-hidden">
        {/* Loading spinner */}
        {imageUrl && !imageLoaded && !imageError && (
          <div className="absolute inset-0 z-10 flex min-h-[250px] items-center justify-center bg-gradient-to-r from-gray-600 via-gray-700 to-gray-600">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        )}

        {/* No image / Error placeholder */}
        {(!imageUrl || imageError) && (
          <div className="flex min-h-[250px] items-center justify-center bg-gradient-to-r from-gray-600 via-gray-700 to-gray-600 text-white/40">
            <div className="text-center">
              <div className="mb-2 text-2xl">🖼️</div>
              <p className="text-xs">{imageUrl ? 'Failed to load' : 'No creative'}</p>
            </div>
          </div>
        )}

        {/* Video Ad */}
        {ad.adType === 'VIDEO' && ad.videoUrl ? (
          <>
            <video
              src={ad.videoUrl}
              poster={imageUrl}
              className={`h-auto w-full object-cover transition-transform duration-500 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              } ${isHovered ? 'scale-105' : 'scale-100'}`}
              style={{ minHeight: '250px' }}
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedData={() => setImageLoaded(true)}
              onError={() => {
                setImageError(true);
                setImageLoaded(true);
              }}
            />
            {/* Play Icon Overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                <svg className="ml-0.5 h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </>
        ) : (
          /* Image Ad */
          imageUrl &&
          !imageError && (
            <img
              src={imageUrl}
              alt={ad.adTitle || 'Ad creative'}
              className={`h-auto w-full rounded-t-xl object-cover transition-transform duration-500 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              } ${isHovered ? 'scale-105' : 'scale-100'}`}
              style={{ minHeight: '250px' }}
              loading="lazy"
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                setImageError(true);
                setImageLoaded(true);
              }}
            />
          )
        )}

        {/* ── Bottom gradient overlay with ad description (hover pe dikhata hai) ── */}
        <div
          className={`absolute right-0 bottom-0 left-0 max-h-[45%] bg-gradient-to-b from-black/0 via-black/60 to-black/95 p-3 pt-8 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${isHovered ? 'opacity-100' : ''} ${textExpanded ? 'overflow-y-auto scrollbar-thin' : 'overflow-hidden'}`}
        >
          {/* Ad text — truncated with Read more, scrolls inside the same 45% height */}
          <p
            className={`text-xs font-semibold break-words text-white ${!textExpanded ? 'line-clamp-3' : ''}`}
          >
            {ad.adTitle || ad.adDescription || advertiserName}
          </p>
          {(ad.adTitle || ad.adDescription || '').length > MAX_CHARS && (
            <button
              type="button"
              className="mt-0.5 cursor-pointer text-[10px] font-medium text-[#5867EB] hover:text-[#02C8C4] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setTextExpanded(!textExpanded);
              }}
            >
              {textExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
          <p className="mt-0.5 text-[11px] break-words text-white/70">
            {platformLabel}
            {dateRange && ` · ${dateRange}`}
          </p>
        </div>

        {/* Gradient bridge to blend image into the action bar — matches AdLibrary */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 z-5 h-8 w-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: 'linear-gradient(to bottom, transparent 0%, #2A2A2A 100%)',
          }}
        />
      </div>

      {/* Bottom hover-revealed action bar — exact AdLibrary pattern */}
      <div className="pointer-events-none max-h-0 overflow-hidden opacity-0 transition-[max-height,opacity] duration-300 ease-out group-hover:pointer-events-auto group-hover:max-h-14 group-hover:opacity-100">
        <div
          className="flex h-14 w-full items-center px-3"
          style={{ backgroundColor: '#2A2A2A' }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsRecreateModalOpen(true);
            }}
            className="w-full rounded-full bg-white px-4 py-2 text-sm font-bold tracking-tight text-black shadow-md transition-colors duration-150 hover:bg-[#F2F2F2] active:bg-[#E5E5E5] 2xl:py-2.5 2xl:text-15"
          >
            Recreate
          </button>
        </div>
      </div>
      </motion.div>
      {/* Recreate Ad Modal — rendered outside motion.div so clicks inside it don't bubble to card onClick */}
      <RecreateAdModal
        open={isRecreateModalOpen}
        onOpenChange={setIsRecreateModalOpen}
        image={imageUrl}
        ad={ad}
      />
    </>
  );
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default CompetitorAdCard;
