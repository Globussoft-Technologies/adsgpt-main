import axios from 'axios';
import getCookies from '@/utils/getCookies';
import {
  setLoading,
  setError,
  setImageAndScript,
  setClonePayload,
  setAllVideos,
  setAvatars,
  appendAvatars,
  setAvatarsPagination,
  setAvatarsLoading,
  setAiAdsAnalysisData,
  setAiAdsAnalysisLoading,
  setAiAdsAnalysisError,
  setAiAdsSceneData,
  setAiAdsSceneError,
  setAiAdsSceneLoading,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { uploadToS3 } from '@/utils/imageUpload';
import { globalToast } from '@/utils/globalToast';
import { setSavedCount } from '@/store/reducers/adStudio/adVideoNewSlice';
import { GA4Events } from '@/utils/ga4';
import { toVideoDurationValue } from '@/utils/videoModelCapabilities';
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const VIDEO_GENERATE_API = `${BACKEND_HOST}/adsgpt/video/generate`;

export const generateVideoAction =
  (payload, files = []) =>
  async (dispatch, getState) => {
    try {
      dispatch(setLoading(true));
      dispatch(setError(null));

      const { socket } = getState();
      const userId = socket?.userData?.user_id;
      GA4Events.adVideoProductBrollsRequested({ source: 'product_brolls_form', success: true });

      let imageUrl = '';

      if (files.length > 0) {
        const imgObj = files[0];
        const file = imgObj.file;

        if (file) {
          globalToast.loading('Uploading image...');
          const uploadedUrl = await uploadToS3(file, userId, true);
          globalToast.dismiss();
          if (uploadedUrl) {
            imageUrl = `${S3_BASE_URL}${uploadedUrl}`;
          } else {
            throw new Error('Image upload failed');
          }
        } else if (imgObj.url) {
          imageUrl = imgObj.url;
        } else if (imgObj.preview && !imgObj.preview.startsWith('blob:')) {
          // External URL — fetch, upload to S3, use S3 URL
          globalToast.loading('Uploading image...');
          const res = await fetch(imgObj.preview);
          const blob = await res.blob();
          const urlFile = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
          const uploadedUrl = await uploadToS3(urlFile, userId, true);
          globalToast.dismiss();
          if (uploadedUrl) {
            imageUrl = `${S3_BASE_URL}${uploadedUrl}`;
          } else {
            throw new Error('Image upload failed');
          }
        }
      }

      const finalPayload = {
        ...payload,
        inputs: {
          ...payload.inputs,
          duration: toVideoDurationValue(payload.inputs?.duration),
          image: imageUrl || (payload.inputs.image ? `${S3_BASE_URL}${payload.inputs.image}` : ''),
        },
      };

      const response = await axios.post(VIDEO_GENERATE_API, finalPayload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });

      if (response.status === 200 || response.status === 201) {
        dispatch(setImageAndScript(response.data));
        globalToast.success('Video generation started successfully!');
        return response.data;
      } else {
        throw new Error('Video generation failed');
      }
    } catch (error) {
      console.error('Error generating video:', error);
      const errorMsg =
        error.response?.data?.error || error.message || 'An error occurred during video generation';
      dispatch(setError(errorMsg));
      globalToast.error(errorMsg);
      throw error;
    } finally {
      dispatch(setLoading(false));
    }
  };

