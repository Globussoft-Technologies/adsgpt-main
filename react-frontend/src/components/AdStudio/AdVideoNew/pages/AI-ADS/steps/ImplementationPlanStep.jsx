import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw, Send } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { regenerateAiAdsSceneAction, generateAiAdsVideoAction } from '@/store/actions/adVideoNew/Advideoactions';
import { setAiAdsSceneError } from '@/store/reducers/adStudio/adVideoNewSlice';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';

const CustomLoader = ({ label }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-4">
    <div className="relative h-6 w-6 animate-spin">
      <svg viewBox="0 0 50 50" className="h-full w-full">
        <circle cx="25" cy="25" r="20" fill="none" className="stroke-gray-300 dark:stroke-[#6b6b6b]" strokeWidth="5" />
        <path d="M25 5A20 20 0 0 1 45 25" fill="none" className="stroke-gray-900 dark:stroke-white" strokeWidth="5" strokeLinecap="round" />
      </svg>
    </div>
    <span className="text-[11px] font-medium text-gray-900 dark:text-white 2xl:text-xs">{label}</span>
  </div>
);

const RegenerateButton = ({ onClick, disabled, label = 'Re-generate' }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
    disabled={disabled}
    className="flex items-center gap-1 rounded-md border border-white/30 bg-black px-2 py-1 text-[11px] font-medium text-white transition  disabled:cursor-not-allowed disabled:opacity-40"
    title={label}
  >
    <RefreshCw className="h-3 w-3" />
    <span>{label}</span>
  </button>
);

// Per-scene image failure card — clicking Re-generate opens the same prompt
// overlay as the regular Re-generate flow so the user can guide the retry.
const SceneImageFailed = ({ onRetry, disabled, message }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
      <AlertTriangle className="h-6 w-6 text-red-400" />
    </div>
    <span className="text-[11px] font-medium text-white/70 2xl:text-xs">
      {message || 'Image generation failed'}
    </span>
    <span className="text-[12px] font-medium text-white/70">
      However your credits are not deducted
    </span>
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onRetry(); }}
      disabled={disabled}
      className="flex items-center gap-1 rounded-md border border-white/30 bg-black px-3 py-1 text-[11px] font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RefreshCw className="h-3 w-3" />
      <span>Re-generate</span>
    </button>
  </div>
);



const SCENES_PER_PAGE = 1;

