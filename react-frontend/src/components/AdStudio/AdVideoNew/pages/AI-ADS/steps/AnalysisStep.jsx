import React, { useState, useEffect, useRef } from 'react';
import { X, Link as LinkIcon, Loader2, Plus } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import BrandSearch from '@/components/AdFactory/BrandsDropDown/BrandSelect';
import { analyzeAiAdsAction } from '@/store/actions/adVideoNew/Advideoactions';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

const AnalysisStep = ({ type, onBack, onNext, onClose }) => {
  const [script, setScript] = useState('');
  const [scriptError, setScriptError] = useState('');
  const [brandiqError, setBrandiqError] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysisImages, setAnalysisImages] = useState([]);
  const fileInputRef = useRef(null);

  const addImageFiles = (files) => {
    if (!files.length) return;
    const remaining = 5 - analysisImages.length;
    if (remaining <= 0) return;
    const toAdd = files.slice(0, remaining).map((file) => ({
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

  const dispatch = useDispatch();
  const isBrand = type === 'brand';
  const selectedBrand = useSelector((state) => state.adFactoryNew.selectedBrand);
  const hasBrandIQSelection = selectedBrand && selectedBrand.id;

  useEffect(() => {
    return () => {
      dispatch(setFields({ selectedBrand: {}, brand_name: '', brand_description: '', brand_logo: '' }));
    };
  }, [dispatch]);

  useEffect(() => {
    if (hasBrandIQSelection) setBrandiqError('');
  }, [hasBrandIQSelection]);

  const clearErrors = () => { setScriptError(''); setBrandiqError(''); };

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

      onNext({
        analysisType: script.trim() ? 'analyze' : 'brandiq',
        name: result.name || '',
        description: result.description || '',
        brandLogo: result.logoUrl || '',
        images: result.images || [],
        category: result.category || '',
        logoUrl: result.logoUrl || '',
        productType: result.productType || '',
        tagline: result.tagline || '',
        userPrompt: result.optimizedPrompt || '',
        ctaType: result.cta || '',
        uploadedImages: analysisImages,
      });
    } catch (err) {
      console.log(err?.response?.data?.error);
      const msg = err?.response?.data?.error || 'Failed to analyze. Please try again.';
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
                    disabled={analysisImages.length >= 5}
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
                  placeholder="Describe your video idea"
                  className="w-full resize-none rounded-xl bg-transparent pt-4 pr-4 pb-1 pl-15 text-sm text-white placeholder:text-[#afafaf] focus:outline-none"
                />
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
                  {analysisImages.map((img, idx) => (
                    <div key={idx} className="group relative h-9 w-9 rounded-md border border-white/10">
                      <img src={img.preview} alt="preview" className="h-full w-full rounded-md object-cover" />
                      <button
                        type="button"
                        onClick={() => removeAnalysisImage(idx)}
                        className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleAddImages}
                  />
                </div>
                <div className="border-white/10 px-2 py-0.5 mb-2 w-50 [&_input]:h-7! [&_input]:text-xs! [&_input]:px-2! **:min-h-0! [&_svg]:h-3.5! [&_svg]:w-3.5!">
                  <BrandSearch isAvatarAdsSearch={true} className="" placeholder="Select a brand" portal={true} />
                </div>
              </div>
              {scriptError && <p className="mt-2 text-xs text-red-400">{scriptError}</p>}
              {brandiqError && <p className="mt-2 text-xs text-red-400">{brandiqError}</p>}
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
                  disabled={analysisImages.length >= 5}
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
                  placeholder="Describe your video idea"
                  className="w-full resize-none rounded-xl bg-transparent pt-4 pr-4 pb-1 pl-15 text-[13px] text-white placeholder:text-[#afafaf] focus:outline-none"
                />
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
                  {analysisImages.map((img, idx) => (
                    <div key={idx} className="group relative h-9 w-9 rounded-md border border-white/10">
                      <img src={img.preview} alt="preview" className="h-full w-full rounded-md object-cover" />
                      <button
                        type="button"
                        onClick={() => removeAnalysisImage(idx)}
                        className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleAddImages}
                  />
                </div>
              </div>
              {scriptError && <p className="mt-2 text-xs text-red-400">{scriptError}</p>}
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
    </div>
  );
};

export default AnalysisStep;
