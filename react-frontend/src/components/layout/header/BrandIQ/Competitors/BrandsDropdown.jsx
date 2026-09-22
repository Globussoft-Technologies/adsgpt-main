import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search, Settings, X } from 'lucide-react';
import { useSelector } from 'react-redux';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Curated brand color map for instant, accurate matching
const KNOWN_BRAND_COLORS = {
  boat: '#EF4444',
  'boat lifestyle': '#EF4444',
  lifestyle: '#EF4444',
  figma: '#A259FF',
  google: '#4285F4',
  nike: '#18181B',
  luma: '#2563EB',
  pinterest: '#E60023',
  snitch: '#18181B',
  spotify: '#1DB954',
  apple: '#18181B',
  youtube: '#FF0000',
  facebook: '#1877F2',
  meta: '#0668E1',
  instagram: '#E4405F',
  amazon: '#FF9900',
  netflix: '#E50914',
  microsoft: '#00A4EF',
  canva: '#00C4CC',
  slack: '#4A154B',
  twitter: '#1DA1F2',
  x: '#64748B',
  linkedin: '#0A66C2',
  discord: '#5865F2',
  shopify: '#96BF48',
  tiktok: '#FE2C55',
  uber: '#18181B',
  ubereats: '#06C167',
  'uber eats': '#06C167',
  airbnb: '#FF5A5F',
  starbucks: '#00704A',
  samsung: '#2563EB',
  sony: '#6366F1',
  twitch: '#9146FF',
  reddit: '#FF4500',
  adidas: '#18181B',
  zara: '#18181B',
  zomato: '#CB202D',
  swiggy: '#FC8019',
  dominos: '#006491',
  "domino's": '#006491',
  'pizza hut': '#EE3124',
  pizzahut: '#EE3124',
  kfc: '#E4002B',
  mcdonalds: '#DA291C',
  "mcdonald's": '#DA291C',
  'h&m': '#E50010',
  hm: '#E50010',
  'visual entity': '#6366F1',
  visualentity: '#6366F1',
  openai: '#10A37F',
  chatgpt: '#10A37F',
  'claude code': '#DA7757',
  claude: '#DA7757',
  claudecode: '#DA7757',
  anthropic: '#DA7757',
  allbirds: '#18181B',
  adobe: '#FF0000',
  notion: '#64748B',
  stripe: '#635BFF',
  github: '#475569',
  gitlab: '#FC6D26',
  puma: '#EA1B23',
  dell: '#0076CE',
  hp: '#0096D6',
  lenovo: '#E2231A',
  asus: '#00539B',
  intel: '#0071C5',
  amd: '#ED1C24',
  nvidia: '#76B900',
  oneplus: '#F50514',
  xiaomi: '#FF6900',
  oppo: '#008453',
  vivo: '#415FFF',
  realme: '#EAB308',
  glownova: '#E2E8F0',
  'glownova cosmetics': '#E2E8F0',
  cosmetics: '#E2E8F0',
  sugar: '#18181B',
  'sugar cosmetics': '#18181B',
  nykaa: '#FC2779',
  lakme: '#B91C1C',
  mac: '#18181B',
  'mac cosmetics': '#18181B',
  fenty: '#18181B',
  'fenty beauty': '#18181B',
  kay: '#F43F5E',
  'kay beauty': '#F43F5E',
  kiko: '#18181B',
  'kiko milano': '#18181B',
  maybelline: '#E11D48',
  loreal: '#D97706',
  "l'oreal": '#D97706',
  rare: '#F43F5E',
  'rare beauty': '#F43F5E',
  nars: '#18181B',
  sephora: '#18181B',
  huda: '#E11D48',
  'huda beauty': '#E11D48',
  elf: '#18181B',
  'e.l.f.': '#18181B',
};

const BRAND_PALETTES = [
  '#6366F1', // Indigo
  '#3B82F6', // Blue
  '#0EA5E9', // Sky
  '#06B6D4', // Cyan
  '#14B8A6', // Teal
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#F97316', // Orange
  '#EF4444', // Red
  '#EC4899', // Pink
  '#D946EF', // Fuchsia
  '#8B5CF6', // Purple
  '#7C3AED', // Violet
];

