import React, { useState, useEffect, useRef } from 'react';
import { X, Link as LinkIcon, Loader2, Plus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import BrandSearch from '@/components/AdFactory/BrandsDropDown/BrandSelect';
import { analyzeAiAdsAction } from '@/store/actions/adVideoNew/Advideoactions';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

const isImageFile = (file) =>
  ALLOWED_IMAGE_TYPES.includes(file.type) ||
  ALLOWED_IMAGE_EXTENSIONS.test(file.name || '');

const AnalysisStep = ({ type, onBack, onNext, onClose }) => {
  const [script, setScript] = useState('');
  const [scriptError, setScriptError] = useState('');
  const [brandiqError, setBrandiqError] = useState('');
  const [imageError, setImageError] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysisImages, setAnalysisImages] = useState([]);
  const fileInputRef = useRef(null);

  const addImageFiles = (files) => {
    if (!files.length) return;
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length < files.length) {
      setImageError('Only .jpg, .jpeg, .png, and .webp image files are allowed.');
    } else {
      setImageError('');
    }
    if (!imageFiles.length) return;
    const remaining = 5 - analysisImages.length;
    if (remaining <= 0) return;
    const toAdd = imageFiles.slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    }));
    setAnalysisImages((prev) => [...prev, ...toAdd]);
  };

  const handleAddImages = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    addImageFiles(files);
  };

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length) addImageFiles(imageFiles);
  };

  const removeAnalysisImage = (index) => {
    setAnalysisImages((prev) => prev.filter((_, i) => i !== index));
  };

  const [lightbox, setLightbox] = useState({ open: false, images: [], index: 0 });
  const openLightbox = (images, index) => setLightbox({ open: true, images, index });
  const closeLightbox = () => setLightbox((prev) => ({ ...prev, open: false }));

  const dispatch = useDispatch();
  const isBrand = type === 'brand';
  const selectedBrand = useSelector((state) => state.adFactoryNew.selectedBrand);
  const hasBrandIQSelection = selectedBrand && selectedBrand.id;

  useEffect(() => {
    return () => {
      dispatch(setFields({ selectedBrand: {}, brand_name: '', brand_description: '', brand_logo: '',brandInfo: {}, }));
    };
  }, [dispatch]);

  useEffect(() => {
    if (hasBrandIQSelection) setBrandiqError('');
  }, [hasBrandIQSelection]);

  const clearErrors = () => { setScriptError(''); setBrandiqError(''); setImageError(''); };

  const handleScriptKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!loading) handleAnalyze();
    }
  };

  const handleAnalyze = async () => {
    if (!script.trim()) {
      setScriptError('Please describe your video idea to proceed');
      return;
    }
    clearErrors();

    setLoading(true);
    try {
      const payload = {
        script: script.trim(),
        name: hasBrandIQSelection ? (selectedBrand.name || '') : '',
      };

      const result = await dispatch(analyzeAiAdsAction(type, payload));

      // If a BrandIQ brand was selected, use its already-uploaded S3 images
      // directly so they are not re-fetched and re-uploaded to S3.
      const brandImages = hasBrandIQSelection
        ? (selectedBrand.imageUrl || []).map((src) => ({ url: src, preview: src, name: src.split('/').pop(), isS3: true }))
        : [];
      const brandLogoUrl =
        hasBrandIQSelection && Array.isArray(selectedBrand.logoUrls) && selectedBrand.logoUrls.length > 0
          ? { url: selectedBrand.logoUrls[0], preview: selectedBrand.logoUrls[0], name: 'brand-logo', isS3: true }
          : null;

      onNext({
        analysisType: script.trim() ? 'analyze' : 'brandiq',
        name: result.name || '',
        description: result.description || '',
        brandLogo: result.logoUrl || '',
        images: brandImages.length > 0 ? [] : (result.images || []),
        brandImages,
        brandLogoUrl,
        category: result.category || '',
        logoUrl: brandLogoUrl ? '' : (result.logoUrl || ''),
        productType: result.productType || '',
        tagline: result.tagline || '',
        userPrompt: result.optimizedPrompt || '',
        ctaType: result.cta || '',
        uploadedImages: analysisImages,
      });
    } catch (err) {
      const data = err?.response?.data;
      const msg = data?.error || data?.detail || 'Failed to analyze. Please try again.';
      if (script.trim()) {
        setScriptError(msg);
      } else {
        setBrandiqError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleManual = () => {
    clearErrors();
    onNext({ analysisType: 'manual' });
  };

  return (
    <div className="custom-scrollbar relative flex h-full min-w-[450px] w-screen max-w-md sm:max-w-xl shrink-0 flex-col items-center justify-center overflow-y-auto bg-[#1C1C1F] p-4 sm:p-8 2xl:max-w-[40rem]">
      {/* Close button */}
      <button onClick={onClose} className="absolute top-6 right-6 text-white/50 hover:text-white">
        <X className="h-5 w-5" />
      </button>
      <div className="relative w-full rounded-2xl px-2 pt-4 2xl:pt-5">
        {isBrand ? (
          <>
            {/* Title */}
            <h2 className="mb-10 text-center text-xl font-bold text-white 2xl:text-2xl">
             Bring Your Brand Vision to Life
            </h2>

            {/* URL Input + BrandIQ */}
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-white">Transform your ideas into studio-quality videos</label>
              <div
                className={`relative w-full rounded-xl border bg-[#909294]/15 transition-all ${scriptError || brandiqError ? 'border-red-500' : 'border-transparent focus-within:border-white/20'}`}
              >
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={analysisImages.length >= 5 || loading}
                    className="absolute top-3 left-3 z-10 flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-white/20 text-white/60 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    title="Add image"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                <textarea
                  type="text"
                  value={script}
                  rows={3}
                  onChange={(e) => { setScript(e.target.value); setScriptError(''); setBrandiqError(''); }}
                  onPaste={handlePaste}
                  onKeyDown={handleScriptKeyDown}
                  placeholder="Describe your video idea"
                  disabled={loading}
                  className="w-full resize-none rounded-xl bg-transparent pt-4 pr-4 pb-1 pl-15 text-sm text-white placeholder:text-[#afafaf] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
                  {analysisImages.map((img, idx) => (
                    <div key={idx} className="group relative h-9 w-9 cursor-pointer rounded-md border border-white/10">
                      <img
                        src={img.preview}
                        alt="preview"
                        className="h-full w-full rounded-md object-cover"
                        onClick={() => openLightbox(analysisImages.map((i) => i.preview), idx)}
                      />
                      <button
                        type="button"
                        onClick={() => removeAnalysisImage(idx)}
                        disabled={loading}
                        className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100 disabled:cursor-not-allowed"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={handleAddImages}
                  />
                </div>
                <div className={`border-white/10 px-2 py-0.5 mb-2 w-50 [&_input]:h-7! [&_input]:text-xs! [&_input]:px-2! **:min-h-0! [&_svg]:h-3.5! [&_svg]:w-3.5! ${loading ? 'pointer-events-none opacity-50' : ''}`}>
                  <BrandSearch isAvatarAdsSearch={true} className="" placeholder="Select a brand" portal={true} />
                </div>
              </div>
              {scriptError && <p className="mt-2 text-xs text-red-400">{scriptError}</p>}
              {brandiqError && <p className="mt-2 text-xs text-red-400">{brandiqError}</p>}
              {imageError && <p className="mt-2 text-xs text-red-400">{imageError}</p>}
            </div>

            {/* Action Buttons */}
            <div className="mt-10 flex justify-end gap-2">
              {/* <button
                onClick={handleManual}
                className="rounded-md min-w-40 border border-[#efefef]/70 px-6 py-2 text-[13px] font-medium text-white transition hover:bg-white/5"
              >
                Add Manually
              </button> */}
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="rounded-md min-w-25 bg-white px-6 py-2 text-[13px] font-semibold text-black transition hover:bg-white/90 disabled:opacity-60 flex items-center gap-2"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Analyze
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Title */}
            <h2 className="mb-10 text-center text-xl font-bold text-white">
             Bring Your Product Vision to Life
            </h2>

            {/* URL Input */}
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-white">Transform your ideas into studio-quality videos</label>
              <div
                className={`relative w-full rounded-xl border bg-[#909294]/15 transition-all ${scriptError ? 'border-red-500' : 'border-transparent focus-within:border-white/20'}`}
              >
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={analysisImages.length >= 5 || loading}
                  className="absolute top-3 left-3 z-10 flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-white/20 text-white/60 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title="Add image"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <textarea
                  type="text"
                  value={script}
                  rows={3}
                  onChange={(e) => { setScript(e.target.value); setScriptError(''); setBrandiqError(''); }}
                  onPaste={handlePaste}
                  onKeyDown={handleScriptKeyDown}
                  placeholder="Describe your video idea"
                  disabled={loading}
                  className="w-full resize-none rounded-xl bg-transparent pt-4 pr-4 pb-1 pl-15 text-[13px] text-white placeholder:text-[#afafaf] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
                  {analysisImages.map((img, idx) => (
                    <div key={idx} className="group relative h-9 w-9 cursor-pointer rounded-md border border-white/10">
                      <img
                        src={img.preview}
                        alt="preview"
                        className="h-full w-full rounded-md object-cover"
                        onClick={() => openLightbox(analysisImages.map((i) => i.preview), idx)}
                      />
                      <button
                        type="button"
                        onClick={() => removeAnalysisImage(idx)}
                        disabled={loading}
                        className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100 disabled:cursor-not-allowed"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={handleAddImages}
                  />
                </div>
              </div>
              {scriptError && <p className="mt-2 text-xs text-red-400">{scriptError}</p>}
              {imageError && <p className="mt-2 text-xs text-red-400">{imageError}</p>}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              {/* <button
                onClick={handleManual}
                className="min-w-35 rounded-md border border-[#efefef]/70 px-6 py-1.5 text-[13px] font-medium text-white transition hover:bg-white/5"
              >
                Manual Setup
              </button> */}
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="min-w-25 rounded-md bg-white px-6 py-1.5 text-[13px] font-semibold text-black transition hover:bg-white/90 disabled:opacity-60 flex items-center gap-2"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Analyze 
              </button>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {lightbox.open && (
          <ShowLightBox
            images={lightbox.images}
            lightboxImage={lightbox.images[lightbox.index]}
            closeLightbox={closeLightbox}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default AnalysisStep;
