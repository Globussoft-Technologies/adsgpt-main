import getCookies from '@/utils/getCookies';
import axios from 'axios';
import { createAsyncThunk } from '@reduxjs/toolkit';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const AMEMBER_HOST = import.meta.env.VITE_AMEMBER_URL;
const AD_FACTORY_WEB_URL_AUTOFILL = import.meta.env.VITE_AD_FACTORY_WEB_URL_AUTOFILL;
const AD_FACTORY_WEB_URL_GETIMAGES = import.meta.env.VITE_AD_FACTORY_WEB_URL_GETIMAGES;
const REDIRECT_LOGIN = AMEMBER_HOST + '/login';
import { toast } from 'react-toastify';
import {
  resetNodeStatuses,
  setCompletedNodes,
  setFormProgress,
  setSelectedServices,
  updateNodeEnabledStatus,
  updateNodeStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';
import {
  setDeleteCampaignId,
  setDeleteDialogOpen,
  updateAdCreatives,
  updateBrandInfo,
  updateHistory,
} from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

export const createCampaign = createAsyncThunk(
  'adFactory/createCampaign',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      const res = await axios.post(`${BACKEND_HOST}/adsgpt/campaign/create`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });
      if (res?.data?.campaignId) {
        dispatch(resetNodeStatuses());
      }
      return res?.data?.campaignId;
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      if (err?.response?.status === 409) {
        toast.error('This campaign name already exists. Please try a different campaign name.');
        return rejectWithValue('This already exists. Please try a different campaign name.');
      }
      return rejectWithValue(
        err?.response?.data?.error || err?.message || 'Failed to create new campaign'
      );
    }
  }
);

export const downloadaszip = createAsyncThunk(
  'adFactory/downloadaszip',
  async (payload, { rejectWithValue }) => {
    try {
      const res = await axios.post(`${BACKEND_HOST}/adsgpt/campaign/images-zip-download`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
        responseType: 'blob', // Tell axios to expect binary data
      });

      // Return the blob data with filename suggestion
      return {
        blob: res.data,
        filename: `images_${Date.now()}.zip`,
      };
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.error || err?.message || 'Failed to download ZIP'
      );
    }
  }
);
export const Analyzingsweburl = createAsyncThunk(
  'adFactory/analyzweburl',
  async (payload, { rejectWithValue, dispatch, getState }) => {
    const { adFactoryNew } = getState();
    try {
      const res = await axios.post(AD_FACTORY_WEB_URL_AUTOFILL, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });

      const { brandInfo, objectives } = res?.data || {};

      // Check if brandInfo has essential data
      const hasValidBrandInfo =
        brandInfo &&
        (brandInfo.brandName ||
          brandInfo.brandDescription ||
          (brandInfo.brandLogo && brandInfo.brandLogo.length > 0));

      // Check if objectives has essential data
      const hasValidObjectives =
        objectives &&
        (objectives.primaryObjective ||
          objectives.coreIdea ||
          (objectives.callToAction && objectives.callToAction.length > 0));

      // Dispatch actions based on data validity
      if (hasValidBrandInfo) {
        dispatch(setCompletedNodes('brand-info'));
        dispatch(setFormProgress({ nodeId: 'brand-info', progress: 100 }));
        const payload = {
          campaignId: adFactoryNew?.activeCampainId,
          nodeType: 'brandInfo',
          data: res?.data?.brandInfo,
        };
        dispatch(updateCampaign(payload));
      } else if (brandInfo) {
        dispatch(setFormProgress({ nodeId: 'brand-info', progress: 50 }));
      }

      if (hasValidObjectives) {
        dispatch(setCompletedNodes('objectives'));
        dispatch(setFormProgress({ nodeId: 'objectives', progress: 100 }));
        const payload = {
          campaignId: adFactoryNew?.activeCampainId,
          nodeType: 'objectives',
          data: res?.data?.objectives,
        };
        dispatch(updateCampaign(payload));
      } else if (objectives) {
        dispatch(setFormProgress({ nodeId: 'objectives', progress: 50 }));
      }

      // Update node enabled status if we have any valid data
      if (hasValidBrandInfo || hasValidObjectives || brandInfo || objectives) {
        dispatch(updateNodeEnabledStatus());
      }

      return res?.data;
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.error || err?.message || 'Failed to analyze website URL'
      );
    }
  }
);