const ImplementationPlanStep = ({ canGoBack, onBack, onNext, onClose, onRetryToForm, handleGenerate }) => {
  const dispatch = useDispatch();
  const sceneData = useSelector((state) => state.adVideoNew.aiAdsSceneData);
  const isLoading = useSelector((state) => state.adVideoNew.aiAdsSceneLoading);
  const sceneError = useSelector((state) => state.adVideoNew.aiAdsSceneError);

  const sessionId =
    sceneData?._id ||
    sceneData?.data?._id ||
    new URLSearchParams(window.location.search).get('id') ||
    null;

  const scenes = sceneData?.data?.scenes || sceneData?.scenes || [];
  const sessionStatus = sceneData?.data?.status || sceneData?.status;
  const isPending = sessionStatus === 'pending';
  const isEffectivelyLoading = isLoading || (isPending && scenes.length === 0);
  // Initial loading: scripts haven't arrived yet — used to block close + navigation
  const isInitialLoading = scenes.length === 0;
  const isGenerated = scenes.length > 0 && !isEffectivelyLoading;
  // Generate Video unlocks only when every scene has a frame and none failed
  const allImagesReady =
    scenes.length > 0 &&
    scenes.every((s) => s.frameImageUrl && !s.imageFailed);
  // True while at least one scene is still pending (no result, not failed)
  const isStillGenerating =
    scenes.length > 0 &&
    scenes.some((s) => !s.frameImageUrl && !s.imageFailed);

  const totalPages = Math.ceil(scenes.length / SCENES_PER_PAGE);
  const [page, setPage] = useState(0);
  const visibleScenes = scenes.slice(page * SCENES_PER_PAGE, (page + 1) * SCENES_PER_PAGE);
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  // { [sceneIndex]: 'image' | 'text' | 'both' } — which parts are regenerating
  const [regeneratingMap, setRegeneratingMap] = useState({});
  const regenInFlightRef = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [lightbox, setLightbox] = useState({ open: false, images: [], index: 0 });
  // { [sceneIndex]: { [lineId]: editedText } }
  const [editedLines, setEditedLines] = useState({});
  // { [sceneIndex]: { [lineId]: errorMessage } }
  const [lineErrors, setLineErrors] = useState({});
  // confirmation modal state
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    onConfirm: null,
  });
  // image prompt overlay — which scene's overlay is open + the typed prompt
  const [imagePromptIdx, setImagePromptIdx] = useState(null);
  const [imagePromptText, setImagePromptText] = useState('');
  const openLightbox = (images, index) => setLightbox({ open: true, images, index });
  const closeLightbox = () => setLightbox((prev) => ({ ...prev, open: false }));

  const closeConfirm = () =>
    setConfirmDialog({ open: false, title: '', message: '', confirmLabel: 'Confirm', onConfirm: null });

  const askConfirm = ({ title, message, confirmLabel = 'Confirm', onConfirm }) => {
    setConfirmDialog({ open: true, title, message, confirmLabel, onConfirm });
  };

  const isRegenerating = Object.keys(regeneratingMap).length > 0;

  const handleRegenerateOne = async (globalIdx, type, prompt) => {
    if (!sessionId) return;
    const scene = scenes[globalIdx];
    // `deduct` tells the backend whether this scene already had a working
    // image. true → user is replacing a working image (paid 2 credits on
    // success). false → user is recovering from a failure that never produced
    // an image (free retry until first success). Backend validates this flag
    // against DB to prevent the frontend from underpaying.
    const deduct = !!(scene?.frameImageUrl || scene?.imageUrl || scene?.image);
    const segment = {
      segmentNumber: scene?.segmentNumber ?? globalIdx + 1,
      regenerate: type,
      deduct,
      ...(type === 'text'
        ? { regeneratePrompt: '' }
        : prompt && prompt.trim()
          ? { regeneratePrompt: prompt.trim() }
          : {}),
    };
    setRegeneratingMap({ [globalIdx]: type });
    regenInFlightRef.current = true;
    try {
      await dispatch(regenerateAiAdsSceneAction(sessionId, [segment]));
    } catch {
      regenInFlightRef.current = false;
      setRegeneratingMap({});
    }
  };

  // Clear regeneratingMap only after a regen we dispatched finishes (isLoading → false)
  useEffect(() => {
    if (!isLoading && regenInFlightRef.current) {
      regenInFlightRef.current = false;
      setRegeneratingMap({});
    }
  }, [isLoading]);

  const handleGenerateClick = async () => {
    if (!sessionId) return;
    setGenerating(true);
    try {
      // Build the current script for every scene (with any user edits applied
      // via editedLines). Node persists this to DB and forwards to Python in
      // place of the originals.
      //
      // Important: Python reads `voice` (format: "[tone] <text>"), NOT `text`,
      // when synthesizing audio. When the user edits text, we must rebuild
      // voice as "[tone] <new text>" — preserve the bracketed tone marker,
      // replace the text portion. Otherwise Python speaks the old text even
      // though the UI shows the edited one.
      const sceneScripts = scenes
        .filter((scene) => Array.isArray(scene.script))
        .map((scene, idx) => ({
          segmentNumber: scene.segmentNumber,
          script: scene.script.map((line) => {
            const newText = editedLines[idx]?.[line.id] ?? line.text;
            let newVoice = line.voice;
            if (newText !== line.text && typeof line.voice === 'string') {
              const toneMatch = line.voice.match(/^(\[[^\]]+\]\s*)/);
              const tonePrefix = toneMatch ? toneMatch[1] : '';
              newVoice = `${tonePrefix}${newText}`;
            }
            return {
              ...line,
              text: newText,
              voice: newVoice,
            };
          }),
        }));

      await dispatch(
        generateAiAdsVideoAction(sessionId, { scenes: sceneScripts })
      );
      // Trigger genie animation + navigate to MySpace via layout
      if (handleGenerate) {
        handleGenerate();
      } else {
        onNext();
      }
    } catch {
      // error toasted in action
    } finally {
      setGenerating(false);
    }
  };

  // "Try Again" returns the user to the pre-filled Details form (same as the
  // Back button), so they can review/tweak their inputs and hit Next to run a
  // fresh generation — which mints a new sessionId, exactly like the first
  // pass. Clears the error so the form isn't blocked. Falls back to onBack if
  // the retry-to-form handler isn't provided.
  const handleRetry = () => {
    dispatch(setAiAdsSceneError(null));
    (onRetryToForm || onBack)?.();
  };

  const getLineText = (globalIdx, lineId, originalText) =>
    editedLines[globalIdx]?.[lineId] ?? originalText;

  const validateLine = (text, maxChars) => {
    const count = text.length;
    if (!text.trim()) return 'script is required';
    if (maxChars && count > maxChars) {
      return `Max ${maxChars} character${maxChars > 1 ? 's' : ''} allowed (currently ${count})`;
    }
    return null;
  };

  const handleLineChange = (globalIdx, lineId, value, maxChars) => {
    setEditedLines((prev) => ({
      ...prev,
      [globalIdx]: { ...prev[globalIdx], [lineId]: value },
    }));
    const error = validateLine(value, maxChars);
    setLineErrors((prev) => ({
      ...prev,
      [globalIdx]: { ...prev[globalIdx], [lineId]: error },
    }));
  };

  const hasLineErrors = Object.values(lineErrors).some((sceneErrs) =>
    Object.values(sceneErrs).some((e) => e !== null)
  );


  return (
    <div className="relative flex h-full max-h-[100vh] min-h-[500px] rounded-3xl w-screen max-w-[450px] min-w-[450px] flex-col bg-white dark:bg-[#303030]/30 px-1 pt-6 pb-3 md:max-w-[750px] 2xl:max-h-[80vh] 2xl:min-h-[600px] 2xl:max-w-[850px]">
      {/* Close Button — disabled until ALL scenes (scripts + images) are
          ready, and during per-scene regen. Only enabled when full session
          is complete, or in error state (so user can dismiss the error). */}
      <button
        onClick={onClose}
        disabled={(isInitialLoading || isStillGenerating || isRegenerating) && !sceneError}
        className={`pointer-events-auto absolute top-6 right-6 z-50 transition ${
          (isInitialLoading || isStillGenerating || isRegenerating) && !sceneError
            ? 'cursor-not-allowed text-gray-400 dark:text-white/20'
            : 'cursor-pointer text-gray-500 dark:text-white/50 hover:text-black dark:hover:text-white'
        }`}
        title={
          (isInitialLoading || isStillGenerating) && !sceneError
            ? 'Wait until scene generation finishes'
            : isRegenerating && !sceneError
              ? 'Wait until regeneration finishes'
              : 'Close'
        }
      >
        <X className="h-6 w-6" />
      </button>

      {/* Error State — full panel */}
      {sceneError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center sm:px-12">
          {/* Pulsing ring */}
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center 2xl:h-24 2xl:w-24">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/20" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 2xl:h-20 2xl:w-20">
              <AlertTriangle className="h-7 w-7 text-red-400 2xl:h-9 2xl:w-9" />
            </div>
          </div>

          {/* Message */}
          <div className="flex w-full flex-col items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white 2xl:text-lg">Scene Generation Failed</h3>
            <p className="w-full max-w-sm text-[13px] leading-relaxed text-gray-500 dark:text-white/55 2xl:text-sm">
              {typeof sceneError === 'string' && sceneError
                ? sceneError
                : "We couldn't generate your AI ad scenes this time. Please try again."}
            </p>
          </div>

          {/* Try Again button — returns to the pre-filled Details form */}
          <button
            type="button"
            onClick={handleRetry}
            className="mt-2 flex items-center gap-2 rounded-md border border-black/20 dark:border-white/20 bg-gray-900 text-white dark:bg-white px-5 py-2 text-sm font-semibold dark:text-black transition hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" />
            Try Again
          </button>
        </div>
      )}

      {/* Normal / Loading content */}
      {!sceneError && (
        <>
          {/* Prev Arrow — only blocked when scripts haven't arrived yet (not during per-scene regen) */}
          <button
            onClick={() => canPrev && setPage((p) => p - 1)}
            disabled={!canPrev || isInitialLoading}
            className={`absolute top-[40%] -left-12 sm:-left-20 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 dark:border-white/20 bg-black/5 dark:bg-[#5B5B5B]/20 text-gray-900 dark:text-white transition 2xl:-left-25 2xl:h-12 2xl:w-12 ${
              canPrev && !isInitialLoading ? 'hover:bg-black/5 dark:hover:bg-white/10' : 'cursor-not-allowed opacity-30'
            }`}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* Next Arrow — only blocked when scripts haven't arrived yet (not during per-scene regen) */}
          <button
            onClick={() => canNext && setPage((p) => p + 1)}
            disabled={!canNext || isInitialLoading}
            className={`absolute top-[40%] -right-12 sm:-right-20 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 dark:border-white/20 bg-black/5 dark:bg-[#5B5B5B]/20 text-gray-900 dark:text-white transition 2xl:-right-25 2xl:h-12 2xl:w-12 ${
              canNext && !isInitialLoading ? 'hover:bg-black/5 dark:hover:bg-white/10' : 'cursor-not-allowed opacity-30'
            }`}
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          <div className="relative m-auto flex w-full flex-col overflow-y-auto p-4 2xl:p-5">
            {/* Header */}
            <h2 className="mt-4 mb-8 text-center text-lg font-semibold text-gray-900 dark:text-white 2xl:mt-3 2xl:mb-10 2xl:text-xl">
              AI Video Implementation Plan
            </h2>

            {/* Content Grid */}
          <div className="flex w-full flex-col">
  {isEffectivelyLoading && !isRegenerating ? (
    <div className="flex gap-4">
      {/* Image Loader */}
      <div className="relative h-[420px] w-[280px] overflow-hidden rounded-md border border-black/10 dark:border-white/20 bg-gray-100 dark:bg-[#100F0F]">
        <CustomLoader label="Generating Image" />
      </div>

      {/* Script Loader */}
      <div className="flex h-[420px] flex-1 flex-col rounded-md border border-black/10 dark:border-white/20 bg-gray-50 dark:bg-[#100F0F] p-4">
        <CustomLoader label="Generating Script" />
      </div>
    </div>
  ) : (
    visibleScenes.map((scene, localIdx) => {
      const globalIdx = page * SCENES_PER_PAGE + localIdx;

      const regenType = regeneratingMap[globalIdx];
      const regenImage = regenType === 'image' || regenType === 'both';
      const regenText = regenType === 'text' || regenType === 'both';


      return (
        <div
          key={globalIdx}
          className="flex gap-4"
        >
          {/* LEFT IMAGE */}
          <div className="relative h-[420px] w-[280px] shrink-0 overflow-hidden rounded-md border border-black/10 dark:border-white/20 bg-gray-100 dark:bg-[#100F0F]">
            {regenImage ? (
              <CustomLoader label="Generating Image" />
            ) : scene.imageFailed ? (
              <SceneImageFailed
                onRetry={() => handleRegenerateOne(globalIdx, 'image')}
                disabled={isRegenerating}
                message={scene.imageError}
              />
            ) : !(scene.frameImageUrl || scene.imageUrl || scene.image) ? (
              <CustomLoader label="Generating Image" />
            ) : (
              <>
                <img
                  src={scene.frameImageUrl || scene.imageUrl || scene.image}
                  alt={`Scene ${globalIdx + 1}`}
                  className="h-full w-full cursor-pointer object-cover"
                  onClick={() => {
                    const allImages = visibleScenes
                      .map((s) => s.frameImageUrl || s.imageUrl || s.image)
                      .filter(Boolean);

                    openLightbox(allImages, localIdx);
                  }}
                />

                <div className="absolute top-2 right-2 z-10">
                  <RegenerateButton
                    onClick={() => {
                      setImagePromptIdx(globalIdx);
                      setImagePromptText('');
                    }}
                    disabled={isRegenerating}
                  />
                </div>
              </>
            )}

            {/* Image prompt overlay — rendered outside conditional so it
                appears over both the failed state AND the successful image. */}
            {imagePromptIdx === globalIdx && (
              <div className="absolute inset-x-2 bottom-2 z-20 flex h-[32%] items-end">
                <div className="flex w-full flex-col gap-1.5 rounded-lg border border-white/15 bg-black/80 p-2 backdrop-blur">
                  <textarea
                    autoFocus
                    rows={3}
                    value={imagePromptText}
                    onChange={(e) => setImagePromptText(e.target.value)}
                    placeholder="Describe the changes…"
                    className="custom-scrollbar w-full flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1 text-xs text-white placeholder:text-white/50 focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setImagePromptIdx(null);
                        setImagePromptText('');
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white"
                      title="Close"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    {imagePromptText.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          const promptToSend = imagePromptText;
                          askConfirm({
                            title: 'Regenerate Image',
                            message: <>We will use the AdsGPT Video Model to Re-generate this image, and <strong className="text-gray-900 dark:text-white">2 credits</strong> will be deducted for the process do you want to continue?</>,
                            confirmLabel: 'Regenerate',
                            onConfirm: () => {
                              closeConfirm();
                              setImagePromptIdx(null);
                              setImagePromptText('');
                              handleRegenerateOne(globalIdx, 'image', promptToSend);
                            },
                          });
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-black transition hover:opacity-90"
                        title="Submit prompt"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT CONTENT */}
          <div className="relative flex h-[420px] flex-1 flex-col rounded-md border border-black/10 dark:border-white/20 bg-gray-50 dark:bg-[#100F0F] p-4">
            {regenText ? (
              <CustomLoader label="Generating Script" />
            ) : (
              <>
                <div className="absolute top-3 right-3 z-10">
                  <RegenerateButton
                    onClick={() =>
                      askConfirm({
                        title: 'Regenerate Script',
                        message: 'Are you sure you want to regenerate this scene\u2019s script? Any edits in the script will be replaced.',
                        confirmLabel: 'Regenerate',
                        onConfirm: () => {
                          closeConfirm();
                          handleRegenerateOne(globalIdx, 'text');
                        },
                      })
                    }
                    disabled={isRegenerating}
                  />
                </div>

                <div className="custom-scrollbar mt-2 flex flex-1 flex-col gap-4 overflow-y-auto pr-6">
                  {/* Scene Description */}
                  {scene.sceneDescription && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
                        Scene Description
                      </h3>

                      <p className="text-sm leading-relaxed text-gray-500 dark:text-white/80">
                        {scene.sceneDescription}
                      </p>
                    </div>
                  )}

                  {/* Script */}
                  {Array.isArray(scene.script) &&
                    scene.script.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                          Script
                        </h3>

                        {scene.script.map((line) => {
                          const currentText = getLineText(
                            globalIdx,
                            line.id,
                            line.text
                          );

                          const error =
                            lineErrors[globalIdx]?.[line.id] ?? null;

                          return (
                            <div
                              key={line.id}
                              className="flex flex-col gap-1"
                            >
                              <span className="text-[11px] text-gray-500 dark:text-white/80 font-bold">
                                {line.start} – {line.end}
                              </span>

                              <input
                                type="text"
                                value={currentText}
                                maxLength={line.charCount || undefined}
                                onChange={(e) =>
                                  handleLineChange(
                                    globalIdx,
                                    line.id,
                                    e.target.value,
                                    line.charCount
                                  )
                                }
                                onKeyDown={(e) => {
                                  const isPrintable =
                                    e.key.length === 1 &&
                                    !e.ctrlKey &&
                                    !e.metaKey &&
                                    !e.altKey;
                                  const atLimit =
                                    line.charCount > 0 &&
                                    currentText.length >= line.charCount;
                                  if (isPrintable && atLimit) {
                                    setLineErrors((prev) => ({
                                      ...prev,
                                      [globalIdx]: {
                                        ...prev[globalIdx],
                                        [line.id]: `Max ${line.charCount} characters allowed`,
                                      },
                                    }));
                                  }
                                }}
                                onPaste={(e) => {
                                  if (!line.charCount) return;
                                  const pasted = e.clipboardData?.getData('text') || '';
                                  if (currentText.length + pasted.length > line.charCount) {
                                    setLineErrors((prev) => ({
                                      ...prev,
                                      [globalIdx]: {
                                        ...prev[globalIdx],
                                        [line.id]: `Max ${line.charCount} characters allowed`,
                                      },
                                    }));
                                  }
                                }}
                                className={`w-full rounded border bg-black/5 dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none transition focus:bg-black/5 dark:focus:bg-white/10 ${
                                  error
                                    ? 'border-red-500/70'
                                    : 'border-transparent'
                                }`}
                              />

                              {error && (
                                <span className="text-[11px] text-red-400">
                                  {error}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>
              </>
            )}
          </div>
        </div>
      );
    })
  )}
</div>

            {/* Page indicator — only when multiple pages */}
            {totalPages > 1 && (
              <div className="mt-4 flex justify-center gap-1.5">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === page ? 'w-4 bg-gray-900 dark:bg-white' : 'w-1.5 bg-black/20 dark:bg-white/30'
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Footer Actions — Back only when reached from details form, Generate on last scene page */}
            <div className="mt-8 flex items-center justify-between gap-3 2xl:mt-10">
                {canGoBack && !isInitialLoading && (
                  <button
                    disabled={isEffectivelyLoading}
                    onClick={onBack}
                    className="rounded-sm border border-black/20 dark:border-[#efefef]/70 px-4 py-1.5 text-sm font-medium text-gray-900 dark:text-white transition hover:bg-black/5 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Back
                  </button>
                )}
                {isGenerated && page === totalPages - 1 && (
                <button
                  disabled={!allImagesReady || generating || hasLineErrors}
                  onClick={() =>
                    askConfirm({
                      title: 'Generate Video',
                      message:
                        'Are you sure you want to generate the video? This will use your credits and start the rendering process.',
                      confirmLabel: 'Generate',
                      onConfirm: () => {
                        closeConfirm();
                        handleGenerateClick();
                      },
                    })
                  }
                  className={`min-w-35 rounded-sm px-8 py-1.5 text-sm font-medium transition ${
                    allImagesReady && !generating && !hasLineErrors
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-black hover:opacity-90 dark:hover:bg-white/90'
                      : 'cursor-not-allowed bg-black/10 text-gray-400 dark:bg-white/20 dark:text-white/40'
                  }`}
                  title={!allImagesReady ? 'Waiting for all scene images to finish generating' : ''}
                >
                  {generating ? 'Generating...' : 'Generate'}
                </button>
                )}
              </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {lightbox.open && (
          <ShowLightBox
            images={lightbox.images}
            lightboxImage={lightbox.images[lightbox.index]}
            closeLightbox={closeLightbox}
          />
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      {confirmDialog.open && (
        <div
          className="absolute inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeConfirm}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[90%] max-w-[360px] rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1C1C1F] p-5 shadow-2xl"
          >
            <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">
              {confirmDialog.title}
            </h3>
            <p className="mb-5 text-sm leading-relaxed text-gray-500 dark:text-white/70">
              {confirmDialog.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeConfirm}
                className="rounded-md border border-black/20 dark:border-white/20 px-4 py-1.5 text-sm font-medium text-gray-900 dark:text-white transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDialog.onConfirm?.()}
                className="rounded-md bg-gray-900 text-white dark:bg-white px-4 py-1.5 text-sm font-semibold dark:text-black transition hover:opacity-90"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImplementationPlanStep;
