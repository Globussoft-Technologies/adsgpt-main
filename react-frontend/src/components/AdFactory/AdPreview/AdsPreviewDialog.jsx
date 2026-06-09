import { Dialog, DialogContent } from '@/components/ui/dialog';
import AdFactoryBgEffect from '../NodeForms/AdFactoryBgEffect';
import PreviewSidebar from './PreviewSidebar';
import PreviewCanvas from './PreviewCanvas';
import { useCallback, useEffect, useState } from 'react';
import SavedCreatives from './SavedCreatives';
import { Menu, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchAdFactoryHistory,
  fetchCampaignById,
  updateCampaign,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { useSearchParams } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { setEnableId } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  setCompletedNodes,
  setFormProgress,
  updateNodeEnabledStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Helper function to transform all creatives
const transformAllCreatives = (creatives) => {
  if (!creatives || !Array.isArray(creatives)) return [];

  return creatives.map((creative) => {
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
      imageUrl: creative?.image || '',
      headline: creative?.text?.headline || '',
      message: creative?.text?.primaryText || '',
      linkUrl: creative?.ctaLink || '',
      callToAction:
        ctaMap[creative?.cta] || creative?.cta?.toUpperCase()?.replace(/ /g, '_') || 'LEARN_MORE',
      description: creative?.text?.description || creative?.text?.ctaLabel || '',
    };
  });
};
// Assuming adCreative is your first array and creatives is your second array
export const getUniqueCreatives = (adCreative, creatives) => {
  // Get all ids from adCreative for fast lookup
  const adCreativeIds = new Set(adCreative?.map((item) => item.id));
  // Filter creatives to only include items whose id is NOT in adCreative
  const uniqueFromCreatives = creatives.filter((item) => !adCreativeIds.has(item.id));
  // Return all items from adCreative + unique items from creatives
  return [...uniqueFromCreatives];
};