export const AnalyzingsweburlForImages = createAsyncThunk(
  'adFactory/AnalyzingsweburlForImages',
  async (payload, { rejectWithValue, dispatch, getState }) => {
    try {
      const res = await axios.post(AD_FACTORY_WEB_URL_GETIMAGES, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });
      return res;
    } catch (err) {
      return rejectWithValue(
        err?.response?.data?.error || err?.message || 'Failed to analyze website URL'
      );
    }
  }
);

export const updateCampaign = createAsyncThunk(
  'adFactory/updateCampaign',
  async (payload, { rejectWithValue, dispatch, getState }) => {
    try {
      const res = await axios.put(`${BACKEND_HOST}/adsgpt/campaign/update`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });
      const { socket } = getState();
      if (res.status === 200) {
        const fetchPayload = {
          campaignId: payload?.campaignId,
          userId: socket?.userData?.user_id,
        };
        dispatch(fetchCampaignById(fetchPayload));
      }
      return res?.data;
    } catch (err) {
      if (err?.response?.status === 400) {
        const data = err?.response?.data;
        const errorMsg =
          data?.details?.[0]?.message || data?.message || 'Please enter a valid CTA link';
        return rejectWithValue(errorMsg);
      }
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      if (err?.response?.status === 409) {
        return rejectWithValue(
          err?.response?.data?.message ||
            'This campaign name already exists. Please try a different campaign name.'
        );
      }
      return rejectWithValue(
        err?.response?.data?.error || err?.message || 'Failed to update campaign'
      );
    }
  }
);

