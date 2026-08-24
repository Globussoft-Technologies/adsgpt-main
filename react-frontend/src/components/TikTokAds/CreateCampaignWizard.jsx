import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  Rocket,
  AlertCircle,
  BookmarkPlus,
  Bookmark,
  Trash2,
  Megaphone,
  Target,
  Layers,
  Users,
  Image as ImageIcon,
  CheckCircle2,
  Search,
  Globe,
  Tag,
  Languages as LanguagesIcon,
  ChevronDown,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Music,
  Heart,
  MessageCircle,
  Share2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getTiktokWizardSchema,
  getTiktokRegions,
  getTiktokIdentities,
  getTiktokInterestCategories,
  getTiktokPixels,
  createTiktokPixel,
  getTiktokLeadForms,
  createTiktokCampaign,
  createTiktokAdGroup,
  createTiktokAd,
  updateTiktokCampaign,
  updateTiktokAdGroup,
  updateTiktokAd,
  uploadTiktokVideo,
  getTiktokVideoInfo,
  uploadTiktokImage,
  getTiktokMusic,
  uploadTiktokMusic,
  listTiktokCampaignTemplates,
  getTiktokCampaignTemplate,
  saveTiktokCampaignTemplate,
  deleteTiktokCampaignTemplate,
} from '@/apis/tikTokAds/tikTokAdsApi';
import {
  FieldShell,
  TextField,
  NumberField,
  SelectField,
  MultiSelectField,
  SegButton,
  SegGroup,
  ToggleField,
  CurrencyField,
} from './wizardFields';
import LibraryPicker from './LibraryPicker';
import { getClipboardImageFiles } from '@/utils/clipboardImages';

const currencySymbol = (curr = 'USD') => {
  switch (curr?.toUpperCase()) {
    case 'INR':
      return '₹';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'JPY':
      return '¥';
    case 'USD':
    default:
      return '$';
  }
};

// TikTok requires in-feed video ads to be at least 5 seconds, up to a
// 10-minute maximum for standard (non-Spark) ads.
const MIN_VIDEO_DURATION_SECONDS = 5;
const MAX_VIDEO_DURATION_SECONDS = 600;

// TikTok's minimum resolution is orientation-aware (confirmed via the live
// Ads Manager check + official video specs):
//   • Horizontal 16:9 → 960×540
//   • Vertical   9:16 → 540×960
//   • Square     1:1  → 640×640
// A flat "width≥960 AND height≥540" would wrongly reject a valid 540×960
// vertical video, so check the longer/shorter sides instead: longer ≥ 960 and
// shorter ≥ 540 covers both 16:9 and 9:16; square needs its own 640×640 floor.
const MIN_VIDEO_LONG_SIDE = 960;
const MIN_VIDEO_SHORT_SIDE = 540;
const MIN_VIDEO_SQUARE_SIDE = 640;
const SQUARE_RATIO_TOLERANCE = 0.02;
const meetsMinResolution = (width, height) => {
  if (width == null || height == null) return true; // can't read → don't block
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  // Square (1:1) has its own floor.
  if (Math.abs(width / height - 1) <= SQUARE_RATIO_TOLERANCE) {
    return width >= MIN_VIDEO_SQUARE_SIDE && height >= MIN_VIDEO_SQUARE_SIDE;
  }
  return longSide >= MIN_VIDEO_LONG_SIDE && shortSide >= MIN_VIDEO_SHORT_SIDE;
};

// TikTok requires a minimum average bitrate of 350 Kbps. The browser has no
// API that reports a file's real (video-track-only) bitrate without parsing
// the container, so we approximate: total file size / duration. This mixes
// in audio + container overhead, which can make a genuinely low-bitrate
// video read as passing — so this is a soft warning only, never a hard
// block. TikTok's own upload API is the real gatekeeper for this rule.
const MIN_VIDEO_BITRATE_KBPS = 350;
const estimateBitrateKbps = (fileSizeBytes, durationSeconds) =>
  durationSeconds > 0 ? (fileSizeBytes * 8) / durationSeconds / 1000 : null;

// TikTok requires in-feed video ads to be one of these three aspect ratios
// (16:9 landscape, 1:1 square, 9:16 vertical) — confirmed via the live
// Ads Manager "technical issues" upload check (applies platform-wide, not
// just to a specific placement).
const SUPPORTED_VIDEO_RATIOS = [16 / 9, 1, 9 / 16];
const ASPECT_RATIO_TOLERANCE = 0.02;
const isSupportedAspectRatio = (width, height) => {
  const ratio = width / height;
  return SUPPORTED_VIDEO_RATIOS.some((r) => Math.abs(ratio - r) <= ASPECT_RATIO_TOLERANCE);
};

// TikTok rejects images larger than 2340px on the longer side or 1242px on
// the shorter side (confirmed via the live Ads Manager upload error).
const MAX_IMAGE_LONG_SIDE = 2340;
const MAX_IMAGE_SHORT_SIDE = 1242;

// Images are far more permissive than video: the live Ads Manager accepts a
// wide range of aspect ratios (it crops to fit the feed) and many everyday
// photo/thumbnail sizes — so we do NOT apply the video's strict 16:9/1:1/9:16
// ratio rule or its orientation-specific floor to images. The only real image
// floors are the max above and a small minimum on the shorter side to catch a
// genuinely tiny asset (e.g. a 150px logo) that TikTok would reject as
// "Unsupported image size". 500px matches TikTok's lowest documented image
// minimum (catalog/collection cards) and clears normal creatives easily.
const MIN_IMAGE_SHORT_SIDE = 500;

// Standard Carousel Ads take 2-35 images (confirmed via TikTok's official
// "Specifications for Carousel Ads" help article). This is a distinct format
// from CATALOG_CAROUSEL (2-20, feed-driven), which is not implemented here.
const MIN_CAROUSEL_IMAGES = 2;
const MAX_CAROUSEL_IMAGES = 35;

// Music/audio rules for the tracks attached to Carousel / Reach image ads,
// confirmed verbatim from TikTok's official "Specifications for Carousel Ads"
// help article: duration ≥ 2s, up to 10 MB, and only these container types.
const MIN_MUSIC_DURATION_SECONDS = 2;
const MAX_MUSIC_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_MUSIC_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac'];

// Reads an audio file's duration client-side via a throwaway <audio> element,
// without uploading it. Resolves null if the browser can't read metadata (in
// which case we don't block — TikTok's upload stays the source of truth).
function readAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

// Reads a video file's duration + pixel dimensions client-side via a
// throwaway <video> element, without uploading it. Resolves null fields if
// the browser can't read metadata.
function readVideoMetadata(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: null, width: null, height: null });
    };
    video.src = url;
  });
}

// Reads an image file's pixel dimensions client-side via a throwaway Image.
function readImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function MediaPreview({ file, url, type, onRemove }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    if (file) {
      objectUrl = URL.createObjectURL(file);
      setSrc(objectUrl);
    } else if (url) {
      setSrc(url);
    } else {
      setSrc(null);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, url]);

  if (!src) return null;

  return (
    <div className="relative mt-3 inline-block max-w-full overflow-hidden rounded-lg border border-gray-200 bg-black/5 p-1 dark:border-white/10 dark:bg-white/5">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 z-10 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-black dark:bg-white/20 dark:hover:bg-white/30"
      >
        Remove
      </button>
      {type === 'video' ? (
        <video src={src} controls className="max-h-52 w-auto rounded-md" preload="metadata" />
      ) : (
        <img src={src} alt="Media preview" className="max-h-52 w-auto rounded-md object-contain" />
      )}
      {file && (
        <p className="mt-1 truncate text-[11px] text-gray-500 dark:text-white/50" title={file.name}>
          {file.name}
        </p>
      )}
    </div>
  );
}

