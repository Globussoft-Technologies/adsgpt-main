import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { ChevronLeft } from 'lucide-react';
import {
  setCloneStep,
  setImageAndScript,
  setRecreateInputs,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { getVideoById } from '@/store/actions/adVideoNew/Advideoactions';
import emitter from '@/utils/eventEmitter';
import webcamPlaceholderImg from '@/assets/layouts/adVideoNew/webcamImg.png';
import webcamImgGif from '@/assets/layouts/adVideoNew/webcamImgGif.gif';
import avatarUploadImg from '@/assets/layouts/adVideoNew/avatarUpload.png';
import avatarUploadBgImg from '@/assets/layouts/adVideoNew/avatarUploadBg.png';

import UploadImagesStep from './Clone yourself/steps/UploadImagesStep';
import ConfigStep from './Clone yourself/steps/ConfigStep';
import ScriptStep from './Clone yourself/steps/ScriptStep';
import FaceCaptureGuide from '../FaceCaptureGuide';

// Discard confirmation dialog — reuses same styling as AvatarAdsPage
const DiscardDialog = ({ onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-99999 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="w-[320px] rounded-2xl border border-black/10 bg-white p-6 text-gray-900 shadow-xl dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white">
      <h3 className="mb-2 text-base font-semibold">Discard changes?</h3>
      <p className="mb-6 text-sm text-gray-500 dark:text-white/60">
        Your generated clone image and script will be lost.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-full border border-black/10 px-5 py-2 text-sm text-gray-600 hover:bg-black/5 dark:border-[#3a3a3a] dark:text-white/80 dark:hover:bg-white/10"
        >
          No
        </button>
        <button
          onClick={onConfirm}
          className="rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
        >
          Yes, Discard
        </button>
      </div>
    </div>
  </div>
);

const CloneYourselfPage = ({ handleGenerate }) => {
  const dispatch = useDispatch();
  const { imageAndScript, currentCloneStep, recreateInputs } = useSelector(
    (state) => state.adVideoNew
  );

  const [cloneImages, setCloneImages] = useState([]);
  const [generatedId, setGeneratedId] = useState(
    () => new URLSearchParams(window.location.search).get('id') || null
  );
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const setStep = useCallback((step) => dispatch(setCloneStep(step)), [dispatch]);

  // ── Deep-link resume via ?id= — runs on mount and on every refresh ──────────
  useEffect(() => {
    const idFromUrl = new URLSearchParams(window.location.search).get('id');
    if (!idFromUrl) return;
    setGeneratedId(idFromUrl);
    setStep('script');
    (async () => {
      try {
        const res = await dispatch(getVideoById(idFromUrl));
        // getVideoById returns response.data — unwrap the inner data object
        const videoData = res?.data || res;
        if (videoData) dispatch(setImageAndScript(videoData));
      } catch (err) {
        console.error('Error fetching clone video by id:', err);
      }
    })();
  }, []); // empty deps — only on mount/refresh, searchParams is read directly

  // ── Sync ?id= into URL when in script step ────────────────────────────────
  useEffect(() => {
    if (currentCloneStep === 'script' && generatedId) {
      setSearchParams({ id: generatedId }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [currentCloneStep, generatedId, setSearchParams]);

  // ── Reset on first mount (skip if deep-linking via ?id=) ─────────────────
  useEffect(() => {
    const idFromUrl = searchParams.get('id');
    if (idFromUrl) return; // deep-link — the fetch effect above handles this
    if (currentCloneStep === 'script') return; // already in script step
    dispatch(setImageAndScript(null));
    dispatch(setCloneStep('upload'));
    dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
    setGeneratedId(null);
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recreate flow ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!recreateInputs || recreateInputs.type !== 'clone') return;
    const inputs = recreateInputs;
    if (inputs.uploadedAvatars?.length > 0) {
      setCloneImages(
        inputs.uploadedAvatars.map((url) => ({
          file: null,
          preview: url.startsWith('http') ? url : (import.meta.env.VITE_S3_BASE_URL || '') + url,
        }))
      );
    }
    setStep('config');
  }, [recreateInputs, dispatch]);

  // ── Discard listener (from AdVideoLayout back button) ─────────────────────
  const hasAnyError = useMemo(() => {
    const data = imageAndScript?.data || imageAndScript;
    return data?.generatedImage === 'failed' || data?.generatedScript === 'failed';
  }, [imageAndScript]);

  useEffect(() => {
    const onRequestDiscard = () => {
      if (currentCloneStep === 'script') {
        if (hasAnyError) handleConfirmDiscard();
        else setShowDiscardDialog(true);
      }
    };
    emitter.on('clone:request-discard', onRequestDiscard);
    return () => emitter.off('clone:request-discard', onRequestDiscard);
  }, [currentCloneStep, hasAnyError]);

  const handleConfirmDiscard = () => {
    dispatch(setImageAndScript(null));
    dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
    setGeneratedId(null);
    setCloneImages([]);
    setSearchParams({}, { replace: true });
    setShowDiscardDialog(false);
    setStep('upload');
  };

  return (
    <div className="flex h-full max-h-svh flex-col gap-6 overflow-hidden lg:max-h-[90vh] 2xl:max-h-[calc(95svh-40px)]">
      {/* Step 1: Choose camera or upload */}
      {currentCloneStep === 'upload' && (
        <div className="flex h-full flex-col gap-6 p-6">
          <div className="mx-auto flex max-h-[80vh] w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 rounded-3xl">
            <div className="w-full text-left">
              <h2 className="flex items-center gap-3 text-lg font-semibold text-gray-900 2xl:text-2xl dark:text-white">
                <button
                  onClick={() => dispatch({ type: 'adVideoNew/setActivePage', payload: 'home' })}
                  className="rounded-full p-1 text-gray-500 transition hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                Upload Your Face Angles
              </h2>
              <p className="mt-1 ml-10 text-[11px] font-light text-gray-500 2xl:text-sm dark:text-white/80">
                Add three photos: left, center, and right for Clone Generation
              </p>
            </div>

            <div className="grid min-h-0 w-full flex-1 grid-cols-2 gap-4">
              {/* Use Camera */}
              <button
                onClick={() => setStep('face-capture')}
                className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-3xl border border-[var(--ws-border)] bg-gray-100 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl active:scale-[0.99] dark:border-white/10 dark:bg-[#1c1c1c]"
              >
                <img
                  src={webcamPlaceholderImg}
                  alt="Use Camera"
                  className="h-full w-full object-cover scale-[1.08] transition-all duration-500 ease-out group-hover:scale-112 group-hover:opacity-0"
                />
                <img
                  src={webcamImgGif}
                  alt="Use Camera Animation"
                  className="absolute inset-0 h-full w-full object-cover scale-[1.08] opacity-0 transition-all duration-500 ease-out group-hover:scale-112 group-hover:opacity-100"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent transition-opacity duration-300 group-hover:opacity-95" />

                {/* Dedicated hover border overlay */}
                <div className="pointer-events-none absolute inset-0 z-30 rounded-3xl border-2 border-transparent transition-all duration-300 group-hover:border-[#5867EB] group-hover:shadow-[0_0_20px_rgba(88,103,235,0.35)] dark:group-hover:border-white dark:group-hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]" />

                <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 transform transition-transform duration-300 group-hover:scale-105">
                  <span className="rounded-full bg-white px-6 py-2 text-xs font-semibold whitespace-nowrap text-black shadow-md 2xl:px-8 2xl:py-2.5 2xl:text-base">
                    Use Camera
                  </span>
                </div>
              </button>

              {/* Upload your own images */}
              <button
                onClick={() => setStep('upload-images')}
                className="group relative flex h-full cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border border-[var(--ws-border)] bg-gray-50 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl active:scale-[0.99] dark:border-white/10 dark:bg-[#1c1c1c]"
              >
                <img
                  src={avatarUploadBgImg}
                  className="absolute right-1/4 z-10 h-auto w-62.5 max-w-[70%] -translate-y-6 transform rounded-2xl object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  alt=""
                />
                <img
                  src={avatarUploadImg}
                  className="absolute left-1/3 z-20 h-auto w-52.5 max-w-[60%] rounded-2xl object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  alt=""
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f]/70 via-zinc-200/30 to-transparent transition-opacity duration-300 group-hover:opacity-95 dark:from-[#0f0f0f] dark:via-[#0f0f0f]/0" />

                {/* Dedicated hover border overlay */}
                <div className="pointer-events-none absolute inset-0 z-30 rounded-3xl border-2 border-transparent transition-all duration-300 group-hover:border-[#5867EB] group-hover:shadow-[0_0_20px_rgba(88,103,235,0.35)] dark:group-hover:border-white dark:group-hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]" />

                <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 transform font-semibold whitespace-nowrap text-white transition-transform duration-300 group-hover:scale-105 2xl:text-xl">
                  Upload your own images
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2a: upload face images manually */}
      {currentCloneStep === 'upload-images' && (
        <UploadImagesStep
          onBack={() => setStep('upload')}
          onComplete={(images) => {
            setCloneImages(images);
            setStep('config');
          }}
        />
      )}

      {/* Step 2b: face-capture via webcam */}
      {currentCloneStep === 'face-capture' && (
        <FaceCaptureGuide
          onBack={() => setStep('upload')}
          onSubmit={(captures) => {
            const imgs = ['front', 'left', 'right']
              .map((key) => (captures[key] ? { file: null, preview: captures[key] } : null))
              .filter(Boolean);
            setCloneImages(imgs);
            setStep('config');
          }}
        />
      )}

      {/* Step: configure & generate */}
      {currentCloneStep === 'config' && (
        <ConfigStep
          customAvatarImages={cloneImages}
          recreateData={recreateInputs?.type === 'clone' ? recreateInputs : null}
          onBack={() => {
            setCloneImages([]);
            dispatch(setRecreateInputs(null));
            setStep('upload');
          }}
          onGenerate={(id) => {
            setGeneratedId(id);
            setStep('script');
          }}
        />
      )}

      {/* Step: review & generate final video */}
      {currentCloneStep === 'script' && (
        <ScriptStep
          previewImages={cloneImages}
          onBack={() => {
            if (hasAnyError) handleConfirmDiscard();
            else setShowDiscardDialog(true);
          }}
          generatedId={generatedId}
          handleGenerate={handleGenerate}
        />
      )}

      {showDiscardDialog && (
        <DiscardDialog
          onConfirm={handleConfirmDiscard}
          onCancel={() => setShowDiscardDialog(false)}
        />
      )}
    </div>
  );
};

export default CloneYourselfPage;
