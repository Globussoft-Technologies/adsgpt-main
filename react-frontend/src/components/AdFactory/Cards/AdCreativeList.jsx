import CreativeGeneratingLoader from '@/components/AdStudio/AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { useDownloadWithFormat } from '@/hooks/useDownloadWithFormat';
import { fetchAdFactoryHistory } from '@/store/actions/adFactoryNew/adFactoryActions';
import { AnimatePresence } from 'framer-motion';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Download, Pencil, ChevronDown, Filter, Package, Loader2, Info, Copy } from 'lucide-react';
import ImageFormatDialog from '@/components/BrandIQ/ImageFormating/ImageFormatDialog';
import { setEditorFields } from '@/store/reducers/adStudio/editorSlice';
const EXPIRED_URL = import.meta.env.VITE_EXPIRED_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const VITE_MODE = import.meta.env.VITE_MODE;
import { downloadaszip } from '@/store/actions/adFactoryNew/adFactoryActions';
import { checkCanvaAuth } from '@/apis/canva/canvaApi';
import canvaIconLogo from '@/assets/layouts/Canva Icon logo_32x32.png';

import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

const CANVA_CLIENT_ID = import.meta.env.VITE_CANVA_CLIENT_ID;
const CANVA_REDIRECT_URI = import.meta.env.VITE_CANVA_REDIRECT_URI;
const CANVA_SCOPES = import.meta.env.VITE_CANVA_SCOPES;
const CANVA_ENABLED = import.meta.env.VITE_ENABLE_CANVA === 'true';
const BACKEND_URL = import.meta.env.VITE_SOCKET_URL;
export const AdCreativeList = ({ onImageClick, renderHeaderDownloadButton }) => {
  const [selected, setSelected] = useState(null);
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState('all');
  const [selectedHistoryVersionIndex, setSelectedHistoryVersionIndex] = useState('all');
  const [hasFetchedHistory, setHasFetchedHistory] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const [canvaLoadingKey, setCanvaLoadingKey] = useState(null);
  const userId = useSelector((state) => state.socket?.userData?.user_id);

  const handleEditWithCanva = async (e, imageUrl) => {
    e.stopPropagation();
    if (!imageUrl) return;
    setCanvaLoadingKey(imageUrl);
    try {
      const result = await checkCanvaAuth(imageUrl, 'image');
      if (result.status) {
        window.location.href = `${BACKEND_URL}/adsgpt/canva/v2/upload?id=${userId}&url=${encodeURIComponent(imageUrl)}&type=image`;
      } else {
        const { state, codeChallenge } = result;
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: CANVA_CLIENT_ID,
          redirect_uri: CANVA_REDIRECT_URI,
          scope: CANVA_SCOPES,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        });
        window.location.href = `https://www.canva.com/api/oauth/authorize?${params.toString()}`;
      }
      // keep loading=true — redirect is in progress, spinner stays until page unloads
    } catch (err) {
      console.error('Canva auth error:', err);
      setCanvaLoadingKey(null);
    }
  };
  const [loadedImages, setLoadedImages] = useState({});
  const { userData } = useSelector((state) => state?.socket);
  const { results, history, productionAndServices } = useSelector((state) => state?.adFactoryNew);

  const imageModelLabel = useMemo(() => {
    const imageService = productionAndServices?.servicesSelected?.find(
      (s) => s.serviceName === 'image'
    );
    const model = imageService?.serviceParams?.model;
    const labelMap = {
      google: 'Nano Banana Pro',
      openai: 'OpenAI 1.5',
      openai2: 'OpenAI 2.0',
      auto: 'Auto',
    };
    return model ? (labelMap[model] || model) : null;
  }, [productionAndServices]);
  const queryCampaignId = searchParams.get('campaignId');
  const { handleDownloadWithFormat } = useDownloadWithFormat();
  const [isDownloadingViaAPI, setIsDownloadingViaAPI] = useState(false);

  // Extract history data
  const historyData = useMemo(() => (Array.isArray(history) ? history : []), [history]);

  // Extract current images
  const currentImages = useMemo(() => results?.image || [], [results?.image]);

  // Get all historical images for display
  const allHistoryImages = useMemo(() => {
    const images = [];

    historyData
      ?.filter((item) => item?.previousData?.results?.image?.length > 0)
      ?.sort((a, b) => b?.version - a?.version) // Sort by version descending (newest first)
      ?.forEach((historyItem) => {
        const historyImages = historyItem?.previousData?.results?.image || [];
        const historyImageModel = historyItem?.previousData?.services?.servicesSelected?.find(
          (s) => s.serviceName === 'image'
        )?.serviceParams?.model;
        historyImages?.forEach((img, index) => {
          images.push({
            ...img,
            historyVersion: historyItem?.version,
            historyId: historyItem?._id,
            historyIndex: index,
            createdAt: historyItem?.createdAt,
            campaignName: historyItem?.previousData?.metadata?.campaignName,
            fullUrl: img?.data ? `${S3_BASE_URL}${img?.data}` : null,
            version: historyItem?.version, // Add version for display
            editImage: img?.data,
            imagePath: img?.data, // Store the path for download
            imageModel: historyImageModel || null,
          });
        });
      });

    return images;
  }, [historyData]);

  // Get current images with full URLs
  const currentImagesWithUrls = useMemo(() => {
    return currentImages?.map((img, index) => ({
      ...img,
      index,
      fullUrl: img?.data ? `${S3_BASE_URL}${img?.data}` : null,
      isCurrent: true,
      editImage: img?.data,
      imagePath: img?.data,
    }));
  }, [currentImages]);

  // Get images for specific version
  const singleVersionImages = useMemo(() => {
    if (selectedHistoryVersion === 'all') return [];

    const historyItem = historyData?.find((item) => item?._id === selectedHistoryVersion);
    if (!historyItem) return [];

    const images = historyItem?.previousData?.results?.image || [];
    return images?.map((img, index) => ({
      ...img,
      historyVersion: historyItem?.version,
      historyId: historyItem?._id,
      historyIndex: index,
      createdAt: historyItem?.createdAt,
      campaignName: historyItem?.previousData?.metadata?.campaignName,
      fullUrl: img?.data ? `${S3_BASE_URL}${img?.data}` : null,
      version: historyItem?.version,
      imagePath: img?.data,
      editImage: img?.data,
    }));
  }, [selectedHistoryVersion, historyData]);

  // Determine which images to display
  const displayHistoryImages =
    selectedHistoryVersion === 'all' ? allHistoryImages : singleVersionImages;

  // Get all visible images for ZIP download (current + filtered history)
  const allVisibleImages = useMemo(() => {
    const images = [];

    // Add current images
    if (currentImagesWithUrls?.length > 0) {
      currentImagesWithUrls.forEach((img, index) => {
        images.push({
          ...img,
          isCurrent: true,
          fileName: `current_image_${index + 1}.jpg`,
          folder: 'Current Images',
        });
      });
    }

    // Add history images based on filter
    displayHistoryImages?.forEach((img, index) => {
      const versionLabel =
        selectedHistoryVersion === 'all'
          ? `version_${img?.version}`
          : `version_${selectedHistoryVersionIndex}`;

      images.push({
        ...img,
        isCurrent: false,
        fileName: `history_${versionLabel}_${index + 1}.jpg`,
        folder: `History/${versionLabel}`,
      });
    });

    return images;
  }, [
    currentImagesWithUrls,
    displayHistoryImages,
    selectedHistoryVersion,
    selectedHistoryVersionIndex,
  ]);

  // Get unique versions for filter buttons
  const availableVersions = useMemo(() => {
    const versions = new Set();
    historyData?.forEach((item) => {
      if (item?.previousData?.results?.image?.length > 0) {
        versions.add({ id: item?._id, version: item?.version });
      }
    });
    return Array.from(versions).sort((a, b) => b?.version - a?.version);
  }, [historyData]);

  // Fetch history data once when component mounts
  useEffect(() => {
    if (queryCampaignId && userData?.user_id && !hasFetchedHistory) {
      const campaignPayload = {
        campaignId: queryCampaignId,
        userId: userData?.user_id,
      };
      dispatch(fetchAdFactoryHistory(campaignPayload));
      setHasFetchedHistory(true);
    }
  }, [dispatch, queryCampaignId, userData?.user_id, hasFetchedHistory]);

  // Handle image loading
  useEffect(() => {
    // Only reset loaded images for history when version changes
    const newLoadedState = { ...loadedImages };

    // Keep current image loaded states
    Object.keys(loadedImages).forEach((key) => {
      if (key.startsWith('current-')) {
        newLoadedState[key] = loadedImages[key];
      }
    });

    setLoadedImages(newLoadedState);
  }, [selectedHistoryVersion]);

  const handleImageClick = (item, key, index, images) => {
    if (item?.status === 200 && item?.fullUrl) {
      setSelectedImageUrl(item?.fullUrl);
      // setIsModalOpen(true);
      if (onImageClick) {
        onImageClick(item?.fullUrl, index, images);
      }
    }
  };

  const handleImageLoad = (key) => {
    setLoadedImages((prev) => ({ ...prev, [key]: true }));
  };

  const handleImageError = (key) => {
    setLoadedImages((prev) => ({ ...prev, [key]: 'error' }));
  };

  const openLightbox = (
    baseImage,
    logoImage,
    baseWithLogoImage,
    botId,
    adIndex,
    editorType,
    campaignId = '',
    historyId = '',
    contextType = ''
  ) => {
    if (baseWithLogoImage == EXPIRED_URL) {
      window.open(import.meta.env.VITE_SIGNUP_URL, '_blank');
      return;
    }
    dispatch(
      setEditorFields({
        baseImage,
        logoImage,
        baseWithLogoImage,
        botId,
        adIndex,
        campaignId,
        historyId,
        contextType,
        isEditorOpen: true,
        isOldEditorOpen: editorType === 'old' ? true : false,
      })
    );
  };

  // Get current filter label
  const getCurrentFilterLabel = () => {
    if (selectedHistoryVersion === 'all') return 'All Versions';
    const selectedVersion = availableVersions.find((v) => v.id === selectedHistoryVersion);
    return selectedVersion ? `Version ${selectedHistoryVersionIndex}` : 'Select Version';
  };

  // Helper function to prepare image URLs for API
  const prepareImageUrlsForAPI = (images) => {
    return images.filter((img) => img?.status === 200 && img?.fullUrl).map((img) => img.fullUrl);
  };

  // Download all visible images via API
  const downloadAllImagesAsZipViaAPI = async () => {
    if (allVisibleImages.length === 0) return;

    try {
      setIsDownloadingViaAPI(true);
      setDownloadProgress(0);

      // Prepare image URLs
      const imageUrls = prepareImageUrlsForAPI(allVisibleImages);

      if (imageUrls.length === 0) {
        alert('No valid images to download');
        return;
      }

      // Prepare payload
      const payload = {
        image_urls: imageUrls,
      };
      console.log(payload, 'hwvgfuwegfuwgweufgweufgug ');
      // Dispatch the API call
      const result = await dispatch(downloadaszip(payload)).unwrap();

      // Create download link for blob
      const url = window.URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename || `creative_images_${imageUrls.length}_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('API ZIP download failed:', error);
      alert(`Failed to download via API: ${error.message || 'Unknown error'}`);

      // Optional: Fallback to client-side ZIP creation
      // await downloadAllImagesAsZip();
    } finally {
      setIsDownloadingViaAPI(false);
      setDownloadProgress(0);
    }
  };

  // Download specific set via API
  const downloadSelectedSetViaAPI = async (images, setName) => {
    const imageUrls = prepareImageUrlsForAPI(images);

    if (imageUrls.length === 0) {
      alert('No valid images to download');
      return;
    }

    try {
      setIsDownloadingViaAPI(true);
      setDownloadProgress(0);

      const payload = {
        image_urls: imageUrls,
      };

      const result = await dispatch(downloadaszip(payload)).unwrap();

      const url = window.URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${setName}_${imageUrls.length}_images_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('API ZIP download failed:', error);
      alert(`Failed to download via API: ${error.message || 'Unknown error'}`);

      // Optional: Fallback to client-side
      // await downloadSelectedSet(images, setName);
    } finally {
      setIsDownloadingViaAPI(false);
      setDownloadProgress(0);
    }
  };

  // Simplified download functions for current and history sets
  const downloadCurrentImages = () => {
    if (currentImagesWithUrls?.length > 0) {
      downloadSelectedSetViaAPI(currentImagesWithUrls, 'current_images');
    }
  };

  const downloadHistoryImages = () => {
    if (displayHistoryImages?.length > 0) {
      const setName =
        selectedHistoryVersion === 'all'
          ? 'all_history_versions'
          : `history_version_${selectedHistoryVersionIndex}`;
      downloadSelectedSetViaAPI(displayHistoryImages, setName);
    }
  };
  // Render image component
  const renderImage = (item, key, isHistory = false, editImage, index) => {
    if (!item?.fullUrl && item?.status === 200) {
      return (
        <div className="rounded-xl bg-gray-50 text-center dark:bg-[#292929]">
          <p className="text-sm text-red-400">Image data missing</p>
        </div>
      );
    }
    return (
      <div
        className={`h-[19rem] cursor-pointer rounded-xl bg-gradient-to-r p-[1px] transition ${
          selected === key
            ? 'from-[#02C8C4] to-[#5867EB] p-[3px]'
            : 'from-black/5 to-black/5 hover:from-[#02C8C4]/30 hover:to-[#5867EB]/30 dark:from-white/10 dark:to-white/10'
        }`}
        onClick={() => handleImageClick(item, key, index)}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-xl bg-gray-50 transition dark:bg-[#292929]">
          {/* Version badge for history images */}
          {(isHistory || item?.timestamp || item?.createdAt) && item?.status === 200 && (
            <div className="flex items-center justify-between bg-gray-100 px-4 py-2 dark:bg-[#1a1a1a]">
              <span className="text-xs font-medium text-[#02C8C4]">
                {item?.prompt === 'Edited image' ? 'Edited Image' : (() => {
                  const model = isHistory ? item?.imageModel : imageModelLabel;
                  if (!model) return '';
                  const labelMap = { google: 'Nano Banana Pro', openai: 'OpenAI 1.5', openai2: 'OpenAI 2.0', auto: 'Auto' };
                  return (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-10 font-medium text-white/70">
                      {labelMap[model] || model}
                    </span>
                  );
                })()}
              </span>
              <span className="text-xs text-gray-500 dark:text-[#888]">
                {new Date(item?.timestamp || item?.createdAt).toLocaleDateString()}
              </span>
            </div>
          )}

          <div className="flex h-full items-center justify-center">
            {item?.status === 400 ? (
              <div className="relative flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
                <div className="absolute top-2 right-3 left-3 flex items-center justify-between">
                  {(() => {
                    const model = isHistory ? item?.imageModel : imageModelLabel;
                    if (!model) return <span />;
                    const labelMap = { google: 'Nano Banana Pro', openai: 'OpenAI 1.5', openai2: 'OpenAI 2.0', auto: 'Auto' };
                    return (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-10 font-medium text-white/70">
                        {labelMap[model] || model}
                      </span>
                    );
                  })()}
                  <span className="text-xs text-[#888]">
                    {new Date(item?.timestamp || item?.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm font-semibold text-red-400">Content moderation blocked</p>
                <p className="text-xs text-red-300 opacity-70">
                  Your credits were not deducted. Please revise your inputs and try again.
                </p>
              </div>
            ) : item?.status !== 200 ? (
              <div className="relative h-full w-full overflow-hidden rounded-lg">
                <div className="relative h-full w-full animate-pulse rounded-l-2xl bg-gray-100 dark:bg-[#212121]">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <CreativeGeneratingLoader />
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative h-full w-full">
                {/* Loading skeleton - only show if not loaded and not error */}
                {!loadedImages[key] && loadedImages[key] !== 'error' && (
                  <div className="absolute inset-0 z-10 animate-pulse rounded-xl bg-gray-100 dark:bg-[#212121]">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#02C8C4] border-t-transparent"></div>
                        <p className="text-sm text-gray-400">Loading...</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Image */}
                {item?.fullUrl && (
                  <>
                    <div className="card_header absolute top-0 left-0 z-30 flex h-10 w-full items-center justify-between rounded-none px-3 opacity-100 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="flex items-center gap-2 text-sm font-medium text-white">
                        {/* User avatar section can be added here */}
                      </div>
                      <div className="right_header flex items-center gap-2 2xl:gap-2.5">
                        {/* Static Icons - Only show when not hovered */}
                        <AnimatePresence>
                          <>
                            {/* Edit Icon */}
                            <ShadcnTooltip label="Edit">
                              <motion.button
                                onClick={() => {
                                  openLightbox(
                                    editImage,
                                    '',
                                    '',
                                    '',
                                    '',
                                    'new',
                                    queryCampaignId,
                                    item?.historyId || '',
                                    isHistory ? 'history' : 'current'
                                  );
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3B3B3B] text-white transition-all duration-300 hover:scale-110 hover:bg-[#4A4A4A] active:scale-95 2xl:h-8 2xl:w-8"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                transition={{ duration: 0.25, ease: 'easeOut' }}
                              >
                                <Pencil className="h-3 w-3 2xl:h-4 2xl:w-4" />
                              </motion.button>
                            </ShadcnTooltip>
                            {/* Edit in Canva */}
                            {CANVA_ENABLED && (
                            <motion.button
                              onClick={(e) => handleEditWithCanva(e, item?.fullUrl)}
                              disabled={canvaLoadingKey === item?.fullUrl}
                              className="group flex items-center gap-1 rounded-full bg-[#3B3B3B] px-2 py-1 text-10 font-medium text-white transition-all duration-300 hover:scale-105 hover:bg-[#4A4A4A] active:scale-95 disabled:opacity-50"
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.9 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                            >
                              {canvaLoadingKey === item?.fullUrl ? (
                                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                              ) : (
                                <img src={canvaIconLogo} alt="" className="h-3 w-3 shrink-0" aria-hidden="true" />
                              )}
                              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 group-hover:max-w-20">
                                Edit in Canva
                              </span>
                            </motion.button>
                            )}
                            {renderHeaderDownloadButton(item?.fullUrl)}
                          </>
                        </AnimatePresence>

                        {VITE_MODE == 'dev' && item?.prompt && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3B3B3B]"
                              >
                                <Info className="h-4 w-4 text-white" />
                              </button>
                            </PopoverTrigger>

                            <PopoverContent
                              side="bottom"
                              align="center"
                              onClick={(e) => e.stopPropagation()}
                              onWheel={(e) => e.stopPropagation()}
                              onWheelCapture={(e) => e.stopPropagation()}
                              className="max-w-60 space-y-2 bg-gray-200 text-xs text-black 2xl:max-w-96 2xl:text-sm"
                            >
                              <div className="scrollbar-thin pointer-events-auto max-h-20 overflow-y-auto pr-1.5 2xl:max-h-40 2xl:pr-2">
                                <p className="break-all whitespace-normal">{item?.prompt}</p>
                              </div>

                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(item?.prompt);
                                }}
                                className="flex items-center gap-2 rounded-md bg-[#3B3B3B] px-2 py-1 text-white hover:bg-[#4a4a4a]"
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                    <img
                      src={item?.fullUrl}
                      alt={
                        isHistory ? `Historical Creative V${item?.version}` : 'Generated Creative'
                      }
                      className={`h-full w-full cursor-pointer object-cover transition-opacity duration-300 ${
                        loadedImages[key] === true ? 'opacity-100' : 'opacity-0'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleImageClick(
                          item,
                          key,
                          key,
                          (isHistory ? displayHistoryImages : currentImages)
                            ?.filter((item) => item?.status !== 400)
                            ?.map((item) => `${S3_BASE_URL}${item?.data}`)
                        );
                      }}
                      onLoad={() => handleImageLoad(key)}
                      onError={() => handleImageError(key)}
                      loading="lazy"
                    />
                  </>
                )}

                {/* Error overlay for broken images */}
                {loadedImages[key] === 'error' && (
                  <div className="absolute inset-0 flex h-full items-center justify-center bg-gray-100 dark:bg-[#1a1a1a]">
                    <div className="text-center">
                      <p className="text-sm text-red-400">Failed to load image</p>
                      <p className="text-xs text-gray-500">Image may have been deleted</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex w-full flex-col gap-6">
        {/* ZIP Download Button for all visible images */}
        {allVisibleImages.length > 0 && (
          <div className="flex items-center justify-end gap-4">
            <div className="flex flex-col items-end gap-2">
              {isDownloadingViaAPI && downloadProgress > 0 && (
                <div className="w-48 rounded-full bg-gray-100 dark:bg-[#363636]">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  ></div>
                  <p className="mt-1 text-xs text-gray-400">{downloadProgress}% downloaded</p>
                </div>
              )}
              <button
                onClick={downloadAllImagesAsZipViaAPI}
                disabled={isDownloadingViaAPI}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {isDownloadingViaAPI ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Creating ZIP...</span>
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4" />
                    <span>Download All as ZIP </span>
                    {/* ({allVisibleImages.filter(img => img?.status === 200).length} images) */}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {currentImagesWithUrls?.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Current Images</h3>
                {/* <ShadcnTooltip label={`Download ${currentImagesWithUrls.length} current images as ZIP`}>
                  <button
                    onClick={() => downloadSelectedSet(currentImagesWithUrls, 'current_images')}
                    disabled={isDownloadingZip}
                    className="flex items-center gap-2 rounded-md bg-[#363636] px-3 py-1 text-xs text-white hover:bg-[#444444] disabled:opacity-50"
                  >
                    {isDownloadingZip ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Package className="h-3 w-3" />
                    )}
                    <span>Download ({currentImagesWithUrls.length})</span>
                  </button>
                </ShadcnTooltip> */}
              </div>
              <span className="text-sm text-gray-500 dark:text-[#B0B0B0]">
                {currentImagesWithUrls?.length} image
                {currentImagesWithUrls?.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 justify-center gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {currentImagesWithUrls?.map((item) => (
                <div key={`current-${item?.index}`}>
                  {renderImage(item, `current-${item?.index}`, false, item?.editImage, item?.index)}
                </div>
              ))}
            </div>
          </>
        )}

        {/* History Section - Only show if we have history data */}
        {allHistoryImages?.length > 0 && (
          <>
            <div className="mt-8">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">History</h3>
                  {/* {displayHistoryImages?.length > 0 && (
                    <ShadcnTooltip label={`Download ${displayHistoryImages.length} history images as ZIP`}>
                      <button
                        onClick={() => downloadSelectedSet(displayHistoryImages, `history_${selectedHistoryVersion === 'all' ? 'all' : `version_${selectedHistoryVersionIndex}`}`)}
                        disabled={isDownloadingZip}
                        className="flex items-center gap-2 rounded-md bg-[#363636] px-3 py-1 text-xs text-white hover:bg-[#444444] disabled:opacity-50"
                      >
                        {isDownloadingZip ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Package className="h-3 w-3" />
                        )}
                        <span>Download ({displayHistoryImages.length})</span>
                      </button>
                    </ShadcnTooltip>
                  )} */}
                </div>
                <div className="relative">
                  {/* Filter Dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setIsFilterOpen(!isFilterOpen)}
                      className="flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200 dark:bg-[#363636] dark:text-white dark:hover:bg-[#444444]"
                    >
                      <Filter className="h-4 w-4" />
                      <span>{getCurrentFilterLabel()}</span>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* Dropdown Menu */}
                    <AnimatePresence>
                      {isFilterOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -10, scale: 0.95 }}
                          transition={{ duration: 0.2 }}
                          className="absolute right-0 z-50 mt-2 w-48 rounded-lg border border-black/10 bg-white py-2 shadow-lg dark:border-white/10 dark:bg-[#292929]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* All Versions Option */}
                          <button
                            onClick={() => {
                              setSelectedHistoryVersion('all');
                              setIsFilterOpen(false);
                            }}
                            className={`flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-[#363636] ${
                              selectedHistoryVersion === 'all' ? 'text-[#02C8C4]' : 'text-gray-900 dark:text-white'
                            }`}
                          >
                            <span>All Versions</span>
                            {selectedHistoryVersion === 'all' && (
                              <div className="h-2 w-2 rounded-full bg-[#02C8C4]" />
                            )}
                          </button>

                          {/* Divider */}
                          <div className="my-2 border-t border-black/10 dark:border-white/10" />

                          {/* Version Options */}
                          <div className="max-h-60 overflow-y-auto">
                            {availableVersions?.map((versionInfo, index) => (
                              <button
                                key={versionInfo?.id}
                                onClick={() => {
                                  setSelectedHistoryVersion(versionInfo?.id);
                                  setSelectedHistoryVersionIndex(index + 1);
                                  setIsFilterOpen(false);
                                }}
                                className={`flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-[#363636] ${
                                  selectedHistoryVersion === versionInfo?.id
                                    ? 'text-[#02C8C4]'
                                    : 'text-gray-900 dark:text-white'
                                }`}
                              >
                                <span>Version {index + 1}</span>
                                {selectedHistoryVersion === versionInfo?.id && (
                                  <div className="h-2 w-2 rounded-full bg-[#02C8C4]" />
                                )}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Images Grid - Same layout for both "All Versions" and single version */}
              {displayHistoryImages?.length > 0 ? (
                <div className="grid grid-cols-1 justify-center gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {displayHistoryImages?.map((item, index) => {
                    const key =
                      selectedHistoryVersion === 'all'
                        ? `history-all-${item?.historyId}-${index}`
                        : `history-single-${index}`;

                    return (
                      <div key={key}>{renderImage(item, key, true, item?.editImage, index)}</div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl bg-gray-50 p-8 text-center dark:bg-[#292929]">
                  <p className="text-gray-500 dark:text-[#D5D5D5]">
                    {selectedHistoryVersion === 'all'
                      ? 'No historical images found.'
                      : 'No images found for this version.'}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty States */}
        {currentImagesWithUrls?.length === 0 && allHistoryImages?.length === 0 && (
          <div className="rounded-xl bg-gray-50 p-8 text-center dark:bg-[#292929]">
            <p className="text-gray-500 dark:text-[#D5D5D5]">No images generated yet for this campaign.</p>
          </div>
        )}
      </div>

      {/* Close dropdown when clicking outside */}
      {isFilterOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsFilterOpen(false)} />
      )}
    </>
  );
};
