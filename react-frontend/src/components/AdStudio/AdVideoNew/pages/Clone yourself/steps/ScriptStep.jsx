import { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, X, Loader2 } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import {
  setImageAndScript,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  regenerateCloneScript,
  generateCloneVideo,
} from '@/store/actions/adVideoNew/Advideoactions';
import { globalToast } from '@/utils/globalToast';

const getWordCount = (text) => (text?.trim() ? text.trim().split(/\s+/).length : 0);

const ScriptStep = ({ previewImages = [], onBack, generatedId, handleGenerate }) => {
  const dispatch = useDispatch();
  const [, setSearchParams] = useSearchParams();
  const { imageAndScript, isLoading } = useSelector((state) => state.adVideoNew);

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState(null);
  const [script, setScript] = useState(null);
  const [tone, setTone] = useState('');
  const [carouselIndex, setCarouselIndex] = useState(0);

  const generatedData = useMemo(() => imageAndScript?.data || imageAndScript, [imageAndScript]);

  const currentDataId = useMemo(
    () =>
      imageAndScript?._id ||
      imageAndScript?.id ||
      imageAndScript?.data?._id ||
      imageAndScript?.data?.id ||
      generatedData?._id ||
      generatedData?.id,
    [imageAndScript, generatedData]
  );

  const generationError = useMemo(() => {
    if (generatedData?._id === generatedId || currentDataId === generatedId) {
      if (generatedData?.type === 'error' || generatedData?.status >= 400 || generatedData?.status === 'failed')
        return generatedData?.error || 'Generation failed';
    }
    return null;
  }, [generatedData, generatedId, currentDataId]);

  const isImageFailed = useMemo(
    () => generatedData?.generatedImage === 'failed' || generatedData?.image === 'failed',
    [generatedData]
  );
  const isScriptFailed = useMemo(
    () => generatedData?.generatedScript === 'failed' || generatedData?.text === 'failed',
    [generatedData]
  );

  const isImageLoading = useMemo(() => {
    if (generationError && (generatedData?.type === 'error' || generatedData?.error?.toLowerCase().includes('image'))) return false;
    if (isImageFailed) return false;
    return !(generatedData?.generatedImage || generatedData?.image) || currentDataId !== generatedId;
  }, [generatedData, currentDataId, generatedId, generationError, isImageFailed]);

  const isScriptLoading = useMemo(() => {
    if (generationError && (generatedData?.type === 'error' || generatedData?.error?.toLowerCase().includes('script'))) return false;
    if (isScriptFailed) return false;
    const hasScript = generatedData?.generatedScript || generatedData?.text || generatedData?.creativeBrief?.script;
    return !hasScript || currentDataId !== generatedId;
  }, [generatedData, currentDataId, generatedId, generationError, isScriptFailed]);

  const displayImage = useMemo(() => {
    if (currentDataId === generatedId) {
      const path = generatedData?.generatedImage || generatedData?.image;
      if (path && typeof path === 'string' && path !== 'failed') {
        return path.startsWith('http') ? path : `${import.meta.env.VITE_S3_BASE_URL || ''}${path}`;
      }
    }
    return previewImages[carouselIndex]?.preview || null;
  }, [generatedData, currentDataId, generatedId, previewImages, carouselIndex]);

  useEffect(() => {
    if (generatedData?._id === generatedId || currentDataId === generatedId) {
      // Clone API stores script under generatedScript (object with .script array)
      // or under creativeBrief.script when coming from the generate response
      const fromGeneratedScript = generatedData?.generatedScript;
      const fromCreativeBrief = generatedData?.creativeBrief?.script
        ? { script: generatedData.creativeBrief.script, videoDuration: generatedData.creativeBrief.videoDuration }
        : null;
      const newScript = fromGeneratedScript || fromCreativeBrief || generatedData?.text;
      if (newScript && typeof newScript !== 'string') setScript(newScript);
    }
  }, [generatedData, generatedId, currentDataId]);

  const scriptSegments = useMemo(() => {
    if (!script) return [];
    if (typeof script === 'string') {
      try { return JSON.parse(script).script || []; } catch { return []; }
    }
    return script.script || [];
  }, [script]);

  const isAnySegmentInvalid = useMemo(
    () =>
      scriptSegments.some((s) => {
        const count = getWordCount(s.text);
        return (s.maxWords && count > s.maxWords) || (s.minWords && count < s.minWords);
      }),
    [scriptSegments]
  );

  const handleSegmentChange = (id, newText) => {
    setScript((prev) => {
      if (!prev || typeof prev === 'string') return prev;
      return {
        ...prev,
        script: prev.script.map((s) =>
          s.id === id
            ? { ...s, text: newText, wordCount: getWordCount(newText), charCount: newText.length }
            : s
        ),
      };
    });
  };

  const handleToneChange = async (newTone) => {
    setTone(newTone);
    setIsRegenerating(true);
    setRegenerationError(null);
    try {
      const response = await dispatch(regenerateCloneScript({ id: generatedId, tone: newTone }));
      // response shape: { success, creativeBrief: { script: [...] }, ... }
      const newScriptArr = response?.creativeBrief?.script;
      if (newScriptArr) {
        const newScript = { script: newScriptArr, videoDuration: response.creativeBrief.videoDuration };
        setScript(newScript);
        dispatch(
          setImageAndScript({
            ...(imageAndScript?.data || imageAndScript),
            generatedScript: newScript,
            type: 'both',
            status: 200,
            error: '',
          })
        );
        globalToast.success('Script regenerated successfully!');
      }
    } catch (error) {
      console.error('Regeneration failed:', error);
      setRegenerationError(error.response?.data?.error || error.message || 'Failed to regenerate script');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-3xl border border-black/10 bg-white sm:grid-cols-2 dark:border-[#3a3a3a] dark:bg-[#1c1c1c]">
      {/* Left: preview */}
      <div className="relative h-full min-h-[350px] w-full bg-gray-100 dark:bg-[#1c1c1c]">
        <button
          onClick={onBack}
          disabled={isImageLoading || isScriptLoading || isLoading || isGenerating}
          className={`absolute top-6 left-6 z-10 rounded-full bg-black p-2 text-white hover:bg-black/60 ${
            isImageLoading || isScriptLoading || isLoading || isGenerating ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {isImageLoading && !generationError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gray-100 dark:bg-[#0F0F0F]">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-gray-900 dark:border-white/20 dark:border-t-white" />
            <span className="text-xs font-medium text-gray-500 dark:text-white/60">
              Generating your clone image...
            </span>
          </div>
        ) : isImageFailed || (generationError && generatedData?.error?.toLowerCase().includes('image')) ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gray-100 p-6 text-center dark:bg-[#0F0F0F]">
            <div className="rounded-full bg-red-500/10 p-3">
              <X className="h-8 w-8 text-red-500" />
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {generatedData?.error || 'Failed to generate image'}
            </span>
          </div>
        ) : displayImage ? (
          <img src={displayImage} alt="Clone preview" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-white/40">
            No preview available
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
      </div>

      {/* Right: script */}
      <div className="flex min-h-0 flex-col gap-2 p-5 2xl:p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Generated Script</h3>

        {isScriptLoading || isRegenerating ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl bg-gray-100 dark:bg-[#9092941A]">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-gray-900 dark:border-white/20 dark:border-t-white" />
            <span className="text-xs font-medium text-gray-500 dark:text-white/60">Crafting your script...</span>
          </div>
        ) : isScriptFailed || regenerationError || (generationError && generatedData?.error?.toLowerCase().includes('script')) ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center">
            <div className="rounded-full bg-red-500/10 p-3">
              <X className="h-8 w-8 text-red-500" />
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {regenerationError || generatedData?.error || 'Failed to Generate Script'}
            </span>
          </div>
        ) : (
          <div className="custom-scrollbar flex max-h-[65vh] min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-2xl bg-gray-100 p-4 dark:bg-[#9092941A]">
            <div className="flex gap-4 px-2 text-[10px] font-bold tracking-wider text-gray-500 uppercase dark:text-white/40">
              <div className="w-24 shrink-0">Timestamp</div>
              <div className="flex-1">Script</div>
            </div>
            <div className="custom-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto pr-2">
              {scriptSegments.map((item) => {
                const count = getWordCount(item.text);
                const isOverLimit = count > item.maxWords;
                return (
                  <div key={item.id} className="group flex items-start gap-4">
                    <div className="w-24 shrink-0 pt-3 text-xs font-medium text-gray-500 dark:text-white/50">
                      {item.start} - {item.end}
                    </div>
                    <div className="relative flex-1">
                      <textarea
                        value={item.text}
                        onChange={(e) => handleSegmentChange(item.id, e.target.value)}
                        disabled={isGenerating}
                        className={`custom-scrollbar w-full resize-none rounded-xl border border-transparent bg-white p-3 text-sm text-gray-900 transition-all focus:border-black/20 focus:outline-none dark:bg-[#1C1C1C]/40 dark:text-white/80 dark:focus:border-white/20 ${
                          isOverLimit ? 'border-red-500/50 bg-red-500/5' : 'hover:bg-black/5 dark:hover:bg-[#1C1C1C]/60'
                        } ${isGenerating ? 'cursor-not-allowed opacity-50' : ''}`}
                        rows={2}
                      />
                      {count > item.maxWords && (
                        <p className="mt-1 text-[12px] font-medium text-red-400 italic">
                          Word limit exceeded (Max: {item.maxWords}, Current: {count})
                        </p>
                      )}
                      {count < item.minWords && (
                        <p className="mt-1 text-[12px] font-medium text-yellow-400 italic">
                          Too few words (Min: {item.minWords}, Current: {count})
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!(isImageLoading || isScriptLoading || isRegenerating || generationError || isImageFailed || isScriptFailed) && (
          <div className="mt-4 flex items-center justify-end gap-3 2xl:mb-6">
            <Select value={tone} onValueChange={handleToneChange} disabled={isGenerating}>
              <SelectTrigger className={`backdrop-blur-100 dark:![&>svg]:text-white rounded-full border-none bg-gray-100 px-5! py-4.5 text-sm text-gray-900! hover:bg-black/5! dark:bg-[#9D9B9B80] dark:text-white! dark:hover:bg-[#9D9B9B70]! [&>svg]:size-5 ${isGenerating ? 'cursor-not-allowed opacity-50' : ''}`}>
                <SelectValue placeholder="Select Tone" />
              </SelectTrigger>
              <SelectContent className="z-[999999] min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
                {['Enthusiastic','Casual','Friendly'].map((t) => (
                  <SelectItem key={t} className="text-[10px] 2xl:text-sm" value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!regenerationError && (
              <button
                disabled={isLoading || isImageLoading || isScriptLoading || isRegenerating || isAnySegmentInvalid || isGenerating}
                onClick={async () => {
                  setIsGenerating(true);
                  try {
                    const res = await dispatch(generateCloneVideo(generatedId, { script: { script: scriptSegments } }));
                    if (res) {
                      setSearchParams({}, { replace: true });
                      dispatch(setImageAndScript(null));
                      dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
                      handleGenerate?.();
                    }
                  } catch (err) {
                    console.error('Final generation error:', err);
                    setIsGenerating(false);
                  }
                }}
                className={`rounded-full bg-gray-900 px-8 py-2 text-sm font-bold text-white hover:opacity-90 dark:bg-white dark:text-black dark:hover:bg-white/90 ${
                  isLoading || isImageLoading || isScriptLoading || isRegenerating || isAnySegmentInvalid || isGenerating
                    ? 'cursor-not-allowed opacity-50'
                    : ''
                }`}
              >
                {isGenerating ? <Loader2 className="h-5 w-5 animate-spin text-white dark:text-black" /> : 'Generate'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScriptStep;
