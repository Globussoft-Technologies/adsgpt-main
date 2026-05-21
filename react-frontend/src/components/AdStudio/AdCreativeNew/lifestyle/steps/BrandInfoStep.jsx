import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { ArrowLeft, CheckCircle, CloudUpload, LinkIcon, Plus } from 'lucide-react';
import { LifestyleShell } from '../LifestyleShell';
import ColorPicker from '@/components/common/ColorPicker';
import BrandSearch from '@/components/AdFactory/BrandsDropDown/BrandSelect';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';

export function BrandInfoStep({ data, title, onBack, onSkip, onClose, onConfirm }) {
  const reduxBrandName = useSelector((state) => state.adFactoryNew?.brand_name);
  const selectedBrand = useSelector((state) => state.adFactoryNew?.selectedBrand);
  // Full BrandIQ catalog — used so typing a brand name that matches an
  // existing record surfaces its logos + images as unselected options
  // (image-10 behaviour).
  const myBrands = useSelector((state) => state.brandIQTabs?.myBrands) ?? [];
  const brandName = reduxBrandName ?? data.brandInfo.brandName ?? '';
  // If neither redux nor the autofill response has a brand name at mount
  // time, treat this as a "fresh / empty form" load — do NOT seed local
  // fields from `data` (which can still carry the previous brand's
  // description / logo / images even after the user erased the name).
  // Skipping seeding here, combined with the per-brand effects below that
  // populate fields when a brand IS picked, keeps the form's "filled" /
  // "empty" states atomic.
  const hasInitialBrandRef = useRef(
    Boolean(reduxBrandName?.trim() || data?.brandInfo?.brandName?.trim()),
  );
  const seedFromData = hasInitialBrandRef.current;
  const [brandDescription, setBrandDescription] = useState(
    seedFromData ? data.brandInfo.brandDescription || '' : '',
  );
  const [promotionalInfo, setPromotionalInfo] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState(
    seedFromData ? data.brandInfo.brandLogo?.[0] ?? '' : '',
  );

  // Prefill of redux `brand_name` now happens in LifestyleAdsFlow (when a
  // fresh autofill arrives or when the user picks the Skip / Add-manually
  // path). Doing it here would re-fill redux every time this step remounts
  // — including the back-navigation from Ad Setup — which would clobber
  // an explicit erase the user made before navigating away.

  const initialColors = useMemo(
    () =>
      seedFromData ? data.brandInfo.brandGuidelines.colorPalette.slice(0, 6) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );
  const [brandColors, setBrandColors] = useState(initialColors);

  // Logo options used to come straight from the autofill response. Lifting
  // to state so the typed-brand-name lookup can append matched-brand logos
  // alongside the autofill ones.
  const [brandLogoOptions, setBrandLogoOptions] = useState(() =>
    seedFromData ? data.brandInfo.brandLogo || [] : [],
  );

  // Brand image pool is now reactive — starts from the autofill scrape but
  // grows with user uploads / pasted URLs / clipboard image pastes.
  const [brandImagePool, setBrandImagePool] = useState(() =>
    seedFromData ? data.brandInfo.brandImages || [] : [],
  );
  const [brandImageUrlInput, setBrandImageUrlInput] = useState('');

  // Lightbox state for previewing the brand logo at full size.
  const [logoLightboxOpen, setLogoLightboxOpen] = useState(false);

  const [selectedLogo, setSelectedLogo] = useState(
    seedFromData ? brandLogoOptions[0] ?? '' : '',
  );
  const [selectedImages, setSelectedImages] = useState(() =>
    seedFromData ? (data.brandInfo.brandImages || []).slice(0, 1) : [],
  );

  // Whenever the underlying autofill data changes (e.g. user picked a different
  // brand from BrandIQ that already has prefetched images), reset the pool to
  // that brand's scrape so we don't blend two brands' assets. Skipped when we
  // intentionally loaded an empty form — otherwise the previous brand's
  // images would leak back in on the very next render.
  useEffect(() => {
    if (!seedFromData) return;
    setBrandImagePool(data.brandInfo.brandImages || []);
    setSelectedImages((data.brandInfo.brandImages || []).slice(0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.brandInfo.brandImages]);

  // When the user picks a different brand from the BrandIQ dropdown, prefill
  // local fields from that brand's stored record — no re-scrape needed. We
  // only run this when an actual brand record is selected (id present), not
  // on the initial empty selectedBrand. Every setter is unconditional so a
  // record with empty fields actually CLEARS the previous brand's values
  // instead of leaking them into the new selection.
  useEffect(() => {
    if (!selectedBrand?.id) return;
    setBrandDescription(selectedBrand?.description || '');
    const logos = Array.isArray(selectedBrand?.logoUrls) ? selectedBrand.logoUrls : [];
    setBrandLogoOptions(logos);
    setBrandLogoUrl(logos[0] || '');
    setSelectedLogo(logos[0] || '');
    const imgs = Array.isArray(selectedBrand?.imageUrl)
      ? selectedBrand.imageUrl.filter(Boolean)
      : [];
    setBrandImagePool(imgs);
    setSelectedImages(imgs.slice(0, 1));
    // Pull brand colors from whichever shape the record uses — different
    // BrandIQ writers have used `colors`, `brandColors`, or the nested
    // `brandGuidelines.colorPalette`. Take the first non-empty array we find.
    const colors =
      (Array.isArray(selectedBrand?.colors) && selectedBrand.colors) ||
      (Array.isArray(selectedBrand?.brandColors) && selectedBrand.brandColors) ||
      (Array.isArray(selectedBrand?.brandGuidelines?.colorPalette) &&
        selectedBrand.brandGuidelines.colorPalette) ||
      [];
    setBrandColors(colors.filter(Boolean).slice(0, 6));
  }, [selectedBrand?.id]);

  // Image-10: when the user TYPES a brand name (without picking it from the
  // dropdown), check the BrandIQ catalog for a case-insensitive name match.
  // If one exists, surface its logos + brand images as *unselected* options
  // below the respective fields. The user must explicitly pick one.
  useEffect(() => {
    // Only run when there's NO dropdown selection — the selectedBrand effect
    // above handles that case (and auto-selects). Skip empty names too.
    if (selectedBrand?.id) return;
    const typed = (reduxBrandName || '').trim().toLowerCase();
    if (!typed) return;
    const match = myBrands.find((b) => b?.name?.toLowerCase() === typed);
    if (!match) return;

    const logos = Array.isArray(match.logoUrls) ? match.logoUrls.filter(Boolean) : [];
    setBrandLogoOptions(logos);
    // Deliberately do NOT setSelectedLogo / setBrandLogoUrl — the user is
    // typing manually, they choose explicitly.

    const imgs = Array.isArray(match.imageUrl) ? match.imageUrl.filter(Boolean) : [];
    setBrandImagePool(imgs);
    setSelectedImages([]);
    // Description / colors are left as the user's own manual entries so we
    // don't trample what they may have typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduxBrandName, selectedBrand?.id, myBrands]);

  const addBrandImageUrl = (rawUrl) => {
    const url = (rawUrl || '').trim();
    if (!url) return;
    setBrandImagePool((prev) => (prev.includes(url) ? prev : [...prev, url]));
    setSelectedImages((prev) => (prev.includes(url) ? prev : [...prev, url]));
  };

  const addBrandImageFiles = (files) => {
    if (!files || files.length === 0) return;
    const urls = Array.from(files)
      .filter((f) => f && f.type?.startsWith('image/'))
      .map((f) => URL.createObjectURL(f));
    if (urls.length === 0) return;
    setBrandImagePool((prev) => [...prev, ...urls]);
    setSelectedImages((prev) => [...prev, ...urls]);
  };

  const handleBrandImagePaste = (e) => {
    // Try clipboard files first (image copy/paste). Fall back to text URL.
    const files = e.clipboardData?.files;
    if (files && files.length > 0 && Array.from(files).some((f) => f.type?.startsWith('image/'))) {
      e.preventDefault();
      addBrandImageFiles(files);
      return;
    }
    const text = e.clipboardData?.getData('text');
    if (text && /^https?:\/\//i.test(text.trim())) {
      e.preventDefault();
      addBrandImageUrl(text);
      setBrandImageUrlInput('');
    }
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerColor, setPickerColor] = useState('#888888');
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e) => {
      if (pickerRef.current?.contains(e.target)) return;
      setBrandColors((prev) => [...prev, pickerColor]);
      setPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen, pickerColor]);

  const toggleImage = (src) =>
    setSelectedImages((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]
    );

  const handleConfirm = () => {
    onConfirm?.({
      brandName: (brandName || '').trim(),
      brandDescription: brandDescription.trim(),
      promotionalInfo: promotionalInfo.trim(),
      brandLogoUrl: (selectedLogo || brandLogoUrl).trim(),
      brandColors,
      brandImages: selectedImages,
      selectedPlatforms: [],
    });
  };

  return (
    <LifestyleShell title={title} onClose={onClose}>
      <div className="relative -mt-12 max-h-[calc(100svh-20px)] w-full max-w-[1100px] min-w-[420px] overflow-y-auto rounded-[30px] bg-[#303030]/30 p-5 backdrop-blur-md sm:p-6 lg:px-12 2xl:mt-0 2xl:max-h-[calc(100svh-140px)]">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="absolute top-4 left-6 flex h-12 w-12 items-center justify-center rounded-full text-white/60 transition-colors hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={26} strokeWidth={2} />
          </button>
        )}
        <div className="relative mb-5 flex items-center justify-center">
          <h3 className="text-[16px] text-white sm:text-xl">Brand Information</h3>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-x-12 gap-y-6 lg:grid-cols-2">
          <div className="ml-3 space-y-10">
            <Field label="Brand/product Name*">
              <BrandSearch placeholder="Enter your Brand/product name" isBrandInfoStep={true} />
            </Field>

            <Field label="Brand description">
              <input
                type="text"
                value={brandDescription}
                onChange={(e) => setBrandDescription(e.target.value)}
                placeholder="Enter your Brand Description"
                className={inputClass}
              />
            </Field>

            <Field label="Promotional Info">
              <input
                type="text"
                value={promotionalInfo}
                onChange={(e) => setPromotionalInfo(e.target.value)}
                placeholder="e.g., FLAT 10% OFF on All Purchases, coupon: OFFER10, etc"
                className={inputClass}
              />
            </Field>

            <Field label="Brand Colors">
              <div className="flex flex-wrap items-center gap-3">
                {brandColors.map((c, i) => (
                  <ColorSwatch
                    key={`${c}-${i}`}
                    color={c}
                    onRemove={() => setBrandColors((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-[#909294]/10 text-white/70 ring-1 ring-white/10 transition-colors hover:bg-[#909294]/20"
                    aria-label="Add brand color"
                  >
                    <Plus size={20} strokeWidth={2} />
                  </button>
                  {pickerOpen && (
                    <div
                      ref={pickerRef}
                      className="absolute top-1/2 left-full z-30 ml-2 -translate-y-1/2"
                    >
                      <ColorPicker color={pickerColor} onChange={setPickerColor} />
                    </div>
                  )}
                </div>
              </div>
            </Field>
          </div>

          <div className="space-y-8">
            <Field label="Brand logo">
              <div
                onPaste={(e) => {
                  // Clipboard image → register as a blob URL upload.
                  // Clipboard text URL → register as a typed URL.
                  const files = e.clipboardData?.files;
                  if (
                    files &&
                    files.length > 0 &&
                    Array.from(files).some((f) => f.type?.startsWith('image/'))
                  ) {
                    const f = Array.from(files).find((x) =>
                      x.type?.startsWith('image/'),
                    );
                    if (f) {
                      e.preventDefault();
                      setBrandLogoUrl(URL.createObjectURL(f));
                    }
                    return;
                  }
                  const text = e.clipboardData?.getData('text');
                  if (text && /^https?:\/\//i.test(text.trim())) {
                    e.preventDefault();
                    setBrandLogoUrl(text.trim());
                  }
                }}
                className="text-10 flex items-center gap-3 rounded-full bg-[#909294]/10 px-1 py-1 text-[#afafaf]"
              >
                <div className="flex flex-1 items-center justify-between">
                  <input
                    type="text"
                    inputMode="url"
                    // Hide local blob: URLs from the input — uploads should
                    // show only as a preview, not as a giant blob string.
                    // Real URLs (typed/pasted) still render normally.
                    value={brandLogoUrl?.startsWith('blob:') ? '' : brandLogoUrl}
                    onChange={(e) => setBrandLogoUrl(e.target.value)}
                    placeholder="Paste your Brand logo"
                    className="w-full rounded-lg bg-transparent px-4 py-2.5 text-xs text-white placeholder:text-[#afafaf]/80 focus:outline-none 2xl:text-base"
                  />
                  <LinkIcon className="h-3 w-3 text-[#909294] 2xl:h-4 2xl:w-4" />
                </div>
                <label
                  htmlFor="brand-logo-upload"
                  className="text-10 flex cursor-pointer items-center gap-1 rounded-full bg-white/20 px-2.5 py-3 text-white hover:opacity-70 2xl:gap-2"
                >
                  <CloudUpload className="h-3 w-3 text-white 2xl:h-4 2xl:w-4" />
                  <span className="text-10! whitespace-nowrap 2xl:text-xs!">Upload Image</span>
                </label>
                <input
                  id="brand-logo-upload"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setBrandLogoUrl(URL.createObjectURL(f));
                  }}
                />
              </div>

              {/* Preview of the currently-entered brand logo (typed URL,
                  pasted URL, or uploaded blob). Click the thumbnail to open
                  the full-size lightbox; the small red × removes it. */}
              {brandLogoUrl && (
                <div className="mt-3 inline-flex items-center gap-3">
                  <div className="group relative h-12 w-12 cursor-pointer rounded-full ring-1 ring-white/20">
                    <img
                      src={brandLogoUrl}
                      alt="brand logo preview"
                      onClick={() => setLogoLightboxOpen(true)}
                      className="h-full w-full rounded-full object-cover"
                    />
                    <button
                      type="button"
                      aria-label="Remove brand logo"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBrandLogoUrl('');
                        setSelectedLogo('');
                      }}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100"
                    >
                      <span className="text-[11px] leading-none">×</span>
                    </button>
                  </div>
                </div>
              )}

              {brandLogoOptions.length > 0 && (
                <div className="mt-3 flex items-center gap-4 overflow-x-auto p-1">
                  {brandLogoOptions.map((url) => {
                    const active = selectedLogo === url;
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => {
                          setSelectedLogo(url);
                          setBrandLogoUrl(url);
                        }}
                        className={`relative h-9 w-9 shrink-0 rounded-full bg-white/5 ring-1 transition-transform hover:scale-105 ${
                          active ? 'ring-2 ring-white/80' : 'ring-white/10'
                        }`}
                        aria-label="Use this logo"
                        aria-pressed={active}
                        title={url}
                      >
                        <img
                          src={url}
                          alt=""
                          className="h-full w-full rounded-full object-contain"
                        />
                        {active && (
                          <span className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-white">
                            <CheckCircle size={16} strokeWidth={2.5} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field label="Brand Images">
              <div
                onPaste={handleBrandImagePaste}
                className="text-10 flex items-center gap-3 rounded-full bg-[#909294]/10 px-1 py-1 text-[#afafaf]"
              >
                <div className="flex flex-1 items-center justify-between">
                  <input
                    type="url"
                    value={brandImageUrlInput}
                    onChange={(e) => setBrandImageUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addBrandImageUrl(brandImageUrlInput);
                        setBrandImageUrlInput('');
                      }
                    }}
                    placeholder="Paste your Brand image"
                    className="w-full rounded-lg bg-transparent px-4 py-2.5 text-xs text-white placeholder:text-[#afafaf]/80 focus:outline-none 2xl:text-base"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      addBrandImageUrl(brandImageUrlInput);
                      setBrandImageUrlInput('');
                    }}
                    disabled={!brandImageUrlInput.trim()}
                    aria-label="Add brand image URL"
                    className="shrink-0 px-1 text-[#909294] transition-colors hover:text-white disabled:opacity-40"
                  >
                    <LinkIcon className="h-3 w-3 2xl:h-4 2xl:w-4" />
                  </button>
                </div>
                <label
                  htmlFor="brand-image-upload"
                  className="text-10 flex cursor-pointer items-center gap-1 rounded-full bg-white/20 px-2.5 py-3 text-white hover:opacity-70 2xl:gap-2"
                >
                  <CloudUpload className="h-3 w-3 text-white 2xl:h-4 2xl:w-4" />
                  <span className="text-10! whitespace-nowrap 2xl:text-xs!">Upload Image</span>
                </label>
                <input
                  id="brand-image-upload"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    addBrandImageFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {brandImagePool.length > 0 ? (
                <div className="mt-3 max-h-[230px] overflow-y-auto pr-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
                  <div className="grid grid-cols-3 gap-2 p-1 sm:grid-cols-4">
                    {brandImagePool.map((src) => {
                      const active = selectedImages.includes(src);
                      return (
                        <button
                          key={src}
                          type="button"
                          onClick={() => toggleImage(src)}
                          className={`relative aspect-square overflow-hidden rounded-[10px] bg-white/5 ring-1 transition-transform hover:scale-[1.02] ${
                            active ? 'ring-2 ring-white' : 'ring-white/10'
                          }`}
                          aria-pressed={active}
                          title={src}
                        >
                          <img
                            src={src}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          {active && (
                            <>
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-transparent"
                              />
                              <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full text-white">
                                <CheckCircle size={16} strokeWidth={3} />
                              </span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-white/40">
                  No brand images detected — paste a URL or upload one above.
                </p>
              )}

              {brandImagePool.length > 0 && (
                <p className="mt-2 text-[11px] text-white/40">
                  {selectedImages.length} of {brandImagePool.length} selected · scroll for more
                </p>
              )}
            </Field>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="rounded-full bg-[#3B3C3D] px-10 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-80"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!brandName?.trim()}
            className="rounded-full bg-white px-8 py-2.5 text-[13px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </div>
      {logoLightboxOpen && brandLogoUrl && (
        <ShowLightBox
          images={[brandLogoUrl]}
          lightboxImage={brandLogoUrl}
          closeLightbox={() => setLogoLightboxOpen(false)}
        />
      )}
    </LifestyleShell>
  );
}

const inputClass = `
  py-4 w-full rounded-full bg-[#909294]/10 px-5 text-[14px] text-white
  outline-none ring-1 ring-white/5
  placeholder:text-[#afafaf]/80
  focus-visible:ring-2 focus-visible:ring-white/30 sm:text-[15px]
`;

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[13px] text-white/90 sm:text-base">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ColorSwatch({ color, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="h-8 w-8 rounded-full ring-1 ring-white/10 transition-transform hover:scale-105"
      data-color={color}
      title={`${color} (click to remove)`}
      style={{ backgroundColor: color }}
    />
  );
}