export const fetchProcessingCount = () => async (dispatch) => {
  try {
    const response = await axios.get(`${BACKEND_HOST}/adsgpt/video/processing-count`, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    // console.log("count",response)
    const count = response?.data?.count || 0;

    dispatch(setSavedCount(count));
  } catch (error) {
    console.error('Error fetching processing count:', error);
  }
};

export const fetchAllVideos =
  ({ skip = 0, limit = 10, append = false, type = '', startDate = '', endDate = '' } = {}) =>
  async (dispatch, getState) => {
    try {
      dispatch(setLoading(true));
      const response = await axios.get(`${BACKEND_HOST}/adsgpt/video/all`, {
        params: { skip, limit, type, startDate, endDate },
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      });
      // console.log('all videos', response);
      const videos = response?.data?.data || [];
      if (append) {
        const { allVideos } = getState().adVideoNew;
        dispatch(setAllVideos([...allVideos, ...videos]));
      } else {
        dispatch(setAllVideos(videos));
      }
      return videos;
    } catch (error) {
      console.error('Error fetching all videos:', error);
      return [];
    } finally {
      dispatch(setLoading(false));
    }
  };

export const generateVideoUGCAction =
  (payload, files = []) =>
  async (dispatch, getState) => {
    try {
      dispatch(setLoading(true));
      dispatch(setError(null));

      const { socket } = getState();
      const userId = socket?.userData?.user_id;
      GA4Events.adVideoAIUGCAdsRequested({ source: 'ai_ugc_ads_form', success: true });

      let imageUrl = '';

      if (files.length > 0) {
        const selectedImage = files[0];

        // CASE 1: Image from analyze-url API — fetch and upload to S3
        if (selectedImage.isApiImage) {
          globalToast.loading('Uploading image...');
          const res = await fetch(selectedImage.preview);
          const blob = await res.blob();
          const urlFile = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
          const uploadedUrl = await uploadToS3(urlFile, userId, true);
          globalToast.dismiss();
          if (!uploadedUrl) throw new Error('Image upload failed');
          imageUrl = `${S3_BASE_URL}${uploadedUrl}`;
        }

        // CASE 2: Image pasted URL — fetch and upload to S3
        else if (selectedImage.isUrl) {
          globalToast.loading('Uploading image...');
          const res = await fetch(selectedImage.preview);
          const blob = await res.blob();
          const urlFile = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
          const uploadedUrl = await uploadToS3(urlFile, userId, true);
          globalToast.dismiss();
          if (!uploadedUrl) throw new Error('Image upload failed');
          imageUrl = `${S3_BASE_URL}${uploadedUrl}`;
        }

        // CASE 3: Manually uploaded image
        else if (selectedImage.file) {
          globalToast.loading('Uploading image...');

          const uploadedUrl = await uploadToS3(selectedImage.file, userId, true);

          globalToast.dismiss();

          if (!uploadedUrl) {
            throw new Error('Image upload failed');
          }

          imageUrl = `${S3_BASE_URL}${uploadedUrl}`;
        }
      }

      const finalPayload = {
        ...payload,
        inputs: {
          ...payload.inputs,
          duration: toVideoDurationValue(payload.inputs?.duration),
          image: imageUrl,
        },
      };

      const response = await axios.post(VIDEO_GENERATE_API, finalPayload, {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 200 || response.status === 201) {
        dispatch(setImageAndScript(response.data));
        globalToast.success('Video generation started successfully!');
        return response.data;
      } else {
        throw new Error('Video generation failed');
      }
    } catch (error) {
      console.error('Error generating video:', error);

      const errorMsg =
        error.response?.data?.error || error.message || 'An error occurred during video generation';

      dispatch(setError(errorMsg));
      globalToast.error(errorMsg);

      throw error;
    } finally {
      dispatch(setLoading(false));
    }
  };

export const downloadMediaFromUrl = (mediaUrl, kind = 'video') => async () => {
  try {
    if (!mediaUrl) throw new Error('URL is required');

    // Image records arrive pre-normalised with absolute URLs; video records
    // still hand us relative paths. Only prefix S3 if the URL isn't already
    // absolute, otherwise we end up double-prefixing.
    const fullUrl = /^https?:\/\//i.test(mediaUrl) ? mediaUrl : `${S3_BASE_URL}${mediaUrl}`;
    const filename =
      mediaUrl.split('/').pop() || (kind === 'image' ? 'image.png' : 'video.mp4');

    const toastId = globalToast.loading(
      kind === 'image' ? 'Downloading image...' : 'Downloading video...',
    );

    const response = await axios.get(`${BACKEND_HOST}/adsgpt/video/download-media`, {
      params: { url: fullUrl },
      headers: {
        Authorization: `Bearer ${getCookies()}`,
      },
      responseType: 'blob',
    });

    const blob = new Blob([response.data]);
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(blobUrl);
    globalToast.success('Download completed', { id: toastId });
  } catch (error) {
    console.error('Download API error:', error);
    globalToast.error('Failed to download');
    throw error;
  }
};

export const downloadMediaZipAction = (urls, kind = 'video') => async () => {
  try {
    if (!urls || urls.length === 0) throw new Error('URLs are required');

    const toastId = globalToast.loading(
      kind === 'image'
        ? 'Preparing image zip download...'
        : 'Preparing video zip download...',
    );

    const fullUrls = urls.map((url) =>
      /^https?:\/\//i.test(url) ? url : `${S3_BASE_URL}${url}`,
    );

    const response = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/download-media-zip`,
      { urls: fullUrls },
      {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
        responseType: 'blob',
      }
    );

    const blob = new Blob([response.data], { type: 'application/zip' });
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${kind === 'image' ? 'images' : 'videos'}-${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(blobUrl);
    globalToast.success('Zip download completed', { id: toastId });
  } catch (error) {
    console.error('Zip download error:', error);
    globalToast.error('Failed to download zip');
    throw error;
  }
};

// `filter` can be a string (industry, legacy category dropdown) or an object
// of { field: value | value[] } for the faceted filter rail. Array values are
// sent as repeated query params so the backend can apply an $in match.
//
// Pagination is opt-in via opts.limit: when provided the backend returns a
// single page (+ hasMore/total) and we store that meta; opts.append controls
// whether the page replaces the list (page 1 / filter change) or is appended
// (infinite scroll). Without opts.limit the call returns the full list exactly
// as before, so existing non-paginated callers are unaffected. Always resolves
// to the avatar array.
export const getAllAvatars =
  (filter, { page, limit, append = false } = {}) =>
  async (dispatch) => {
    try {
      if (!append) dispatch(setAvatarsLoading(true));

      const filterObj =
        typeof filter === 'string'
          ? { industry: filter }
          : filter && typeof filter === 'object'
            ? filter
            : {};

      const params = new URLSearchParams();
      Object.entries(filterObj).forEach(([key, val]) => {
        if (val === undefined || val === null || val === '') return;
        if (Array.isArray(val)) {
          val.forEach((v) => {
            if (v !== undefined && v !== null && v !== '') params.append(key, v);
          });
        } else {
          params.append(key, val);
        }
      });

      if (limit) {
        params.append('page', String(page || 1));
        params.append('limit', String(limit));
      }

      const response = await axios.get(`${BACKEND_HOST}/adsgpt/avatar`, {
        params,
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      });
      const data = response.data.data || [];

      if (append) dispatch(appendAvatars(data));
      else dispatch(setAvatars(data));

      if (limit) {
        dispatch(
          setAvatarsPagination({
            page: response.data.page || page || 1,
            hasMore: !!response.data.hasMore,
            total: response.data.total ?? data.length,
          })
        );
      }

      return data;
    } catch (error) {
      console.error('Error fetching avatars:', error);
      return [];
    } finally {
      if (!append) dispatch(setAvatarsLoading(false));
    }
  };

export const getAvatarIndustries = () => async () => {
  try {
    const response = await axios.get(`${BACKEND_HOST}/adsgpt/avatar/industries`, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.data || [];
  } catch (error) {
    console.error('Error fetching avatar categories:', error);
    return [];
  }
};

export const getAvatarFilters = () => async () => {
  try {
    const response = await axios.get(`${BACKEND_HOST}/adsgpt/avatar/filters`, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.data || {};
  } catch (error) {
    console.error('Error fetching avatar filters:', error);
    return {};
  }
};

export const getVideoById = (id) => async () => {
  try {
    const response = await axios.get(`${BACKEND_HOST}/adsgpt/video/${id}`, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('getvideobyid: ', response);
    return response.data;
  } catch (error) {
    console.error('Error fetching video:', error);
    throw error;
  }
};

export const generateImageAndScript = (payload) => async (dispatch) => {
  try {
    dispatch(setLoading(true));
    dispatch(setError(null));
    const normalizedPayload = {
      ...payload,
      inputs: {
        ...payload.inputs,
        duration: toVideoDurationValue(payload.inputs?.duration),
      },
    };
    const response = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/generate-image-and-script`,
      normalizedPayload,
      {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('generateImageAndScript: ', response);
    dispatch(setImageAndScript(response.data));
    // globalToast.success('Image and script generation started successfully!');
    return response.data;
  } catch (error) {
    console.error('Error fetching image and script:', error);
    globalToast.error(error.response?.data?.error || 'Failed to generate image and script');
    dispatch(setError(error.response?.data?.error || 'Error fetching image and script'));
    throw error;
  } finally {
    dispatch(setLoading(false));
  }
};

export const regenerateCloneScript = (payload) => async (dispatch) => {
  try {
    const response = await axios.post(`${BACKEND_HOST}/adsgpt/video/regenerate-script-clone`, payload, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    const apiError = error.response?.data?.error || error.message;
    const fullErrorMsg = apiError ? `Failed to regenerate script: ${apiError}` : 'Failed to regenerate script';
    globalToast.error(fullErrorMsg);
    dispatch(setError(fullErrorMsg));
    throw error;
  }
};

export const regenerateScript = (payload) => async (dispatch) => {
  try {
    const response = await axios.post(`${BACKEND_HOST}/adsgpt/video/regenerate-script`, payload, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('regenerate Script: ', response);
    return response.data;
  } catch (error) {
    console.error('Error fetching regenerated script:', error);
    const apiError = error.response?.data?.error || error.message;
    const fullErrorMsg = apiError
      ? apiError
      : 'Failed to generate script';
    globalToast.error(fullErrorMsg);
    dispatch(setError(fullErrorMsg));
    throw error;
  }
};

export const generateAvatarVideo =
  (id, payload = {}) =>
  async (dispatch) => {
    try {
      dispatch(setLoading(true));
      dispatch(setError(null));
      const response = await axios.post(
        `${BACKEND_HOST}/adsgpt/video/generate-avatar-video/${id}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${getCookies()}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log(' Video generated successfully: ', response);
      globalToast.success('Video generation started successfully!');
      GA4Events.adVideoAIAvatarsRequested({ source: 'ai_avatars_form', success: true });
      return response.data;
    } catch (error) {
      console.error('Error in generating video', error);
      const errorMsg = 'Error in generating video';
      globalToast.error(error.response?.data?.error || errorMsg);
      dispatch(setError(errorMsg));
      throw error;
    } finally {
      dispatch(setLoading(false));
    }
  };


export const analyzeAiAdsAction = (aiAdsType, { script = '', name = '' }) => async (dispatch) => {
  try {
    dispatch(setAiAdsAnalysisLoading(true));
    dispatch(setAiAdsAnalysisError(null));
    const endpoint = `${BACKEND_HOST}/adsgpt/video/ai-ads/${aiAdsType}`;
    const response = await axios.post(
      endpoint,
      { script, name },
      {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const result = response.data?.data || response.data;
    dispatch(setAiAdsAnalysisData(result));
    return result;
  } catch (error) {
    const data = error.response?.data;
    const errorMsg = data?.error || data?.detail || 'Failed to analyze';
    dispatch(setAiAdsAnalysisError(errorMsg));
    throw error;
  } finally {
    dispatch(setAiAdsAnalysisLoading(false));
  }
};




export const generateAiAdsSceneAction = (aiAdsType, details) => async (dispatch, getState) => {
  try {
    dispatch(setAiAdsSceneLoading(true));
    dispatch(setError(null));

    const { socket } = getState();
    const userId = socket?.userData?.user_id;
    GA4Events.adVideoAIAdsRequested({ source: 'ai_ads_form', success: true });

    // Upload all images (url-based then file-based) to S3
    const imageUrls = [];

    for (const img of details.urlImages || []) {
      try {
        // Already on S3 — use as-is, no re-upload needed
        if (img.isS3 && img.url) {
          imageUrls.push(img.url);
          continue;
        }
        const res = await fetch(img.url);
        const blob = await res.blob();
        const file = new File([blob], img.name || 'image.jpg', { type: blob.type || 'image/jpeg' });
        const uploaded = await uploadToS3(file, userId, true);
        if (uploaded) imageUrls.push(`${S3_BASE_URL}${uploaded}`);
      } catch (e) {
        console.error('Image upload failed:', e);
      }
    }

    for (const img of details.uploadedImages || []) {
      if (!img.file) continue;
      const uploaded = await uploadToS3(img.file, userId, true);
      if (uploaded) imageUrls.push(`${S3_BASE_URL}${uploaded}`);
    }

    // Upload logo
    let logoUrl = '';
    const logoSource = details.uploadedLogo || details.urlLogo;
    if (logoSource) {
      try {
        if (logoSource.file) {
          const uploaded = await uploadToS3(logoSource.file, userId, true);
          if (uploaded) logoUrl = `${S3_BASE_URL}${uploaded}`;
        } else if (logoSource.isS3 && logoSource.url) {
          // Already on S3 — use as-is
          logoUrl = logoSource.url;
        } else if (logoSource.url) {
          const res = await fetch(logoSource.url);
          const blob = await res.blob();
          const file = new File([blob], 'logo.jpg', { type: blob.type || 'image/jpeg' });
          const uploaded = await uploadToS3(file, userId, true);
          if (uploaded) logoUrl = `${S3_BASE_URL}${uploaded}`;
        }
      } catch (e) {
        console.error('Logo upload failed:', e);
      }
    }

    const { formData } = details;
    const duration = toVideoDurationValue(formData.duration);
    const isBrand = aiAdsType === 'brand';

    // Voice cascade — the deliverable depends on the provider:
    //   • ElevenLabs → voiceId is the deliverable, voiceName is metadata.
    //   • Sarvam     → voiceName is the deliverable, voiceId stays ''.
    // voiceProvider tells Python which TTS engine to synthesize with; the rest
    // is metadata useful for analytics / recreating the picker on resume.
    // NOTE: key is `voiceFilters` (not `voice`) — the inputs schema already
    // reserves `voice: String` for the older video types.
    const voice = formData.voice || {};
    const voicePayload = {
      voiceProvider: voice.provider || 'elevenlabs',
      voiceId: voice.voiceId || '',
      voiceName: voice.voiceName || '',
      voiceFilters: {
        language: voice.language || '',
        languageLabel: voice.languageLabel || '',
        gender: voice.gender || '',
        accent: voice.accent || '',
        age: voice.age || '',
      },
    };

    const inputs = isBrand
      ? {
          type: 'ai_ads',
          aiAdsType: 'brand',
          brandName: formData.name,
          productDescription: formData.description,
          category: formData.category,
          images: imageUrls,
          logoUrl,
          adStyle: formData.adStyle,
          tone: formData.tone,
          ctaType: formData.cta,
          tagline: formData.tagline,
          model: formData.model,
          duration,
          aspectRatio: formData.aspectRatio,
          numberOfVideos: 1,
          userPrompt: formData.optimizedPrompt || '',
          captionsEnabled: formData.captionsEnabled ?? false,
          ...voicePayload,
        }
      : {
          type: 'ai_ads',
          aiAdsType: 'product',
          productName: formData.name,
          productDescription: formData.description,
          category: formData.category,
          images: imageUrls,
          logoUrl,
          adStyle: formData.adStyle,
          tone: formData.tone,
          ctaType: formData.cta,
          productType: formData.productType,
          price: formData.price || '',
          model: formData.model,
          duration,
          aspectRatio: formData.aspectRatio,
          numberOfVideos: 1,
          userPrompt: formData.optimizedPrompt || '',
          captionsEnabled: formData.captionsEnabled ?? false,
          ...voicePayload,
        };

    const response = await axios.post(
     `${BACKEND_HOST}/adsgpt/video/ai-ads/generate-scene`,
      { inputs },
      {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data?.valid === false) {
      dispatch(setAiAdsSceneLoading(false));
      return { __validationError: true, fields: response.data.fields || [], message: response.data.message };
    }

    // Unwrap to keep the Redux shape consistent with getAiAdsSceneAction.
    // Storing the wrapped {data: {...}} envelope leaves a stale empty
    // data.scenes:[] in state — and because [] is truthy, the
    // `sceneData?.data?.scenes || sceneData?.scenes` read in
    // ImplementationPlanStep keeps returning [] even after the socket text
    // event populates the top-level scenes, producing a blank panel until
    // the user refreshes (which goes through the GET action that already
    // unwraps).
    const sceneData = response.data?.data || response.data;
    const sessionId = sceneData?._id || null;
    dispatch(setAiAdsSceneData(sceneData));
    return { ...response.data, sessionId };
    // setAiAdsSceneLoading(false) is called by the aiAdsScenesReady socket event
  } catch (error) {
    const responseData = error.response?.data;
    if (responseData?.fields?.length > 0) {
      dispatch(setAiAdsSceneLoading(false));
      return { __validationError: true, fields: responseData.fields, message: responseData.message };
    }
    const errorMsg = responseData?.error || 'Failed to generate scenes';
    dispatch(setError(errorMsg));
    globalToast.error(errorMsg);
    dispatch(setAiAdsSceneLoading(false));
    throw error;
  }
};

export const getAiAdsSceneAction = (_id) => async (dispatch) => {
  try {
    dispatch(setAiAdsSceneError(null));
    dispatch(setAiAdsSceneLoading(true));
    const response = await axios.get(
      `${BACKEND_HOST}/adsgpt/video/${_id}`,
      { headers: { Authorization: `Bearer ${getCookies()}` } }
    );
    const data = response.data?.data || response.data;
    const failedBeforeScenes =
      data?.status === 'failed' &&
      (!Array.isArray(data?.scenes) || data.scenes.length === 0);
    const persistedSceneError =
      data?.sceneError ||
      (failedBeforeScenes
        ? 'Scene generation failed. Please try again.'
        : null);
    dispatch(setAiAdsSceneData(data));
    dispatch(setAiAdsSceneError(persistedSceneError));
    // This is a fetch, not a generation — turn off loading immediately
    dispatch(setAiAdsSceneLoading(false));
  } catch (error) {
    globalToast.error(error.response?.data?.error || 'Failed to fetch scenes');
    dispatch(setAiAdsSceneLoading(false));
  }
};

// segments: [{ segmentNumber: 0, regenerate: 'text'|'image'|'both' }]
export const regenerateAiAdsSceneAction = (_id, segments) => async (dispatch) => {
  try {
    dispatch(setAiAdsSceneLoading(true));
    await axios.post(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/regenerate-scene`,
      { sessionId: _id, segments },
      {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // console.log(error)
    const errorMsg = error.response?.data?.error || 'Insufficient credits to regenerate this image.';
    dispatch(setError(errorMsg));
    globalToast.error(errorMsg);
    dispatch(setAiAdsSceneLoading(false));
    throw error;
  }
  // setAiAdsSceneLoading(false) is called by the aiAdsScenesReady socket event
};

// Clones an existing AI Ads session into a new doc (status="copy") so the
// Recreate flow always lands on a fresh _id, even when the user doesn't edit
// the form. The new doc carries over inputs + scenes + scripts; results[] is
// empty until the user triggers generate-video. Returns { sessionId: newId }.
export const copyAiAdsSessionAction = (sessionId) => async (dispatch) => {
  try {
    const response = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/copy/${sessionId}`,
      {},
      { headers: { Authorization: `Bearer ${getCookies()}` } }
    );
    const newDoc = response.data?.data || response.data;
    const newId = newDoc?._id || response.data?.sessionId;
    if (newDoc) dispatch(setAiAdsSceneData(newDoc));
    return { sessionId: newId, data: newDoc };
  } catch (error) {
    const errorMsg = error.response?.data?.error || 'Failed to copy AI Ads session';
    globalToast.error(errorMsg);
    throw error;
  }
};

// `overrides` is optional — pass { scenes: [{ segmentNumber, script: [...] }] }
// when the user edited scripts in the Implementation Plan step. Node persists
// these to DB and forwards them to Python in place of the originals.
// ── Clone Yourself ────────────────────────────────────────────────────────────

export const generateCloneImageAndScript = (payload) => async (dispatch) => {
  try {
    dispatch(setLoading(true));
    dispatch(setError(null));
    const normalizedPayload = {
      ...payload,
      inputs: {
        ...payload.inputs,
        duration: toVideoDurationValue(payload.inputs?.duration),
      },
    };
    dispatch(setClonePayload(normalizedPayload));
    const res = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/generate-image-and-script-clone`,
      normalizedPayload,
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } }
    );
    dispatch(setImageAndScript(res.data));
    return res.data;
  } catch (error) {
    const msg = error.response?.data?.error || error.message || 'Clone generation failed';
    dispatch(setError(msg));
    globalToast.error(msg);
    throw error;
  } finally {
    dispatch(setLoading(false));
  }
};

export const regenerateCloneFirstFrame = (payload) => async (dispatch) => {
  try {
    const { images, ...cleanInputs } = payload?.inputs || {};
  const cleanPayload = { sessionId: payload?.sessionId, inputs: cleanInputs };
    const res = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/regenerate-frame-clone`,
      cleanPayload,
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (error) {
    const msg = error.response?.data?.error || error.message || 'Retry failed';
    globalToast.error(msg);
    throw error;
  }
};

export const generateCloneVideo = (id, payload) => async (dispatch) => {
  try {
    dispatch(setLoading(true));
    dispatch(setError(null));
    const res = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/generate-clone-video/${id}`,
      payload || {},
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } }
    );
    globalToast.success('Clone video generation started!');
    GA4Events.adVideoCloneYourselfRequested({ source: 'clone_yourself_form', success: true });
    return res.data;
  } catch (error) {
    const msg = error.response?.data?.error || error.message || 'Failed to generate clone video';
    globalToast.error(msg);
    throw error;
  } finally {
    dispatch(setLoading(false));
  }
};

// ─────────────────────────────────────────────────────────────────────────────

export const uploadVoice = (file, userId) => async () => {
  try {
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('voice', file);
    const res = await axios.post(`${BACKEND_HOST}/adsgpt/video/upload-voice`, formData, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data?.data || null;
  } catch (error) {
    const msg = error.response?.data?.message || 'Voice upload failed';
    globalToast.error(msg);
    throw error;
  }
};

export const generateAiAdsVideoAction = (sessionId, overrides) => async () => {
  try {
    const response = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/generate-video/${sessionId}`,
      overrides || {},
      { headers: { Authorization: `Bearer ${getCookies()}` } }
    );
    if (response.status === 200 || response.status === 201) {
      return true;
    }
    throw new Error('Video generation failed');
  } catch (error) {
    const errorMsg = error.response?.data?.error || 'Failed to generate video';
    globalToast.error(errorMsg);
    throw error;
  }
};

// Voice-only re-render on a completed AI Ads video. Returns 202 immediately;
// the finished version arrives via socket 'aiAdsVoiceReady'. `inputs` is the
// delta: { voiceProvider, voiceId, voiceName, regenType, translateLang }.
// The backend forwards Python's 400 already_in_language verbatim — we rethrow
// it with a code so the panel can show it inline instead of a generic toast.
export const regenerateAiAdsVoiceAction = (sessionId, inputs) => async () => {
  try {
    const response = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/regenerate-voice/${sessionId}`,
      { inputs },
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } }
    );
    return response.data; // { status:'processing', sessionId, regenType }
  } catch (error) {
    const data = error.response?.data;
    if (error.response?.status === 400 && data?.error === 'already_in_language') {
      const e = new Error(data?.message || 'This ad is already in that language.');
      e.code = 'already_in_language';
      throw e;
    }
    const errorMsg = data?.error || data?.message || 'Failed to regenerate voice';
    globalToast.error(errorMsg);
    throw error;
  }
};