export const updateCreativeById = createAsyncThunk(
  'adFactory/updateCreativeById',
  async ({ campaignId, creativeId, data }, { rejectWithValue }) => {
    try {
      const res = await axios.put(
        `${BACKEND_HOST}/adsgpt/campaign/creatives/${campaignId}/${creativeId}`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getCookies()}`,
          },
        }
      );

      return res.data;
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err?.message || 'Failed to update creative'
      );
    }
  }
);

export const fetchCampaigns = createAsyncThunk(
  'aadFactory/fetchCampaigns',
  async (userId, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/campaign/get/${userId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      return res?.data || [];
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch Campaigns'
      );
    }
  }
);
function getQuantityByServiceName(servicesSelected, serviceName) {
  if (!servicesSelected || !Array.isArray(servicesSelected)) return 0;
  const service = servicesSelected.find((item) => item.serviceName === serviceName);
  return service ? service?.serviceParams?.quantity || 0 : 0;
}

const transformFromFinalFormat = (transformedCreatives) => {
  if (!transformedCreatives || !Array?.isArray(transformedCreatives)) return [];

  return transformedCreatives.map((transformed, index) => {
    // Reverse CTA mapping - from uppercase with underscores to readable text
    const reverseCtaMap = {
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

    // Try to find the reverse mapping, otherwise convert from underscore to space
    const ctaText =
      reverseCtaMap[transformed?.callToAction] ||
      (transformed?.callToAction
        ? transformed?.callToAction
            .toLowerCase()
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase())
        : 'Learn More');

    return {
      id: transformed?.creativeId || Date.now(),
      name: `Ad Creative ${index + 1}`,
      image: transformed?.imageUrl || '',
      text: {
        id: `ai-${index + 1 || 1}`,
        title: `Ad Copy ${index + 1 || 1}`,
        primaryText: transformed?.message || '',
        headline: transformed?.headline || '',
        description: transformed?.description || '',
        ctaLabel: '[CTA Link]',
        timestamp: new Date().toISOString(),
        isAI: false,
      },
      cta: ctaText,
      ctaLink: transformed?.linkUrl || '',
      createdAt: new Date().toISOString(),
    };
  });
};

const getEmptyAdCreatives = () => [
  {
    id: '1',
    name: 'Ad Creative 1',
    image: '',
    text: [],
    cta: '',
    ctaLink: null,
    createdAt: '',
  },
];
// Function to update node states based on campaign data
// NOTE: This function should NOT reset completedNodes - it only updates based on server data
// Local Redux state (like preview, post-ad completion) should be preserved
const updateNodeStatesFromCampaignData = (campaignData, dispatch, getState) => {
  if (!campaignData) return;

  const {
    brandInfo,
    objectives,
    assets,
    distribution,
    services,
    results,
    creatives,
    preview,
    postAd,
  } = campaignData;
  const state = getState();
  const currentCompletedNodes = state?.adFactory?.completedNodes || [];

  // Always sync creatives when campaign changes so we don't show previous campaign CTA/link
  if (Array.isArray(creatives) && creatives.length > 0) {
    const transformed = transformFromFinalFormat(creatives);
    dispatch(updateAdCreatives(transformed));
  } else {
    dispatch(updateAdCreatives(getEmptyAdCreatives()));
  }

  // DON'T reset - preserve local state like preview and post-ad completion
  // Only update nodes based on server data

  // 1. Check Brand Info
  if (brandInfo?.status === 'success') {
    if (!currentCompletedNodes.includes('brand-info')) {
      dispatch(setCompletedNodes('brand-info'));
    }
    dispatch(setFormProgress({ nodeId: 'brand-info', progress: 100 }));
  }

  // 2. Check Objectives
  if (objectives?.status === 'success') {
    if (!currentCompletedNodes.includes('objectives')) {
      dispatch(setCompletedNodes('objectives'));
    }
    dispatch(setFormProgress({ nodeId: 'objectives', progress: 100 }));
  }

  // 3. Check Assets
  if (assets?.status === 'success') {
    if (!currentCompletedNodes.includes('assets')) {
      dispatch(setCompletedNodes('assets'));
    }
    dispatch(setFormProgress({ nodeId: 'assets', progress: 100 }));
  }

  // 4. Check Distribution (Platforms)
  if (distribution?.status === 'success') {
    if (!currentCompletedNodes.includes('validate')) {
      dispatch(setCompletedNodes('validate'));
    }
    dispatch(setFormProgress({ nodeId: 'validate', progress: 100 }));
  }

  // 5. Check Services
  if (services?.status === 'success') {
    if (!currentCompletedNodes.includes('services')) {
      dispatch(setCompletedNodes('services'));
    }
    dispatch(setFormProgress({ nodeId: 'services', progress: 100 }));

    const imageQuantity = getQuantityByServiceName(services?.servicesSelected, 'image');
    const textQuantity = getQuantityByServiceName(services?.servicesSelected, 'text');
    const historytext = campaignData.history?.some(
      (item) =>
        (item.textCount && item.textCount > 0) ||
        item?.previousData?.results?.text?.some((t) => t.status === 200)
    );
    const historyImage = campaignData.history?.some(
      (item) =>
        (item.imageCount && item.imageCount > 0) ||
        item?.previousData?.results?.image?.some((i) => i.status === 200)
    );

    const image = results?.image?.some((item) => item.status === 200);
    const text = results?.text?.some((item) => item.status === 200);

    // Sync selected services to ensure node locking logic is correct
    dispatch(
      setSelectedServices({
        text: textQuantity > 0,
        image: imageQuantity > 0,
        video: false,
      })
    );

    // Text Generation Completion Check
    if (text || historytext) {
      if (!currentCompletedNodes.includes('text-generation')) {
        dispatch(setCompletedNodes('text-generation'));
      }
      dispatch(setFormProgress({ nodeId: 'text-generation', progress: 100 }));
    }

    // Image Generation Completion Check
    if (image || historyImage) {
      if (!currentCompletedNodes.includes('image-generation')) {
        dispatch(setCompletedNodes('image-generation'));
      }
      dispatch(setFormProgress({ nodeId: 'image-generation', progress: 100 }));
    }
  }

  if (creatives?.length > 0 || preview?.status === 'success') {
    if (!currentCompletedNodes.includes('preview')) {
      dispatch(setCompletedNodes('preview'));
    }
    dispatch(setFormProgress({ nodeId: 'preview', progress: 100 }));
  }

  if (postAd?.status === 'success' || campaignData?.status === 'published') {
    if (!currentCompletedNodes.includes('post-ad')) {
      dispatch(setCompletedNodes('post-ad'));
    }
    dispatch(setFormProgress({ nodeId: 'post-ad', progress: 100 }));
  }

  dispatch(updateNodeEnabledStatus());
};

export const fetchCampaignById = createAsyncThunk(
  'aadFactory/fetchCampaignById',
  async (payload, { rejectWithValue, dispatch, getState }) => {
    try {
      // DON'T reset node statuses - this clears local Redux state like preview/post-ad completion
      // dispatch(resetNodeStatuses());
      const token = getCookies();

      // Fetch both campaign data and history in parallel
      const [res, historyRes] = await Promise.all([
        axios.get(`${BACKEND_HOST}/adsgpt/campaign/get/${payload?.userId}/${payload?.campaignId}`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }),
        axios
          .get(
            `${BACKEND_HOST}/adsgpt/campaign/get-history/${payload?.userId}/${payload?.campaignId}`,
            {
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            }
          )
          .catch(() => ({ data: { data: [] } })), // Gracefully handle history fetch errors
      ]);

      const campaignData = res?.data?.data;
      const historyData = historyRes?.data?.data || [];

      // Merge history into campaignData so updateNodeStatesFromCampaignData can use it
      const enhancedCampaignData = {
        ...campaignData,
        history: historyData,
      };

      updateNodeStatesFromCampaignData(enhancedCampaignData, dispatch, getState);

      return enhancedCampaignData;
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch Campaigns'
      );
    }
  }
);

export const fetchAdFactoryHistory = createAsyncThunk(
  'aadFactory/fetchAdFactoryHistory',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      // dispatch(resetNodeStatuses());
      const token = getCookies();
      const res = await axios.get(
        `${BACKEND_HOST}/adsgpt/campaign/get-history/${payload?.userId}/${payload?.campaignId}`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }
      );

      const campaignData = res?.data?.data;
      // updateNodeStatesFromCampaignData(campaignData, dispatch);
      return res?.data?.data || [];
    } catch (err) {
      if (err?.response?.status === 404) {
        dispatch(updateHistory({}));
      }
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch Campaigns'
      );
    }
  }
);

export const deleteAdFactoryCampaign = createAsyncThunk(
  'adFactory/deleteAdFactoryCampaign',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const res = await axios.delete(
        `${BACKEND_HOST}/adsgpt/campaign/delete/${payload?.userId}/${payload?.campaignId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      dispatch(setDeleteCampaignId(payload?.campaignId));

      if (res.data.success === true) {
        toast.success(res.data.message);
        await dispatch(fetchCampaigns(payload?.userId));
        await dispatch(setDeleteDialogOpen(false));
      }
      // Return the deleted campaign ID for state update
      return {
        campaignId: payload?.campaignId,
        data: res?.data?.data || {},
      };
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to delete campaign'
      );
    }
  }
);