export const hexToRgba = (hex = '#6366F1', opacity = 1) => {
  if (!hex || typeof hex !== 'string') return `rgba(99, 102, 241, ${opacity})`;
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (clean.length !== 6) return `rgba(99, 102, 241, ${opacity})`;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const darkenColor = (hex, percent = 22) => {
  if (!hex || typeof hex !== 'string') return '#111827';
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  if (clean.length !== 6) return '#111827';
  const num = parseInt(clean, 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00ff) - amt);
  const B = Math.max(0, (num & 0x0000ff) - amt);
  return `#${(0x1000000 + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
};

// Ensures colors are clearly visible and never muddy/black on dark backgrounds
const ensureVisibleInDark = (hex) => {
  if (!hex || typeof hex !== 'string') return '#E2E8F0';
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  if (brightness < 60) {
    return '#E2E8F0'; // Return sleek luminous silver/slate for dark/black brands
  }
  return hex;
};

const getBrandColorCacheKey = (brandId, logoUrl) => {
  return `adsgpt:brandColor:${brandId || logoUrl || ''}`;
};

// Dynamically extracts the dominant chromatic or monochrome color directly from the logo image
const extractLogoColor = (imageUrl, isDark, onResult) => {
  if (!imageUrl || typeof window === 'undefined') return;
  const img = new Image();
  img.crossOrigin = 'anonymous';

  const processImage = () => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const size = 32;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      let maxChromaticCount = 0;
      let dominantChromatic = null;
      let isAllMonochrome = true;
      let totalVisible = 0;

      const chromaticCounts = new Map();

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 50) continue; // transparent
        totalVisible++;

        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const chroma = maxC - minC;

        if (chroma > 18) {
          isAllMonochrome = false;
          // Skip near-white or extreme black
          if (maxC > 245 && minC > 230) continue;
          if (maxC < 20) continue;

          const bucket = `${r >> 4},${g >> 4},${b >> 4}`;
          const current = chromaticCounts.get(bucket) || { count: 0, r: 0, g: 0, b: 0 };
          current.count++;
          current.r += r;
          current.g += g;
          current.b += b;
          chromaticCounts.set(bucket, current);

          if (current.count > maxChromaticCount) {
            maxChromaticCount = current.count;
            dominantChromatic = current;
          }
        }
      }

      if (dominantChromatic && maxChromaticCount >= 3) {
        const r = Math.round(dominantChromatic.r / dominantChromatic.count);
        const g = Math.round(dominantChromatic.g / dominantChromatic.count);
        const b = Math.round(dominantChromatic.b / dominantChromatic.count);
        const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        onResult(hex);
      }
    } catch {
      // Fallback
    }
  };

  img.onload = processImage;
  img.onerror = () => {};
  img.src = imageUrl;

  if (img.complete && img.naturalWidth > 0) {
    processImage();
  }
};

export const isKnownOrExplicitBrand = (label = '', explicitColor = '') => {
  if (explicitColor && typeof explicitColor === 'string' && explicitColor.startsWith('#')) {
    return true;
  }
  const normalized = (label || '').toLowerCase().trim();
  if (!normalized) return false;
  if (KNOWN_BRAND_COLORS[normalized]) return true;
  for (const key of Object.keys(KNOWN_BRAND_COLORS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return true;
    }
  }
  return false;
};

export const getBrandColor = (label = '', explicitColor = '') => {
  if (explicitColor && typeof explicitColor === 'string' && explicitColor.startsWith('#')) {
    return explicitColor;
  }
  const normalized = (label || '').toLowerCase().trim();
  if (KNOWN_BRAND_COLORS[normalized]) {
    return KNOWN_BRAND_COLORS[normalized];
  }
  for (const [key, color] of Object.entries(KNOWN_BRAND_COLORS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return color;
    }
  }
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  return BRAND_PALETTES[Math.abs(hash) % BRAND_PALETTES.length];
};

const getBrandInitials = (label = '') => {
  if (!label || typeof label !== 'string') return 'B';
  const cleaned = label.trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  const alpha = cleaned.replace(/[^a-zA-Z0-9]/g, '');
  if (alpha.length >= 2) {
    return alpha.slice(0, 2).toUpperCase();
  }
  return (alpha || cleaned || 'B').slice(0, 2).toUpperCase();
};

const BrandAvatar = ({
  logoUrl,
  label = '',
  brandColor = '',
  isPrimary = false,
  isDark = false,
  className = '',
  size = 'md',
}) => {
  const initials = getBrandInitials(label);
  const rawColor = brandColor || getBrandColor(label);
  const resolvedColor = isDark ? ensureVisibleInDark(rawColor) : rawColor;
  const gradientDark = darkenColor(resolvedColor, 26);

  const sizeClasses =
    size === 'sm'
      ? 'h-6.5 w-6.5 text-[10px]'
      : 'h-7 w-7 text-[11px] 2xl:h-7.5 2xl:w-7.5 2xl:text-xs';

  if (!isPrimary) {
    return (
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none ${sizeClasses} border border-black/10 bg-zinc-100 text-zinc-700 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-200 ${className}`}
        aria-hidden="true"
        title={label}
      >
        <span className="leading-none tracking-tight">
          {initials}
        </span>
        {logoUrl && (
          <img
            key={logoUrl}
            src={logoUrl}
            alt={label}
            className="absolute inset-0 h-full w-full object-contain p-0.5 bg-white dark:bg-zinc-900"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </span>
    );
  }

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold select-none ${sizeClasses} text-white transition-transform duration-200 ${className}`}
      style={{
        background: `linear-gradient(135deg, ${resolvedColor} 0%, ${gradientDark} 100%)`,
        boxShadow: isDark
          ? `0 0 10px ${hexToRgba(resolvedColor, 0.5)}, inset 0 1px 0 rgba(255, 255, 255, 0.35)`
          : `0 2px 7px ${hexToRgba(resolvedColor, 0.4)}, inset 0 1px 0 rgba(255, 255, 255, 0.25)`,
        border: `1.5px solid ${isDark ? hexToRgba(resolvedColor, 0.85) : hexToRgba(resolvedColor, 0.55)}`,
      }}
      aria-hidden="true"
      title={label}
    >
      <span className="leading-none tracking-tight text-white drop-shadow-md">
        {initials}
      </span>
      {logoUrl && (
        <img
          key={logoUrl}
          src={logoUrl}
          alt={label}
          className="absolute inset-0 h-full w-full object-contain p-0.5 bg-white dark:bg-zinc-900"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
    </span>
  );
};

const BrandsDropdown = ({
  options = [],
  label = '',
  value = null,
  onChange,
  onManageBrands,
  compact = false,
  singleAvatar = false,
}) => {
  const reduxIsDark = useSelector((state) => state.theme?.isDarkMode);
  const isDark = Boolean(
    reduxIsDark ||
      (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  );

  const [searchTerm, setSearchTerm] = useState('');

  const selectedOption =
    options.find((option) => option.value === value?.value) ||
    (value?.value ? value : options[0]);
  const selectedLabel = selectedOption?.label || value?.label || label || 'Select brand';

  const hasKnownColor = isKnownOrExplicitBrand(
    selectedLabel,
    selectedOption?.color || value?.color
  );

  const baseColor = useMemo(
    () => getBrandColor(selectedLabel, selectedOption?.color || value?.color),
    [selectedLabel, selectedOption?.color, value?.color]
  );

  const brandCacheKey = getBrandColorCacheKey(
    selectedOption?.value || value?.value,
    selectedOption?.logoUrl || value?.logoUrl
  );

  const [extractedColor, setExtractedColor] = useState(() => {
    if (typeof window === 'undefined') return null;
    if (hasKnownColor) return baseColor;
    return localStorage.getItem(brandCacheKey) || null;
  });

  useEffect(() => {
    if (hasKnownColor) {
      setExtractedColor(baseColor);
      try {
        localStorage.setItem(brandCacheKey, baseColor);
      } catch {/* eslint-disable-line */}
      return;
    }

    const cached = typeof window !== 'undefined' ? localStorage.getItem(brandCacheKey) : null;
    if (cached) {
      setExtractedColor(cached);
    }
    if (selectedOption?.logoUrl) {
      extractLogoColor(selectedOption.logoUrl, isDark, (color) => {
        if (color) {
          setExtractedColor(color);
          try {
            localStorage.setItem(brandCacheKey, color);
          } catch {/* eslint-disable-line */} 
        }
      });
    }
  }, [brandCacheKey, selectedOption?.logoUrl, isDark, hasKnownColor, baseColor]);

  const rawActiveColor = hasKnownColor ? baseColor : (extractedColor || baseColor);
  // Ensure the color is vibrant and never disappears into dark backgrounds
  const activeColor = isDark ? ensureVisibleInDark(rawActiveColor) : rawActiveColor;

  // Other brands for the avatar stack (all brands except currently selected)
  const otherBrands = options.filter((opt) => opt.value !== selectedOption?.value);
  const secondBrand = otherBrands[0] || null;
  const remainingCount = Math.max(0, options.length - 2);

  // Filtered options for the dropdown search
  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options;
    const term = searchTerm.toLowerCase().trim();
    return options.filter((opt) => (opt.label || '').toLowerCase().includes(term));
  }, [options, searchTerm]);

  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearchTerm('')}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch brand. Current brand: ${selectedLabel}`}
          style={{
            background: isDark
              ? `linear-gradient(135deg, ${hexToRgba(activeColor, 0.35)} 0%, rgba(24, 28, 40, 0.96) 100%)`
              : `linear-gradient(135deg, ${hexToRgba(activeColor, 0.16)} 0%, ${hexToRgba(activeColor, 0.05)} 100%)`,
            borderColor: isDark
              ? hexToRgba(activeColor, 0.7)
              : hexToRgba(activeColor, 0.35),
            boxShadow: isDark
              ? `0 0 14px ${hexToRgba(activeColor, 0.32)}, 0 2px 6px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.22)`
              : `0 2px 10px ${hexToRgba(activeColor, 0.14)}, inset 0 1px 0 rgba(255, 255, 255, 0.7)`,
          }}
          className={`group inline-flex h-9 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 transition-all duration-200 hover:scale-[1.015] active:scale-[0.99] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 ${
            compact ? 'text-xs lg:text-[13px]' : 'text-sm'
          }`}
        >
          {/* Avatar / Stack */}
          <div className="flex items-center">
            {/* Primary / Selected brand avatar */}
            <BrandAvatar
              key={selectedOption?.value || selectedOption?.logoUrl || selectedLabel}
              logoUrl={selectedOption?.logoUrl}
              label={selectedLabel}
              brandColor={activeColor}
              isPrimary={true}
              isDark={isDark}
              size={compact ? 'sm' : 'md'}
              className="z-30"
            />

            {!singleAvatar && secondBrand && (
              <BrandAvatar
                key={secondBrand?.value || secondBrand?.logoUrl || secondBrand?.label}
                logoUrl={secondBrand?.logoUrl}
                label={secondBrand?.label}
                brandColor={getBrandColor(secondBrand?.label, secondBrand?.color)}
                isPrimary={false}
                isDark={isDark}
                size={compact ? 'sm' : 'md'}
                className="z-20 -ml-1.5"
              />
            )}

            {!singleAvatar && remainingCount > 0 && (
              <span
                className={`relative z-10 -ml-1 flex shrink-0 items-center justify-center rounded-full font-bold select-none ring-2 ring-white dark:ring-[#18181b] bg-[#E5E7EB] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 shadow-2xs ${
                  compact
                    ? 'h-6 w-6 text-[8.5px] pl-1 pr-0.5'
                    : 'h-6.5 w-6.5 text-[9.5px] pl-1.5 pr-0.5 2xl:h-7 2xl:w-7 2xl:text-[10px]'
                }`}
                title={`${remainingCount} more brands`}
              >
                <span className="leading-none tracking-tight">{remainingCount}+</span>
              </span>
            )}
          </div>

          {/* Selected brand label */}
          <span className="min-w-0 max-w-[80px] xs:max-w-[110px] sm:max-w-[150px] 2xl:max-w-[200px] truncate text-left text-[12px] sm:text-[13px] font-semibold text-zinc-800 capitalize tracking-tight dark:text-white">
            {selectedLabel}
          </span>


          {/* Solid down caret */}
          <ChevronDown
            className="h-3 w-3 shrink-0 stroke-[2.5] text-zinc-500 transition-transform duration-200 group-data-[state=open]:rotate-180 dark:text-zinc-300"
            style={{ color: isDark ? hexToRgba(activeColor, 0.95) : undefined }}
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-[260px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-black/10 bg-white/95 p-1.5 text-zinc-900 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-[#151922]/95 dark:text-white"
      >
        {/* Ambient brand color highlight at top of menu */}
        <div
          className="-mt-1.5 mb-1.5 h-[2px] w-full rounded-t-2xl"
          style={{
            background: `linear-gradient(90deg, transparent 5%, ${activeColor} 50%, transparent 95%)`,
            boxShadow: isDark ? `0 0 8px ${hexToRgba(activeColor, 0.7)}` : undefined,
          }}
          aria-hidden="true"
        />

        <DropdownMenuLabel className="flex items-center justify-between px-2.5 pt-1 pb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <span>Switch Brand</span>
          {options.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {options.length} {options.length === 1 ? 'brand' : 'brands'}
            </span>
          )}
        </DropdownMenuLabel>

        {/* Quick search when multiple brands exist */}
        {options.length > 5 && (
          <div className="px-1.5 pb-1.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-black/5 bg-zinc-100/70 px-2.5 py-1 text-xs text-zinc-600 transition-colors focus-within:border-black/20 focus-within:bg-zinc-100 dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-300 dark:focus-within:border-white/20 dark:focus-within:bg-zinc-800">
              <Search className="h-3 w-3 shrink-0 text-zinc-400" />
              <input
                type="text"
                placeholder="Search brand..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-transparent text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="scrollbar-thin flex max-h-60 flex-col gap-0.5 overflow-y-auto pr-0.5">
          {filteredOptions.length > 0 ? (
            filteredOptions.map(({ value: optionValue, label: optionLabel, logoUrl, color: optionColor }) => {
              const isSelected = (selectedOption?.value || value?.value) === optionValue;
              const rawItemColor = isSelected
                ? rawActiveColor
                : getBrandColor(optionLabel, optionColor);
              const itemColor = isDark ? ensureVisibleInDark(rawItemColor) : rawItemColor;

              return (
                <DropdownMenuItem
                  key={optionValue}
                  onSelect={() => onChange?.(optionValue)}
                  style={
                    isSelected
                      ? {
                          backgroundColor: isDark
                            ? hexToRgba(itemColor, 0.26)
                            : hexToRgba(itemColor, 0.12),
                          borderColor: hexToRgba(itemColor, isDark ? 0.45 : 0.3),
                        }
                      : undefined
                  }
                  className={`cursor-pointer rounded-xl px-2.5 py-2 text-sm font-medium transition-all flex items-center gap-2.5 focus:bg-zinc-100 dark:focus:bg-zinc-800 ${
                    isSelected
                      ? 'text-zinc-950 font-semibold border dark:text-white shadow-2xs'
                      : 'text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <BrandAvatar
                    logoUrl={logoUrl}
                    label={optionLabel}
                    brandColor={itemColor}
                    isPrimary={isSelected}
                    isDark={isDark}
                    size="sm"
                    className="ring-1 ring-black/5 dark:ring-white/10"
                  />
                  <span className="min-w-0 flex-1 truncate capitalize font-medium">
                    {optionLabel}
                  </span>
                  {isSelected && (
                    <Check
                      className="h-4 w-4 shrink-0 font-bold"
                      style={{ color: itemColor }}
                    />
                  )}
                </DropdownMenuItem>
              );
            })
          ) : (
            <div className="px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No matching brands found
            </div>
          )}
        </div>

        {onManageBrands && (
          <>
            <DropdownMenuSeparator className="my-1.5 bg-black/8 dark:bg-white/10" />
            <DropdownMenuItem
              onSelect={onManageBrands}
              className="cursor-pointer rounded-xl px-2.5 py-2 text-sm font-medium text-zinc-700 hover:text-zinc-950 focus:bg-zinc-100 focus:text-zinc-950 dark:text-zinc-300 dark:hover:text-white dark:focus:bg-zinc-800 dark:focus:text-white flex items-center gap-2"
            >
              <Settings className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              <span className="flex-1">Manage Brands</span>
              <ChevronRight className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default BrandsDropdown;