// Searchable multi-select with instant live filtering, selected badges,
// quick presets, and clear all. Delivers a modern Ads Manager experience.
function SearchableMultiSelectField({
  label,
  hint,
  placeholder = 'Search...',
  required,
  error,
  values = [],
  onChange,
  options = [],
  disabled = false,
  className = '',
  icon: Icon = null,
  emptyHint = 'No selection targets all',
  presets = null,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const set = useMemo(() => new Set(values || []), [values]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase().trim();
    return options.filter((opt) => {
      const lbl = typeof opt === 'string' ? opt : opt.label;
      return lbl.toLowerCase().includes(q);
    });
  }, [options, query]);

  const toggle = (v) => {
    if (disabled) return;
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };

  const removeValue = (v, e) => {
    e?.stopPropagation();
    if (disabled) return;
    const next = new Set(set);
    next.delete(v);
    onChange(Array.from(next));
  };

  const clearAll = (e) => {
    e?.stopPropagation();
    if (disabled) return;
    onChange([]);
  };

  const selectedOptions = useMemo(() => {
    return (values || []).map((v) => {
      const found = options.find((opt) => (typeof opt === 'string' ? opt : opt.value) === v);
      return {
        value: v,
        label: found ? (typeof found === 'string' ? found : found.label) : v,
      };
    });
  }, [values, options]);

  return (
    <FieldShell
      label={
        <div className="flex w-full items-center justify-between">
          <span>{label}</span>
          {values?.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] font-semibold text-gray-400 transition hover:text-red-400 dark:text-white/40 dark:hover:text-red-400"
            >
              Clear all ({values.length})
            </button>
          )}
        </div>
      }
      hint={hint || (values.length === 0 ? emptyHint : undefined)}
      error={error}
      required={required}
      className={className}
    >
      <div ref={containerRef} className="relative w-full">
        {/* Trigger Search Bar & Selected Chips */}
        <div
          onClick={() => {
            if (!disabled) {
              setIsOpen(true);
              inputRef.current?.focus();
            }
          }}
          className={`min-h-[46px] w-full rounded-2xl border bg-gray-100 p-2 text-sm transition-all dark:bg-[#909294]/15 ${
            isOpen
              ? 'border-gray-400 ring-2 ring-[#02C8C4]/20 dark:border-white/25 dark:ring-[#02C8C4]/20'
              : 'border-gray-300 hover:border-gray-400 dark:border-white/5 dark:hover:border-white/15'
          } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {Icon && (
              <div className="flex pl-1 pr-0.5 text-gray-400 dark:text-white/40">
                <Icon className="h-4 w-4" />
              </div>
            )}

            {/* Selected Chips */}
            {selectedOptions.map((opt) => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#02C8C4]/15 to-[#5867EB]/15 border border-[#15DCFF]/30 px-2.5 py-0.5 text-xs font-semibold text-gray-900 dark:text-white shadow-xs"
              >
                <span>{opt.label}</span>
                <button
                  type="button"
                  onClick={(e) => removeValue(opt.value, e)}
                  className="rounded-full p-0.5 text-gray-400 hover:bg-black/10 hover:text-gray-900 dark:text-white/60 dark:hover:bg-white/20 dark:hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

            {/* Inline search input */}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              placeholder={values.length === 0 ? placeholder : 'Add more...'}
              disabled={disabled}
              className="min-w-[120px] flex-1 bg-transparent px-1.5 py-1 text-xs text-gray-900 placeholder:text-xs placeholder:text-gray-400 outline-none dark:text-white dark:placeholder:text-[#AFAFAF]"
            />

            {/* Dropdown indicator */}
            <div className="ml-auto flex items-center gap-1 pr-1 text-gray-400 dark:text-white/40">
              {query && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuery('');
                  }}
                  className="p-1 hover:text-gray-700 dark:hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#02C8C4]' : ''}`}
              />
            </div>
          </div>
        </div>

        {/* Dropdown Panel */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 mt-1.5 w-full rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#181818]/95 max-h-72 overflow-hidden flex flex-col"
            >
              {/* Presets Row if any */}
              {presets && presets.length > 0 && (
                <div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-b border-gray-200 pb-2.5 dark:border-white/10">
                  <span className="text-[11px] font-semibold text-gray-400 dark:text-white/40 mr-1">Presets:</span>
                  {presets.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        onChange(p.values);
                      }}
                      className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-700 transition hover:border-[#15DCFF] hover:bg-[#15DCFF]/10 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:border-[#15DCFF] dark:hover:bg-[#15DCFF]/10"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Header inside dropdown */}
              <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-gray-400 dark:text-white/50">
                <span>
                  {filteredOptions.length} {filteredOptions.length === 1 ? 'option' : 'options'}
                  {query ? ` matching "${query}"` : ''}
                </span>
                <span>{values.length} selected</span>
              </div>

              {/* Options list */}
              <div className="scrollbar-thin flex-1 overflow-y-auto pr-1">
                {filteredOptions.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {filteredOptions.map((opt) => {
                      const v = typeof opt === 'string' ? opt : opt.value;
                      const lbl = typeof opt === 'string' ? opt : opt.label;
                      const active = set.has(v);

                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => toggle(v)}
                          className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-all ${
                            active
                              ? 'bg-gradient-to-r from-[#02C8C4]/15 to-[#5867EB]/15 font-semibold text-gray-900 dark:text-white border border-[#15DCFF]/40'
                              : 'text-gray-700 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/5 border border-transparent'
                          }`}
                        >
                          <span className="truncate pr-2">{lbl}</span>
                          <div
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border transition-all ${
                              active
                                ? 'border-[#02C8C4] bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                                : 'border-gray-300 dark:border-white/20 bg-transparent'
                            }`}
                          >
                            {active && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-gray-400 dark:text-white/40">
                    <p>No results found for &ldquo;{query}&rdquo;</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </FieldShell>
  );
}

const STEPS = ['Objective', 'Campaign', 'Ad Group', 'Ad', 'Review'];

// Country-level location IDs (TikTok uses GeoNames IDs). Used as a fallback so
// the location picker is never empty when /tool/region/ fails to load — TikTok
// REQUIRES at least one location_id on every ad group.
const FALLBACK_REGIONS = [
  { id: '6252001', name: 'United States' },
  { id: '2635167', name: 'United Kingdom' },
  { id: '6251999', name: 'Canada' },
  { id: '2077456', name: 'Australia' },
  { id: '2921044', name: 'Germany' },
  { id: '3017382', name: 'France' },
  { id: '2802361', name: 'Belgium' },
  { id: '2750405', name: 'Netherlands' },
  { id: '3175395', name: 'Italy' },
  { id: '2510769', name: 'Spain' },
  { id: '1880251', name: 'Singapore' },
  { id: '1269750', name: 'India' },
  { id: '1643084', name: 'Indonesia' },
  { id: '1861060', name: 'Japan' },
  { id: '3469034', name: 'Brazil' },
];

const AGE_GROUPS = [
  { value: 'AGE_18_24', label: '18–24' },
  { value: 'AGE_25_34', label: '25–34' },
  { value: 'AGE_35_44', label: '35–44' },
  { value: 'AGE_45_54', label: '45–54' },
  { value: 'AGE_55_100', label: '55+' },
];

const GENDERS = [
  { value: 'GENDER_UNLIMITED', label: 'All' },
  { value: 'GENDER_MALE', label: 'Male' },
  { value: 'GENDER_FEMALE', label: 'Female' },
];

const BID_TYPES = [
  { value: 'BID_TYPE_NO_BID', label: 'No bid (lowest cost)' },
  { value: 'BID_TYPE_CUSTOM', label: 'Custom bid' },
];

// TikTok language targeting — ISO 639-1 codes accepted by the ad group API.
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'tr', label: 'Turkish' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'sv', label: 'Swedish' },
];

const BUDGET_MODES = [
  { value: 'BUDGET_MODE_DAY', label: 'Daily budget' },
  { value: 'BUDGET_MODE_TOTAL', label: 'Lifetime budget' },
  { value: 'BUDGET_MODE_INFINITE', label: 'No limit' },
];

// The two budget modes a user actually picks in the UI. "No limit"
// (BUDGET_MODE_INFINITE) is not a dropdown choice — it's the implicit result
// of not setting a campaign budget at all (see hasCampaignBudget).
const BUDGET_MODE_CHOICES = BUDGET_MODES.filter((m) => m.value !== 'BUDGET_MODE_INFINITE');

// A campaign has a budget when CBO is on (CBO always requires one) OR when the
// optional "Set campaign budget" toggle is on. When neither is true, no budget
// is set at the campaign level (BUDGET_MODE_INFINITE) and budget is defined per
// ad group instead.
// Awareness/consideration objectives (Reach, Video Views, Community
// Interaction) expose the full CBO model: a "Campaign budget optimization"
// toggle plus an optional "Set campaign budget" toggle. The other objectives
// (Traffic, Lead Gen, App Promotion, Sales) show neither toggle — they always
// carry a plain campaign budget (confirmed in-product).
// A campaign carries a budget when CBO (Campaign Budget Optimization) is enabled.
const hasCampaignBudget = (form) => Boolean(form.budgetOptimizeOn);

// The budget mode that actually governs an ad group's schedule: the campaign's
// mode when the campaign carries the budget, else the ad group's own mode.
const effectiveAdgroupBudgetMode = (form) =>
  hasCampaignBudget(form) ? form.budgetMode : form.adgroupBudgetMode;

// A lifetime budget locks the schedule to a fixed start+end — the API rejects
// SCHEDULE_FROM_NOW (run continuously) for total budgets.
const lifetimeForcesStartEnd = (form) =>
  effectiveAdgroupBudgetMode(form) === 'BUDGET_MODE_TOTAL';

// The schedule type actually in effect: forced to SCHEDULE_START_END by a
// lifetime budget, otherwise the user's radio choice.
const effectiveScheduleType = (form) =>
  lifetimeForcesStartEnd(form) ? 'SCHEDULE_START_END' : form.scheduleType;

// An end date is needed (and the field shown) only in start-end mode. A start
// time is always required regardless of mode.
const scheduleNeedsEndDate = (form) => effectiveScheduleType(form) === 'SCHEDULE_START_END';

const SPECIAL_INDUSTRIES = [
  { value: 'HOUSING', label: 'Housing' },
  { value: 'EMPLOYMENT', label: 'Employment' },
  { value: 'CREDIT', label: 'Credit' },
];

const formatFriendlyError = (raw) => {
  if (!raw || typeof raw !== 'string') return raw || 'Failed to create';
  if (raw.includes('special_industries') && raw.includes('POLITICS')) {
    return "TikTok does not support 'Politics' under Special Industries. Only Housing, Employment, and Credit are supported.";
  }
  if (raw.includes('special_industries') && raw.includes('one or more value of the param is not acceptable')) {
    return 'Invalid Special Industries selection. TikTok only supports Housing, Employment, and Credit.';
  }
  if (raw.includes('one or more value of the param is not acceptable')) {
    const field = raw.split(':')[0]?.replace(/\.\d+/, '')?.replace(/_/g, ' ');
    const correctMatch = raw.match(/correct is \[(.*?)\]/);
    if (field && correctMatch) {
      return `Invalid ${field}. Supported values: ${correctMatch[1].replace(/'/g, '')}.`;
    }
  }
  return raw;
};

const mapApiErrorToField = (rawMsg) => {
  if (!rawMsg || typeof rawMsg !== 'string') return null;
  const msgLower = rawMsg.toLowerCase();

  // Pixel / Optimization Event
  if (
    msgLower.includes('pixel event') ||
    msgLower.includes('optimization_event') ||
    msgLower.includes('pixel event type does not exist') ||
    msgLower.includes('events manager')
  ) {
    return {
      field: 'optimizationEvent',
      step: 2,
      message: 'This pixel event does not exist on your pixel. Set up this event in TikTok Events Manager or choose an active event.',
    };
  }
  if (msgLower.includes('pixel_id') || msgLower.includes('pixel') || msgLower.includes('data connection')) {
    return {
      field: 'pixelId',
      step: 2,
      message: 'Invalid or missing TikTok Pixel.',
    };
  }

  // Bidding & CPC
  if (
    msgLower.includes('only cpc is supported') ||
    msgLower.includes('bid_type') ||
    msgLower.includes('bid price') ||
    msgLower.includes('bid_price') ||
    msgLower.includes('bid')
  ) {
    return {
      field: 'bidPrice',
      step: 2,
      message: rawMsg.includes('Only CPC is supported')
        ? 'TikTok requires a custom CPC bid for this goal. Enter a valid Bid price.'
        : 'Please provide a valid bid price.',
    };
  }

  // Identity / Account
  if (
    msgLower.includes('identity') ||
    msgLower.includes('identity_id') ||
    msgLower.includes('identity_type') ||
    msgLower.includes('bc_auth_tt')
  ) {
    return {
      field: 'identityId',
      step: 3,
      message: 'Please select a valid TikTok Identity to publish the ad.',
    };
  }

  // Ad Media & Creative
  if (msgLower.includes('video_id') || msgLower.includes('video') || msgLower.includes('transcoding') || msgLower.includes('upload an image')) {
    return {
      field: 'video',
      step: 3,
      message: 'Invalid or incomplete video asset.',
    };
  }
  if (msgLower.includes('image_ids') || msgLower.includes('single_image')) {
    return {
      field: 'image',
      step: 3,
      message: 'Invalid or missing image asset.',
    };
  }
  if (msgLower.includes('music')) {
    return {
      field: 'musicId',
      step: 3,
      message: 'Music is required for this ad format.',
    };
  }

  // Ad text & CTA
  if (msgLower.includes('ad_text') || msgLower.includes('ad text') || msgLower.includes('text')) {
    return {
      field: 'adText',
      step: 3,
      message: 'Ad text is invalid or exceeds character limit.',
    };
  }
  if (msgLower.includes('call_to_action') || msgLower.includes('call to action') || msgLower.includes('cta')) {
    return {
      field: 'cta',
      step: 3,
      message: 'Invalid Call to Action for this objective.',
    };
  }
  if (
    msgLower.includes('landing_page_url') ||
    msgLower.includes('landing page') ||
    msgLower.includes('external_url') ||
    msgLower.includes('url')
  ) {
    return {
      field: 'landingPageUrl',
      step: 3,
      message: 'A valid landing page URL is required.',
    };
  }
  if (msgLower.includes('ad_name')) {
    return {
      field: 'adName',
      step: 3,
      message: 'Invalid Ad Name.',
    };
  }

  // Promotion type / target / Subtype
  if (
    msgLower.includes('promotion_type') ||
    msgLower.includes('promotion_target_type') ||
    msgLower.includes('ecomm_type')
  ) {
    return {
      field: 'optimizationGoal',
      step: 2,
      message: rawMsg,
    };
  }

  // Operating systems / Devices
  if (msgLower.includes('operating_systems') || msgLower.includes('device')) {
    return {
      field: 'deviceTypes',
      step: 2,
      message: 'Select a compatible device type for this objective.',
    };
  }

  // Locations / Targeting
  if (msgLower.includes('location') || msgLower.includes('location_ids')) {
    return {
      field: 'locationIds',
      step: 2,
      message: 'Invalid location targeting selection.',
    };
  }
  if (msgLower.includes('age_groups') || msgLower.includes('age')) {
    return {
      field: 'ageGroups',
      step: 2,
      message: 'Invalid age group targeting.',
    };
  }
  if (msgLower.includes('gender')) {
    return {
      field: 'gender',
      step: 2,
      message: 'Invalid gender targeting.',
    };
  }
  if (msgLower.includes('interest')) {
    return {
      field: 'interestCategoryIds',
      step: 2,
      message: 'Invalid interest category selection.',
    };
  }

  // Ad group / Budget / Schedule
  if (msgLower.includes('adgroup_name')) {
    return {
      field: 'adgroupName',
      step: 2,
      message: 'Invalid Ad Group name.',
    };
  }
  if (msgLower.includes('budget') || msgLower.includes('budget_mode')) {
    return {
      field: 'adgroupBudget',
      step: 2,
      message: 'Invalid budget configuration.',
    };
  }
  if (
    msgLower.includes('schedule') ||
    msgLower.includes('schedule_start_time') ||
    msgLower.includes('schedule_end_time')
  ) {
    return {
      field: 'scheduleStartTime',
      step: 2,
      message: 'Invalid schedule start or end time.',
    };
  }

  // Campaign fields
  if (msgLower.includes('campaign_name')) {
    return {
      field: 'campaignName',
      step: 1,
      message: 'Invalid campaign name.',
    };
  }
  if (msgLower.includes('special_industries')) {
    return {
      field: 'specialIndustries',
      step: 1,
      message: 'Invalid special industry category.',
    };
  }

  return null;
};

const PLACEMENTS = [
  { value: 'PLACEMENT_TIKTOK', label: 'TikTok' },
  { value: 'PLACEMENT_PANGLE', label: 'Pangle' },
  { value: 'PLACEMENT_GLOBAL_APP_BUNDLE', label: 'Global App Bundle' },
];

const DEVICE_TYPES = [
  { value: 'ANDROID', label: 'Android' },
  { value: 'IOS', label: 'iOS' },
];

const BRAND_SAFETY_TYPES = [
  { value: 'NO_BRAND_SAFETY', label: 'None (default)' },
  { value: 'STANDARD_INVENTORY', label: 'Standard inventory' },
  { value: 'EXPANDED_INVENTORY', label: 'Expanded inventory' },
  { value: 'LIMITED_INVENTORY', label: 'Limited inventory' },
];

const OPTIMIZATION_GOAL_LABELS = {
  CLICK: 'Clicks',
  REACH: 'Reach',
  ENGAGED_VIEW: '6-second Focused Video Views',
  VIDEO_VIEW: 'Video Views',
  FOLLOWERS: 'Followers',
  PAGE_VISIT: 'Profile visits',
  LEADS: 'Instant Form Leads',
  CONVERT: 'Conversions',
  VALUE: 'Value (ROAS)',
  INSTALL: 'App Installs',
  IN_APP_EVENT: 'In-App Events',
};

const billingEventForGoal = (goal, bidType) => {
  switch (goal) {
    case 'REACH':
    case 'CPM':
      return 'CPM';
    case 'VIDEO_VIEW':
    case 'ENGAGED_VIEW':
    case 'CPV':
      return 'CPV';
    case 'CONVERT':
    case 'VALUE':
    case 'INSTALL':
    case 'IN_APP_EVENT':
    case 'LEADS':
    case 'FOLLOWERS':
    case 'PROFILE_VIEWS':
      return 'OCPM';
    case 'PAGE_VISIT':
      return bidType === 'BID_TYPE_CUSTOM' ? 'CPC' : 'OCPM';
    case 'CLICK':
    case 'TRAFFIC':
    case 'LANDING_PAGE':
    default:
      return 'CPC';
  }
};

// TikTok ad groups need a `promotion_type` describing the destination for objectives.
const promotionTypeForObjective = (objectiveKey, deviceTypes = []) => {
  switch (objectiveKey) {
    case 'TRAFFIC':
    case 'PRODUCT_SALES':
      return 'WEBSITE';
    case 'APP_PROMOTION':
      return (deviceTypes || []).includes('DEVICE_IOS') && !(deviceTypes || []).includes('DEVICE_ANDROID')
        ? 'APP_IOS'
        : 'APP_ANDROID';
    case 'LEAD_GENERATION':
      return 'LEAD_GENERATION';
    default:
      return null; // REACH, VIDEO_VIEWS, ENGAGEMENT
  }
};

const promotionTargetTypeForLeadSubType = (subType) => {
  switch (subType) {
    case 'INSTANT_FORM':
      return 'INSTANT_PAGE';
    case 'WEBSITE':
      return 'EXTERNAL_WEBSITE';
    default:
      return null;
  }
};

// Sales' Instant Page path reuses the same INSTANT_PAGE promotion_target_type
// as Lead Generation's Instant Form path; its Website path needs no
// promotion_target_type at all (promotion_type: WEBSITE already says enough).
const promotionTargetTypeForProductSalesSubType = (subType) =>
  subType === 'INSTANT_PAGE' ? 'INSTANT_PAGE' : null;

// Conversion-stage objectives can't launch until the ad account has a real
// asset set up in TikTok Ads Manager. We surface a heads-up rather than block
// them — they work in production once the asset exists.
const OBJECTIVE_ASSET_NOTE = {
  APP_PROMOTION:
    'Requires a registered app in TikTok (Assets → App) linked to the TikTok SDK or an MMP.',
  LEAD_GENERATION:
    'Choose Instant Form (needs a TikTok Instant Form Page ID) or Website (needs a Pixel + lead event).',
  PRODUCT_SALES: 'Choose Website (needs a Pixel + conversion event) or TikTok Instant Page (needs a Page ID).',
};

// Lead Generation has two distinct paths. Only the WEBSITE path needs a pixel;
// INSTANT_FORM uses a TikTok Instant Form referenced by page_id on the creative.
const LEAD_SUB_TYPES = [
  { key: 'INSTANT_FORM', label: 'Instant form (TikTok)', optimizationGoal: 'LEADS', optimizationGoals: ['LEADS', 'CLICK'] },
  { key: 'WEBSITE', label: 'Website form', optimizationGoal: 'CONVERT', optimizationGoals: ['CONVERT', 'CLICK'] },
];

const isLeadGeneration = (objectiveKey) => objectiveKey === 'LEAD_GENERATION';
const leadSubTypeNeedsPixel = (subType) => subType === 'WEBSITE';
const leadSubTypeNeedsForm = (subType) => subType === 'INSTANT_FORM';

const getOptimizationGoalsForObjective = (objectiveKey, leadGenSubType, productSalesSubType, currentObjective) => {
  if (isLeadGeneration(objectiveKey)) {
    if (leadGenSubType === 'INSTANT_FORM') return ['LEADS', 'CLICK'];
    if (leadGenSubType === 'WEBSITE') return ['CONVERT', 'CLICK'];
    return ['LEADS', 'CONVERT', 'CLICK'];
  }
  if (isProductSales(objectiveKey)) {
    if (productSalesSubType === 'INSTANT_PAGE') return ['CLICK', 'PAGE_VISIT'];
    if (productSalesSubType === 'WEBSITE') return ['CONVERT', 'VALUE', 'CLICK'];
    return ['CONVERT', 'VALUE', 'CLICK'];
  }
  return currentObjective?.optimizationGoals?.length
    ? currentObjective.optimizationGoals
    : ['CLICK', 'CONVERT'];
};

// Sales has the same Website-vs-Instant-Page split as Lead Generation
// (confirmed in TikTok Ads Manager: choosing "TikTok Instant Page" as the
// optimization location removes the Data connection/Optimization event
// fields entirely and optimizes for outbound clicks on the Instant Page
// instead — no pixel involved). Re-use the same sub-type vocabulary so the
// rest of the wizard's pixel/page-id logic can treat both objectives alike.
const isProductSales = (objectiveKey) => objectiveKey === 'PRODUCT_SALES';
const PRODUCT_SALES_SUB_TYPES = [
  { key: 'WEBSITE', label: 'Website' },
  { key: 'INSTANT_PAGE', label: 'TikTok Instant Page' },
];
const productSalesSubTypeNeedsPixel = (subType) => subType === 'WEBSITE';
const productSalesSubTypeNeedsForm = (subType) => subType === 'INSTANT_PAGE';

// TikTok requires music on any image-based ad — single image or carousel are
// the same image format under the hood, and the Music Builder becomes a
// required field as soon as an image is added (observed across objectives in
// Ads Manager). Video ads carry their own audio, so no separate music there.
const mediaTypeNeedsMusic = (objectiveKey, mediaType) =>
  mediaType === 'image' || mediaType === 'carousel';

// Ad text is required for EVERY objective and format. TikTok's request schema
// marks ad_text [optional] and its help docs claim a blank caption is allowed
// for Reach/Video Views, but the LIVE /ad/create/ API rejects a missing
// caption with "Please insert text for your ad." (40002) — so the live API is
// the source of truth here, not the docs. (The only real exception is Spark
// Ads, where the caption is inherited from the organic post; our wizard uploads
// fresh creative for every objective, so that path doesn't apply yet.)
// eslint-disable-next-line no-unused-vars
const adTextIsRequired = (objectiveKey, mediaType) => true;

// App Promotion requires a campaign-level app_promotion_type (confirmed via
// TikTok's official "App promotion" doc) — App Pre-Registration is left out
// since it's allowlist-only.
const isAppPromotion = (objectiveKey) => objectiveKey === 'APP_PROMOTION';
const APP_PROMOTION_TYPES = [
  { key: 'APP_INSTALL', label: 'App install' },
  { key: 'APP_RETARGETING', label: 'App retargeting' },
];

// Minimum daily ad-group budget per currency, confirmed via TikTok's official
// "Budget verification ratio and value range for each currency" doc — this is
// base minimum (20) × that currency's verification ratio. Only currencies
// with a ratio other than 1 need a distinct entry; anything not listed here
// (USD, EUR, GBP, AUD, CAD, SGD, CHF, ARS, BRL, ILS, MYR, NZD, PEN, QAR, RON,
// SAR, AED, etc.) keeps the base minimum of 20 since their ratio is 1.
const AD_GROUP_MIN_BUDGET_BY_CURRENCY = {
  JPY: 2000, HKD: 200, RUB: 2000, ZAR: 200, KRW: 20000, PLN: 80,
  DKK: 200, SEK: 200, NOK: 200, TRY: 200, MXN: 200, THB: 200, CNY: 200,
  DZD: 2000, BDT: 2000, BOB: 200, CLP: 20000, COP: 20000, CRC: 20000,
  CZK: 200, EGP: 200, GTQ: 200, HNL: 200, ISK: 2000, INR: 2000,
  IDR: 200000, KES: 2000, MOP: 200, TWD: 200, NIO: 200, NGN: 2000,
  PKR: 2000, PYG: 200000, PHP: 1000, UAH: 200, UYU: 200, VEF: 2000000,
  VND: 200000, HUF: 20,
};
// Awareness/upper-funnel objectives (Reach, Video Views, Community Interaction)
// enforce a higher minimum — 50 in base currency vs 20 for the others
// (confirmed in-product: Reach shows "At least 50" at both campaign and
// ad-group level; Traffic/Lead Gen/App Promotion/Sales show 20). 50 = 2.5× the
// 20 floor, and the per-currency verification ratio is the same across tiers,
// so the higher tier = base table × 2.5 for every currency.
const HIGHER_MIN_OBJECTIVES = ['REACH', 'VIDEO_VIEWS', 'ENGAGEMENT'];
const objectiveMinMultiplier = (objectiveKey) =>
  HIGHER_MIN_OBJECTIVES.includes(objectiveKey) ? 2.5 : 1;

// Minimum budget for a given objective + currency. The same value applies at
// both campaign and ad-group level (confirmed in-product), and our wizard
// creates a single ad group so the campaign floor equals the ad-group floor.
const minBudgetFor = (objectiveKey, currency) =>
  (AD_GROUP_MIN_BUDGET_BY_CURRENCY[currency] || 20) * objectiveMinMultiplier(objectiveKey);

// Objective-aware minimums for both levels (same value).
const adGroupMinBudget = (currency, objectiveKey) => minBudgetFor(objectiveKey, currency);
const campaignMinBudget = (currency, objectiveKey) => minBudgetFor(objectiveKey, currency);

// When the user targets "all locations" (selects none), we must NOT send every
// region ID — /tool/region/ returns countries AND their sub-regions/cities
// mixed, and TikTok rejects a location_ids list where a child (city) overlaps
// its parent (country). Send only COUNTRY-level regions, which can't overlap.
// Fall back to all IDs only if no country-level entries exist (shouldn't happen).
const defaultLocationIds = (regions) => {
  const countries = regions.filter((r) => r.level === 'COUNTRY').map((r) => r.id);
  return countries.length ? countries : regions.map((r) => r.id);
};

// Whole days between two datetime-local strings (min 1). Used for lifetime
// budget minimums, which TikTok computes as dailyMin × scheduled days.
const scheduledDays = (startStr, endStr) => {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
};

// TikTok's documented lifetime-budget minimum = daily minimum × scheduled days
// (e.g. 20 × 31-day schedule = 620). Without an end date we can't know the day
// count, so fall back to the flat daily minimum as a floor. `dailyMin` is the
// per-level (campaign or ad group) daily minimum.
const lifetimeMinBudget = (dailyMin, startStr, endStr) => {
  const days = scheduledDays(startStr, endStr);
  return days ? dailyMin * days : dailyMin;
};

// Whether the ad requires a destination website URL. TRAFFIC is the only
// objective that requires it on the ad itself — every other objective either
// has no external destination (Reach, Engagement, App promotion, Video
// Whether the ad requires a destination website URL. TRAFFIC, Website Sales
// (PRODUCT_SALES), and Website Lead Generation (LEAD_GENERATION) drive traffic
// to an external landing page and require landing_page_url on the ad.
const objectiveNeedsLandingUrl = (objectiveKey, subType) => {
  if (objectiveKey === 'TRAFFIC') return true;
  if (objectiveKey === 'PRODUCT_SALES' && (!subType || subType === 'WEBSITE')) return true;
  if (objectiveKey === 'LEAD_GENERATION' && subType === 'WEBSITE') return true;
  return false;
};

// Community Interaction has two ad-group optimization goals with very
// different ad-level destination requirements (confirmed via TikTok's
// official "Create Community Interaction ads" doc):
//   • FOLLOWERS  → destination is always the TikTok profile, no extra fields
//   • PAGE_VISIT → advertiser picks one of 3 destinations via
//                  tiktok_page_category: PROFILE_PAGE (none), OTHER_TIKTOK_PAGE
//                  (landing_page_url = a TikTok page URL), or TIKTOK_INSTANT_PAGE
//                  (page_id, same field Lead Gen's Instant Form uses)
const isEngagementPageVisit = (objectiveKey, optimizationGoal) =>
  objectiveKey === 'ENGAGEMENT' && optimizationGoal === 'PAGE_VISIT';

// TikTok requires `call_to_action` and a destination to exist TOGETHER: a CTA
// may only be sent when the ad actually has a destination (landing URL or a
// TikTok page_id). Sending a CTA alone — e.g. on Reach / Video Views / App
// promotion, which have no ad-level destination — fails /ad/create/ with
// "External_URL and Call_to_action must exist together" (40002). This mirrors
// exactly the conditions under which the creative emits a URL/page below, so
// the CTA is gated on the same truth. (source: TikTok CTA help + SDK — the
// creative field is `landing_page_url`; "External_URL" is TikTok's internal
// display name for it, not a real request field.)
const adHasDestination = (form) => {
  if (isEngagementPageVisit(form.objectiveKey, form.optimizationGoal)) {
    return (
      (form.tiktokPageCategory === 'OTHER_TIKTOK_PAGE' && !!form.landingPageUrl) ||
      (form.tiktokPageCategory === 'TIKTOK_INSTANT_PAGE' && !!form.pageId)
    );
  }
  if (isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsForm(form.leadGenSubType)) {
    return !!form.pageId;
  }
  if (isProductSales(form.objectiveKey) && productSalesSubTypeNeedsForm(form.productSalesSubType)) {
    return !!form.pageId;
  }
  if (objectiveNeedsLandingUrl(form.objectiveKey, form.leadGenSubType || form.productSalesSubType)) {
    return !!form.landingPageUrl;
  }
  return false;
};

// Objective-level: could this objective EVER carry an ad destination? Drives
// whether the CTA field is even shown. (adHasDestination is the value-level
// check used when actually building the payload — here the destination fields
// may still be empty, so we key on the objective/goal, not the values.)
const objectiveCanHaveDestination = (form) => {
  if (form.objectiveKey === 'ENGAGEMENT') {
    return form.optimizationGoal === 'PAGE_VISIT';
  }
  if (isLeadGeneration(form.objectiveKey) || isProductSales(form.objectiveKey)) {
    return true;
  }
  return objectiveNeedsLandingUrl(form.objectiveKey, form.leadGenSubType || form.productSalesSubType);
};

const TIKTOK_PAGE_CATEGORIES = [
  { value: 'PROFILE_PAGE', label: 'Account profile' },
  { value: 'OTHER_TIKTOK_PAGE', label: 'Other TikTok page (Playlist, Hashtag, Music, Branded Effect)' },
  { value: 'TIKTOK_INSTANT_PAGE', label: 'TikTok Instant Page' },
];

// TikTok caps ad text at 100 characters — but if it contains any CJK
// (Chinese, Japanese, Korean) fullwidth character, the cap drops to 50,
// since each fullwidth glyph is ~2x the visual width of a Latin character.
// Ranges expressed as \u{XXXX} code point escapes (not literal glyphs) to
// avoid embedding irregular/fullwidth characters directly in source.
const CJK_FULLWIDTH_RE = new RegExp(
  '[\u{3000}-\u{303F}\u{3040}-\u{30FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]',
  'u'
);
const adTextMaxLength = (text) => (CJK_FULLWIDTH_RE.test(text) ? 50 : 100);
const AD_TEXT_LENGTH_ERROR =
  'Text must be between 1 and 100 characters. (For Chinese, Japanese or Korean: 1-50 fullwidth characters or 1-100 halfwidth)';

// These are TikTok's "Standard Events" names (ads.tiktok.com/help/article/
// standard-events-parameters), which is what /adgroup/create/'s
// optimization_event field expects. Do NOT source this list from
// pixel_event_create.yml's PixelEventType enum — that enum belongs to the
// unrelated /pixel/event/create/ endpoint (server-side event reporting), not
// ad group creation. The SDK's AdgroupCreateBody model has no enum constraint
// on optimization_event (plain string), so the Standard Events doc is the
// authoritative source here.
const PIXEL_EVENTS_BY_OBJECTIVE = {
  PRODUCT_SALES: [
    { value: 'ON_WEB_ORDER', label: 'Complete payment (Place Order)' },
    { value: 'PAY_ACTION', label: 'Pay action' },
    { value: 'INITIATE_ORDER', label: 'Initiate checkout' },
    { value: 'ADD_BILLING', label: 'Add payment info' },
    { value: 'ON_WEB_CART', label: 'Add to cart' },
    { value: 'ON_WEB_DETAIL', label: 'View content / Product details' },
    { value: 'ON_WEB_ADD_TO_WISHLIST', label: 'Add to wishlist' },
    { value: 'ON_WEB_SEARCH', label: 'Search' },
    { value: 'PAGE_VIEW', label: 'Page view' },
  ],
  LEAD_GENERATION: [
    { value: 'FORM', label: 'Submit form (Lead)' },
    { value: 'CONVERSION_LEADS', label: 'Conversion leads' },
    { value: 'ON_WEB_REGISTER', label: 'Complete registration' },
    { value: 'ON_WEB_SUBSCRIBE', label: 'Subscribe' },
    { value: 'CONSULT', label: 'Contact / Consult' },
    { value: 'LANDING_PAGE_VIEW', label: 'Landing page view' },
  ],
};

// Convert a TikTok "YYYY-MM-DD HH:MM:SS" account-time string into the
// "YYYY-MM-DDTHH:MM" value required by <input type="datetime-local">.
const toDatetimeLocal = (value) => {
  if (!value) return '';
  const s = String(value).trim();
  if (!s) return '';
  // Keep it naive: replace the space with a T and trim to minutes.
  return s.replace(' ', 'T').slice(0, 16);
};

const findObjectiveKeyByType = (objectiveType, objectives = []) => {
  if (!objectiveType) return '';
  const o = objectives.find(
    (obj) =>
      obj.objectiveType === objectiveType ||
      (obj.subTypes || []).some((st) => st.objectiveType === objectiveType)
  );
  return o?.key || '';
};

// Strip runtime/context-only state before serialising the wizard form — File
// handles are not JSON-safe and IDs (campaign/adgroup/ad/identity) are
// account-specific. Names and all other wizard inputs are kept so the template
// fully reproduces the Objective, Campaign, Ad Group and Ad steps.
function stripUnsavable(form) {
  const {
    videoFile,
    imageFile,
    selectedMedia,
    uploadedVideoId,
    uploadedImageId,
    campaignId,
    adgroupId,
    adId,
    identityId,
    ...rest
  } = form || {};
  return rest;
}

// ── TikTok phone ad preview ──────────────────────────────────────────────────
function PhoneMockup({
  mediaSrc,
  mediaSrcs,
  mediaType,
  displayName,
  adText,
  ctaLabel,
  musicSrc,
  musicName,
  size = 'sm',
}) {
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  const isCarousel = mediaType === 'carousel' && mediaSrcs?.length > 0;
  const activeCarouselSrc = isCarousel ? mediaSrcs[Math.min(carouselIndex, mediaSrcs.length - 1)] : null;
  const hasMusic = !!musicSrc;
  const isVideo = mediaType === 'video' && !!mediaSrc;

  // Synchronize video play / pause & mute
  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying, mediaSrc]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Synchronize background audio for image / carousel with music
  useEffect(() => {
    if (!audioRef.current || !hasMusic) return;
    if (isPlaying && !isMuted) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, isMuted, musicSrc]);

  const togglePlay = (e) => {
    e?.stopPropagation?.();
    setIsPlaying((p) => !p);
  };

  const toggleMute = (e) => {
    e?.stopPropagation?.();
    setIsMuted((m) => {
      const nextMuted = !m;
      if (!nextMuted && !isPlaying) {
        setIsPlaying(true);
      }
      return nextMuted;
    });
  };

  const isSm = size === 'sm';
  const borderRadius = isSm ? 'rounded-[26px]' : 'rounded-[36px]';
  const innerRadius = isSm ? 'rounded-[20px]' : 'rounded-[28px]';
  const borderWidth = isSm ? 'border-[6px]' : 'border-[9px]';
  const notchH = isSm ? 'h-2.5 w-16' : 'h-3.5 w-24';
  const avatarSz = isSm ? 'h-7 w-7' : 'h-10 w-10';
  const iconSz = isSm ? 'h-4 w-4' : 'h-5 w-5';
  const countFs = isSm ? 'text-[8px]' : 'text-[10px]';
  const discSz = isSm ? 'h-7 w-7' : 'h-9 w-9';

  return (
    <div
      className={`relative ${borderRadius} ${borderWidth} border-gray-900 bg-black shadow-2xl select-none overflow-hidden`}
      style={{ aspectRatio: '9/16', width: '100%' }}
    >
      {/* Phone Notch */}
      <div className={`absolute left-1/2 top-1 z-30 ${notchH} -translate-x-1/2 rounded-full bg-gray-900`} />

      {/* Top Status Bar */}
      <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-4 pt-2 pb-1 font-semibold text-white pointer-events-none text-[9px] 2xl:text-[11px]">
        <span>9:41</span>
        <div className="flex items-center gap-1">
          <svg width="10" height="7" viewBox="0 0 10 7" fill="white">
            <rect x="0" y="2" width="2" height="5" rx="0.5" />
            <rect x="2.5" y="1" width="2" height="6" rx="0.5" />
            <rect x="5" y="0" width="2" height="7" rx="0.5" />
            <rect x="7.5" y="0" width="2" height="7" rx="0.5" opacity="0.3" />
          </svg>
          <svg width="9" height="7" viewBox="0 0 9 7" fill="white">
            <path d="M4.5 1.5C6 1.5 7.3 2.2 8.1 3.3L9 2.4C7.9 1 6.3 0 4.5 0S1.1 1 0 2.4l.9.9C1.7 2.2 3 1.5 4.5 1.5z" />
            <path d="M4.5 3C5.5 3 6.4 3.4 7 4.1l.9-.9C7 2.4 5.8 1.8 4.5 1.8S2 2.4 1.1 3.2l.9.9C2.6 3.4 3.5 3 4.5 3z" />
            <circle cx="4.5" cy="5.5" r="1" />
          </svg>
          <svg width="14" height="7" viewBox="0 0 14 7" fill="none">
            <rect x="0.5" y="0.5" width="11" height="6" rx="1.5" stroke="white" strokeOpacity="0.4" />
            <rect x="1" y="1" width="8" height="5" rx="1" fill="white" />
            <path d="M12.5 2.5v2c.8-.3.8-1.7 0-2z" fill="white" opacity="0.4" />
          </svg>
        </div>
      </div>

      {/* Top Header: Following | For You */}
      <div className="absolute left-0 right-0 top-6 z-30 flex items-center justify-center gap-4 font-semibold text-white/60 pointer-events-none text-[10px] 2xl:text-xs">
        <span className="cursor-pointer">Following</span>
        <span className="font-bold text-white border-b-2 border-white pb-0.5">For You</span>
      </div>

      {/* Floating Audio Mute/Unmute toggle button */}
      <div className="absolute top-9 right-2.5 z-40">
        {(isVideo || hasMusic) && (
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? 'Click to unmute audio' : 'Click to mute audio'}
            className={`flex h-6 w-6 2xl:h-7 2xl:w-7 items-center justify-center rounded-full backdrop-blur-md transition-all shadow-md ${
              !isMuted
                ? 'bg-[#15DCFF] text-black font-bold ring-2 ring-[#15DCFF]/50 scale-105'
                : 'bg-black/60 text-white/90 hover:bg-black/80 hover:text-white'
            }`}
          >
            {isMuted ? <VolumeX className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" /> : <Volume2 className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />}
          </button>
        )}
      </div>

      {/* Main Media Display */}
      <div
        className={`absolute inset-0 overflow-hidden ${innerRadius} bg-gray-950 cursor-pointer`}
        onClick={togglePlay}
      >
        {isCarousel ? (
          <>
            <img
              src={activeCarouselSrc}
              className="h-full w-full object-cover"
              alt={`Carousel image ${carouselIndex + 1} of ${mediaSrcs.length}`}
              onClick={(e) => {
                e.stopPropagation();
                setCarouselIndex((i) => (i + 1) % mediaSrcs.length);
              }}
            />
            {hasMusic && <audio ref={audioRef} src={musicSrc} loop />}
            {mediaSrcs.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCarouselIndex((i) => (i - 1 + mediaSrcs.length) % mediaSrcs.length);
                  }}
                  className="absolute left-1.5 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/70 text-xs"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCarouselIndex((i) => (i + 1) % mediaSrcs.length);
                  }}
                  className="absolute right-1.5 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/70 text-xs"
                >
                  ›
                </button>
              </>
            )}
            <div className="absolute bottom-24 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 pointer-events-none">
              {mediaSrcs.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all ${
                    i === carouselIndex ? 'w-3 bg-white' : 'w-1 bg-white/40'
                  }`}
                />
              ))}
            </div>
          </>
        ) : mediaSrc ? (
          mediaType === 'video' ? (
            <video
              ref={videoRef}
              src={mediaSrc}
              className="h-full w-full object-cover"
              muted={isMuted}
              loop
              autoPlay
              playsInline
            />
          ) : (
            <>
              <img src={mediaSrc} className="h-full w-full object-cover" alt="ad preview" />
              {hasMusic && <audio ref={audioRef} src={musicSrc} loop />}
            </>
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gray-900">
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <rect x="2" y="2" width="20" height="20" rx="3" />
              <path d="M9 10l5 3-5 3V10z" />
            </svg>
          </div>
        )}

        {/* Dark Vignette Bottom Scrim for crisp text contrast */}
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none z-10" />

        {/* Center paused overlay indicator */}
        {!isPlaying && (mediaSrc || activeCarouselSrc) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white shadow-xl ring-1 ring-white/30">
              <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
            </div>
          </div>
        )}
      </div>

      {/* Right Action Bar (Heart, Comment, Bookmark, Share, Vinyl) */}
      <div className="absolute bottom-11 right-1.5 z-20 flex flex-col items-center gap-2 pointer-events-none">
        {/* Profile Avatar */}
        <div className="relative flex flex-col items-center">
          <div className={`${avatarSz} rounded-full bg-gradient-to-tr from-[#15DCFF] to-[#FE2C55] p-[1.5px] shadow`}>
            <div className="h-full w-full rounded-full bg-gray-800 flex items-center justify-center text-white text-[9px] font-bold">
              {(displayName || 'A').slice(0, 1).toUpperCase()}
            </div>
          </div>
          <div className="-mt-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FE2C55] text-white text-[8px] font-bold shadow">
            +
          </div>
        </div>

        {/* Heart / Like */}
        <div className="flex flex-col items-center">
          <Heart className={`${iconSz} fill-white text-white drop-shadow`} />
          <span className={`text-white font-medium drop-shadow ${countFs}`}>991K</span>
        </div>

        {/* Comment */}
        <div className="flex flex-col items-center">
          <MessageCircle className={`${iconSz} fill-white text-white drop-shadow`} />
          <span className={`text-white font-medium drop-shadow ${countFs}`}>3.4K</span>
        </div>

        {/* Bookmark */}
        <div className="flex flex-col items-center">
          <Bookmark className={`${iconSz} fill-white text-white drop-shadow`} />
          <span className={`text-white font-medium drop-shadow ${countFs}`}>810</span>
        </div>

        {/* Share */}
        <div className="flex flex-col items-center">
          <Share2 className={`${iconSz} fill-white text-white drop-shadow`} />
          <span className={`text-white font-medium drop-shadow ${countFs}`}>1.2K</span>
        </div>

        {/* Spinning Vinyl Record Disc */}
        <div
          onClick={toggleMute}
          className={`pointer-events-auto cursor-pointer ${discSz} rounded-full bg-gradient-to-tr from-gray-900 via-gray-800 to-black p-1 ring-1 ring-white/30 shadow-lg mt-0.5 ${
            isPlaying ? 'animate-spin [animation-duration:3.5s]' : ''
          }`}
          title={isMuted ? 'Sound muted - tap to unmute' : 'Playing audio'}
        >
          <div className="flex h-full w-full items-center justify-center rounded-full bg-black/90">
            <Music className={`h-2.5 w-2.5 ${!isMuted ? 'text-[#15DCFF]' : 'text-white/70'}`} />
          </div>
        </div>
      </div>

      {/* Bottom Left Ad Information Overlay */}
      <div className="absolute bottom-10 left-2.5 right-12 z-20 pointer-events-none flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <p className="font-bold text-white text-[10px] 2xl:text-xs drop-shadow truncate">
            @{displayName || 'your_brand'}
          </p>
          <span className="rounded-xs bg-white/20 px-1 py-0.5 text-[8px] font-semibold text-white/90 backdrop-blur-xs">
            Sponsored
          </span>
        </div>

        <p className="text-[9px] 2xl:text-[11px] leading-tight text-white/90 drop-shadow line-clamp-2 mt-0.5">
          {adText || 'Your ad copy will be displayed here'}
        </p>

        {/* Interactive Call to Action Banner */}
        {ctaLabel && (
          <div className="mt-1 flex items-center justify-between rounded bg-[#FE2C55] px-2 py-0.5 text-white shadow-sm max-w-[150px]">
            <span className="text-[9px] 2xl:text-[10px] font-bold tracking-wide">{ctaLabel}</span>
            <span className="text-[9px] font-bold">›</span>
          </div>
        )}

        {/* Music Sound Ticker */}
        <div className="mt-0.5 flex items-center gap-1 text-white/75 text-[8px] 2xl:text-[10px]">
          <Music className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            {musicName || (isVideo ? `Original sound - ${displayName || 'ad'}` : 'Commercial sound')}
          </span>
        </div>
      </div>

      {/* Bottom Navigation Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 flex h-8 items-center justify-around ${innerRadius.replace(
          'rounded-[',
          'rounded-b-[',
        )} bg-black/85 backdrop-blur-md pointer-events-none px-1 border-t border-white/5`}
      >
        <div className="flex flex-col items-center gap-px text-white">
          <div className="h-2.5 w-2.5 rounded-xs bg-white" />
          <span className="text-[6px] font-medium">Home</span>
        </div>
        <div className="flex flex-col items-center gap-px text-white/60">
          <div className="h-2.5 w-2.5 rounded-xs bg-white/30" />
          <span className="text-[6px]">Friends</span>
        </div>
        <div className="flex items-center justify-center">
          <div className="flex h-4 w-7 items-center justify-center rounded-md bg-gradient-to-r from-[#15DCFF] via-white to-[#FE2C55] p-[1.5px] shadow">
            <div className="flex h-full w-full items-center justify-center rounded-[3px] bg-white text-black font-bold text-[9px] leading-none">
              +
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-px text-white/60">
          <div className="h-2.5 w-2.5 rounded-xs bg-white/30" />
          <span className="text-[6px]">Inbox</span>
        </div>
        <div className="flex flex-col items-center gap-px text-white/60">
          <div className="h-2.5 w-2.5 rounded-xs bg-white/30" />
          <span className="text-[6px]">Profile</span>
        </div>
      </div>
    </div>
  );
}

function TikTokAdPreview({ form, identityName, musicList = [] }) {
  const [mediaObjectUrl, setMediaObjectUrl] = useState(null);
  const [carouselObjectUrls, setCarouselObjectUrls] = useState([]);
  const [musicObjectUrl, setMusicObjectUrl] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let url = null;
    if (form.mediaType === 'video' && form.videoFile) {
      url = URL.createObjectURL(form.videoFile);
      setMediaObjectUrl(url);
    } else if (form.mediaType === 'image' && form.imageFile) {
      url = URL.createObjectURL(form.imageFile);
      setMediaObjectUrl(url);
    } else {
      setMediaObjectUrl(null);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [form.videoFile, form.imageFile, form.mediaType]);

  useEffect(() => {
    if (form.musicFile) {
      const url = URL.createObjectURL(form.musicFile);
      setMusicObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setMusicObjectUrl(null);
    return undefined;
  }, [form.musicFile]);

  useEffect(() => {
    if (form.mediaType !== 'carousel' || !form.carouselFiles.length) {
      setCarouselObjectUrls([]);
      return () => {};
    }
    const urls = form.carouselFiles.map((f) => URL.createObjectURL(f));
    setCarouselObjectUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [form.carouselFiles, form.mediaType]);

  const mediaSrc =
    mediaObjectUrl || (form.mediaType === 'video' ? form.videoUrl : form.imageUrl) || null;

  const selectedMusicObj = useMemo(
    () => musicList?.find((m) => String(m.musicId) === String(form.musicId)),
    [musicList, form.musicId]
  );
  const musicSrc = musicObjectUrl || selectedMusicObj?.url || '';
  const musicName =
    form.musicFile?.name ||
    selectedMusicObj?.name ||
    (selectedMusicObj?.author ? `${selectedMusicObj.name} · ${selectedMusicObj.author}` : '');

  const displayName = identityName || 'Your identity';
  const adText = form.adText || 'Your text will be shown here';
  const ctaLabel = objectiveCanHaveDestination(form)
    ? (form.cta || 'LEARN_MORE').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

  const mockupProps = {
    mediaSrc,
    mediaSrcs: carouselObjectUrls,
    mediaType: form.mediaType,
    displayName,
    adText,
    ctaLabel,
    musicSrc,
    musicName,
  };

  return (
    <>
      <div className="flex flex-col items-center gap-2 p-1">
        <div className="flex w-full items-center justify-between px-1 mb-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/50">
            Ad Preview
          </p>
          <button
            onClick={() => setExpanded(true)}
            title="Expand preview"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:bg-white/10 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" />
            </svg>
          </button>
        </div>
        {/* phone frame */}
        <div className="w-54 2xl:w-60 max-w-full">
          <PhoneMockup {...mockupProps} size="sm" />
        </div>
        <p className="text-[10px] text-gray-400 dark:text-white/35 mt-1">In feed · TikTok</p>
      </div>

      {/* fullscreen expanded modal */}
      {expanded && (
        <div
          className="fixed inset-0 z-9999 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
          onClick={() => setExpanded(false)}
        >
          <div className="flex flex-col items-center gap-3 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex w-full items-center justify-between rounded-2xl bg-white/10 backdrop-blur-lg px-4 py-2 text-white border border-white/10">
              <span className="text-xs font-semibold uppercase tracking-wider">TikTok Live Preview</span>
              <button
                onClick={() => setExpanded(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div style={{ width: '320px' }}>
              <PhoneMockup {...mockupProps} size="lg" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const TIKTOK_STEPS = [
  { id: 'objective', label: 'Objective', icon: Target },
  { id: 'campaign', label: 'Campaign', icon: Layers },
  { id: 'adgroup', label: 'Ad Group', icon: Users },
  { id: 'ad', label: 'Ad', icon: ImageIcon },
  { id: 'review', label: 'Review', icon: CheckCircle2 },
];

function StepRail({ currentIndex, steps: stepOverride, onStepClick }) {
  const stepsToRender = stepOverride || TIKTOK_STEPS;
  return (
    <div className="flex items-center gap-1 overflow-x-auto 2xl:gap-1.5">
      {stepsToRender.map((s, i) => {
        const Icon = s.icon;
        const label = s.label || s;
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <React.Fragment key={s.id || label}>
            <button
              type="button"
              onClick={() => onStepClick?.(i)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-all shrink-0 2xl:px-3 2xl:py-1.5 2xl:text-sm cursor-pointer ${
                active
                  ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white shadow-sm'
                  : done
                  ? 'border border-emerald-400/30 bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300 hover:border-emerald-400/50'
                  : 'border border-gray-200 bg-gray-50 text-gray-400 dark:border-white/8 dark:bg-white/3 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60'
              }`}
            >
              {done ? (
                <Check className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
              ) : Icon ? (
                <Icon className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
              ) : (
                <span className="flex h-3.5 w-3.5 items-center justify-center text-[10px] 2xl:h-4 2xl:w-4 2xl:text-[11px]">
                  {i + 1}
                </span>
              )}
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < stepsToRender.length - 1 && (
              <div
                className={`h-0.5 w-2 2xl:w-3 shrink-0 ${
                  i < currentIndex ? 'bg-emerald-400/30' : 'bg-gray-200 dark:bg-white/15'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Single source of truth for step validation, shared by the sidebar issue
// list, the Review step's "fix N steps" banner, and the Next/Create Campaign
// button gates (canNext/canLaunch in the wizard component). Previously the
// sidebar ran a second, hand-maintained copy of these rules (getStepIssues)
// that drifted from this one — e.g. it once flagged a landing URL as
// "recommended" on every objective, including Reach, which has no ad-level
// destination at all and would show a misleading warning while the button
// itself (gated on the rules below) was correctly enabled. Reusing this one
// function for both keeps the displayed reason and the button state in sync.
// `currency` defaults to 'USD' for callers (e.g. the sidebar) that don't have
// the wizard's resolved account currency in scope — this only affects the
// wording of a minimum-budget message, never whether a field is required.
function getStepErrors(step, form, currentObjective, currency = 'USD') {
  const errs = {};
  const needsPixel =
    (isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsPixel(form.leadGenSubType)) ||
    (isProductSales(form.objectiveKey) && productSalesSubTypeNeedsPixel(form.productSalesSubType));
  if (step === 0) {
    if (!form.objectiveKey) errs.objectiveKey = 'Select an objective';
    if (isLeadGeneration(form.objectiveKey) && !form.leadGenSubType) {
      errs.leadGenSubType = 'Select a lead generation path';
    }
    if (isProductSales(form.objectiveKey) && !form.productSalesSubType) {
      errs.productSalesSubType = 'Select a sales destination';
    }
  }
  if (step === 1) {
    if (!form.campaignName.trim()) errs.campaignName = 'Campaign name is required';
    if (hasCampaignBudget(form)) {
      const min = campaignMinBudget(currency, form.objectiveKey);
      if (!form.budget || Number(form.budget) <= 0) {
        errs.budget = 'Enter a valid budget';
      } else if (Number(form.budget) < min) {
        errs.budget = `Minimum budget is ${min} ${currency}`;
      }
    }
  }
  if (step === 2) {
    if (!form.adgroupName.trim()) errs.adgroupName = 'Ad group name is required';
    if (!form.optimizationGoal) errs.optimizationGoal = 'Optimization goal is required';
    if (!form.budgetOptimizeOn) {
      const min =
        form.adgroupBudgetMode === 'BUDGET_MODE_TOTAL'
          ? lifetimeMinBudget(adGroupMinBudget(currency, form.objectiveKey), form.scheduleStartTime, form.scheduleEndTime)
          : adGroupMinBudget(currency, form.objectiveKey);
      const unit = form.adgroupBudgetMode === 'BUDGET_MODE_TOTAL' ? 'lifetime budget' : 'daily budget';
      if (!form.adgroupBudget || Number(form.adgroupBudget) <= 0) {
        errs.adgroupBudget = `A ${unit} is required`;
      } else if (Number(form.adgroupBudget) < min) {
        errs.adgroupBudget = `Minimum ${unit} is ${min} ${currency}`;
      }
    }
    const isCpc = billingEventForGoal(form.optimizationGoal, form.bidType) === 'CPC';
    if ((isCpc || form.bidType === 'BID_TYPE_CUSTOM') && (!form.bidPrice || Number(form.bidPrice) <= 0)) {
      errs.bidPrice = 'Bid price is required (must be greater than 0)';
    }
    if (needsPixel) {
      if (!form.pixelId) errs.pixelId = 'Select a TikTok Pixel';
      if (!form.optimizationEvent) errs.optimizationEvent = 'Select a conversion event';
    }
    if (!form.scheduleStartTime) {
      errs.scheduleStartTime = 'A start time is required';
    }
    if (scheduleNeedsEndDate(form)) {
      if (!form.scheduleEndTime) {
        errs.scheduleEndTime = lifetimeForcesStartEnd(form)
          ? 'A lifetime budget requires an end date'
          : 'An end time is required';
      }
    }
    if (form.scheduleStartTime && form.scheduleEndTime) {
      if (new Date(form.scheduleEndTime) <= new Date(form.scheduleStartTime)) {
        errs.scheduleEndTime = 'End time must be after start time';
      }
    }
  }
  if (step === 3) {
    const videoOnly = currentObjective?.videoOnly;
    const effectiveMediaType = videoOnly ? 'video' : form.mediaType;

    if (!form.identityId) {
      errs.identityId = 'Select a TikTok identity to publish the ad';
    }
    if (!form.adName.trim()) {
      errs.adName = 'Ad name is required';
    }
    if (effectiveMediaType === 'video' && !form.videoUrl && !form.videoFile) {
      errs.video = 'Upload a video or provide a video URL';
    }
    if (effectiveMediaType === 'image' && !form.imageUrl && !form.imageFile) {
      errs.image = 'Upload an image or provide an image URL';
    }
    if (effectiveMediaType === 'carousel' && form.carouselFiles.length < MIN_CAROUSEL_IMAGES) {
      errs.carousel = `Upload at least ${MIN_CAROUSEL_IMAGES} images (up to ${MAX_CAROUSEL_IMAGES}) for a carousel ad`;
    }
    if (mediaTypeNeedsMusic(form.objectiveKey, effectiveMediaType) && !form.musicId) {
      errs.music = 'Select or upload music for this ad';
    }
    {
      const adText = form.adText.trim();
      // Use TikTok's own single message for both empty and too-long cases —
      // "between 1 and 100 characters" already covers the minimum (empty), so
      // the message matches the wording Ads Manager shows for either problem.
      if (!adText) {
        if (adTextIsRequired(form.objectiveKey, effectiveMediaType)) {
          errs.adText = AD_TEXT_LENGTH_ERROR;
        }
      } else if (adText.length > adTextMaxLength(adText)) {
        errs.adText = AD_TEXT_LENGTH_ERROR;
      }
    }
    if (
      objectiveNeedsLandingUrl(form.objectiveKey, form.leadGenSubType || form.productSalesSubType) &&
      !form.landingPageUrl.trim()
    ) {
      errs.landingPageUrl = 'Destination URL is required';
    }
    if (isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsForm(form.leadGenSubType) && !form.pageId) {
      errs.pageId = 'Select or enter a TikTok Instant Form Page ID';
    }
    if (isProductSales(form.objectiveKey) && productSalesSubTypeNeedsForm(form.productSalesSubType) && !form.pageId) {
      errs.pageId = 'Select or enter a TikTok Instant Page ID';
    }
    if (isEngagementPageVisit(form.objectiveKey, form.optimizationGoal)) {
      if (form.tiktokPageCategory === 'OTHER_TIKTOK_PAGE' && !form.landingPageUrl.trim()) {
        errs.landingPageUrl = 'Enter the TikTok page URL';
      }
      if (form.tiktokPageCategory === 'TIKTOK_INSTANT_PAGE' && !form.pageId) {
        errs.pageId = 'Enter the TikTok Instant Page ID';
      }
    }
  }
  return errs;
}

// String-list adapter over getStepErrors, for the sidebar/review UI which
// displays free-text issues rather than field-keyed errors.
function getStepIssues(step, form, selectedObjective, currency) {
  return Object.values(getStepErrors(step, form, selectedObjective, currency));
}

function CampaignSetupSidebar({
  currentStep,
  steps = TIKTOK_STEPS,
  form,
  selectedObjective,
  onStepClick,
  currency,
  identities = [],
  musicList = [],
  stepOffset = 0,
}) {
  const actualStep = currentStep + stepOffset;
  const currentIssues = getStepIssues(actualStep, form, selectedObjective, currency);
  const isAdStep = actualStep === 3;

  return (
    <aside className="scrollbar-thin hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-gray-50/50 px-4 py-5 dark:border-white/8 dark:bg-white/2 md:flex">
      {/* Whole-wizard checklist */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/40">
          Campaign setup
        </p>
        <ul className="mt-2.5 flex flex-col gap-0.5">
          {steps.map((s, i) => {
            const isCurrent = i === currentStep;
            const targetStep = i + stepOffset;
            const stepIssues = getStepIssues(targetStep, form, selectedObjective, currency);
            const hasErr = stepIssues.length > 0;
            const done = i < currentStep && !hasErr;
            const label = s.label || s;
            return (
              <li key={s.id || label}>
                <button
                  type="button"
                  onClick={() => onStepClick?.(targetStep)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-gray-100 font-semibold text-gray-900 dark:bg-white/8 dark:text-white'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-white/55 dark:hover:bg-white/5 dark:hover:text-white/80'
                  }`}
                >
                  <span
                    className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      done
                        ? 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300'
                        : hasErr && i <= currentStep
                        ? 'border border-amber-400/40 bg-amber-400/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300'
                        : isCurrent
                        ? 'border border-[#15DCFF]/40 bg-[#15DCFF]/10 text-[#0EA5C2] dark:border-[#15DCFF]/30 dark:bg-[#15DCFF]/15 dark:text-[#15DCFF]'
                        : 'border border-gray-300 bg-gray-50 text-gray-500 dark:border-white/8 dark:bg-white/3 dark:text-white/40'
                    }`}
                  >
                    {done ? (
                      <Check className="h-2.5 w-2.5" />
                    ) : hasErr && i <= currentStep ? (
                      <AlertCircle className="h-2.5 w-2.5 text-amber-500" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Current-step status — tinted amber card */}
      {currentIssues.length > 0 && actualStep < 4 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-400/20 dark:bg-amber-400/5">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-200">
                {currentIssues.length} {currentIssues.length === 1 ? 'thing' : 'things'} left on this step
              </p>
              <div className="mt-1 flex flex-col gap-0.5">
                {currentIssues.map((m, idx) => (
                  <div key={idx} className="flex items-start gap-1 text-[11px] text-amber-800/80 dark:text-amber-300/80">
                    <span className="select-none">•</span>
                    <span>{m}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ad Preview (when on Ad step or previewing) */}
      {isAdStep && (
        <div className="mt-1 flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-white/8">
          <TikTokAdPreview
            form={form}
            identityName={
              identities?.find((it) => String(it.identityId) === String(form.identityId))?.displayName || ''
            }
            musicList={musicList}
          />
        </div>
      )}
    </aside>
  );
}

// "Save as template" — inline chip → name input → POST. Lives on the Review
// step. Only meaningful in create mode (the wizard has the whole form).
function SaveAsTemplateChip({ form, advertiserId }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await saveTiktokCampaignTemplate({
        name: trimmed,
        payload: { ...stripUnsavable(form), advertiserId },
        objective: form.objectiveKey,
        conversionLocation: form.objectiveType,
      });
      toast.success(`Template "${trimmed}" saved.`);
      setOpen(false);
      setName('');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        title="Save Objective, Campaign, Ad Group and Ad settings as a reusable template"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-white/12 dark:bg-white/4 dark:text-white/75 dark:hover:border-white/25 dark:hover:text-white"
      >
        <BookmarkPlus className="h-3.5 w-3.5" /> Save as template
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 rounded-l-full rounded-r-full border border-r-0 border-gray-300 bg-gray-50 py-1 pl-1 pr-0 dark:border-white/15 dark:bg-white/4">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setOpen(false);
            setName('');
          }
        }}
        placeholder="Template name…"
        maxLength={120}
        className="w-36 rounded-full bg-transparent px-3 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-white/40"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={!name.trim() || saving}
        className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-3 py-1 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        Save
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setName(''); }}
        disabled={saving}
        className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
        aria-label="Cancel"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// "Start from template" — Objective-step dropdown. Lists the user's saved
// templates, applies the selected one's payload to the form.
function TemplatePicker({ onApply }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Lazy-load list when the dropdown opens.
  useEffect(() => {
    if (!open || items.length) return undefined;
    let cancelled = false;
    setLoading(true);
    listTiktokCampaignTemplates()
      .then((r) => { if (!cancelled) setItems(r?.templates || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, items.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handlePick = async (t) => {
    setApplyingId(t.id);
    try {
      const r = await getTiktokCampaignTemplate(t.id);
      if (r?.template?.payload) {
        await onApply?.(r.template);
        toast.success(`Applied template "${t.name}".`);
        setOpen(false);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load template.');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async (e, t) => {
    e.stopPropagation();
    setDeletingId(t.id);
    try {
      await deleteTiktokCampaignTemplate(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      toast.success(`Deleted "${t.name}".`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete template.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-white/12 dark:bg-white/4 dark:text-white/80 dark:hover:border-white/25 dark:hover:text-white"
      >
        <Bookmark className="h-3.5 w-3.5" />
        Start from template
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-80 w-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/12 dark:bg-[#1A1A1A]">
          {loading && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-gray-500 dark:text-white/55">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-500 dark:text-white/50">
              No saved templates yet. Fill all 4 steps and save the campaign you&apos;re building on the Review step to reuse it later.
            </div>
          )}
          {!loading && items.map((t) => (
            <button
              type="button"
              key={t.id}
              disabled={!!applyingId}
              onClick={() => handlePick(t)}
              className="flex w-full items-center gap-2 border-b border-gray-200 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-100 disabled:opacity-50 dark:border-white/5 dark:hover:bg-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-900 dark:text-white">{t.name}</p>
                {(t.objective || t.conversionLocation) && (
                  <p className="truncate text-[11px] text-gray-500 dark:text-white/45">
                    {[t.objective, t.conversionLocation].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              {applyingId === t.id ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400 dark:text-white/55" />
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDelete(e, t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleDelete(e, t);
                  }}
                  title="Delete template"
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:text-white/35 dark:hover:bg-white/8 dark:hover:text-red-300"
                >
                  {deletingId === t.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Review-step card + field helpers (mirrors Meta Ads Manager V2 review layout).
function ReviewSection({ title, children, wide = false }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#303030]/20 ${
        wide ? 'md:col-span-2' : ''
      }`}
    >
      <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 dark:border-white/10 dark:bg-white/5 2xl:px-5 2xl:py-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-white/85 2xl:text-sm">
          {title}
        </p>
      </div>
      <dl className="divide-y divide-gray-200 dark:divide-white/8">{children}</dl>
    </div>
  );
}

function ReviewField({ label, value }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2 2xl:px-5 2xl:py-2.5">
      <dt className="w-28 shrink-0 text-xs font-semibold tracking-wider text-gray-500 dark:text-white/55 2xl:w-32 2xl:text-sm">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-xs font-medium text-gray-900 dark:text-white 2xl:text-sm">
        {value || <span className="text-gray-400 dark:text-white/30">—</span>}
      </dd>
    </div>
  );
}

const CreateCampaignWizard = ({
  advertiserId,
  accountName = '',
  accounts = [],
  currency = 'USD',
  timezone = '',
  mode = 'create',
  context = null,
  onClose,
  onCreated,
  onChangeAccount,
}) => {
  const isCreate = mode === 'create';
  const isAddAdGroup = mode === 'add-adgroup'; // creating a new ad group under existing campaign
  const isAddAd = mode === 'add-ad';           // creating a new ad under existing ad group
  const isEdit = !isCreate && !isAddAdGroup && !isAddAd;
  const isEditCampaign = mode === 'edit-campaign';
  const isEditAdGroup = mode === 'edit-adgroup';
  const isEditAd = mode === 'edit-ad';

  // Build initial form from context when editing.
  const buildInitialForm = () => {
    if (!context) return {};
    if (isEditCampaign) {
      const raw = context.raw || {};
      const rawBudgetMode = context.budgetMode || raw.budget_mode || 'BUDGET_MODE_DAY';
      const campaignHasBudget = rawBudgetMode !== 'BUDGET_MODE_INFINITE';
      return {
        campaignName: context.name || '',
        // Infinite = no campaign budget was set; default the picker to Daily.
        budgetMode: campaignHasBudget ? rawBudgetMode : 'BUDGET_MODE_DAY',
        budget: context.budget != null ? Number(context.budget) : 50,
        budgetOptimizeOn: raw.budget_optimize_on || false,
        setCampaignBudget: campaignHasBudget,
        specialIndustries: raw.special_industries || [],
        appPromotionType: raw.app_promotion_type || 'APP_INSTALL',
      };
    }
    if (isEditAdGroup) {
      const raw = context.raw || {};
      return {
        objectiveType: raw.objective_type || '',
        optimizationGoal: raw.optimize_goal || context.optimizationGoal || '',
        adgroupName: context.name || '',
        locationIds: (raw.location_ids || []).map(String),
        ageGroups: (raw.age_groups || []).map(String),
        gender: raw.gender || 'GENDER_UNLIMITED',
        interestCategoryIds: (raw.interest_category_ids || []).map(String),
        adgroupBudget: context.budget != null ? Number(context.budget) : 20,
        budgetMode: context.budgetMode || raw.budget_mode || 'BUDGET_MODE_DAY',
        adgroupBudgetMode: raw.budget_mode || context.budgetMode || 'BUDGET_MODE_DAY',
        frequency: raw.frequency || 3,
        frequencySchedule: raw.frequency_schedule || 7,
        bidType: raw.bid_type || 'BID_TYPE_NO_BID',
        bidPrice: raw.bid != null ? String(raw.bid) : '',
        placements: raw.placements?.length ? raw.placements : ['PLACEMENT_TIKTOK'],
        deviceTypes: raw.device_type || [],
        scheduleType: raw.schedule_type === 'SCHEDULE_START_END' ? 'SCHEDULE_START_END' : 'SCHEDULE_FROM_NOW',
        scheduleStartTime: toDatetimeLocal(raw.schedule_start_time),
        scheduleEndTime: toDatetimeLocal(raw.schedule_end_time),
        languages: raw.languages || [],
        spendingPower: raw.spending_power || 'ALL',
        // brandSafetyType: raw.brand_safety_type || 'NO_BRAND_SAFETY',
        pixelId: raw.pixel_id || '',
        optimizationEvent: raw.optimization_event || '',
        pageId: raw.page_id || '',
        leadGenSubType:
          raw.objective_type === 'LEAD_GENERATION'
            ? raw.promotion_target_type === 'INSTANT_PAGE'
              ? 'INSTANT_FORM'
              : raw.promotion_target_type === 'EXTERNAL_WEBSITE'
              ? 'WEBSITE'
              : ''
            : '',
        productSalesSubType:
          raw.objective_type === 'PRODUCT_SALES' || raw.objective_type === 'WEB_CONVERSIONS'
            ? raw.promotion_target_type === 'INSTANT_PAGE'
              ? 'INSTANT_PAGE'
              : 'WEBSITE'
            : '',
      };
    }
    if (isEditAd) {
      const raw = context.raw || {};
      return {
        adName: context.name || '',
        adText: raw.ad_text || raw.creative?.ad_text || '',
        cta: raw.call_to_action || raw.creative?.call_to_action || 'LEARN_MORE',
        landingPageUrl: raw.landing_page_url || raw.creative?.landing_page_url || '',
        identityId: raw.identity_id || raw.creative?.identity_id || '',
        mediaType:
          raw.ad_format === 'SINGLE_IMAGE' ? 'image' : raw.ad_format === 'CAROUSEL_ADS' ? 'carousel' : 'video',
        impressionTrackingUrl: raw.impression_tracking_url || raw.creative?.impression_tracking_url || '',
        clickTrackingUrl: raw.click_tracking_url || raw.creative?.click_tracking_url || '',
      };
    }
    return {};
  };

  const initialStep = isEditCampaign ? 1 : isEditAdGroup ? 2 : isEditAd ? 3 : isAddAdGroup ? 2 : isAddAd ? 3 : 0;

  const [step, setStep] = useState(initialStep);
  const [schema, setSchema] = useState(null);
  const [regions, setRegions] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [interestCategories, setInterestCategories] = useState([]);
  const [pixels, setPixels] = useState([]);
  const [loadingPixels, setLoadingPixels] = useState(false);
  const [newPixelName, setNewPixelName] = useState('');
  const [creatingPixel, setCreatingPixel] = useState(false);
  const [leadForms, setLeadForms] = useState([]);
  const [loadingLeadForms, setLoadingLeadForms] = useState(false);
  const [musicList, setMusicList] = useState([]);
  const [loadingMusic, setLoadingMusic] = useState(false);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [manualPageId, setManualPageId] = useState('');
  const [libraryMode, setLibraryMode] = useState(true);
  const [launching, setLaunching] = useState(false);
  // Synchronous re-entrancy guard for launch/save. `launching` state can't
  // prevent a second concurrent call (React batches state, and StrictMode +
  // re-renders can invoke the handler twice before the flag is committed),
  // which otherwise fires each create endpoint twice — visible as duplicate
  // create-campaign/ad-group calls and "Campaign name already exists" errors.
  const inFlightRef = useRef(false);
  // For add-adgroup: pre-seed the existing campaign so handleLaunch skips step 1.
  // For add-ad: pre-seed both campaign + adgroup so handleLaunch skips steps 1 & 2.
  const [created, setCreated] = useState(
    isAddAdGroup && context?.id
      ? { campaignId: context.id }
      : isAddAd && context?.id
        ? { adgroupId: context.id, campaignId: context.campaignId || '' }
        : {}
  ); // {campaignId, adgroupId, videoId, imageId, carouselImageIds, adId}
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({}); // field-level validation errors
  const [videoWarning, setVideoWarning] = useState(''); // non-blocking advisory (e.g. estimated low bitrate)

  const [form, setForm] = useState({
    objectiveKey: '',
    objectiveType: '',
    optimizationGoal: '',
    campaignName: '',
    budgetMode: 'BUDGET_MODE_DAY',
    budget: 50,
    budgetOptimizeOn: false,
    // When CBO is off, this optional toggle decides whether a (non-optimized)
    // campaign-level budget is set. Off → no campaign budget (BUDGET_MODE_INFINITE),
    // budget lives at the ad-group level. Ignored when CBO is on.
    setCampaignBudget: true,
    specialIndustries: [],
    adgroupName: '',
    placements: ['PLACEMENT_TIKTOK'],
    deviceTypes: [],
    locationIds: [],
    ageGroups: [],
    gender: 'GENDER_UNLIMITED',
    interestCategoryIds: [],
    adgroupBudget: 20,
    // The ad group's OWN budget mode, used only when the campaign has no
    // budget (otherwise the ad group inherits the campaign budget).
    adgroupBudgetMode: 'BUDGET_MODE_DAY',
    frequency: 3,
    frequencySchedule: 7,
    bidType: 'BID_TYPE_NO_BID',
    bidPrice: '',
    // SCHEDULE_FROM_NOW (run continuously, start only) or SCHEDULE_START_END
    // (fixed start + end). TikTok always requires a start time; end only in
    // start-end mode. Lifetime budgets force SCHEDULE_START_END.
    scheduleType: 'SCHEDULE_FROM_NOW',
    scheduleStartTime: '',
    scheduleEndTime: '',
    languages: [],
    spendingPower: 'ALL',
    // brandSafetyType: 'NO_BRAND_SAFETY',
    impressionTrackingUrl: '',
    clickTrackingUrl: '',
    pixelId: '',
    optimizationEvent: '',
    leadGenSubType: '',
    productSalesSubType: '',
    appPromotionType: 'APP_INSTALL',
    pageId: '',
    tiktokPageCategory: 'PROFILE_PAGE',
    identityId: '',
    mediaType: 'video',
    videoUrl: '',
    videoFile: null,
    imageUrl: '',
    imageFile: null,
    carouselFiles: [],
    musicId: '',
    musicFile: null,
    adName: '',
    adText: '',
    cta: 'LEARN_MORE',
    landingPageUrl: '',
    ...buildInitialForm(),
  });

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Pre-check a video file client-side before it's set on the form, so an
  // obviously-oversized file (>10 min, TikTok's documented max for standard
  // in-feed ads) is rejected instantly instead of after a slow upload. Any
  // TikTok-side rule we haven't confirmed still surfaces via the real API
  // error at launch — this is a fast-fail, not the source of truth.
  const handleVideoFileSelect = async (file) => {
    if (!file) {
      update({ videoFile: null });
      setVideoWarning('');
      return;
    }
    const { duration, width, height } = await readVideoMetadata(file);
    if (duration != null && duration < MIN_VIDEO_DURATION_SECONDS) {
      setErrors((e) => ({ ...e, video: 'Video must be at least 5 seconds long.' }));
      return;
    }
    if (duration != null && duration > MAX_VIDEO_DURATION_SECONDS) {
      setErrors((e) => ({ ...e, video: 'Video must be 10 minutes or shorter.' }));
      return;
    }
    if (!meetsMinResolution(width, height)) {
      setErrors((e) => ({
        ...e,
        video:
          'Cannot be delivered to TikTok: Resolution too low. Minimum is 960×540 (horizontal), 540×960 (vertical), or 640×640 (square).',
      }));
      return;
    }
    if (width != null && height != null && !isSupportedAspectRatio(width, height)) {
      setErrors((e) => ({
        ...e,
        video: 'Cannot be delivered to TikTok: Video ratio must be 16:9/1:1/9:16.',
      }));
      return;
    }
    setErrors((e) => ({ ...e, video: undefined }));
    const estimatedBitrate = duration ? estimateBitrateKbps(file.size, duration) : null;
    setVideoWarning(
      estimatedBitrate != null && estimatedBitrate < MIN_VIDEO_BITRATE_KBPS
        ? `Estimated bitrate (~${Math.round(estimatedBitrate)} Kbps) looks low — TikTok requires at least ${MIN_VIDEO_BITRATE_KBPS} Kbps. This is an approximation; TikTok will give the final answer on upload.`
        : ''
    );
    update({ videoFile: file });
  };

  // Image validation is deliberately lighter than video (see MIN_IMAGE_SHORT_SIDE
  // note): only a max bound (confirmed via a live upload error) and a small
  // minimum on the shorter side to catch a genuinely tiny asset. No aspect-ratio
  // gate — the live Ads Manager accepts many ratios and crops to the feed, so
  // enforcing 16:9/1:1/9:16 here wrongly rejected ordinary photos/thumbnails.
  const handleImageFileSelect = async (file) => {
    if (!file) {
      update({ imageFile: null });
      return;
    }
    const dims = await readImageDimensions(file);
    if (dims) {
      const longer = Math.max(dims.width, dims.height);
      const shorter = Math.min(dims.width, dims.height);
      if (longer > MAX_IMAGE_LONG_SIDE || shorter > MAX_IMAGE_SHORT_SIDE) {
        setErrors((e) => ({
          ...e,
          image: `Image resolution (${dims.width}×${dims.height}px) exceeds TikTok limits. Max allowed is ${MAX_IMAGE_LONG_SIDE}px on the longest side and ${MAX_IMAGE_SHORT_SIDE}px on the shortest side. Recommended: 1080×1920 (9:16) or 1200×1200 (1:1).`,
        }));
        return;
      }
      if (shorter < MIN_IMAGE_SHORT_SIDE) {
        setErrors((e) => ({
          ...e,
          image: `Image resolution (${dims.width}×${dims.height}px) is too small. Minimum resolution is at least ${MIN_IMAGE_SHORT_SIDE}px.`,
        }));
        return;
      }
    }
    setErrors((e) => ({ ...e, image: undefined }));
    update({ imageFile: file });
  };

  // Carousel takes 2-35 images (TikTok's documented range for the standard,
  // non-catalog Carousel format). Each added file gets the same light checks as
  // a single image (max bound + small minimum, no aspect-ratio gate — see
  // handleImageFileSelect); the count check runs against the combined total.
  const handleCarouselFilesSelect = async (files) => {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    const combined = [...form.carouselFiles, ...incoming].slice(0, MAX_CAROUSEL_IMAGES);
    for (const file of incoming) {
      const dims = await readImageDimensions(file);
      if (dims) {
        const longer = Math.max(dims.width, dims.height);
        const shorter = Math.min(dims.width, dims.height);
        if (longer > MAX_IMAGE_LONG_SIDE || shorter > MAX_IMAGE_SHORT_SIDE) {
          setErrors((e) => ({
            ...e,
            carousel: `"${file.name}" (${dims.width}×${dims.height}px) exceeds TikTok limits. Max allowed is ${MAX_IMAGE_LONG_SIDE}px on longest side and ${MAX_IMAGE_SHORT_SIDE}px on shortest side. Recommended: 1080×1920 or 1200×1200.`,
          }));
          return;
        }
        if (shorter < MIN_IMAGE_SHORT_SIDE) {
          setErrors((e) => ({
            ...e,
            carousel: `"${file.name}" (${dims.width}×${dims.height}px) is too small. Minimum resolution is at least ${MIN_IMAGE_SHORT_SIDE}px.`,
          }));
          return;
        }
      }
    }
    setErrors((e) => ({ ...e, carousel: undefined }));
    update({ carouselFiles: combined });
  };
  const handleImagePaste = async (e) => {
    const file = getClipboardImageFiles(e.clipboardData, 1)[0] || null;
    if (!file) return;
    e.preventDefault();
    await handleImageFileSelect(file);
  };
  const handleCarouselPaste = async (e) => {
    const files = getClipboardImageFiles(e.clipboardData, MAX_CAROUSEL_IMAGES);
    if (!files.length) return;
    e.preventDefault();
    await handleCarouselFilesSelect(files);
  };

  const removeCarouselFile = (index) => {
    update({ carouselFiles: form.carouselFiles.filter((_, i) => i !== index) });
  };

  // Upload a user's own music track and select it. Adds it to the in-memory
  // list so it shows as selected immediately (mirrors the pixel-create flow).
  const handleMusicFileSelect = async (file) => {
    if (!file) return;

    // Pre-upload checks against TikTok's documented music rules, so an invalid
    // track fails instantly with a clear reason instead of after a round-trip.
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!SUPPORTED_MUSIC_EXTENSIONS.includes(ext)) {
      setErrors((e) => ({
        ...e,
        music: `Unsupported audio format. TikTok accepts ${SUPPORTED_MUSIC_EXTENSIONS.map((x) => `.${x}`).join(', ')}.`,
      }));
      return;
    }
    if (file.size > MAX_MUSIC_SIZE_BYTES) {
      setErrors((e) => ({ ...e, music: 'Audio file is too large. TikTok allows up to 10 MB.' }));
      return;
    }
    const duration = await readAudioDuration(file);
    if (duration != null && duration < MIN_MUSIC_DURATION_SECONDS) {
      setErrors((e) => ({ ...e, music: 'Audio must be at least 2 seconds long.' }));
      return;
    }
    setErrors((e) => ({ ...e, music: undefined }));

    setUploadingMusic(true);
    try {
      const res = await uploadTiktokMusic({ advertiserId, file });
      const uploaded = res?.music;
      if (uploaded?.musicId) {
        setMusicList((prev) => [uploaded, ...prev]);
        update({ musicId: String(uploaded.musicId), musicFile: file });
        toast.success('Music uploaded');
      } else {
        throw new Error('Music upload did not return an ID');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to upload music');
    } finally {
      setUploadingMusic(false);
    }
  };

  // Apply a saved campaign template — merge its payload over the current form,
  // strip runtime-only state, and ask the dashboard to switch advertiser accounts
  // if the template was saved against a different one.
  const applyTemplate = (template) => {
    const payload = template?.payload || {};
    const templateAccount = payload.advertiserId || null;
    const patch = { ...payload };
    delete patch.advertiserId;
    delete patch.videoFile;
    delete patch.imageFile;
    delete patch.carouselFiles;
    delete patch.musicFile;
    // Make sure we don't replay stale IDs, media handles or account-specific
    // identity. Names and all step settings are intentionally preserved.
    patch.selectedMedia = null;
    patch.uploadedVideoId = null;
    patch.uploadedImageId = null;
    patch.campaignId = null;
    patch.adgroupId = null;
    patch.adId = null;
    patch.identityId = '';
    update(patch);
    setStep(0);
    if (templateAccount && templateAccount !== advertiserId) {
      onChangeAccount?.(templateAccount);
    }
  };

  useEffect(() => {
    getTiktokWizardSchema()
      .then(setSchema)
      .catch(() => toast.error('Failed to load wizard config'));
    getTiktokIdentities(advertiserId)
      .then((r) => setIdentities(r.identities || []))
      .catch(() => {});
  }, [advertiserId]);

  // TikTok's /tool/region/ and /tool/interest_category/ endpoints require an
  // objective_type. Re-fetch when the user picks/changes the objective so the
  // available locations/interests match the campaign goal.
  useEffect(() => {
    if (!advertiserId) return;
    const objectiveType = form.objectiveType || 'TRAFFIC';
    getTiktokRegions(advertiserId, undefined, objectiveType)
      .then((r) => setRegions(r.regions?.length ? r.regions : FALLBACK_REGIONS))
      .catch((e) => {
        // Region API failed — fall back to a country list so the user can still
        // pick a required location.
        setRegions(FALLBACK_REGIONS);
        toast.error(
          e.response?.data?.error || 'Could not load full region list — showing countries only'
        );
      });
    getTiktokInterestCategories(advertiserId, undefined, objectiveType)
      .then((r) => setInterestCategories(r.categories || []))
      .catch(() => setInterestCategories([]));
  }, [advertiserId, form.objectiveType]);

  const locationPresets = useMemo(() => {
    if (!regions?.length) return [];
    const findIds = (names) =>
      regions
        .filter((r) => names.some((n) => r.name?.toLowerCase().includes(n.toLowerCase())))
        .map((r) => r.id);

    return [
      {
        label: 'Tier 1 (US, UK, CA, AU)',
        values: findIds(['United States', 'United Kingdom', 'Canada', 'Australia']),
      },
      {
        label: 'North America (US, CA)',
        values: findIds(['United States', 'Canada']),
      },
      {
        label: 'Europe Top 5',
        values: findIds(['United Kingdom', 'Germany', 'France', 'Italy', 'Spain']),
      },
    ].filter((p) => p.values.length > 0);
  }, [regions]);

  const languagePresets = [
    { label: 'English Only', values: ['en'] },
    { label: 'Top Global (EN, ES, FR, DE, HI, AR)', values: ['en', 'es', 'fr', 'de', 'hi', 'ar'] },
  ];

  const interestCategoryPresets = useMemo(() => {
    if (!interestCategories?.length) return [];
    return [
      {
        label: 'E-Commerce & Tech',
        values: interestCategories
          .filter((c) => /e-commerce|tech|electronics|app|online/i.test(c.name || ''))
          .map((c) => String(c.id)),
      },
      {
        label: 'Lifestyle & Media',
        values: interestCategories
          .filter((c) => /beauty|fashion|apparel|entertainment|game|travel|food|pets/i.test(c.name || ''))
          .map((c) => String(c.id)),
      },
    ].filter((p) => p.values.length > 0);
  }, [interestCategories]);

  // Fetch pixels when the selected objective/path needs one. Reset pixel state
  // when the objective changes away from a pixel-requiring objective.
  const needsPixel =
    (isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsPixel(form.leadGenSubType)) ||
    (isProductSales(form.objectiveKey) && productSalesSubTypeNeedsPixel(form.productSalesSubType));

  useEffect(() => {
    if (!advertiserId || !needsPixel) {
      setPixels([]);
      return;
    }
    setLoadingPixels(true);
    getTiktokPixels(advertiserId)
      .then((r) => setPixels(r.pixels || []))
      .catch(() => {
        setPixels([]);
        toast.error('Could not load TikTok pixels. Make sure the Pixel permission is granted.');
      })
      .finally(() => setLoadingPixels(false));
  }, [advertiserId, needsPixel]);

  // Fetch the music library when the chosen creative needs music (Carousel, or
  // Reach image ads). Best-effort — users can still upload their own track.
  const needsMusic = mediaTypeNeedsMusic(form.objectiveKey, form.mediaType);
  useEffect(() => {
    if (!advertiserId || !needsMusic) {
      setMusicList([]);
      return;
    }
    setLoadingMusic(true);
    getTiktokMusic(advertiserId)
      .then((r) => setMusicList(r.music || []))
      .catch(() => setMusicList([]))
      .finally(() => setLoadingMusic(false));
  }, [advertiserId, needsMusic]);

  // Fetch TikTok Instant Forms/Pages when the user picks an in-app path —
  // Lead Generation's Instant Form, or Sales' Instant Page destination.
  useEffect(() => {
    const needsPageList =
      (isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsForm(form.leadGenSubType)) ||
      (isProductSales(form.objectiveKey) && productSalesSubTypeNeedsForm(form.productSalesSubType));
    if (!advertiserId || !needsPageList) {
      setLeadForms([]);
      return;
    }
    setLoadingLeadForms(true);
    getTiktokLeadForms(advertiserId)
      .then((r) => setLeadForms(r.forms || []))
      .catch(() => {
        setLeadForms([]);
        // Don't block the user — the list endpoint is not always available; they
        // can still paste a Page ID manually.
      })
      .finally(() => setLoadingLeadForms(false));
  }, [advertiserId, form.objectiveKey, form.leadGenSubType, form.productSalesSubType]);

  useEffect(() => {
    if (!isLeadGeneration(form.objectiveKey)) {
      update({ leadGenSubType: '', pageId: '' });
    }
    if (!isProductSales(form.objectiveKey)) {
      update({ productSalesSubType: '' });
    }
    if (!isLeadGeneration(form.objectiveKey) && !isProductSales(form.objectiveKey)) {
      update({ pixelId: '', optimizationEvent: '' });
    }
  }, [form.objectiveKey]);

  // Reset path-specific fields when the Lead Generation sub-type changes.
  useEffect(() => {
    if (!isLeadGeneration(form.objectiveKey)) return;
    update({
      pixelId: leadSubTypeNeedsPixel(form.leadGenSubType) ? form.pixelId : '',
      optimizationEvent: leadSubTypeNeedsPixel(form.leadGenSubType) ? form.optimizationEvent : '',
      pageId: leadSubTypeNeedsForm(form.leadGenSubType) ? form.pageId : '',
      optimizationGoal:
        form.leadGenSubType === 'INSTANT_FORM'
          ? 'LEADS'
          : form.leadGenSubType === 'WEBSITE'
          ? 'CONVERT'
          : form.optimizationGoal,
    });
  }, [form.leadGenSubType]);

  // Reset path-specific fields when the Sales sub-type changes — Instant Page
  // needs no pixel (TikTok auto-optimizes for outbound clicks on the page).
  useEffect(() => {
    if (!isProductSales(form.objectiveKey)) return;
    update({
      pixelId: productSalesSubTypeNeedsPixel(form.productSalesSubType) ? form.pixelId : '',
      optimizationEvent: productSalesSubTypeNeedsPixel(form.productSalesSubType) ? form.optimizationEvent : '',
      pageId: productSalesSubTypeNeedsForm(form.productSalesSubType) ? form.pageId : '',
      optimizationGoal: 'CONVERT',
    });
  }, [form.productSalesSubType]);

  const selectedObjective = useMemo(
    () => schema?.objectives?.find((o) => o.key === form.objectiveKey),
    [schema, form.objectiveKey]
  );

  // In edit mode or add-adgroup/add-ad mode the context only gives us the API `objective_type`.
  // Once the schema loads, derive the wizard `objectiveKey` so the ad-group step can
  // show the right optimization-goal options and Reach-only fields.
  useEffect(() => {
    if (!schema || form.objectiveKey) return;
    const contextObjectiveType =
      context?.raw?.objective_type ||
      context?.raw?.campaign_objective_type ||
      context?.objectiveType ||
      context?.objective_type ||
      form.objectiveType;
    if (contextObjectiveType) {
      const key = findObjectiveKeyByType(contextObjectiveType, schema.objectives || []);
      if (key) update({ objectiveKey: key, objectiveType: contextObjectiveType });
    }
  }, [schema, form.objectiveKey, form.objectiveType, context]);

  // Objective used to drive ad-group fields. Prefer the explicit key; fall back
  // to a lookup by API objective_type so edits still populate correctly before
  // the schema effect fires.
  const currentObjective = useMemo(() => {
    if (!schema) return null;
    if (form.objectiveKey) return schema.objectives?.find((o) => o.key === form.objectiveKey) || null;
    if (form.objectiveType) {
      return (
        schema.objectives?.find(
          (o) =>
            o.objectiveType === form.objectiveType ||
            (o.subTypes || []).some((s) => s.objectiveType === form.objectiveType)
        ) || null
      );
    }
    return selectedObjective;
  }, [schema, form.objectiveKey, form.objectiveType, selectedObjective]);

  // Keep form.optimizationGoal aligned with the allowed goals of the current objective
  useEffect(() => {
    const validGoals = getOptimizationGoalsForObjective(
      form.objectiveKey,
      form.leadGenSubType,
      form.productSalesSubType,
      currentObjective
    );
    if (!validGoals.length) return;
    if (!form.optimizationGoal || !validGoals.includes(form.optimizationGoal)) {
      update({ optimizationGoal: validGoals[0] });
    }
  }, [currentObjective, form.objectiveKey, form.leadGenSubType, form.productSalesSubType, form.optimizationGoal]);

  // For CLICK optimization (CPC billing event), TikTok strictly requires manual CPC bidding (BID_TYPE_CUSTOM).
  useEffect(() => {
    if (billingEventForGoal(form.optimizationGoal, form.bidType) === 'CPC' && form.bidType !== 'BID_TYPE_CUSTOM') {
      update({ bidType: 'BID_TYPE_CUSTOM' });
    }
  }, [form.optimizationGoal, form.bidType]);

  // Video-only objectives (Video Views, Community Interaction) don't offer an
  // image option on TikTok — force the media type back to video if a prior
  // objective left it set to image.
  useEffect(() => {
    if (currentObjective?.videoOnly && form.mediaType !== 'video') {
      update({ mediaType: 'video' });
    }
  }, [currentObjective?.videoOnly]);

  // Reach has no Carousel option — if a prior objective left mediaType on
  // carousel, fall back to the Image flow (where Reach handles multi-image).
  useEffect(() => {
    if (form.objectiveKey === 'REACH' && form.mediaType === 'carousel') {
      update({ mediaType: 'image' });
    }
  }, [form.objectiveKey, form.mediaType]);

  // Special Ad Categories (Housing, Employment, Credit) strictly disallow age and
  // gender targeting under advertising non-discrimination regulations.
  useEffect(() => {
    if (form.specialIndustries?.length > 0) {
      if (form.ageGroups?.length > 0) update({ ageGroups: [] });
      if (form.gender && form.gender !== 'GENDER_UNLIMITED') update({ gender: 'GENDER_UNLIMITED' });
    }
  }, [form.specialIndustries]);

  const pickObjective = (o) => {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '').replace('-', '').replace('-', '');
    update({
      objectiveKey: o.key,
      objectiveType: o.key === 'PRODUCT_SALES' ? 'WEB_CONVERSIONS' : o.objectiveType,
      optimizationGoal: o.optimizationGoals?.[0] || '',
      leadGenSubType: o.key === 'LEAD_GENERATION' ? 'INSTANT_FORM' : '',
      productSalesSubType: o.key === 'PRODUCT_SALES' ? 'WEBSITE' : '',
      appPromotionType: 'APP_INSTALL',
      pageId: '',
      pixelId: '',
      optimizationEvent: '',
      musicId: '',
      musicFile: null,
      // Reset budget toggles so each objective starts from its own default
      // (the non-CBO objectives always carry a plain campaign budget).
      budgetOptimizeOn: false,
      setCampaignBudget: true,
      adName: `Ad name${ts}`,
    });
  };

  // ── validation per step ──
  // Delegates to the module-level getStepErrors (shared with the sidebar and
  // Review banner) so this component's Next/Create Campaign gates and the
  // displayed issue text can never drift apart again.
  const validateStep = (targetStep = step) =>
    getStepErrors(targetStep, form, currentObjective, currency);

  const activeLaunchSteps = useMemo(() => {
    if (isAddAd) return [3];
    if (isAddAdGroup) return [2, 3];
    return [0, 1, 2, 3];
  }, [isAddAd, isAddAdGroup]);

  const canNext = () => Object.keys(validateStep(step)).length === 0;

  const canLaunch = () =>
    activeLaunchSteps.every((s) => Object.keys(validateStep(s)).length === 0);

  const handleNext = () => {
    const errs = validateStep(step);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setStep((s) => s + 1);
  };

  // Clear field errors when the user fixes them
  useEffect(() => {
    setErrors((prev) => {
      const current = validateStep(step);
      const next = {};
      Object.keys(prev).forEach((k) => {
        if (current[k]) next[k] = current[k];
      });
      return next;
    });
  }, [form, step]);

  const scheduleEndPayload = () => {
    // TikTok expects "YYYY-MM-DD HH:MM:SS" in the account timezone. A start
    // time is always required by the API, so fall back to ~now if unset. The
    // end time is only sent in the fixed start-end mode.
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (val) => {
      const d = new Date(val);
      if (isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const result = {};
    const start = fmt(form.scheduleStartTime) || fmt(new Date(Date.now() + 60000));
    if (start) result.schedule_start_time = start;
    if (scheduleNeedsEndDate(form) && form.scheduleEndTime) {
      const v = fmt(form.scheduleEndTime);
      if (v) result.schedule_end_time = v;
    }
    return result;
  };

  // ── edit save ──
  const handleSave = async () => {
    // Same re-entrancy guard as handleLaunch — stop a concurrent second call
    // from firing the update endpoints twice.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLaunching(true);
    setError(null);
    try {
      if (isEditCampaign) {
        await updateTiktokCampaign({
          advertiserId,
          campaignId: context.id,
          campaignName: form.campaignName,
          budgetMode: hasCampaignBudget(form) ? form.budgetMode : 'BUDGET_MODE_INFINITE',
          ...(hasCampaignBudget(form) ? { budget: Number(form.budget) } : {}),
        });
      } else if (isEditAdGroup) {
        const payload = {
          advertiser_id: advertiserId,
          adgroup_id: context.id,
          adgroup_name: form.adgroupName,
          placements: form.placements.length ? form.placements : ['PLACEMENT_TIKTOK'],
          ...(form.deviceTypes.length
            ? {
                operating_systems:
                  form.objectiveKey === 'APP_PROMOTION'
                    ? (form.deviceTypes.includes('DEVICE_IOS') && !form.deviceTypes.includes('DEVICE_ANDROID') ? ['IOS'] : ['ANDROID'])
                    : form.deviceTypes.map((d) => String(d).replace(/^DEVICE_/, '')),
              }
            : {}),
          location_ids: form.locationIds.length ? form.locationIds : defaultLocationIds(regions),
          age_groups: form.ageGroups,
          gender: form.gender,
          interest_category_ids: form.interestCategoryIds,
          ...(form.languages.length ? { languages: form.languages } : {}),
          ...(form.spendingPower && form.spendingPower !== 'ALL'
            ? { spending_power: form.spendingPower }
            : {}),
          // ...(form.brandSafetyType && form.brandSafetyType !== 'NO_BRAND_SAFETY'
          //   ? { brand_safety_type: form.brandSafetyType }
          //   : {}),
          // Same rule as create: only true CBO (budget_optimize_on) lets the ad
          // group defer with BUDGET_MODE_INFINITE; otherwise it carries its own
          // mode + amount, regardless of any campaign-level budget.
          ...(form.budgetOptimizeOn
            ? { budget_mode: 'BUDGET_MODE_INFINITE' }
            : {
                budget: Number(form.adgroupBudget),
                budget_mode: form.adgroupBudgetMode || 'BUDGET_MODE_DAY',
              }),
          optimization_goal: form.optimizationGoal,
          ...(promotionTypeForObjective(form.objectiveKey, form.deviceTypes)
            ? { promotion_type: promotionTypeForObjective(form.objectiveKey, form.deviceTypes) }
            : {}),
          ...(isLeadGeneration(form.objectiveKey) && promotionTargetTypeForLeadSubType(form.leadGenSubType)
            ? { promotion_target_type: promotionTargetTypeForLeadSubType(form.leadGenSubType) }
            : {}),
          ...(isProductSales(form.objectiveKey) && promotionTargetTypeForProductSalesSubType(form.productSalesSubType)
            ? { promotion_target_type: promotionTargetTypeForProductSalesSubType(form.productSalesSubType) }
            : {}),
          bid_type: form.bidType,
          ...(form.bidType === 'BID_TYPE_CUSTOM' && form.bidPrice
            ? { bid: Number(form.bidPrice) }
            : {}),
          ...(form.pixelId ? { pixel_id: String(form.pixelId) } : {}),
          ...(form.optimizationEvent ? { optimization_event: form.optimizationEvent } : {}),
          schedule_type: effectiveScheduleType(form),
          ...scheduleEndPayload(),
          ...(form.optimizationGoal === 'REACH'
            ? {
                frequency: Number(form.frequency) || 1,
                frequency_schedule: Number(form.frequencySchedule) || 7,
              }
            : {}),
        };
        await updateTiktokAdGroup({
          advertiserId,
          adgroupId: context.id,
          adgroupName: form.adgroupName,
          payload,
        });
      } else if (isEditAd) {
        await updateTiktokAd({
          advertiserId,
          creatives: [
            {
              ad_id: context.id,
              ad_name: form.adName,
              ad_text: form.adText,
              // CTA only when the ad has a destination (see adHasDestination).
              ...(adHasDestination(form) ? { call_to_action: form.cta } : {}),
              ...(isEngagementPageVisit(form.objectiveKey, form.optimizationGoal)
                ? {
                    tiktok_page_category: form.tiktokPageCategory,
                    ...(form.tiktokPageCategory === 'OTHER_TIKTOK_PAGE' && form.landingPageUrl
                      ? { landing_page_url: form.landingPageUrl }
                      : {}),
                    ...(form.tiktokPageCategory === 'TIKTOK_INSTANT_PAGE' && form.pageId
                      ? { page_id: Number(form.pageId) }
                      : {}),
                  }
                : isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsForm(form.leadGenSubType) && form.pageId
                ? { page_id: Number(form.pageId) }
                : isProductSales(form.objectiveKey) && productSalesSubTypeNeedsForm(form.productSalesSubType) && form.pageId
                ? { page_id: Number(form.pageId) }
                : objectiveNeedsLandingUrl(form.objectiveKey, form.leadGenSubType || form.productSalesSubType) && form.landingPageUrl
                ? { landing_page_url: form.landingPageUrl }
                : {}),
              ...(form.impressionTrackingUrl ? { impression_tracking_url: form.impressionTrackingUrl } : {}),
              ...(form.clickTrackingUrl ? { click_tracking_url: form.clickTrackingUrl } : {}),
            },
          ],
        });
      }
      toast.success('Saved successfully');
      onCreated?.();
      onClose();
    } catch (err) {
      const rawMsg = err.response?.data?.error || err.message || 'Failed to save';
      const msg = formatFriendlyError(rawMsg);
      setError(msg);
      toast.error(msg);

      const fieldErr = mapApiErrorToField(rawMsg);
      if (fieldErr) {
        setErrors((prev) => ({
          ...prev,
          [fieldErr.field]: fieldErr.message,
        }));
        if (fieldErr.step) {
          setStep(fieldErr.step);
        }
      }
    } finally {
      setLaunching(false);
      inFlightRef.current = false;
    }
  };

  // Wait until an uploaded video has finished TikTok's async transcoding
  // before it's referenced in /ad/create/. Referencing a still-processing
  // video fails with error 2200006 ("Video processing failed / referenced too
  // early"). TikTok's /file/video/ad/info/ response has no documented
  // is_ready/status flag, so readiness is inferred from the info object being
  // populated (width/height/cover present) — a field-agnostic check that
  // doesn't rely on an unverified status field. Best-effort: after the retry
  // budget is exhausted we proceed anyway and let /ad/create/ be the final
  // gate, so a slow-but-valid video is never permanently blocked.
  const waitForVideoReady = async (vId, { attempts = 8, delayMs = 2500 } = {}) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const info = await getTiktokVideoInfo(advertiserId, vId);
        const v = info.videos?.find((x) => x.videoId === vId) || info.videos?.[0];
        // A fully-processed video reports its real dimensions (and a cover).
        if (v && v.width && v.height) return true;
      } catch {
        // Transient read error — keep polling within the retry budget.
      }
      if (i < attempts - 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return false;
  };

  // ── idempotent sequential launch ──
  const handleLaunch = async () => {
    // Block a second concurrent run (StrictMode double-invoke / rapid re-render)
    // before it can fire the create endpoints again.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLaunching(true);
    setError(null);
    try {
      let { campaignId, adgroupId, videoId, videoCoverImageId, imageId, carouselImageIds, adId } = created;
      carouselImageIds = carouselImageIds || [];

      if (isAddAdGroup) {
        campaignId = campaignId || context?.id || context?.campaignId;
      }
      if (isAddAd) {
        campaignId = campaignId || context?.campaignId || context?.parentCampaignId;
        adgroupId = adgroupId || context?.id || context?.adgroupId;
      }

      // 1. Campaign
      if (!campaignId && !isAddAdGroup && !isAddAd) {
        const effectiveObjectiveType =
          isProductSales(form.objectiveKey) && form.productSalesSubType === 'WEBSITE'
            ? 'WEB_CONVERSIONS'
            : form.objectiveType;

        const res = await createTiktokCampaign({
          advertiserId,
          campaignName: form.campaignName,
          objectiveType: effectiveObjectiveType,
          // No campaign budget set → infinite (budget lives at ad-group level).
          budgetMode: hasCampaignBudget(form) ? form.budgetMode : 'BUDGET_MODE_INFINITE',
          ...(hasCampaignBudget(form) ? { budget: Number(form.budget) } : {}),
          budgetOptimizeOn: form.budgetOptimizeOn,
          specialIndustries: form.specialIndustries,
          ...(isAppPromotion(form.objectiveKey) ? { appPromotionType: form.appPromotionType } : {}),
          productSalesSubType: form.productSalesSubType,
        });
        campaignId = res.campaignId;
        setCreated((c) => ({ ...c, campaignId }));
        if (!campaignId) throw new Error('Campaign creation returned no id');
      }

      // 2. Ad Group
      if (!adgroupId && !isAddAd) {
        const payload = {
          advertiser_id: advertiserId,
          campaign_id: campaignId,
          adgroup_name: form.adgroupName,
          placement_type: 'PLACEMENT_TYPE_NORMAL',
          placements: form.placements.length ? form.placements : ['PLACEMENT_TIKTOK'],
          ...(form.deviceTypes.length
            ? {
                operating_systems:
                  form.objectiveKey === 'APP_PROMOTION'
                    ? (form.deviceTypes.includes('DEVICE_IOS') && !form.deviceTypes.includes('DEVICE_ANDROID') ? ['IOS'] : ['ANDROID'])
                    : form.deviceTypes.map((d) => String(d).replace(/^DEVICE_/, '')),
              }
            : {}),
          location_ids: form.locationIds.length ? form.locationIds : defaultLocationIds(regions),
          ...(form.specialIndustries?.length ? {} : form.ageGroups.length ? { age_groups: form.ageGroups } : {}),
          ...(form.specialIndustries?.length ? { gender: 'GENDER_UNLIMITED' } : form.gender && form.gender !== 'GENDER_UNLIMITED' ? { gender: form.gender } : {}),
          ...(form.interestCategoryIds.length
            ? { interest_category_ids: form.interestCategoryIds }
            : {}),
          ...(form.languages.length ? { languages: form.languages } : {}),
          ...(form.spendingPower && form.spendingPower !== 'ALL'
            ? { spending_power: form.spendingPower }
            : {}),
          // ...(form.brandSafetyType && form.brandSafetyType !== 'NO_BRAND_SAFETY'
          //   ? { brand_safety_type: form.brandSafetyType }
          //   : {}),
          ...(promotionTypeForObjective(form.objectiveKey, form.deviceTypes)
            ? { promotion_type: promotionTypeForObjective(form.objectiveKey, form.deviceTypes) }
            : {}),
          ...(isLeadGeneration(form.objectiveKey) && promotionTargetTypeForLeadSubType(form.leadGenSubType)
            ? {
                promotion_target_type: promotionTargetTypeForLeadSubType(form.leadGenSubType),
              }
            : {}),
          ...(isProductSales(form.objectiveKey) && promotionTargetTypeForProductSalesSubType(form.productSalesSubType)
            ? {
                promotion_target_type: promotionTargetTypeForProductSalesSubType(form.productSalesSubType),
              }
            : {}),
          // budget_mode is ALWAYS required by /adgroup/create/. The valid value
          // is keyed strictly to CBO (budget_optimize_on), NOT to whether a
          // campaign-level budget exists: only true CBO makes the ad group
          // defer with BUDGET_MODE_INFINITE. When CBO is off (even if a
          // non-optimized campaign budget was set), the ad group MUST carry its
          // own budget_mode (DAY/TOTAL) + amount.
          ...(form.budgetOptimizeOn
            ? { budget_mode: 'BUDGET_MODE_INFINITE' }
            : {
                budget_mode: form.adgroupBudgetMode,
                budget: Number(form.adgroupBudget),
              }),
          // Radio choice, forced to SCHEDULE_START_END by a lifetime budget.
          schedule_type: effectiveScheduleType(form),
          ...scheduleEndPayload(),
          optimization_goal: form.optimizationGoal,
          billing_event: billingEventForGoal(form.optimizationGoal, form.bidType),
          bid_type: form.bidType,
          ...(form.bidType === 'BID_TYPE_CUSTOM' && form.bidPrice
            ? { bid_price: Number(form.bidPrice) }
            : {}),
          ...(form.pixelId ? { pixel_id: String(form.pixelId) } : {}),
          ...(form.optimizationEvent ? { optimization_event: form.optimizationEvent } : {}),
          pacing: 'PACING_MODE_SMOOTH',
          operation_status: 'ENABLE',
          // REACH requires a frequency cap: show the ad at most `frequency`
          // times every `frequency_schedule` days.
          ...(form.optimizationGoal === 'REACH'
            ? {
                frequency: Number(form.frequency) || 1,
                frequency_schedule: Number(form.frequencySchedule) || 7,
              }
            : {}),
        };

        const res = await createTiktokAdGroup({
          advertiserId,
          campaignId,
          adgroupName: form.adgroupName,
          payload,
        });
        adgroupId = res.adgroupId;
        setCreated((c) => ({ ...c, adgroupId }));
      }

      // 3. Media upload (only if we have an identity + a media source)
      if (form.identityId) {
        if (form.mediaType === 'video' && !videoId) {
          if (form.videoFile) {
            const res = await uploadTiktokVideo({ advertiserId, file: form.videoFile });
            videoId = res.videos?.[0]?.videoId;
            videoCoverImageId = res.videos?.[0]?.coverImageId || '';
          } else if (form.videoUrl) {
            const res = await uploadTiktokVideo({ advertiserId, videoUrl: form.videoUrl });
            videoId = res.videos?.[0]?.videoId;
            videoCoverImageId = res.videos?.[0]?.coverImageId || '';
          }
          if (videoId) {
            setCreated((c) => ({ ...c, videoId, videoCoverImageId }));
            // Let TikTok finish transcoding before /ad/create/ references the
            // video, avoiding error 2200006 on larger uploads.
            await waitForVideoReady(videoId);
          }
        }

        if (form.mediaType === 'image' && !imageId) {
          if (form.imageFile) {
            const res = await uploadTiktokImage({ advertiserId, file: form.imageFile });
            imageId = res.images?.[0]?.imageId;
          } else if (form.imageUrl) {
            const res = await uploadTiktokImage({ advertiserId, imageUrl: form.imageUrl });
            imageId = res.images?.[0]?.imageId;
          }
          if (imageId) setCreated((c) => ({ ...c, imageId }));
        }

        if (form.mediaType === 'carousel' && carouselImageIds.length < form.carouselFiles.length) {
          const remaining = form.carouselFiles.slice(carouselImageIds.length);
          for (const file of remaining) {
            const res = await uploadTiktokImage({ advertiserId, file });
            const uploadedId = res.images?.[0]?.imageId;
            if (uploadedId) carouselImageIds = [...carouselImageIds, uploadedId];
          }
          setCreated((c) => ({ ...c, carouselImageIds }));
        }
      }

      // 4. Ad (only if we have an identity + a media asset)
      if (!adId && form.identityId && (videoId || imageId || carouselImageIds.length >= MIN_CAROUSEL_IMAGES)) {
        // Send the SELECTED identity's actual type — TikTok rejects an ad if
        // identity_type doesn't match the identity_id (e.g. a real linked
        // TT_USER/BC_AUTH_TT account submitted as CUSTOMIZED_USER). Fall back to
        // CUSTOMIZED_USER only if the type can't be resolved from the list.
        const selectedIdentity = identities.find((i) => i.identityId === form.identityId);
        const creative = {
          ad_name: form.adName || form.campaignName,
          identity_id: form.identityId,
          identity_type: selectedIdentity?.identityType || 'CUSTOMIZED_USER',
          // A BC-authorized TikTok account (BC_AUTH_TT) must also carry the
          // Business Center id that authorized it, or TikTok rejects the ad
          // with "Identity_type and Identity_bc_ID don't match". The backend
          // surfaces it as authorizedBcId from /identity/get/.
          ...(selectedIdentity?.identityType === 'BC_AUTH_TT' && selectedIdentity?.authorizedBcId
            ? { identity_authorized_bc_id: String(selectedIdentity.authorizedBcId) }
            : {}),
          ad_text: form.adText,
          // A CTA may only be sent alongside a destination (TikTok pairs
          // External_URL + Call_to_action). Objectives with no ad-level
          // destination — Reach, Video Views, App promotion, Engagement/Follow
          // — must omit call_to_action entirely.
          ...(adHasDestination(form) ? { call_to_action: form.cta } : {}),
          // Community Interaction's "TikTok page visits" goal picks one of 3
          // destinations; Lead-gen instant-form ads route to a TikTok page;
          // objectives that drive to a website send the landing URL;
          // Engagement/Follow and App promotion take neither.
          ...(isEngagementPageVisit(form.objectiveKey, form.optimizationGoal)
            ? {
                tiktok_page_category: form.tiktokPageCategory,
                ...(form.tiktokPageCategory === 'OTHER_TIKTOK_PAGE' && form.landingPageUrl
                  ? { landing_page_url: form.landingPageUrl }
                  : {}),
                ...(form.tiktokPageCategory === 'TIKTOK_INSTANT_PAGE' && form.pageId
                  ? { page_id: Number(form.pageId) }
                  : {}),
              }
            : isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsForm(form.leadGenSubType) && form.pageId
            ? { page_id: Number(form.pageId) }
            : isProductSales(form.objectiveKey) && productSalesSubTypeNeedsForm(form.productSalesSubType) && form.pageId
            ? { page_id: Number(form.pageId) }
            : objectiveNeedsLandingUrl(form.objectiveKey, form.leadGenSubType || form.productSalesSubType) && form.landingPageUrl
            ? { landing_page_url: form.landingPageUrl }
            : {}),
          ...(form.impressionTrackingUrl ? { impression_tracking_url: form.impressionTrackingUrl } : {}),
          ...(form.clickTrackingUrl ? { click_tracking_url: form.clickTrackingUrl } : {}),
        };

        if (form.mediaType === 'video' && videoId) {
          creative.ad_format = 'SINGLE_VIDEO';
          creative.video_id = videoId;
          // A SINGLE_VIDEO ad also needs a cover image, supplied via image_ids
          // — otherwise TikTok rejects with "You must upload an image." The
          // cover image id comes from the video upload (suggestcover).
          if (videoCoverImageId) creative.image_ids = [videoCoverImageId];
        } else if (form.mediaType === 'image' && imageId) {
          creative.ad_format = 'SINGLE_IMAGE';
          creative.image_ids = [imageId];
        } else if (form.mediaType === 'carousel' && carouselImageIds.length >= MIN_CAROUSEL_IMAGES) {
          creative.ad_format = 'CAROUSEL_ADS';
          creative.image_ids = carouselImageIds;
        }

        // Carousel and Reach image ads require a music track.
        if (mediaTypeNeedsMusic(form.objectiveKey, form.mediaType) && form.musicId) {
          creative.music_id = String(form.musicId);
        }

        const res = await createTiktokAd({
          advertiserId,
          adgroupId,
          creatives: [creative],
        });
        adId = res.adIds?.[0];
        setCreated((c) => ({ ...c, adId }));
      }

      toast.success(adId ? 'Campaign, ad group & ad created!' : 'Campaign & ad group created!');
      onCreated?.();
      onClose();
    } catch (err) {
      const rawMsg = err.response?.data?.error || err.message || 'Failed to create';
      const msg = formatFriendlyError(rawMsg);
      setError(msg);
      toast.error(msg);

      const fieldErr = mapApiErrorToField(rawMsg);
      if (fieldErr) {
        setErrors((prev) => ({
          ...prev,
          [fieldErr.field]: fieldErr.message,
        }));
        if (fieldErr.step) {
          setStep(fieldErr.step);
        }
      }
    } finally {
      setLaunching(false);
      inFlightRef.current = false;
    }
  };

  // Create a new TikTok pixel from the ad-group step and auto-select it.
  const handleCreatePixel = async () => {
    const name = newPixelName.trim();
    if (!name || !advertiserId) return;
    setCreatingPixel(true);
    try {
      const res = await createTiktokPixel({ advertiserId, name, pixelType: 'TT_WEB_PIXEL' });
      const createdPixel = res?.pixel;
      if (createdPixel?.id) {
        setPixels((prev) => [...prev, createdPixel]);
        update({ pixelId: String(createdPixel.id) });
        setNewPixelName('');
        toast.success(`Pixel "${createdPixel.name || name}" created`);
      } else {
        throw new Error('Pixel creation did not return an ID');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to create pixel');
    } finally {
      setCreatingPixel(false);
    }
  };

  // ── step bodies ──
  const renderStep = () => {
    switch (step) {
      case 0: // Objective
        return (
          <div className="space-y-4">
            {isCreate && <TemplatePicker onApply={applyTemplate} />}
            {Object.entries(schema?.objectivesByGroup || {}).map(([group, objs]) => (
              <div key={group}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {objs.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => pickObjective(o)}
                      className={`rounded-xl border p-3 text-left transition ${
                        form.objectiveKey === o.key
                          ? 'border-[#15DCFF] bg-[#15DCFF]/10'
                          : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-500'
                      }`}
                    >
                      <p className="text-sm font-medium">{o.label}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{o.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {errors.objectiveKey && (
              <p className="text-xs text-red-500">{errors.objectiveKey}</p>
            )}
            {isLeadGeneration(form.objectiveKey) && (
              <div className="space-y-2 rounded-xl border border-[#15DCFF]/20 bg-[#15DCFF]/5 p-3 dark:bg-[#15DCFF]/5">
                <p className="text-xs font-semibold text-[#15DCFF]">Lead generation path</p>
                <div className="flex flex-wrap gap-2">
                  {LEAD_SUB_TYPES.map((st) => (
                    <button
                      key={st.key}
                      type="button"
                      onClick={() =>
                        update({
                          leadGenSubType: st.key,
                          optimizationGoal: st.key === 'INSTANT_FORM' ? 'LEADS' : 'CONVERT',
                          pageId: '',
                          pixelId: '',
                          optimizationEvent: '',
                        })
                      }
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        form.leadGenSubType === st.key
                          ? 'bg-[#15DCFF] text-white'
                          : 'border border-gray-300 bg-white text-gray-600 hover:border-gray-400 dark:border-white/10 dark:bg-[#1d1d1d] dark:text-white/70'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
                {errors.leadGenSubType && <p className="text-xs text-red-500">{errors.leadGenSubType}</p>}
              </div>
            )}
            {isProductSales(form.objectiveKey) && (
              <div className="space-y-2 rounded-xl border border-[#15DCFF]/20 bg-[#15DCFF]/5 p-3 dark:bg-[#15DCFF]/5">
                <p className="text-xs font-semibold text-[#15DCFF]">Sales destination</p>
                <div className="flex flex-wrap gap-2">
                  {PRODUCT_SALES_SUB_TYPES.map((st) => (
                    <button
                      key={st.key}
                      type="button"
                      onClick={() =>
                        update({
                          productSalesSubType: st.key,
                          objectiveType: st.key === 'WEBSITE' ? 'WEB_CONVERSIONS' : 'PRODUCT_SALES',
                          optimizationGoal: 'CONVERT',
                          pageId: '',
                          pixelId: '',
                          optimizationEvent: '',
                        })
                      }
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        form.productSalesSubType === st.key
                          ? 'bg-[#15DCFF] text-white'
                          : 'border border-gray-300 bg-white text-gray-600 hover:border-gray-400 dark:border-white/10 dark:bg-[#1d1d1d] dark:text-white/70'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
                {errors.productSalesSubType && (
                  <p className="text-xs text-red-500">{errors.productSalesSubType}</p>
                )}
              </div>
            )}
            {isAppPromotion(form.objectiveKey) && (
              <div className="space-y-2 rounded-xl border border-[#15DCFF]/20 bg-[#15DCFF]/5 p-3 dark:bg-[#15DCFF]/5">
                <p className="text-xs font-semibold text-[#15DCFF]">App promotion type</p>
                <div className="flex flex-wrap gap-2">
                  {APP_PROMOTION_TYPES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => update({ appPromotionType: t.key })}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        form.appPromotionType === t.key
                          ? 'bg-[#15DCFF] text-white'
                          : 'border border-gray-300 bg-white text-gray-600 hover:border-gray-400 dark:border-white/10 dark:bg-[#1d1d1d] dark:text-white/70'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {errors.appPromotionType && <p className="text-xs text-red-500">{errors.appPromotionType}</p>}
              </div>
            )}
            {OBJECTIVE_ASSET_NOTE[form.objectiveKey] && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <span className="font-semibold">Heads up:</span>{' '}
                {OBJECTIVE_ASSET_NOTE[form.objectiveKey]} It won&apos;t create until that&apos;s set
                up in TikTok Ads Manager.
              </div>
            )}
          </div>
        );

      case 1: // Campaign
        return (
          <div className="space-y-4">
            <TextField
              label="Campaign name"
              value={form.campaignName}
              onChange={(v) => update({ campaignName: v })}
              placeholder="e.g. Summer Traffic Campaign"
              required
              error={errors.campaignName}
            />
            <FieldShell
              label="Special ad categories"
              hint="Select if your ad is related to housing, employment, credit, or politics. Leave empty for standard ads."
            >
              <div className="flex flex-wrap gap-2">
                {SPECIAL_INDUSTRIES.map((opt) => {
                  const active = form.specialIndustries.includes(opt.value);
                  return (
                    <div
                      key={opt.value}
                      className={`rounded-full p-[1px] transition-all ${
                        active
                          ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                          : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const next = active
                            ? form.specialIndustries.filter((v) => v !== opt.value)
                            : [...form.specialIndustries, opt.value];
                          update({ specialIndustries: next });
                        }}
                        className={`flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium transition-all dark:bg-[#1d1d1d] ${
                          active ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-white/55'
                        }`}
                      >
                        {active && <Check className="h-3 w-3" />}
                        {opt.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            </FieldShell>
            {!isEdit && (
              <ToggleField
                label="Campaign Budget Optimisation (CBO)"
                description="Set the budget on the campaign and let TikTok distribute across ad groups. Otherwise each ad group has its own budget."
                value={form.budgetOptimizeOn}
                onChange={(v) => update({ budgetOptimizeOn: v })}
              />
            )}

            {form.budgetOptimizeOn && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {isEdit ? (
                  <FieldShell label="Budget type">
                    <div className="rounded-full border border-gray-200 bg-gray-100 px-4 py-2.5 text-13 text-gray-600 dark:border-white/10 dark:bg-white/3 dark:text-white/70">
                      {form.budgetMode === 'BUDGET_MODE_DAY' ? 'Daily budget' : 'Lifetime budget'}
                      <span className="ml-2 text-gray-400 dark:text-white/35">· can’t be changed</span>
                    </div>
                  </FieldShell>
                ) : (
                  <FieldShell label="Budget type *" required>
                    <SegGroup
                      value={form.budgetMode}
                      onChange={(v) => update({ budgetMode: v })}
                      options={[
                        { value: 'BUDGET_MODE_DAY', label: 'Daily budget' },
                        { value: 'BUDGET_MODE_TOTAL', label: 'Lifetime budget' },
                      ]}
                    />
                  </FieldShell>
                )}
                <CurrencyField
                  label={form.budgetMode === 'BUDGET_MODE_DAY' ? 'Daily budget *' : 'Lifetime budget *'}
                  required
                  symbol={currencySymbol(currency)}
                  value={form.budget}
                  onChange={(v) => update({ budget: v })}
                  placeholder="100"
                  error={errors.budget}
                />
              </div>
            )}

            <CurrencyField
              label="Campaign spending limit (optional)"
              hint="Once this total spend is reached, TikTok auto-pauses the campaign."
              symbol={currencySymbol(currency)}
              value={form.spendCap}
              onChange={(v) => update({ spendCap: v })}
              placeholder="e.g. 50000"
              error={errors.spendCap}
            />
          </div>
        );

      case 2: // Ad Group
        return (
          <div className="space-y-4">
            <TextField
              label="Ad group name"
              value={form.adgroupName}
              onChange={(v) => update({ adgroupName: v })}
              placeholder="e.g. US - 18-34"
              required
              error={errors.adgroupName}
            />
            <SelectField
              label="Optimization goal"
              value={form.optimizationGoal}
              onChange={(v) => update({ optimizationGoal: v })}
              options={getOptimizationGoalsForObjective(
                form.objectiveKey,
                form.leadGenSubType,
                form.productSalesSubType,
                currentObjective
              ).map((g) => ({
                value: g,
                label: OPTIMIZATION_GOAL_LABELS[g] || g,
              }))}
              required
              error={errors.optimizationGoal}
            />

            {needsPixel && (
              <div className="space-y-3 rounded-xl border border-[#15DCFF]/20 bg-[#15DCFF]/5 p-3 dark:bg-[#15DCFF]/5">
                <p className="text-xs font-semibold text-[#15DCFF]">Conversion tracking</p>
                {loadingPixels ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading pixels…
                  </div>
                ) : (
                  <>
                    {pixels.length > 0 ? (
                      <SelectField
                        label="TikTok Pixel"
                        value={form.pixelId}
                        onChange={(v) => update({ pixelId: v })}
                        options={[
                          { value: '', label: '— select pixel —' },
                          ...pixels.map((p) => ({ value: String(p.id), label: p.name || String(p.id) })),
                        ]}
                        required
                        error={errors.pixelId}
                      />
                    ) : (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                        No pixels found for this ad account. Create one below or set up in TikTok Ads Manager.
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newPixelName}
                        onChange={(e) => setNewPixelName(e.target.value)}
                        placeholder="New pixel name"
                        className="flex-1 rounded-full border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs text-gray-900 outline-none focus:border-gray-400 dark:border-white/5 dark:bg-[#909294]/15 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={handleCreatePixel}
                        disabled={creatingPixel || !newPixelName.trim()}
                        className="rounded-full bg-gray-900 px-3 py-1.5 text-xs font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
                      >
                        {creatingPixel ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create pixel'}
                      </button>
                    </div>
                    <SelectField
                      label="Optimization event"
                      value={form.optimizationEvent}
                      onChange={(v) => update({ optimizationEvent: v })}
                      options={[
                        { value: '', label: '— select event —' },
                        ...(PIXEL_EVENTS_BY_OBJECTIVE[form.objectiveKey] || []),
                      ]}
                      required
                      error={errors.optimizationEvent}
                    />
                  </>
                )}
              </div>
            )}

            <MultiSelectField
              label="Placements (optional)"
              hint="Leave empty or select TikTok only for standard campaigns."
              values={form.placements}
              onChange={(v) => update({ placements: v.length ? v : ['PLACEMENT_TIKTOK'] })}
              options={PLACEMENTS}
            />
            <MultiSelectField
              label="Device type (optional)"
              hint="Leave empty to target all devices."
              values={form.deviceTypes}
              onChange={(v) => update({ deviceTypes: v })}
              options={DEVICE_TYPES}
            />
            {/* Ad groups share the campaign budget ONLY under Campaign Budget
                Optimization (CBO). When CBO is off, TikTok requires each ad
                group to set its own budget — even if a non-optimized campaign
                budget was also set. So the "inherited" display is CBO-only. */}
            {form.budgetOptimizeOn ? (
              <FieldShell label="Budget">
                <div className="rounded-full border border-gray-200 bg-gray-100 px-4 py-2.5 text-13 text-gray-600 dark:border-white/10 dark:bg-white/3 dark:text-white/70">
                  From campaign settings:{' '}
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {form.budgetMode === 'BUDGET_MODE_TOTAL' ? 'Lifetime budget' : 'Daily budget'} · {currencySymbol(currency)} {form.budget}
                  </span>{' '}
                  <span className="text-gray-400 dark:text-white/40">· CBO enabled</span>
                </div>
              </FieldShell>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FieldShell label="Budget type *" required>
                  <SegGroup
                    value={form.adgroupBudgetMode}
                    onChange={(v) => update({ adgroupBudgetMode: v })}
                    options={[
                      { value: 'BUDGET_MODE_DAY', label: 'Daily budget' },
                      { value: 'BUDGET_MODE_TOTAL', label: 'Lifetime budget' },
                    ]}
                  />
                </FieldShell>
                <CurrencyField
                  label={form.adgroupBudgetMode === 'BUDGET_MODE_TOTAL' ? 'Lifetime budget *' : 'Daily budget *'}
                  required
                  symbol={currencySymbol(currency)}
                  value={form.adgroupBudget}
                  onChange={(v) => update({ adgroupBudget: v })}
                  placeholder="20"
                  error={errors.adgroupBudget}
                />
              </div>
            )}
            {form.optimizationGoal === 'REACH' && (
              <FieldShell
                label="Frequency cap (required for Reach)"
                hint="Controls how often the same person sees your ad."
              >
                <div className="space-y-3">
                  {[
                    { label: 'Show ads no more than 2 times every 7 days', frequency: 2, frequencySchedule: 7 },
                    { label: 'Show ads no more than 3 times every 7 days', frequency: 3, frequencySchedule: 7 },
                    { label: 'Show ads no more than 4 times every 7 days', frequency: 4, frequencySchedule: 7 },
                    { label: 'Custom frequency cap', frequency: null, frequencySchedule: null },
                  ].map((opt) => {
                    const isCustom = opt.frequency === null;
                    const isSelected = isCustom
                      ? ![2, 3, 4].includes(Number(form.frequency)) || Number(form.frequencySchedule) !== 7
                      : Number(form.frequency) === opt.frequency && Number(form.frequencySchedule) === opt.frequencySchedule;
                    return (
                      <label key={opt.label} className="flex cursor-pointer items-center gap-2.5">
                        <div
                          onClick={() => {
                            if (!isCustom) update({ frequency: opt.frequency, frequencySchedule: opt.frequencySchedule });
                            else update({ frequency: 1, frequencySchedule: 1 });
                          }}
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition ${
                            isSelected
                              ? 'border-[#15DCFF] bg-[#15DCFF]'
                              : 'border-gray-300 dark:border-white/20'
                          }`}
                        >
                          {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>
                        <span
                          className="text-xs text-gray-700 dark:text-white/80"
                          onClick={() => {
                            if (!isCustom) update({ frequency: opt.frequency, frequencySchedule: opt.frequencySchedule });
                            else update({ frequency: 1, frequencySchedule: 1 });
                          }}
                        >
                          {opt.label}
                        </span>
                      </label>
                    );
                  })}
                  {(![2, 3, 4].includes(Number(form.frequency)) || Number(form.frequencySchedule) !== 7) && (
                    <div className="flex items-center gap-2 pl-6">
                      <span className="text-xs text-gray-500">Show at most</span>
                      <input
                        type="number"
                        className="w-16 rounded-full border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-white/5 dark:bg-[#909294]/15 dark:text-white"
                        value={form.frequency}
                        onChange={(e) => update({ frequency: e.target.value })}
                        min={1}
                      />
                      <span className="text-xs text-gray-500">times every</span>
                      <input
                        type="number"
                        className="w-16 rounded-full border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-white/5 dark:bg-[#909294]/15 dark:text-white"
                        value={form.frequencySchedule}
                        onChange={(e) => update({ frequencySchedule: e.target.value })}
                        min={1}
                      />
                      <span className="text-xs text-gray-500">days</span>
                    </div>
                  )}
                </div>
              </FieldShell>
            )}
            <SearchableMultiSelectField
              label="Locations"
              icon={Globe}
              placeholder="Search countries or regions (e.g. United States, France)..."
              emptyHint="No selection targets Worldwide (all locations)"
              values={form.locationIds}
              onChange={(v) => update({ locationIds: v })}
              options={regions.map((r) => ({ value: r.id, label: r.name }))}
              error={errors.locationIds}
              presets={locationPresets}
            />
            {form.specialIndustries?.length > 0 ? (
              <FieldShell
                label="Age groups"
                hint="Age targeting is locked to All (18+) for Special Ad Categories to comply with advertising non-discrimination policies."
              >
                <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  All ages (18+) · Policy-locked by Special Ad Category
                </div>
              </FieldShell>
            ) : (
              <MultiSelectField
                label="Age groups"
                values={form.ageGroups}
                onChange={(v) => update({ ageGroups: v })}
                options={AGE_GROUPS}
              />
            )}

            {form.specialIndustries?.length > 0 ? (
              <FieldShell
                label="Gender"
                hint="Gender targeting is locked to All for Special Ad Categories."
              >
                <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  All genders · Policy-locked by Special Ad Category
                </div>
              </FieldShell>
            ) : (
              <SelectField
                label="Gender"
                value={form.gender}
                onChange={(v) => update({ gender: v })}
                options={GENDERS}
              />
            )}
            <SearchableMultiSelectField
              label="Interest categories"
              icon={Tag}
              placeholder="Search interest categories (e.g. Tech, Beauty, Travel)..."
              emptyHint="No selection targets all audience interests"
              values={form.interestCategoryIds}
              onChange={(v) => update({ interestCategoryIds: v })}
              options={interestCategories.map((c) => ({
                value: String(c.id),
                label: c.name || c.raw?.interest_category_name || String(c.id),
              }))}
              presets={interestCategoryPresets}
            />
            <SearchableMultiSelectField
              label="Languages (optional)"
              icon={LanguagesIcon}
              placeholder="Search languages (e.g. English, Spanish, Hindi)..."
              emptyHint="Leave empty to target all languages"
              values={form.languages}
              onChange={(v) => update({ languages: v })}
              options={LANGUAGES}
              presets={languagePresets}
            />
            <FieldShell label="Spending power">
              <div className="flex gap-2">
                {[{ value: 'ALL', label: 'All' }, { value: 'HIGH', label: 'High spending power' }].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update({ spendingPower: opt.value })}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                      form.spendingPower === opt.value
                        ? 'bg-[#15DCFF] text-white'
                        : 'border border-gray-300 bg-white text-gray-600 hover:border-gray-400 dark:border-white/10 dark:bg-[#1d1d1d] dark:text-white/70'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </FieldShell>
            {/* <SelectField
              label="Brand safety and suitability"
              hint="Controls what type of content your TikTok in-feed ads can appear next to."
              value={form.brandSafetyType}
              onChange={(v) => update({ brandSafetyType: v })}
              options={BRAND_SAFETY_TYPES}
            /> */}
            {billingEventForGoal(form.optimizationGoal, form.bidType) === 'CPC' ? (
              <SelectField
                label="Bid type"
                value="BID_TYPE_CUSTOM"
                disabled
                hint="TikTok requires a custom CPC (Cost per Click) bid for Click optimization."
                options={[{ value: 'BID_TYPE_CUSTOM', label: 'Custom bid (CPC)' }]}
              />
            ) : (
              <SelectField
                label="Bid type"
                value={form.bidType}
                onChange={(v) => update({ bidType: v })}
                options={BID_TYPES}
              />
            )}
            {(form.bidType === 'BID_TYPE_CUSTOM' || billingEventForGoal(form.optimizationGoal, form.bidType) === 'CPC') && (
              <NumberField
                label={`Bid price (${currency})`}
                value={form.bidPrice}
                onChange={(v) => update({ bidPrice: v })}
                min={0.01}
                step={0.01}
                placeholder="e.g. 0.20"
                hint="Maximum amount you are willing to pay per click"
                required
                error={errors.bidPrice}
              />
            )}
            {/* Schedule is a radio: run continuously (start only) vs a fixed
                start+end. A lifetime budget forces the start-end mode. TikTok
                always requires a start time regardless of mode. */}
            <FieldShell label="Schedule">
              <div className="flex flex-col gap-2">
                {[
                  { value: 'SCHEDULE_FROM_NOW', label: 'Run ad group continuously' },
                  { value: 'SCHEDULE_START_END', label: 'Set start and end time' },
                ].map((opt) => {
                  const locked = lifetimeForcesStartEnd(form);
                  const disabled = locked && opt.value === 'SCHEDULE_FROM_NOW';
                  const checked = effectiveScheduleType(form) === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 text-sm ${
                        disabled ? 'cursor-not-allowed text-gray-400 dark:text-white/30' : 'cursor-pointer text-gray-700 dark:text-white/80'
                      }`}
                    >
                      <input
                        type="radio"
                        name="scheduleType"
                        value={opt.value}
                        checked={checked}
                        disabled={disabled}
                        onChange={() =>
                          update({
                            scheduleType: opt.value,
                            // Leaving start-end clears the end date.
                            ...(opt.value === 'SCHEDULE_FROM_NOW' ? { scheduleEndTime: '' } : {}),
                          })
                        }
                        className="accent-[#15DCFF]"
                      />
                      {opt.label}
                      {disabled && <span className="text-xs">(lifetime budget needs an end date)</span>}
                    </label>
                  );
                })}
              </div>
            </FieldShell>

            <FieldShell
              label="Planned start time"
              hint="TikTok requires a start time. Set when the ad group begins delivering."
              required
              error={errors.scheduleStartTime}
            >
              <input
                type="datetime-local"
                className={`w-full rounded-full border bg-gray-100 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:bg-[#909294]/15 dark:text-white ${
                  errors.scheduleStartTime ? 'border-red-500' : 'border-gray-300 dark:border-white/5'
                }`}
                style={{ colorScheme: 'dark' }}
                min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                value={form.scheduleStartTime}
                onChange={(e) => {
                  // Changing start clears an end that would now be before it.
                  const patch = { scheduleStartTime: e.target.value };
                  if (form.scheduleEndTime && new Date(form.scheduleEndTime) <= new Date(e.target.value)) {
                    patch.scheduleEndTime = '';
                  }
                  update(patch);
                }}
              />
              {timezone && (
                <p className="mt-1.5 text-xs text-gray-400 dark:text-white/35">
                  Time zone: {timezone}
                </p>
              )}
            </FieldShell>

            {scheduleNeedsEndDate(form) && (
              <FieldShell label="Planned end time" required error={errors.scheduleEndTime}>
                <input
                  type="datetime-local"
                  className={`w-full rounded-full border bg-gray-100 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:bg-[#909294]/15 dark:text-white ${
                    errors.scheduleEndTime ? 'border-red-500' : 'border-gray-300 dark:border-white/5'
                  }`}
                  style={{ colorScheme: 'dark' }}
                  min={
                    form.scheduleStartTime
                      ? new Date(new Date(form.scheduleStartTime).getTime() + 60000).toISOString().slice(0, 16)
                      : new Date(Date.now() + 60000).toISOString().slice(0, 16)
                  }
                  value={form.scheduleEndTime}
                  onChange={(e) => update({ scheduleEndTime: e.target.value })}
                />
              </FieldShell>
            )}
          </div>
        );

      case 3: // Ad
        return (
          <div className="space-y-4">
            <TextField
              label="Ad name"
              value={form.adName}
              onChange={(v) => update({ adName: v })}
              placeholder={`Ad name${new Date().toISOString().slice(0, 16).replace('T', ' ')}`}
              hint="Used to identify this ad in your dashboard. Not shown to the audience."
              required
              error={errors.adName}
            />
            {identities.length === 0 && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                No TikTok identity found. Link a TikTok account to your ad account to create ads.
              </div>
            )}
            <SelectField
              label="Identity (post as)"
              value={form.identityId}
              onChange={(v) => update({ identityId: v })}
              required
              error={errors.identityId}
              options={[
                { value: '', label: '— none —' },
                ...identities.map((i) => ({ value: i.identityId, label: i.displayName || i.identityId })),
              ]}
            />

            <FieldShell
              label="Media"
              required
              error={errors.video || errors.image || errors.carousel}
              hint={
                libraryMode
                  ? 'Pick any image or video from your generated-media library'
                  : currentObjective?.videoOnly
                  ? 'MP4 / MOV / WEBM up to 100 MB'
                  : form.mediaType === 'video'
                  ? 'MP4 / MOV / WEBM up to 100 MB'
                  : form.mediaType === 'image'
                  ? 'JPG or PNG up to 10 MB'
                  : 'Swipeable carousel of images'
              }
            >
              <div className="flex flex-col gap-3">
                {/* Source: From library ⇄ Upload / URL */}
                <div className="flex items-stretch gap-2 max-w-xs">
                  <SegButton active={libraryMode} onClick={() => setLibraryMode(true)}>
                    From library
                  </SegButton>
                  <SegButton active={!libraryMode} onClick={() => setLibraryMode(false)}>
                    Upload / URL
                  </SegButton>
                </div>

                {libraryMode ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4 2xl:p-4">
                    <LibraryPicker
                      type={currentObjective?.videoOnly ? 'video' : 'all'}
                      selectedUrl={form.mediaType === 'video' ? form.videoUrl : form.imageUrl}
                      onPick={(absoluteUrl, doc) => {
                        if (doc?.type === 'video') {
                          update({
                            mediaType: 'video',
                            videoUrl: absoluteUrl,
                            videoFile: null,
                            imageFile: null,
                            imageUrl: '',
                            carouselFiles: [],
                          });
                        } else {
                          update({
                            mediaType: 'image',
                            imageUrl: absoluteUrl,
                            imageFile: null,
                            videoFile: null,
                            videoUrl: '',
                            carouselFiles: [],
                          });
                        }
                      }}
                    />
                  </div>
                ) : (
                  <>
                    {!currentObjective?.videoOnly && (
                      <div className="flex items-stretch gap-2 max-w-xs">
                        <SegButton
                          active={form.mediaType === 'video'}
                          onClick={() => update({ mediaType: 'video', imageFile: null, imageUrl: '', carouselFiles: [] })}
                        >
                          Video
                        </SegButton>
                        <SegButton
                          active={form.mediaType === 'image'}
                          onClick={() => update({ mediaType: 'image', videoFile: null, videoUrl: '', carouselFiles: [] })}
                        >
                          Image
                        </SegButton>
                        {form.objectiveKey !== 'REACH' && (
                          <SegButton
                            active={form.mediaType === 'carousel'}
                            onClick={() => update({ mediaType: 'carousel', videoFile: null, videoUrl: '', imageFile: null, imageUrl: '' })}
                          >
                            Carousel
                          </SegButton>
                        )}
                      </div>
                    )}

                    {(currentObjective?.videoOnly || form.mediaType === 'video') && (
                      <>
                        <TextField
                          label="Video URL (mp4)"
                          value={form.videoUrl}
                          onChange={(v) => update({ videoUrl: v })}
                          placeholder="https://.../video.mp4"
                        />
                        <FieldShell label="Or upload video file">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 dark:bg-white dark:text-black 2xl:text-sm">
                              Upload video
                              <input
                                type="file"
                                accept="video/mp4,video/quicktime,video/webm"
                                onChange={(e) => handleVideoFileSelect(e.target.files?.[0] || null)}
                                className="hidden"
                              />
                            </label>
                            <span className="text-[11px] text-gray-400 dark:text-white/45">MP4 / MOV / WEBM</span>
                          </div>
                        </FieldShell>
                      </>
                    )}

                    {!currentObjective?.videoOnly && form.mediaType === 'image' && (
                      <>
                        <TextField
                          label="Image URL"
                          value={form.imageUrl}
                          onChange={(v) => update({ imageUrl: v })}
                          placeholder="https://.../image.jpg"
                        />
                        <FieldShell label="Or upload image file">
                          <div className="flex flex-wrap items-center gap-2" onPaste={handleImagePaste} tabIndex={0}>
                            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 dark:bg-white dark:text-black 2xl:text-sm">
                              Upload image
                              <input
                                type="file"
                                accept="image/jpeg,image/png"
                                onChange={(e) => handleImageFileSelect(e.target.files?.[0] || null)}
                                className="hidden"
                              />
                            </label>
                            <span className="text-[11px] text-gray-400 dark:text-white/45">JPG / PNG</span>
                          </div>
                        </FieldShell>
                      </>
                    )}

                    {!currentObjective?.videoOnly && form.mediaType === 'carousel' && (
                      <FieldShell
                        label={`Carousel images (${form.carouselFiles.length}/${MAX_CAROUSEL_IMAGES})`}
                        hint={`Upload ${MIN_CAROUSEL_IMAGES}-${MAX_CAROUSEL_IMAGES} images. TikTok shows them in this order as a swipeable carousel.`}
                      >
                        {form.carouselFiles.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {form.carouselFiles.map((file, i) => (
                              <div key={`${file.name}-${i}`} className="relative">
                                <img
                                  src={URL.createObjectURL(file)}
                                  alt={`Carousel image ${i + 1}`}
                                  className="h-16 w-16 rounded-lg object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeCarouselFile(i)}
                                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-white hover:bg-red-600"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {form.carouselFiles.length < MAX_CAROUSEL_IMAGES && (
                          <div className="flex flex-wrap items-center gap-2" onPaste={handleCarouselPaste} tabIndex={0}>
                            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 dark:bg-white dark:text-black 2xl:text-sm">
                              Add images
                              <input
                                type="file"
                                accept="image/jpeg,image/png"
                                multiple
                                onChange={(e) => handleCarouselFilesSelect(e.target.files)}
                                className="hidden"
                              />
                            </label>
                            <span className="text-[11px] text-gray-400 dark:text-white/45">Select multiple JPG / PNG</span>
                          </div>
                        )}
                      </FieldShell>
                    )}
                  </>
                )}

                {/* Show selected media preview if any image/video selected */}
                {(form.videoFile || form.videoUrl) && (
                  <FieldShell label="Selected video preview">
                    <MediaPreview
                      file={form.videoFile}
                      url={form.videoUrl}
                      type="video"
                      onRemove={() => {
                        update({ videoFile: null, videoUrl: '' });
                        setVideoWarning('');
                      }}
                    />
                    {videoWarning && <p className="mt-1 text-xs text-amber-500">{videoWarning}</p>}
                  </FieldShell>
                )}

                {(form.imageFile || form.imageUrl) && (
                  <FieldShell label="Selected image preview">
                    <MediaPreview
                      file={form.imageFile}
                      url={form.imageUrl}
                      type="image"
                      onRemove={() => update({ imageFile: null, imageUrl: '' })}
                    />
                  </FieldShell>
                )}
              </div>
            </FieldShell>

            {mediaTypeNeedsMusic(form.objectiveKey, form.mediaType) && (
              <FieldShell
                label="Music"
                hint="TikTok requires a music track for this ad format. Pick from the library or upload your own (mp3/wav/m4a/flac, ≤10MB)."
              >
                {loadingMusic ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading music…
                  </div>
                ) : (
                  <>
                    {musicList.length > 0 && (
                      <SelectField
                        label="Select music"
                        value={form.musicId}
                        onChange={(v) => update({ musicId: v, musicFile: null })}
                        options={[
                          { value: '', label: '— select music —' },
                          ...musicList.map((m) => ({
                            value: String(m.musicId),
                            label: m.author ? `${m.name} · ${m.author}` : m.name || String(m.musicId),
                          })),
                        ]}
                        required
                        error={errors.music}
                      />
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black 2xl:text-sm">
                        {uploadingMusic ? 'Uploading…' : 'Upload music'}
                        <input
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/x-m4a,audio/flac,.mp3,.wav,.m4a,.flac"
                          disabled={uploadingMusic}
                          onChange={(e) => handleMusicFileSelect(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                      </label>
                      <span className="text-[11px] text-gray-400 dark:text-white/45">MP3 / WAV / M4A / FLAC</span>
                    </div>
                    {musicList.length === 0 && !form.musicId && (
                      <p className="mt-1 text-[11px] text-gray-400 dark:text-white/45">
                        No library music loaded — upload your own track above.
                      </p>
                    )}
                    {errors.music && musicList.length === 0 && (
                      <p className="mt-1 text-xs text-red-500">{errors.music}</p>
                    )}
                  </>
                )}
              </FieldShell>
            )}

            <TextField
              label="Ad text"
              value={form.adText}
              onChange={(v) => update({ adText: v })}
              placeholder="Check out our product!"
              required={adTextIsRequired(form.objectiveKey, form.mediaType)}
              error={errors.adText}
              hint={`${form.adText.length}/${adTextMaxLength(form.adText)} characters`}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* A CTA can only be sent with a destination, so only show it for
                  objectives that can carry one. Reach / Video Views / App
                  promotion / Engagement-Follow have no destination — TikTok
                  rejects a lone CTA ("External_URL and Call_to_action must
                  exist together"). */}
              {objectiveCanHaveDestination(form) && (
                <SelectField
                  label="Call to action"
                  value={form.cta}
                  onChange={(v) => update({ cta: v })}
                  options={(schema?.ctas || ['LEARN_MORE']).map((c) => {
                    const label = c.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
                    return { value: c, label: c === 'LEARN_MORE' ? `${label} (Recommended)` : label };
                  })}
                />
              )}
              {objectiveNeedsLandingUrl(form.objectiveKey, form.leadGenSubType || form.productSalesSubType) && (
                <TextField
                  label="Landing page URL"
                  value={form.landingPageUrl}
                  onChange={(v) => update({ landingPageUrl: v })}
                  placeholder="https://example.com"
                  required
                  error={errors.landingPageUrl}
                />
              )}
            </div>

            {isEngagementPageVisit(form.objectiveKey, form.optimizationGoal) && (
              <div className="space-y-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 dark:bg-blue-500/5">
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">Destination</p>
                <SelectField
                  label="TikTok page"
                  value={form.tiktokPageCategory}
                  onChange={(v) => update({ tiktokPageCategory: v })}
                  options={TIKTOK_PAGE_CATEGORIES}
                />
                {form.tiktokPageCategory === 'OTHER_TIKTOK_PAGE' && (
                  <TextField
                    label="TikTok page URL"
                    value={form.landingPageUrl}
                    onChange={(v) => update({ landingPageUrl: v })}
                    placeholder="https://www.tiktok.com/..."
                    hint="Copy this from a Playlist, Hashtag, Music, or Branded Effect page in the TikTok app (top-right menu → copy URL)."
                    required
                    error={errors.landingPageUrl}
                  />
                )}
                {form.tiktokPageCategory === 'TIKTOK_INSTANT_PAGE' && (
                  <TextField
                    label="TikTok Instant Page ID"
                    value={form.pageId}
                    onChange={(v) => update({ pageId: v })}
                    placeholder="e.g. 123456789"
                    hint="Get this from TikTok Ads Manager's Instant Page editor, or from an existing page loaded above."
                    required
                    error={errors.pageId}
                  />
                )}
              </div>
            )}

            {((isLeadGeneration(form.objectiveKey) && leadSubTypeNeedsForm(form.leadGenSubType)) ||
              (isProductSales(form.objectiveKey) && productSalesSubTypeNeedsForm(form.productSalesSubType))) && (
              <div className="space-y-3 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 dark:bg-purple-500/5">
                <p className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                  {isProductSales(form.objectiveKey) ? 'TikTok Instant Page' : 'TikTok Instant Form'}
                </p>
                {loadingLeadForms ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading forms…
                  </div>
                ) : (
                  <>
                    {leadForms.length > 0 ? (
                      <SelectField
                        label={isProductSales(form.objectiveKey) ? 'Instant page' : 'Instant form'}
                        value={form.pageId}
                        onChange={(v) => update({ pageId: v })}
                        options={[
                          { value: '', label: '— select page —' },
                          ...leadForms.map((f) => ({ value: String(f.pageId), label: f.name || String(f.pageId) })),
                        ]}
                        required
                        error={errors.pageId}
                      />
                    ) : (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                        No pages loaded. Paste the Page ID from TikTok Ads Manager (Assets → Instant Page).
                      </div>
                    )}
                    <TextField
                      label="Or enter Page ID manually"
                      value={manualPageId}
                      onChange={(v) => setManualPageId(v)}
                      placeholder="e.g. 123456789"
                      hint="Enter the ID and click Use to select it."
                    />
                    {manualPageId.trim() && (
                      <button
                        type="button"
                        onClick={() => update({ pageId: manualPageId.trim() })}
                        className="rounded-full bg-purple-600 px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
                      >
                        Use {manualPageId.trim()}
                      </button>
                    )}
                    {form.pageId && (
                      <p className="text-xs text-gray-600 dark:text-white/60">
                        Selected Page ID: <span className="font-mono font-medium">{form.pageId}</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <TextField
              label="Impression tracking URL (optional)"
              value={form.impressionTrackingUrl}
              onChange={(v) => update({ impressionTrackingUrl: v })}
              placeholder="https://tracking.example.com/impression"
              hint="Third-party impression tracking pixel URL."
            />
            <TextField
              label="Click tracking URL (optional)"
              value={form.clickTrackingUrl}
              onChange={(v) => update({ clickTrackingUrl: v })}
              placeholder="https://tracking.example.com/click"
              hint="Third-party click tracking URL."
            />
          </div>
        );

      case 4: // Review
        {
          const budgetModeLabel =
            BUDGET_MODES.find((m) => m.value === form.budgetMode)?.label || form.budgetMode;
          const bidTypeLabel =
            BID_TYPES.find((b) => b.value === form.bidType)?.label || form.bidType;
          const genderLabel =
            GENDERS.find((g) => g.value === form.gender)?.label || form.gender;
          const ageGroupLabels = form.ageGroups.length
            ? form.ageGroups
                .map((ag) => AGE_GROUPS.find((a) => a.value === ag)?.label || ag)
                .join(', ')
            : 'All';
          const locationNames = form.locationIds.length
            ? form.locationIds
                .map(
                  (id) => regions.find((r) => String(r.id) === String(id))?.name || String(id)
                )
                .join(', ')
            : '—';
          const interestNames = form.interestCategoryIds.length
            ? form.interestCategoryIds
                .map(
                  (id) =>
                    interestCategories.find((c) => String(c.id) === String(id))?.name || String(id)
                )
                .join(', ')
            : 'None';
          const identityName =
            identities.find((i) => String(i.identityId) === String(form.identityId))?.displayName ||
            form.identityId;
          const hasMedia =
            form.videoFile ||
            form.videoUrl ||
            form.imageFile ||
            form.imageUrl ||
            form.carouselFiles.length >= MIN_CAROUSEL_IMAGES;
          const mediaSource = form.videoFile
            ? form.videoFile.name
            : form.imageFile
            ? form.imageFile.name
            : form.carouselFiles.length
            ? `${form.carouselFiles.length} image${form.carouselFiles.length === 1 ? '' : 's'}`
            : form.videoUrl || form.imageUrl
            ? 'From URL'
            : 'Not selected';

          const issueGroups = activeLaunchSteps
            .map((i) => ({ label: STEPS[i], stepIndex: i, issues: getStepIssues(i, form, selectedObjective, currency) }))
            .filter((g) => g.issues.length > 0);

          return (
            <div className="space-y-4">
              {issueGroups.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <AlertCircle className="h-4 w-4" />
                    Fix {issueGroups.length} step{issueGroups.length > 1 ? 's' : ''} before launching
                  </div>
                  <div className="space-y-2">
                    {issueGroups.map((g) => (
                      <div key={g.label}>
                        <button
                          type="button"
                          onClick={() => setStep(g.stepIndex)}
                          className="font-semibold text-left underline hover:opacity-80 cursor-pointer"
                        >
                          {g.label}
                        </button>
                        <ul className="list-disc pl-4 text-amber-700/80 dark:text-amber-400/80">
                          {g.issues.map((issue, idx) => (
                            <li key={idx}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isCreate && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-400">
                    Your campaign will be created as <span className="font-bold">ACTIVE</span>. TikTok starts
                    delivering after the ad passes review — you can pause or edit anytime from the Campaigns tab.
                  </div>
                  <p className="text-xs text-gray-500 dark:text-white/55">
                    Reuse this setup for future campaigns — budget, account and name stay editable.
                  </p>
                  <SaveAsTemplateChip form={form} advertiserId={advertiserId} />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReviewSection title="Objective">
                  <ReviewField label="Objective" value={selectedObjective?.label} />
                  <ReviewField label="Conversion location" value={form.objectiveType} />
                  {isLeadGeneration(form.objectiveKey) && (
                    <ReviewField
                      label="Lead path"
                      value={LEAD_SUB_TYPES.find((s) => s.key === form.leadGenSubType)?.label}
                    />
                  )}
                  {isProductSales(form.objectiveKey) && (
                    <ReviewField
                      label="Sales destination"
                      value={PRODUCT_SALES_SUB_TYPES.find((s) => s.key === form.productSalesSubType)?.label}
                    />
                  )}
                  {isAppPromotion(form.objectiveKey) && (
                    <ReviewField
                      label="App promotion type"
                      value={APP_PROMOTION_TYPES.find((t) => t.key === form.appPromotionType)?.label}
                    />
                  )}
                  <ReviewField label="Optimization goal" value={form.optimizationGoal} />
                </ReviewSection>

                <ReviewSection title="Campaign">
                  <ReviewField label="Name" value={form.campaignName} />
                  {hasCampaignBudget(form) ? (
                    <>
                      <ReviewField label="Budget mode" value={budgetModeLabel} />
                      <ReviewField label="Budget" value={`${form.budget} ${currency}`} />
                    </>
                  ) : (
                    <ReviewField label="Budget" value="No campaign budget (set at ad group level)" />
                  )}
                  {form.budgetOptimizeOn && (
                    <ReviewField label="Budget optimization" value="Enabled (CBO)" />
                  )}
                  {form.specialIndustries.length > 0 && (
                    <ReviewField
                      label="Special categories"
                      value={form.specialIndustries.map((s) => SPECIAL_INDUSTRIES.find((i) => i.value === s)?.label || s).join(', ')}
                    />
                  )}
                </ReviewSection>

                <ReviewSection title="Ad Group">
                  <ReviewField label="Name" value={form.adgroupName} />
                  <ReviewField
                    label="Placements"
                    value={form.placements.map((p) => PLACEMENTS.find((pl) => pl.value === p)?.label || p).join(', ')}
                  />
                  {form.deviceTypes.length > 0 && (
                    <ReviewField
                      label="Devices"
                      value={form.deviceTypes.map((d) => DEVICE_TYPES.find((dt) => dt.value === d)?.label || d).join(', ')}
                    />
                  )}
                  <ReviewField label="Locations" value={locationNames} />
                  <ReviewField label="Age groups" value={ageGroupLabels} />
                  <ReviewField label="Gender" value={genderLabel} />
                  <ReviewField label="Interests" value={interestNames} />
                  {form.languages.length > 0 && (
                    <ReviewField
                      label="Languages"
                      value={form.languages.map((l) => LANGUAGES.find((lang) => lang.value === l)?.label || l).join(', ')}
                    />
                  )}
                  {form.spendingPower && form.spendingPower !== 'ALL' && (
                    <ReviewField label="Spending power" value="High spending power" />
                  )}
                  {/* {form.brandSafetyType && form.brandSafetyType !== 'NO_BRAND_SAFETY' && (
                    <ReviewField
                      label="Brand safety"
                      value={BRAND_SAFETY_TYPES.find((b) => b.value === form.brandSafetyType)?.label || form.brandSafetyType}
                    />
                  )} */}
                  {form.budgetOptimizeOn ? (
                    <ReviewField label="Budget" value="Shared from campaign (CBO)" />
                  ) : (
                    <>
                      <ReviewField
                        label="Budget mode"
                        value={form.adgroupBudgetMode === 'BUDGET_MODE_TOTAL' ? 'Lifetime budget' : 'Daily budget'}
                      />
                      <ReviewField label="Budget" value={`${form.adgroupBudget} ${currency}`} />
                    </>
                  )}
                  <ReviewField label="Bid type" value={bidTypeLabel} />
                  {form.bidType === 'BID_TYPE_CUSTOM' && form.bidPrice && (
                    <ReviewField label="Bid price" value={`${form.bidPrice} ${currency}`} />
                  )}
                  {form.scheduleStartTime && (
                    <ReviewField
                      label="Schedule start"
                      value={new Date(form.scheduleStartTime).toLocaleString()}
                    />
                  )}
                  {form.scheduleEndTime && (
                    <ReviewField
                      label="Schedule end"
                      value={new Date(form.scheduleEndTime).toLocaleString()}
                    />
                  )}
                  {form.optimizationGoal === 'REACH' && (
                    <ReviewField
                      label="Frequency cap"
                      value={`Show ads no more than ${form.frequency} time(s) every ${form.frequencySchedule} day(s)`}
                    />
                  )}
                  {form.pixelId && (
                    <ReviewField
                      label="TikTok Pixel"
                      value={pixels.find((p) => String(p.id) === String(form.pixelId))?.name || form.pixelId}
                    />
                  )}
                  {form.optimizationEvent && (
                    <ReviewField label="Optimization event" value={form.optimizationEvent} />
                  )}
                  {form.pageId && (
                    <ReviewField
                      label="Instant Form Page ID"
                      value={leadForms.find((f) => String(f.pageId) === String(form.pageId))?.name || form.pageId}
                    />
                  )}
                </ReviewSection>

                <ReviewSection title="Ad" wide>
                  {form.identityId && hasMedia ? (
                    <>
                      <ReviewField label="Name" value={form.adName} />
                      <ReviewField label="Identity" value={identityName} />
                      <ReviewField label="Media type" value={form.mediaType} />
                      <ReviewField label="Media" value={mediaSource} />
                      {mediaTypeNeedsMusic(form.objectiveKey, form.mediaType) && (
                        <ReviewField
                          label="Music"
                          value={
                            musicList.find((m) => String(m.musicId) === String(form.musicId))?.name ||
                            form.musicId ||
                            'Not selected'
                          }
                        />
                      )}
                      <ReviewField label="Ad text" value={form.adText} />
                      {objectiveCanHaveDestination(form) && (
                        <ReviewField label="CTA" value={form.cta} />
                      )}
                      {form.pageId ? (
                        <ReviewField label="Instant Form Page ID" value={form.pageId} />
                      ) : (
                        <ReviewField label="Landing page URL" value={form.landingPageUrl} />
                      )}
                      {form.impressionTrackingUrl && (
                        <ReviewField label="Impression tracking URL" value={form.impressionTrackingUrl} />
                      )}
                      {form.clickTrackingUrl && (
                        <ReviewField label="Click tracking URL" value={form.clickTrackingUrl} />
                      )}
                    </>
                  ) : (
                    <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-white/50">
                      Ad skipped — select an identity and media to create an ad.
                    </div>
                  )}
                </ReviewSection>
              </div>

              {error && (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-600 dark:text-red-400 space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>
                      {created.campaignId && !created.adgroupId
                        ? 'Campaign was created, but Ad Group creation failed'
                        : created.adgroupId && !created.adId
                        ? 'Ad Group was created, but Ad creative upload failed'
                        : 'Launch Failed'}
                    </span>
                  </div>
                  <p className="pl-6 text-red-600/90 dark:text-red-400/90">{error}</p>
                  {created.campaignId && !created.adgroupId && (
                    <p className="pl-6 text-[11px] text-gray-500 dark:text-white/60">
                      Campaign ID: <span className="font-mono">{created.campaignId}</span>. Fix the fields above and click Launch to complete the ad group without creating a duplicate campaign.
                    </p>
                  )}
                </div>
              )}
              {!error && created.campaignId && (
                <div className="mt-3 rounded-xl border border-green-500/30 bg-green-500/10 p-3.5 text-xs text-green-700 dark:text-green-400 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    Campaign created successfully (ID: {created.campaignId})
                    {created.adgroupId ? ' · Ad group created' : ''}
                    {created.adId ? ' · Ad live' : ''}.
                  </span>
                </div>
              )}
            </div>
          );
        }

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 8 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-white/8 dark:bg-[#161616] dark:text-white"
        >
          {/* Close button — pinned to top-right corner */}
          <button
            type="button"
            onClick={onClose}
            disabled={launching}
            aria-label="Close"
            className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 dark:text-white/55 dark:hover:bg-white/8 dark:hover:text-white 2xl:h-8 2xl:w-8 cursor-pointer"
          >
            <X className="h-4 w-4 2xl:h-5 2xl:w-5" />
          </button>

          {/* Header — gradient icon tile + Posting-to pill + StepRail */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2.5 pr-12 dark:border-white/12 dark:bg-white/3 sm:gap-3 sm:px-5 sm:py-3 sm:pr-14 2xl:px-6 2xl:py-4 2xl:pr-16">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] ring-1 ring-white/10 2xl:h-12 2xl:w-12">
                <Megaphone className="h-[18px] w-[18px] text-white 2xl:h-6 2xl:w-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white 2xl:text-lg">
                  {isEditCampaign
                    ? 'Edit Campaign'
                    : isEditAdGroup
                    ? 'Edit Ad Group'
                    : isEditAd
                    ? 'Edit Ad'
                    : isAddAdGroup
                    ? 'New Ad Group'
                    : isAddAd
                    ? 'New Ad'
                    : 'New TikTok Campaign'}
                  <span className="ml-2 inline-flex items-center rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#15DCFF] 2xl:text-[10px]">
                    V1
                  </span>
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-500 dark:text-white/60 2xl:text-xs">
                    {context?.parentLabel
                      ? `${isEdit ? 'Editing' : 'Adding to'} ${context.parentLabel} ·`
                      : 'Posting to'}
                  </span>
                  <span className="inline-flex rounded-[6px] bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-px transition-all">
                    <span className="rounded-[5px] bg-white px-2 py-0.5 text-[11px] font-bold leading-tight text-gray-900 dark:bg-[#141414] dark:text-white 2xl:text-xs">
                      {accountName || context?.accountName || accounts?.find((a) => String(a.id) === String(advertiserId))?.name || advertiserId || 'TikTok Account'}
                    </span>
                  </span>
                  {currency && (
                    <span className="font-mono text-[11px] text-gray-400 dark:text-white/45 2xl:text-xs">
                      · {currency}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Step rail in header */}
            {(isCreate || isAddAdGroup || isAddAd) && (
              <StepRail
                steps={
                  isAddAdGroup
                    ? [
                        { id: 'adgroup', label: 'Ad Group', icon: Users },
                        { id: 'ad', label: 'Ad', icon: ImageIcon },
                        { id: 'review', label: 'Review', icon: CheckCircle2 },
                      ]
                    : isAddAd
                    ? [
                        { id: 'ad', label: 'Ad', icon: ImageIcon },
                        { id: 'review', label: 'Review', icon: CheckCircle2 },
                      ]
                    : TIKTOK_STEPS
                }
                currentIndex={isAddAdGroup ? step - 2 : isAddAd ? step - 3 : step}
                onStepClick={(idx) => {
                  const targetStep = isAddAdGroup ? idx + 2 : isAddAd ? idx + 3 : idx;
                  setStep(targetStep);
                }}
              />
            )}
          </div>

          {/* body: form + sidebar */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 2xl:px-8 2xl:py-8">
              {schema ? renderStep() : (
                <div className="flex flex-col items-center justify-center gap-3 py-24">
                  <Loader2 className="h-8 w-8 animate-spin text-[#747c7c]" />
                  <p className="text-sm font-medium text-gray-500 dark:text-white/40">Loading wizard schema…</p>
                </div>
              )}
            </div>

            {/* sidebar */}
            {isAddAdGroup ? (
              <CampaignSetupSidebar
                currentStep={step - 2}
                stepOffset={2}
                steps={[
                  { id: 'adgroup', label: 'Ad Group', icon: Users },
                  { id: 'ad', label: 'Ad', icon: ImageIcon },
                  { id: 'review', label: 'Review', icon: CheckCircle2 },
                ]}
                form={form}
                selectedObjective={selectedObjective}
                onStepClick={setStep}
                currency={currency}
                identities={identities}
                musicList={musicList}
              />
            ) : isAddAd ? (
              <CampaignSetupSidebar
                currentStep={step - 3}
                stepOffset={3}
                steps={[
                  { id: 'ad', label: 'Ad', icon: ImageIcon },
                  { id: 'review', label: 'Review', icon: CheckCircle2 },
                ]}
                form={form}
                selectedObjective={selectedObjective}
                onStepClick={setStep}
                currency={currency}
                identities={identities}
                musicList={musicList}
              />
            ) : isCreate ? (
              <CampaignSetupSidebar
                currentStep={step}
                stepOffset={0}
                steps={TIKTOK_STEPS}
                form={form}
                selectedObjective={selectedObjective}
                onStepClick={setStep}
                currency={currency}
                identities={identities}
                musicList={musicList}
              />
            ) : null}
          </div>

          {/* footer */}
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-white/8">
            {(isCreate || isAddAdGroup || isAddAd) ? (
              <button
                onClick={() => setStep((s) => Math.max(initialStep, s - 1))}
                disabled={step === initialStep || launching}
                className="flex items-center gap-1 rounded-full border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-gray-600 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <div />
            )}
            {(isCreate || isAddAdGroup || isAddAd) ? (
              step < STEPS.length - 1 ? (
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-2 text-sm font-semibold text-white cursor-pointer shadow-sm hover:opacity-95"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={launching || !canLaunch()}
                  className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-6 py-2 text-xs font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 2xl:px-7 2xl:py-2.5 2xl:text-sm cursor-pointer"
                >
                  {launching ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin 2xl:h-4 2xl:w-4" />
                      Launching…
                    </>
                  ) : (
                    <>
                      <Rocket className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                      Launch
                    </>
                  )}
                </button>
              )
            ) : (
              <button
                onClick={handleSave}
                disabled={launching || !canNext()}
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer shadow-sm hover:opacity-95"
              >
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {launching ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default CreateCampaignWizard;