// Translate/Rewrite Step 1 — preview the new script (no render). Returns 202;
// the translated/rewritten script arrives via socket 'aiAdsTranslateScriptReady'.
// `inputs` is the delta: { voiceProvider, voiceId, voiceName, regenType, translateLang }.
// Forwards Python's 400 already_in_language verbatim (rethrows with a code so the
// modal can show it inline).
export const previewRegenerateScriptAction = (sessionId, inputs) => async () => {
  try {
    const response = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/preview-regenerate-script/${sessionId}`,
      { inputs },
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } }
    );
    return response.data; // { status:'processing', sessionId, regenType }
  } catch (error) {
    const data = error.response?.data;
    if (error.response?.status === 400 && data?.error === 'already_in_language') {
      const e = new Error(data?.message || 'This ad is already in that language.');
      e.code = 'already_in_language';
      throw e;
    }
    const errorMsg = data?.error || data?.message || 'Failed to generate script';
    globalToast.error(errorMsg);
    throw error;
  }
};

export const finalMergeAiAdsVoiceAction = (sessionId, preview) => async () => {
  try {
    const response = await axios.post(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/final-merge/${sessionId}`,
      { audioUrl: preview.audioUrl, videoUrl: preview.videoUrl },
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } },
    );
    return response.data;
  } catch (error) {
    globalToast.error(error.response?.data?.error || 'Failed to merge the voice preview');
    throw error;
  }
};

export const discardAiAdsVoicePreviewAction = (sessionId) => async () => {
  try {
    await axios.post(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/discard-voice-preview/${sessionId}`,
      {},
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    globalToast.error(error.response?.data?.error || 'Failed to discard voice preview');
    throw error;
  }
};
// "Keep this one" / revert — move the version pointer to a results[] entry.
export const selectAiAdsVersionAction = (sessionId, version) => async () => {
  try {
    const response = await axios.patch(
      `${BACKEND_HOST}/adsgpt/video/ai-ads/select-version/${sessionId}`,
      { version },
      { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } }
    );
    return response.data; // { success:true, version }
  } catch (error) {
    const errorMsg = error.response?.data?.error || 'Failed to select version';
    globalToast.error(errorMsg);
    throw error;
  }
};