const AdsPreviewDialog = ({ open, onOpenChange, onProgressUpdate }) => {
  const { results, adCreatives, history, availablefirstImages, firstAdCopies, postnodecreatives } =
    useSelector((state) => state?.adFactoryNew || {});
  const [creatives, setCreatives] = useState(adCreatives || []);
  const [savedCreatives, setSavedCreatives] = useState([]);
  const [activeCreativeId, setActiveCreativeId] = useState(adCreatives?.[0]?.id);
  const [activeView, setActiveView] = useState('preview');
  // const [unreadSavedCount, setUnreadSavedCount] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { userData } = useSelector((state) => state.socket);
  const activeCreative = creatives?.find((c) => c?.id === activeCreativeId);
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  const [isloading, setisloading] = useState(false);

  const dispatch = useDispatch();
  // Check if all creatives are saved
  // const allCreativesSaved = creatives.length > 0 && unsavedCreativeIds.size === 0;
  // Initialize creatives when Redux data is available
  useEffect(() => {
    if (availablefirstImages?.length > 0 || firstAdCopies?.length > 0) {
      const initialCreative = [
        {
          id: '1',
          name: 'Ad Creative 1',
          image: availablefirstImages[0]?.src || '',
          text: {
            id: '1',
            title: 'AI Copy 1',
            primaryText: firstAdCopies[0]?.primaryText || '',
            headline: firstAdCopies[0]?.headline || '',
            description: firstAdCopies[0]?.description || '',
            timestamp: firstAdCopies[0]?.timestamp || Date.now(),
            isAI: true,
          },
          cta: 'Learn More',
          ctaLink: null,
          createdAt: new Date().toISOString(),
          canSave: true,
        },
      ];

      // Only update if creatives is empty or different

      setCreatives((prev) => {
        if (prev?.length === 1 && prev[0]?.image === '' && prev[0]?.text?.length === 0) {
          return initialCreative;
        }
        return prev;
      });

      // if(adCreatives[0]?.text.length===0&&adCreatives[0]?.image===""){
      //   setCreatives(initialCreative);

      //   // Set active creative if not set
      //   if (!activeCreativeId) {
      //     setActiveCreativeId(1);
      //   }
      // }
      // Add to unsaved set
      // setUnsavedCreativeIds(prev => new Set([...prev, 1]));
    }
  }, [availablefirstImages, firstAdCopies, activeCreativeId]);

  useEffect(() => {
    if (campaignId && userData?.user_id) {
      const campaignPayload = {
        campaignId: campaignId,
        userId: userData?.user_id,
      };
      dispatch(fetchAdFactoryHistory(campaignPayload));
      dispatch(fetchCampaignById(campaignPayload));
    }
  }, [campaignId, userData, dispatch]);

  const getAllImageObjects = (dataArray) => {
    if (!Array.isArray(dataArray)) return [];

    const allImageObjects = [];

    dataArray.forEach((item) => {
      const imageArray = item?.previousData?.results?.image;

      if (Array.isArray(imageArray)) {
        allImageObjects.push(...imageArray);
      }
    });
    // const aiImages =
    // allImageObjects
    //   ?.filter((item) => item?.data && item?.data !== '')
    //   ?.map((item, index) => ({
    //     id: `ai-${index + 1}`,
    //     src: `${S3_BASE_URL}${item?.data}`,
    //     timestamp: item?.timestamp,
    //     isAI: true,
    //   })) || [];
    return allImageObjects;
  };

  const getAllTextObjects = (dataArray) => {
    if (!Array.isArray(dataArray)) return [];

    const allTextObjects = [];

    dataArray.forEach((item) => {
      const textArray = item?.previousData?.results?.text;

      if (Array.isArray(textArray)) {
        allTextObjects.push(...textArray);
      }
    });
    // const aiTexts =
    // allTextObjects
    //       ?.filter((item) => item?.status === 200 && item?.data?.meta)
    //       ?.map((item, index) => ({
    //         id: `${index + 1}`,
    //         title: `AI Copy ${index + 1}`,
    //         primaryText: item?.data?.meta?.primary_text,
    //         headline: item?.data?.meta?.headline,
    //         description: item?.data?.meta?.description,
    //         timestamp: item?.timestamp,
    //         isAI: true,
    //       })) || [];
    return allTextObjects;
  };

  const allTextObjects = getAllTextObjects(history);
  const rawImageObjects = getAllImageObjects(history);

  const handleAddCreative = () => {
    const newCreative = {
      id: nanoid(),
      name: `Ad Creative ${creatives?.length + 1}`,
      image: availablefirstImages[0]?.src || '',
      text:
        {
          id: '1',
          title: 'AI Copy 1',
          primaryText: firstAdCopies[0]?.primaryText || '',
          headline: firstAdCopies[0]?.headline || '',
          description: firstAdCopies[0]?.description || '',
          timestamp: firstAdCopies[0]?.timestamp || Date.now(),
          isAI: true,
          isSaved: false, // Mark as unsaved initially
        } || {},
      cta: 'Learn More',
      ctaLink: null,
      createdAt: new Date().toISOString(),
      canSave: true,
    };

    setCreatives((prev) => [...(prev || []), newCreative]);

    setActiveCreativeId(newCreative?.id);
    setActiveView('preview');
  };

  const updateCreative = (updatedCreative) => {
    setCreatives(
      (prev) =>
        prev.map((c) =>
          c.id === updatedCreative.id ? { ...updatedCreative, isSaved: false, canSave: true } : c
        ) || []
    );
  };

  const handleSaveCreative = (creative) => {
    if (!creative.canSave) return;

    const finalizedCreative = {
      ...creative,
      isSaved: true,
      canSave: false,
      isEditingSaved: true, // 🔓 remain in edit mode for subsequent updates
    };

    setCreatives((prev) => prev.map((c) => (c.id === creative.id ? finalizedCreative : c)));

    setSavedCreatives((prev) => {
      const alreadySaved = prev?.some?.((c) => c?.id === creative?.id);

      if (alreadySaved) {
        //  UPDATE SAME SAVED CREATIVE
        return prev.map((c) => (c.id === creative.id ? finalizedCreative : c));
      }

      //  FIRST-TIME SAVE ONLY
      return [...prev, { ...finalizedCreative, savedAt: new Date().toISOString() }];
    });
  };

  useEffect(() => {
    // Enable if all current creatives are saved (or if there are no creatives)
    const allSaved = creatives.every((c) => !c.canSave);
    dispatch(setEnableId(allSaved));
  }, [creatives, dispatch]);

  const handleSaveAndContinue = useCallback(async () => {
    if (isloading) return;

    try {
      setisloading(true);

      const allTransformedCreatives = transformAllCreatives(creatives);
      const campaignId = searchParams.get('campaignId');

      const payload = {
        campaignId,
        nodeType: 'status',
        data: {
          status: 'success',
        },
      };

      const result = await dispatch(updateCampaign(payload));

      if (updateCampaign.fulfilled.match(result)) {
        // Update node completion status
        dispatch(setCompletedNodes('preview'));
        dispatch(setFormProgress({ nodeId: 'preview', progress: 100 }));

        // Update node enabled status to enable next nodes
        dispatch(updateNodeEnabledStatus());

        // toast.success('Objectives saved successfully');

        // Call onComplete if provided
        if (onProgressUpdate) {
          onProgressUpdate();
        }

        onOpenChange(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setisloading(false);
    }
  }, [creatives, onOpenChange, isloading, dispatch]);

  const handleOpenCreative = (id, fromSaved = false) => {
    setCreatives((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              //  TEMPORARILY ALLOW SAVE IF OPENED FROM SAVED FOLDER
              canSave: fromSaved ? true : c.canSave,
              isEditingSaved: fromSaved || false,
            }
          : c
      )
    );

    setActiveCreativeId(id);
    setActiveView('preview');
  };

  // const handleDeleteCreative = (id) => {
  //   setSavedCreatives((prev) => prev?.filter?.((c) => c?.id !== id) || []);

  //   if (activeCreativeId === id) {
  //     setActiveCreativeId(null);
  //   }
  // };

  const openSavedScreen = () => {
    setActiveView('saved');
    // setUnreadSavedCount(0); // clear notification
  };

  // In AdsPreviewDialog component, add this function
  const handleDeleteCreative = async (creativeId) => {
    // Update local creatives state
    setCreatives((prev) => prev.filter((c) => c.id !== creativeId));

    // If the deleted creative was active, set a new active creative
    if (activeCreativeId === creativeId) {
      const remainingCreatives = creatives.filter((c) => c.id !== creativeId);
      if (remainingCreatives.length > 0) {
        setActiveCreativeId(remainingCreatives[0].id);
      } else {
        setActiveCreativeId(null);
      }
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-screen max-h-screen! w-screen max-w-screen! scale-100! rounded-none! border-none bg-white dark:bg-[#0F0F0F] p-0">
        <div className="flex h-full w-full max-w-screen overflow-hidden pb-10 md:pb-0">
          {/* Mobile menu button */}
          {!isSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="absolute top-4 left-6 z-50 rounded-full bg-black/10 dark:bg-white/10 p-2 text-gray-900 dark:text-white md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}

          {/* Sidebar */}
          <div className="hidden md:flex">
            <PreviewSidebar
              creatives={creatives}
              activeCreativeId={activeCreativeId}
              onAddCreative={handleAddCreative}
              onOpenCreative={handleOpenCreative}
              onOpenSaved={openSavedScreen}
              // unreadSavedCount={unreadSavedCount}
              activeView={activeView}
              adCreatives={adCreatives}
              onDeleteCreative={handleDeleteCreative}
            />
          </div>

          {/* Mobile Sidebar Drawer */}
          {isSidebarOpen && (
            <div className="fixed inset-0 z-40 md:hidden">
              {/* Overlay */}
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setIsSidebarOpen(false)}
              />

              {/* Drawer */}
              <div className="relative h-full w-[90px] bg-white dark:bg-[#0f0f0f] shadow-xl">
                {/* Close button */}
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="absolute top-3 -right-4 z-50 rounded-full bg-black/10 dark:bg-white/20 p-2 text-gray-900 dark:text-white sm:-right-7"
                >
                  <X className="h-4 w-4" />
                </button>

                <PreviewSidebar
                  creatives={creatives}
                  activeCreativeId={activeCreativeId}
                  onAddCreative={handleAddCreative}
                  onOpenCreative={(id) => {
                    handleOpenCreative(id);
                    setIsSidebarOpen(false);
                  }}
                  onOpenSaved={() => {
                    openSavedScreen();
                    setIsSidebarOpen(false);
                  }}
                  // unreadSavedCount={unreadSavedCount}
                  activeView={activeView}
                  onDeleteCreative={handleDeleteCreative}
                />
              </div>
            </div>
          )}

          {/* Preview Area */}
          {activeView === 'preview' &&
            (creatives.length > 0 && activeCreative ? (
              <PreviewCanvas
                creative={activeCreative}
                onUpdateCreative={updateCreative}
                onSaveCreative={handleSaveCreative}
                results={results}
                handleSaveAndContinue={handleSaveAndContinue}
                textHistory={allTextObjects}
                imageHistory={rawImageObjects}
                isloading={isloading}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xl text-gray-500 dark:text-white/60">
                No creatives. Click "Add More" to create a new ad creative.
              </div>
            ))}

          {activeView === 'saved' && (
            <SavedCreatives
              // savedCreatives={savedCreatives}
              onOpenCreative={handleOpenCreative}
              onDeleteCreative={handleDeleteCreative}
            />
          )}
        </div>
      </DialogContent>
      <AdFactoryBgEffect isGenerated={true} />
    </Dialog>
  );
};

export default AdsPreviewDialog;