export const deleteAdFactoryAdcreative = createAsyncThunk(
  'adFactory/deleteAdFactoryAdcreative',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const res = await axios.delete(
        `${BACKEND_HOST}/adsgpt/campaign/creatives/${payload?.campaignId}/${payload?.creativeId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to delete creative'
      );
    }
  }
);
export const connectToFacebook = createAsyncThunk(
  'adFactory/connectToFacebook',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const { userId, campaignId } = payload;
      const res = await axios.get(
        `${BACKEND_HOST}/api/auth/facebook?userId=${userId}&campaignId=${campaignId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return res;
    } catch (err) {
      console.log('failed to connect to facebook', err);
      return rejectWithValue('failed to connect to facebook');
    }
  }
);

export const checkGoogleUser = createAsyncThunk(
  'adFactory/checkGoogleUser',
  async (userId, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/google-ads/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      // console.log(res)
      return res?.data?.data;
    } catch (err) {
      return rejectWithValue('failed');
    }
  }
);

// DELETE /google-ads/users/:id — :id is the userId stored in the
// GoogleUsers collection (e.g. GPT-123). The /google-ads router enforces
// authenticateJWT, so the Bearer token must accompany every request.
export const disconnectGoogleUser = createAsyncThunk(
  'adFactory/disconnectGoogleUser',
  async (userId, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.delete(
        `${BACKEND_HOST}/adsgpt/google-ads/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return res?.data;
    } catch (err) {
      return rejectWithValue(err?.response?.data?.error || 'failed');
    }
  }
);

export const checkFbUser = createAsyncThunk(
  'adFactory/checkFbUser',
  async (userId, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/ad-posting/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      // console.log(res)
      return res?.data?.data;
    } catch (err) {
      return rejectWithValue('failed');
    }
  }
);

export const fetchAdAccounts = createAsyncThunk(
  'adFactory/fetchAdAccounts',
  async (id, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/ad-posting/ads/accounts/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return res?.data?.adAccounts;
    } catch (err) {
      return rejectWithValue('failed');
    }
  }
);

export const fetchFacebookPages = createAsyncThunk(
  'adFactory/fetchFacebookPages',
  async (id, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/ad-posting/pages/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return res?.data?.pages;
    } catch (err) {
      return rejectWithValue('failed');
    }
  }
);

export const fetchCampaign = createAsyncThunk(
  'adFactory/fetchCampaign',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const { adAccountId, accountId } = payload;
      const res = await axios.get(
        `${BACKEND_HOST}/adsgpt/ad-posting/ads/campaigns?adAccountId=${adAccountId}&accountId=${accountId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return res?.data?.campaigns;
    } catch (err) {
      return rejectWithValue('failed');
    }
  }
);

export const fetchAdsets = createAsyncThunk(
  'adFactory/fetchAdsets',
  async (payload, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();
      const { adAccountId, accountId, campaignId } = payload;
      const res = await axios.get(
        `${BACKEND_HOST}/adsgpt/ad-posting/ads/adsets?adAccountId=${adAccountId}&accountId=${accountId}&campaignId=${campaignId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return res?.data?.adSets;
    } catch (err) {
      return rejectWithValue('failed');
    }
  }
);

// Posts to the V2 endpoint — cell-aware (Traffic / Leads / App Promotion).
// Backend reads the selected Meta campaign + ad set to figure out the
// right object_story_spec shape, so the legacy "everything is link_data"
// breakage on Lead Gen + App Promotion campaigns is gone.
export const launchcampaign = createAsyncThunk(
  'adFactory/launchcampaign',
  async (payload, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.post(
        `${BACKEND_HOST}/adsgpt/ad-posting/ads/v2/create`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );
      toast.success(res?.data?.message);
      return res;
    } catch (err) {
      console.log('failed to launch campaign', err);
      const data = err?.response?.data;
      const message =
        data?.error ||
        data?.details?.message ||
        data?.message ||
        err?.message ||
        'Failed to launch campaign';
      toast.error(message);
      return rejectWithValue('failed to launch campaign');
    }
  }
);
export const launchGoogleAd = createAsyncThunk(
  'adFactory/launchGoogleAd',
  async (payload, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.post(`${BACKEND_HOST}/adsgpt/google-ads/ads`, payload, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      toast.success(res?.data?.message || 'Google Ad launched successfully');
      return res?.data;
    } catch (err) {
      if (err?.response?.status === 403) window.location.href = REDIRECT_LOGIN;
      const message =
        err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Failed to launch Google Ad';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

export const fetchGoogleAdAccounts = createAsyncThunk(
  'adFactory/fetchGoogleAdAccounts',
  async (userId, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/google-ads/get-ad-accounts`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      console.log('[fetchGoogleAdAccounts] response:', res?.data);
      return res?.data?.adAccounts || [];
    } catch (err) {
      if (err?.response?.status === 403) window.location.href = REDIRECT_LOGIN;
      return rejectWithValue(err?.response?.data?.message || err?.message || 'Failed to fetch Google Ad Accounts');
    }
  }
);

export const fetchGoogleCampaigns = createAsyncThunk(
  'adFactory/fetchGoogleCampaigns',
  async ({ adAccountId }, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/google-ads/get-campaigns?adAccountId=${adAccountId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      return res?.data?.data?.[0]?.campaigns || [];
    } catch (err) {
      if (err?.response?.status === 403) window.location.href = REDIRECT_LOGIN;
      return rejectWithValue(err?.response?.data?.message || err?.message || 'Failed to fetch Google Campaigns');
    }
  }
);

export const fetchGoogleAdGroups = createAsyncThunk(
  'adFactory/fetchGoogleAdGroups',
  async ({ adAccountId, campaignId }, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.get(
        `${BACKEND_HOST}/adsgpt/google-ads/get-ad-groups?adAccountId=${adAccountId}&campaignId=${campaignId}`,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      return res?.data?.adGroups || [];
    } catch (err) {
      if (err?.response?.status === 403) window.location.href = REDIRECT_LOGIN;
      return rejectWithValue(err?.response?.data?.message || err?.message || 'Failed to fetch Google Ad Groups');
    }
  }
);

export const uploadAdFactoryEditedImage = createAsyncThunk(
  'adFactory/uploadAdFactoryEditedImage',
  async (payload, { rejectWithValue, dispatch, getState }) => {
    try {
      const token = getCookies();
      const { socket } = getState();
      const formData = new FormData();
      formData.append('file', payload.file);
      formData.append('userId', payload.userId);
      formData.append('type', 'IMAGE');
      formData.append('campaignId', payload.campaignId);
      if (payload.historyId) formData.append('historyId', payload.historyId);
      if (payload.contextType) formData.append('contextType', payload.contextType);
      if (payload.adPath) formData.append('adPath', payload.adPath);

      // Step 1: Upload image to S3 and get the imageUrl
      const uploadRes = await axios.post(
        `${BACKEND_HOST}/adsgpt/adCreative/upload-image`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (uploadRes.status === 200) {
        const imageUrl = uploadRes?.data?.data;

        // Step 2: Save the edited image using the imageUrl
        const savePayload = {
          userId: payload.userId,
          campaignId: payload.campaignId,
          imageUrl: imageUrl,
          historyId: payload.historyId,
          contextType: payload.contextType,
          prompt: payload.prompt || 'Edited image',
        };

        const saveRes = await axios.post(
          `${BACKEND_HOST}/adsgpt/campaign/save-edited-image`,
          savePayload,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          }
        );

        // Step 3: Refetch campaign to update Redux state immediately
        if (saveRes.status === 200) {
          const fetchPayload = {
            campaignId: payload.campaignId,
            userId: payload.userId,
          };
          dispatch(fetchCampaignById(fetchPayload));
        }

        return saveRes?.data;
      }
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.error || err?.message || 'Failed to upload and save edited image'
      );
    }
  }
);
