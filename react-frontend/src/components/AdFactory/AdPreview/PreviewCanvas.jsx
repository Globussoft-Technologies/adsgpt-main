import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import ImageSlider from './ImageSlider';
import AddImageDialog from './AddImageDialog';
import AddCopyDialog from './AddCopyDialog';
import TextSlider from './TextSlider';
import CreativeSection from './CreativeSection';
import MobilePreview from './MobilePreview';
import GoogleMobilePreview from './GoogleMobilePreview';
import { Loader2, Check, Smartphone } from 'lucide-react';
import MobilePreviewModal from './MobilePreviewModal';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import {
  fetchCampaignById,
  updateCampaign,
  updateCreativeById,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { nanoid } from 'nanoid';
import {
  setFirstAdCopies,
  setAvailablefirstImages,
} from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { saveCustomCreatives } from '@/apis/adFactory/adFactoryImagesApi';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const enableGooglePosting = import.meta.env.VITE_ENABLE_GOOGLE_POSTING === 'true';

const transformCreativeToFinalFormat = (creative) => {
  console.log(creative,'creative')
  if (!creative) return null;

  // Map CTA text to uppercase with underscores
  const ctaMap = {
    'Learn More': 'LEARN_MORE',
    'Shop Now': 'SHOP_NOW',
    'Sign Up': 'SIGN_UP',
    'Contact Us': 'CONTACT_US',
    Download: 'DOWNLOAD',
    'Get Quote': 'GET_QUOTE',
    'Book Now': 'BOOK_NOW',
    Subscribe: 'SUBSCRIBE',
    'Apply Now': 'APPLY_NOW',
    'Get Offer': 'GET_OFFER',
    'Message Page': 'MESSAGE_PAGE',
  };

  return {
    creativeId: creative?.id,
    imageUrl: creative?.image,
    headline: creative?.text?.headline || '',
    message: creative?.text?.primaryText || '',
    linkUrl: creative?.ctaLink || '',
    callToAction:
      ctaMap[creative?.cta] || creative?.cta?.toUpperCase()?.replace(/ /g, '_') || 'LEARN_MORE',
    description: creative?.text?.description || '',
    platform: creative?.text?.platform || 'meta',
  };
};

const PreviewCanvas = ({
  creative,
  onUpdateCreative,
  onSaveCreative,
  results,
  handleSaveAndContinue,
  textHistory,
  imageHistory,
  isloading,
}) => {
  const { adCreatives, enableId, postnodecreatives, activeCampaign } = useSelector(
    (state) => state?.adFactoryNew
  );
  const [saveStatus, setSaveStatus] = useState('idle');
  const [adCopies, setAdCopies] = useState([]);
  const [selectedPlatformTab, setSelectedPlatformTab] = useState('meta');
  const tabInitializedRef = useRef(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [availableImages, setAvailableImages] = useState([]);
  // Images the user adds manually (upload / link / app library). Kept separate
  // so the results→availableImages effect never clobbers them.
  const [userImages, setUserImages] = useState([]);
  const [addImageOpen, setAddImageOpen] = useState(false);
  // Copies the user adds manually (AI-generated with a custom prompt, or
  // hand-written). Kept separate from AI results, like userImages.
  const [userCopies, setUserCopies] = useState([]);
  const [addCopyOpen, setAddCopyOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state?.socket) || {};
  const [ctaLinkError, setCtaLinkError] = useState('');

  const campaignId = searchParams.get('campaignId');
  const CTA_OPTIONS = [
    'Learn More',
    'Shop Now',
    'Sign Up',
    'Contact Us',
    'Download',
    'Get Quote',
    'Book Now',
    'Subscribe',
    'Apply Now',
    'Get Offer',
    'Message Page',
  ];

  // useEffect(() => {
  //   // Helper function to extract data from any response object for any platform
  //   const extractFromItem = (item) => {
  //     if (!item?.data) return null;

  //     // Find all platform keys in data that contain ad content
  //     const platformKeys = Object.keys(item.data).filter((key) => {
  //       const platformData = item.data[key];
  //       if (!platformData || typeof platformData !== 'object') return false;

  //       // Check for any recognizable ad content field
  //       return (
  //         platformData.headline ||
  //         platformData.primary_text ||
  //         platformData.primaryText ||
  //         platformData.description ||
  //         platformData.caption ||
  //         platformData.message ||
  //         platformData.title ||
  //         platformData.body ||
  //         platformData.short_description
  //       );
  //     });

  //     if (platformKeys.length === 0) return null;

  //     // Extract data from each platform
  //     const extractedData = platformKeys.map((dataKey) => {
  //       const content = item.data[dataKey];
  //       let primaryText = '';
  //       let headline = '';
  //       let description = '';

  //       // Extract fields based on platform type
  //       if (
  //         dataKey === 'meta' ||
  //         dataKey === 'google' ||
  //         dataKey === 'linkedin' ||
  //         dataKey === 'pinterest' ||
  //         dataKey === 'snapchat' ||
  //         dataKey === 'whatsapp' ||
  //         dataKey === 'twitter' ||
  //         dataKey === 'reddit' ||
  //         dataKey === 'tiktok' ||
  //         dataKey === 'facebook' // Added facebook since you mentioned it
  //       ) {
  //         // Standard social media ad structure
  //         headline = content?.headline || '';
  //         primaryText = content?.primary_text || content?.primaryText || content?.description || '';
  //         description = content?.description || '';

  //         // Special handling for specific platforms
  //         if (dataKey === 'twitter') {
  //           primaryText = content?.message || content?.primary_text || content?.primaryText || '';
  //         } else if (dataKey === 'reddit') {
  //           headline = content?.title || '';
  //           primaryText = content?.body || content?.primary_text || '';
  //         } else if (dataKey === 'whatsapp') {
  //           primaryText = content?.message || content?.primary_text || '';
  //         } else if (dataKey === 'tiktok' || dataKey === 'snapchat') {
  //           headline = content?.short_description || '';
  //           primaryText = content?.caption || content?.primary_text || content?.description || '';
  //         }
  //       } else {
  //         // Fallback for any other platform
  //         headline = content?.headline || content?.title || '';
  //         primaryText =
  //           content?.primary_text ||
  //           content?.primaryText ||
  //           content?.message ||
  //           content?.body ||
  //           content?.caption ||
  //           content?.description ||
  //           '';
  //         description = content?.description || '';
  //       }

  //       return {
  //         id: `${item.timestamp}-${dataKey}-${primaryText}-${headline}`,
  //         title: `AI Copy (${dataKey.charAt(0).toUpperCase() + dataKey.slice(1)})`,
  //         primaryText: primaryText,
  //         headline: headline,
  //         description: description,
  //         timestamp: item.timestamp,
  //         platform: dataKey, // Which platform this is for
  //         sourceType: item.source || 'unknown', // Could add source type if available
  //         isAI: true,
  //         rawData: content, // Keep the original data for reference
  //       };
  //     });

  //     return extractedData;
  //   };

  //   // Process results.text if available
  //   const aiTextsFromResults =
  //     results?.text && Array.isArray(results.text)
  //       ? results.text
  //           .filter((item) => item?.status === 200 && item?.data)
  //           .flatMap(extractFromItem) // Use flatMap to flatten arrays
  //           .filter(Boolean) // Remove null/undefined items
  //       : [];

  //   // Process textHistory if available
  //   const aiTextsFromHistory =
  //     textHistory && Array.isArray(textHistory)
  //       ? textHistory
  //           .filter((item) => item?.status === 200 && item?.data)
  //           .flatMap(extractFromItem) // Use flatMap to flatten arrays
  //           .filter(Boolean) // Remove null/undefined items
  //       : [];

  //   // Combine both sources
  //   const allAiTexts = [...aiTextsFromResults, ...aiTextsFromHistory];

  //   // Remove duplicates based on content
  //   const uniqueTexts = allAiTexts.filter(
  //     (text, index, self) =>
  //       index ===
  //       self.findIndex(
  //         (t) =>
  //           t.primaryText === text.primaryText &&
  //           t.headline === text.headline &&
  //           t.platform === text.platform &&
  //           t.timestamp === text.timestamp
  //       )
  //   );
  //   setAdCopies(allAiTexts);
  // }, [results?.text, textHistory, dispatch]);

  useEffect(() => {
    const extractPlatformText = (item, platformKey) => {
      if (!item?.data || !Object.prototype.hasOwnProperty.call(item.data, platformKey)) return null;
      const data = item.data[platformKey];
      if (!data || typeof data !== 'object') return null;
      const headline = data.headline || '';
      // Google uses 'description' instead of 'primary_text'
      const primaryText = data.primary_text || data.primaryText || data.description || '';
      if (!headline && !primaryText) return null;
      return {
        id: `${item.timestamp}-${platformKey}-${headline}-${primaryText}`,
        title: `AI Copy (${platformKey.charAt(0).toUpperCase() + platformKey.slice(1)})`,
        headline,
        primaryText,
        timestamp: item.timestamp,
        platform: platformKey,
        isAI: true,
        rawData: data,
      };
    };

    const isSuccess = (i) => Number(i?.status) === 200;

    // results.text may be an array OR a single object — normalize to array
    const resultsTextArr = Array.isArray(results?.text)
      ? results.text
      : results?.text
        ? [results.text]
        : [];

    // textHistory is similarly normalized
    const textHistoryArr = Array.isArray(textHistory)
      ? textHistory
      : textHistory
        ? [textHistory]
        : [];

    const allTexts = ['meta', 'google'].flatMap((platformKey) => {
      const fromResults = resultsTextArr
        .filter(isSuccess)
        .map((i) => extractPlatformText(i, platformKey))
        .filter(Boolean);
      const fromHistory = textHistoryArr
        .filter(isSuccess)
        .map((i) => extractPlatformText(i, platformKey))
        .filter(Boolean);
      const combined = [...fromResults, ...fromHistory];
      return combined.filter(
        (text, index, self) =>
          index === self.findIndex((t) => t.headline === text.headline && t.primaryText === text.primaryText && t.platform === text.platform)
      );
    });

    setAdCopies(allTexts);

    // Only auto-select the tab once on initial load, never reset after user interaction
    if (!tabInitializedRef.current && allTexts.length > 0) {
      const firstPlatform = ['meta', 'google'].find((p) => allTexts.some((t) => t.platform === p));
      if (firstPlatform) {
        setSelectedPlatformTab(firstPlatform);
        tabInitializedRef.current = true;
      }
    }
  }, [results?.text, textHistory]);
  useEffect(() => {
    // Process results.image if available
    const aiImagesFromResults =
      results?.image && Array.isArray(results.image)
        ? results.image
            .filter((item) => item?.data && item?.data !== '')
            .map((item, index) => ({
              id: `result-ai-${index + 1}`,
              src: `${S3_BASE_URL}${item?.data}`,
              timestamp: item?.timestamp,
              isAI: true,
            }))
        : [];

    // Process imageHistory if available
    const aiImagesFromHistory =
      imageHistory && Array.isArray(imageHistory)
        ? imageHistory
            .filter((item) => item?.data && item?.data !== '')
            .map((item, index) => ({
              id: `history-ai-${index + 1}`,
              src: `${S3_BASE_URL}${item?.data}`,
              timestamp: item?.timestamp,
              isAI: true,
            }))
        : [];

    // Combine both sources
    const allAiImages = [...aiImagesFromResults, ...aiImagesFromHistory];

    // Remove duplicates based on src if needed
    const uniqueImages = allAiImages.filter(
      (image, index, self) => index === self.findIndex((img) => img.src === image.src)
    );

    setAvailableImages(allAiImages);
  }, [results?.image, imageHistory, S3_BASE_URL, dispatch]); // Remove availableImages from dependencies

  const prevAdCopiesRef = useRef(adCopies);
  const prevAvailableImagesRef = useRef(availableImages);

  useEffect(() => {
    // Publish AI images + any user-added ones so downstream (AdsPreviewDialog)
    // sees the full set the user is choosing from.
    const merged = [...availableImages, ...userImages];

    // Only dispatch if arrays have actually changed
    const adCopiesChanged = JSON.stringify(prevAdCopiesRef.current) !== JSON.stringify(adCopies);
    const imagesChanged =
      JSON.stringify(prevAvailableImagesRef.current) !== JSON.stringify(merged);

    if (adCopiesChanged || imagesChanged) {
      dispatch(setAvailablefirstImages(merged));
      dispatch(setFirstAdCopies(adCopies));

      // Update refs with current values
      prevAdCopiesRef.current = adCopies;
      prevAvailableImagesRef.current = merged;
    }
  }, [availableImages, userImages, adCopies, dispatch]);

  // Seed manually-added images from the campaign's persisted custom gallery so
  // they reappear on reload. Union with any local additions (never wipe them).
  useEffect(() => {
    const persisted = (activeCampaign?.customCreatives?.images || [])
      .filter((c) => c?.data)
      .map((c) => ({
        id: `custom-${c.data}`,
        src: c.data.startsWith('http') ? c.data : `${S3_BASE_URL}${c.data}`,
        key: c.data,
        isUser: true,
        source: c.source || 'upload',
      }));
    if (persisted.length === 0) return;
    setUserImages((prev) => {
      const bySrc = new Map();
      [...persisted, ...prev].forEach((img) => bySrc.set(img.src, img));
      return Array.from(bySrc.values());
    });
  }, [activeCampaign?.customCreatives?.images]);

  // Same for manually-added copies.
  useEffect(() => {
    const persisted = (activeCampaign?.customCreatives?.copies || [])
      .filter((c) => c && (c.primaryText || c.headline || c.description))
      .map((c, i) => ({
        id: `customcopy-${c.platform || 'meta'}-${i}-${c.headline || ''}-${c.primaryText || ''}`,
        title: 'Custom Copy',
        primaryText: c.primaryText || '',
        headline: c.headline || '',
        description: c.description || '',
        platform: c.platform || 'meta',
        isUser: true,
      }));
    if (persisted.length === 0) return;
    setUserCopies((prev) => {
      const byKey = new Map();
      [...persisted, ...prev].forEach((c) =>
        byKey.set(`${c.platform}|${c.headline}|${c.primaryText}`, c)
      );
      return Array.from(byKey.values());
    });
  }, [activeCampaign?.customCreatives?.copies]);

  if (!creative) return null;

  const update = (patch) => {
    onUpdateCreative?.({ ...creative, ...patch });
  };

  // AI/generated images first (preserves existing [0] defaults elsewhere),
  // then anything the user added manually.
  const displayImages = [...availableImages, ...userImages];

  const handleAddImage = (img) => {
    setUserImages((prev) =>
      prev.some((p) => p.src === img.src) ? prev : [...prev, img]
    );
    update?.({ image: img.src }); // auto-select the freshly added image
  };

  // Adds a manually-created copy (AI-generated or hand-written) to the current
  // platform tab, and selects it. Persisted on Save.
  const handleAddCopy = (copy) => {
    const newCopy = {
      id: `customcopy-${nanoid(6)}`,
      title: 'Custom Copy',
      primaryText: copy.primaryText || '',
      headline: copy.headline || '',
      description: copy.description || '',
      platform: selectedPlatformTab,
      isUser: true,
    };
    setUserCopies((prev) => [...prev, newCopy]);
    update?.({ text: newCopy }); // auto-select the freshly added copy
  };

  // Writes the current manual images + copies to the campaign's customCreatives
  // key. Sends the full set (additions and removals captured in one $set).
  const persistCustomCreatives = async () => {
    if (!campaignId || !userData?.user_id) return;
    try {
      await saveCustomCreatives({
        userId: userData.user_id,
        campaignId,
        images: userImages.map((u) => ({ data: u.key || u.src, source: u.source || 'upload' })),
        copies: userCopies.map((c) => ({
          primaryText: c.primaryText || '',
          headline: c.headline || '',
          description: c.description || '',
          platform: c.platform || 'meta',
        })),
      });
    } catch {
      // Non-fatal — the creative save itself already succeeded.
    }
  };

  const handleSave = async () => {
    if (saveStatus === 'saving') return;

    setSaveStatus('saving');
    setCtaLinkError('');
    try {
      // await new Promise((resolve) => setTimeout(resolve, 1500));
      // Transform all creatives to final format
      const allTransformedCreatives = transformCreativeToFinalFormat(creative);
      // onOpenChange(false); // Uncomment to close dialog after save
      const payload = {
        campaignId,
        nodeType: 'creatives',
        data: allTransformedCreatives,
      };
      let result;
      const isActuallySaved = postnodecreatives?.some((saved) => saved.creativeId === creative.id);

      if (creative?.isEditingSaved || isActuallySaved) {
        result = await dispatch(
          updateCreativeById({
            campaignId,
            creativeId: creative.id,
            data: allTransformedCreatives,
          })
        );
      } else {
        result = await dispatch(updateCampaign(payload));
      }

      if (updateCampaign.rejected.match(result) || updateCreativeById.rejected.match(result)) {
        const errorMsg = result.payload || 'Please enter a valid CTA link';
        setSaveStatus('idle');
        // setCtaLinkError(errorMsg);
        toast.error(errorMsg);
        return;
      }
      if (updateCampaign.fulfilled.match(result) || updateCreativeById.fulfilled.match(result)) {
        // Persist manual images BEFORE refetch so the campaign comes back with
        // its customCreatives populated (which re-seeds the slider/copies).
        await persistCustomCreatives();

        const campaignPayload = {
          campaignId,
          userId: userData?.user_id,
        };

        //  REFETCH CAMPAIGN → updates postnodecreatives
        dispatch(fetchCampaignById(campaignPayload));
      }

      if (onSaveCreative) onSaveCreative(creative);

      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    } catch (e) {
      setSaveStatus('idle');
    }
  };

  return (
    <main className="relative mt-8 flex h-full flex-1 flex-col justify-center gap-4 overflow-auto p-4 pt-10 md:mt-0 lg:flex-row lg:p-6 2xl:pt-12">
      {/* Mobile Preview Button */}
      <div className="ml-2 flex md:ml-5 lg:hidden">
        <button
          type="button"
          onClick={() => setIsPreviewOpen(true)}
          className="flex items-center gap-2 rounded-full bg-black/5 dark:bg-white/10 px-4 py-2 text-xs font-semibold text-gray-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/20"
        >
          <Smartphone className="inline-block h-4 w-4" /> Mobile Preview
        </button>
      </div>

      {/* Mobile Preview */}
      <div className="hidden lg:flex">
        {enableGooglePosting && selectedPlatformTab === 'google' ? (
          <GoogleMobilePreview
            key={creative?.id}
            image={creative?.image}
            text={creative?.text}
            cta={creative?.cta}
            ctaLink={creative?.ctaLink}
          />
        ) : (
          <MobilePreview
            key={creative?.id}
            image={creative?.image}
            text={creative?.text}
            cta={creative?.cta}
            ctaLink={creative?.ctaLink}
          />
        )}
      </div>

      {/* Creative Controls */}
      <div className="flex flex-col overflow-hidden pt-2 md:pt-5 2xl:pt-0">
        <div className="flex max-h-[1200px] max-w-[1600px] flex-1 overflow-x-hidden">
          <div className="mx-auto flex w-[95%] flex-col gap-4 sm:pr-2 2xl:pr-8">
            <CreativeSection title="Ad Image">
              <ImageSlider
                mockImages={displayImages}
                selectedImage={creative?.image}
                onSelect={(image) => update?.({ image })}
                onAddImage={() => setAddImageOpen(true)}
              />
            </CreativeSection>

            {(() => {
              const hasAnyCopies = adCopies.length > 0 || userCopies.length > 0;
              // AI copies first, then the user's own — both scoped to the platform tab.
              const filteredAiCopies = adCopies.filter((c) => c.platform === selectedPlatformTab);
              const filteredUserCopies = userCopies.filter((c) => c.platform === selectedPlatformTab);
              const mergedCopies = [...filteredAiCopies, ...filteredUserCopies];
              return (
                <CreativeSection
                  title={
                    <div className="flex items-center gap-3">
                      <span>Ad Copy</span>
                      {hasAnyCopies && (
                        <div className="flex gap-1 rounded-full bg-black/5 dark:bg-white/10 p-0.5">
                          {['meta', ...(enableGooglePosting ? ['google'] : [])].map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setSelectedPlatformTab(p)}
                              className={`rounded-full px-3 py-0.5 text-xs font-medium transition-all ${
                                selectedPlatformTab === p
                                  ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                                  : 'text-gray-500 dark:text-white/60 hover:text-black dark:hover:text-white'
                              }`}
                            >
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  }
                >
                  <TextSlider
                    key={selectedPlatformTab}
                    adCopies={mergedCopies}
                    setAdCopies={(updated) => {
                      // Route edits back to the right state by the isUser flag.
                      const ai = updated.filter((c) => !c.isUser);
                      const usr = updated.filter((c) => c.isUser);
                      setAdCopies((prev) => [
                        ...prev.filter((c) => c.platform !== selectedPlatformTab),
                        ...ai,
                      ]);
                      setUserCopies((prev) => [
                        ...prev.filter((c) => c.platform !== selectedPlatformTab),
                        ...usr,
                      ]);
                    }}
                    selectedText={creative?.text}
                    onSelect={(text) => update?.({ text })}
                    onAddCopy={() => setAddCopyOpen(true)}
                  />
                </CreativeSection>
              );
            })()}

            <div className="grid flex-1 gap-4 sm:max-h-[250px] md:grid-cols-2">
              <CreativeSection title="Call to action Button (CTA)">
                <div className="flex flex-wrap gap-2">
                  {CTA_OPTIONS?.map((cta) => (
                    <button
                      key={cta}
                      type="button"
                      onClick={() => update?.({ cta })}
                      className={`rounded-lg border bg-black/5 dark:bg-white/10 px-4 py-1.5 text-xs font-medium text-gray-900 dark:text-white 2xl:text-sm ${
                        creative?.cta === cta
                          ? 'border-gray-900 dark:border-white text-gray-900 dark:text-white'
                          : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/20'
                      }`}
                    >
                      {cta}
                    </button>
                  ))}
                </div>
              </CreativeSection>

              <CreativeSection title="CTA link">
                <input
                  type="text"
                  placeholder="Enter your CTA link..."
                  value={creative?.ctaLink || ''}
                  onChange={(e) => {
                    update?.({ ctaLink: e.target.value });
                    setCtaLinkError('');
                  }}
                  className={`w-full rounded-3xl border ${
                    ctaLinkError
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-black/20 dark:border-white/40 focus:border-gray-900 dark:focus:border-white'
                  } bg-transparent px-4 py-2.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:outline-none 2xl:text-sm`}
                />
                {ctaLinkError && <p className="mt-1 px-2 text-sm text-red-500">{ctaLinkError}</p>}
              </CreativeSection>
            </div>

            <div className="mt-auto flex flex-wrap justify-end gap-2 py-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saveStatus === 'saving' || !creative?.canSave}
                className={`flex items-center gap-2 rounded-full px-6 py-2 text-xs font-semibold text-white dark:text-[#0F1010] 2xl:text-base ${
                  saveStatus === 'saved' || !creative?.canSave
                    ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-[#3C3C3C]/50 dark:text-white/50'
                    : 'bg-gray-900 dark:bg-white hover:opacity-75'
                } ${saveStatus === 'saving' ? 'cursor-not-allowed opacity-80' : ''} `}
              >
                {saveStatus === 'saving' && (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving
                  </>
                )}

                {saveStatus === 'saved' && (
                  <>
                    <Check className="h-5 w-5" />
                    Saved
                  </>
                )}

                {saveStatus === 'idle' && 'Save'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await persistCustomCreatives();
                  handleSaveAndContinue?.();
                }}
                disabled={isloading || !enableId || creative?.canSave}
                className={`flex items-center gap-2 rounded-full px-6 py-2 text-xs 2xl:text-base ${
                  isloading || !enableId || creative?.canSave
                    ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-[#3C3C3C]/50 dark:text-white/50'
                    : 'bg-gray-100 text-gray-900 dark:bg-[#3C3C3C] dark:text-white hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                {isloading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </>
                ) : (
                  'Save & Continue'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <MobilePreviewModal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen?.(false)}
        creative={creative}
      />

      <AddImageDialog
        open={addImageOpen}
        onClose={() => setAddImageOpen(false)}
        onAdd={handleAddImage}
        userId={userData?.user_id}
      />

      <AddCopyDialog
        open={addCopyOpen}
        onClose={() => setAddCopyOpen(false)}
        onAdd={handleAddCopy}
        platform={selectedPlatformTab}
      />
    </main>
  );
};

export default PreviewCanvas;
