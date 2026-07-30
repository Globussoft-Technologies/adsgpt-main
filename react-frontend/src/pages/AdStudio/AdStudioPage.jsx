import facebookAdDetails from '@/apis/pas/facebook';
import googleAdDetails from '@/apis/pas/google';
import instagramAdDetails from '@/apis/pas/instagram';
import linkedInAdDetails from '@/apis/pas/linkedIn';
import pinterestAdDetails from '@/apis/pas/pinterest';
import redditAdDetails from '@/apis/pas/reddit';
import AdCopyHome from '@/components/AdStudio/AdCopy/AdCopyHome';
import ChatInterface from '@/components/AdStudio/AdCopy/ChatInterface';
import WelcomeAdCopy from '@/components/AdStudio/AdCopy/WelcomeAdCopy';
import AdCreativesHome from '@/components/AdStudio/AdCreatives/AdCreativesHome';
import AdVideoHome from '@/components/AdStudio/AdVideo/AdVideoHome';
import AdVideoHomeNew from '@/components/AdStudio/AdVideoNew/AdVideoHomeNew';
import AdVideoLayout from '@/components/AdStudio/AdVideoNew/AdVideoLayout';
import AdCreativeNewLayout from '@/components/AdStudio/AdCreativeNew/AdCreativeNewLayout';
import AdLibraryPage from '@/pages/AdLibrary/AdLibraryPage';
import AdPromptComponent from '@/components/common/AdPrompt/AdPromptComponent';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import { addImage } from '@/store/reducers/adStudio/promptSlice';
import { formatUrl } from '@/utils/formatUrl';
import { canUseWorkspaceFeature } from '@/utils/workspaceSession';
import { nanoid } from 'nanoid';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';

const AdStudioPage = () => {
  const dispatch = useDispatch();
  const activeAdStudioTabId = useSelector((state) => state.adStudioTabs.activeAdStudioTabId);
  const adCreativeNewActivePage = useSelector(
    (state) => state.adStudioTabs.adCreativeNewActivePage
  );
  const userData = useSelector((state) => state.socket.userData);
  const { conversations } = useSelector((state) => state.adVideo);
  const tabFeatures = useMemo(
    () => ({
      adCopy: 'adStudio.adCopy',
      adCreative: 'adStudio.adCreative',
      adCreativeNew: 'adStudio.adCreative',
      adVideo: 'adStudio.adVideo',
      adVideoNew: 'adStudio.adVideo',
      adLibrary: 'adStudio.adLibrary',
    }),
    []
  );
  const allowedTabs = useMemo(
    () =>
      ['adCopy', 'adCreativeNew', 'adVideoNew', 'adLibrary'].filter((tabId) =>
        canUseWorkspaceFeature(tabFeatures[tabId])
      ),
    [tabFeatures]
  );
  const effectiveTabId = canUseWorkspaceFeature(tabFeatures[activeAdStudioTabId])
    ? activeAdStudioTabId
    : allowedTabs[0];

  useEffect(() => {
    if (effectiveTabId && effectiveTabId !== activeAdStudioTabId) {
      dispatch(setActiveAdStudioTab(effectiveTabId));
    }
  }, [activeAdStudioTabId, dispatch, effectiveTabId]);

  // Fetch brands on load
  useEffect(() => {
    dispatch(fetchBrands(userData?.user_id));
  }, [dispatch, userData?.user_id]);

  // network based apis
  const networkBasedApis = useMemo(
    () => ({
      facebook: facebookAdDetails,
      instagram: instagramAdDetails,
      google: googleAdDetails,
      pinterest: pinterestAdDetails,
      reddit: redditAdDetails,
      linkedin: linkedInAdDetails,
    }),
    []
  );

  const handleSimilarClick = useCallback(
    (ad, activeIndex) => {
      let imgs = [];
      if (ad?.postImage) {
        imgs.push(ad.postImage);
      }
      if (ad?.othermedia && typeof ad?.othermedia === 'string') {
        const parsed = JSON.parse(ad?.othermedia);
        if (Array.isArray(parsed)) {
          parsed.forEach((o) => {
            imgs.push(formatUrl(o));
          });
        }
      }
      const other = Array.isArray(ad?.othermedia) ? ad.othermedia : [];
      other.forEach((o) => {
        imgs.push(formatUrl(o));
      });

      const url = imgs[activeIndex];
      if (url) {
        const newImage = {
          id: nanoid(),
          url,
          type: 'ad',
          title: ad?.adTitle,
          description: ad?.newsfeedDescription || ad?.description,
          ad: ad ? { ...ad, activeIndex } : {},
        };
        dispatch(addImage(newImage));
      }
    },
    [dispatch]
  );

  // Handle PAS-AdsGPT gateway request
  useEffect(() => {
    const storedPayloadId = sessionStorage.getItem('storedPayloadId');

    const fetchAdData = async () => {
      const urlParams = new URLSearchParams(location.search);
      const id = urlParams.get('id');
      const network = urlParams.get('network');
      const activeIndex = urlParams.get('activeIndex') || 0;

      if (id && network && id !== storedPayloadId) {
        if (canUseWorkspaceFeature('adStudio.adCreative')) {
          dispatch(setActiveAdStudioTab('adCreativeNew'));
        }

        // Api call and request logic here
        try {
          const ad = await networkBasedApis[network](id);
          if (ad?.id) {
            sessionStorage.setItem('storedPayloadId', id);
            handleSimilarClick(ad, activeIndex);
          }
        } catch (error) {
          console.error('Error fetching ad data:', error);
        }
      }
    };
    fetchAdData();
  }, [dispatch, networkBasedApis, handleSimilarClick]);

  return (
    <>
      <div className="flex">
        {effectiveTabId === 'adCopy' && (
          <div className="adcopy_container max-h-[calc(100svh-240px)] w-full overflow-y-auto 2xl:max-h-[calc(100svh-260px)]">
            <AdCopyHome />
            <AdPromptComponent />
          </div>
        )}

        {effectiveTabId === 'adCreative' && (
          <div className="adcopy_container w-full">
            <div className="max-h-[calc(100svh-73px)] w-full overflow-y-auto lg:max-h-[calc(100svh-73px)] 2xl:max-h-[calc(100svh-112px)]">
              <AdCreativesHome />
            </div>
            <AdPromptComponent />
          </div>
        )}

        {effectiveTabId === 'adVideo' && (
          <div className="adcopy_container max-h-[calc(100svh-200px)] w-full">
            <AdVideoHome />
            {Array.isArray(conversations) && conversations?.length === 0 && <AdPromptComponent />}
          </div>
        )}

        {effectiveTabId === 'adVideoNew' && (
          <div className="adcopy_container max-h-[calc(100svh-200px)] w-full">
            <AdVideoLayout />
            {/* {Array.isArray(conversations) && conversations?.length === 0 && <AdPromptComponent />} */}
          </div>
        )}

        {effectiveTabId === 'adCreativeNew' && (
          <div
            className={`adcopy_container w-full ${
              adCreativeNewActivePage === 'home' ? 'max-h-[calc(100svh-200px)]' : ''
            }`}
          >
            <AdCreativeNewLayout />
          </div>
        )}

        {effectiveTabId === 'adLibrary' && (
          <div className="adcopy_container max-h-[calc(100svh-73px)] w-full overflow-y-auto 2xl:max-h-[calc(100svh-112px)]">
            <AdLibraryPage />
          </div>
        )}
      </div>
    </>
  );
};

export default AdStudioPage;
