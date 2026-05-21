// import {
//   setCampaignId,
//   setNodeStatus,
//   clearNodeError,
//   populateBrandForm,
//   populateInputsForm,
//   setFormData,
//   setCompletedNodes,
//   populateAssetsForm,
//   populateDistributionForm,
//   populateServicesForm,
// } from '@/store/reducers/AdFactory/AdFactorySlice';
// import {
//   getSocket,
//   setGeneretedAds,
//   setGeneretedAdsdraft,
// } from '@/store/reducers/socket/socketSlice';
// import getCookies from '@/utils/getCookies';
// import { createAsyncThunk } from '@reduxjs/toolkit';
// import { toast } from 'react-toastify';

// const HOST = import.meta.env.VITE_SOCKET_URL;

// // Enhanced error handler
// const handleApiError = (error, defaultMessage = 'Operation failed') => {
//   console.error('API Error:', error);

//   if (error.response?.data?.message) {
//     return error.response.data.message;
//   }

//   if (error.message?.includes('Failed to fetch')) {
//     return 'Network error. Please check your connection.';
//   }

//   return error.message || defaultMessage;
// };

// // Enhanced API request wrapper
// const makeApiRequest = async (url, options, nodeId, { rejectWithValue, dispatch }) => {
//   try {
//     // dispatch(clearNodeError(nodeId));

//     const token = getCookies();
//     const response = await fetch(url, {
//       ...options,
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${token}`,
//         ...options.headers,
//       },
//     });

//     const data = await response.json();

//     if (!response.ok) {
//       // throw new Error(data.message || `HTTP error! status: ${response.status}`);
//     }

//     // Show success message if available
//     if (data.message && data.success !== false) {
//       toast.success(data.message);
//     }

//     // Show warning if campaign name exists but operation succeeded
//     if (data.message && data.success === false && data.campaignId) {
//       toast.warning(data.message);
//       return data; // Still return data for successful creation with warning
//     }

//     return data;
//   } catch (error) {
//     const errorMessage = handleApiError(error);
//     toast.error(errorMessage);
//     return rejectWithValue(errorMessage);
//   }
// };

// // START node API
// export const submitStartNode = createAsyncThunk(
//   'adFactory/submitStartNode',
//   async (payload, { rejectWithValue, getState, dispatch }) => {
//     const { socket } = getState();

//     if (!socket?.userData?.user_id) {
//       toast.error('User data not available');
//       return rejectWithValue('User data not available');
//     }

//     const data = await makeApiRequest(
//       `${HOST}/adsgpt/campaign/create`,
//       {
//         method: 'POST',
//         body: JSON.stringify(payload),
//       },
//       'start',
//       { rejectWithValue, dispatch }
//     );

//     // Handle campaign name exists scenario
//     if (data.success === false && data.campaignId) {
//       dispatch(setCampaignId(data.campaignId));
//       const socketio = getSocket();
//       socketio.emit('adFactoryRequest', data.campaignId);
//       sessionStorage.setItem('campaignId', data.campaignId);
//       return data;
//     }

//     if (data.campaignId) {
//       dispatch(setCampaignId(data.campaignId));
//       const socketio = getSocket();
//       socketio.emit('adFactoryRequest', data.campaignId);
//       sessionStorage.setItem('campaignId', data.campaignId);
//     }

//     return data;
//   }
// );

// export const getCampaignData = createAsyncThunk(
//   'adFactory/getCampaignData',
//   async (_, { rejectWithValue, getState, dispatch }) => {
//     const { adFactory, socket } = getState();

//     if (!socket?.userData?.user_id) {
//       return rejectWithValue('User data not available');
//     }

//     try {
//       const data = await makeApiRequest(
//         `${HOST}/adsgpt/campaign/get/${socket.userData.user_id}/${adFactory.campaignId}`,
//         { method: 'GET' },
//         'start',
//         { rejectWithValue }
//       );

//       // Dispatch after successful API call
//       if (data?.data?.results) {
//         dispatch(setGeneretedAdsdraft(data.data.results.image));
//       }
//       const populateFormsWithCampaignData = async (campaignData) => {
//         // Mark start as completed when loading existing campaign
//         dispatch(setCompletedNodes('start'));
//         dispatch(
//           setNodeStatus({
//             nodeId: 'start',
//             status: 'success',
//             progress: 100,
//           })
//         );

//         if (campaignData?.brandInfo && Object.keys(campaignData?.brandInfo)?.length > 0) {
//           // dispatch(populateBrandForm(campaignData?.brandInfo));
//           // dispatch(setCompletedNodes('brand'));
//           // dispatch(setNodeStatus({ nodeId: 'brand', status: 'success', progress: 100 }));
//         }

//         if (campaignData?.objectives && Object.keys(campaignData?.objectives)?.length > 0) {
//           // dispatch(populateInputsForm(campaignData?.objectives));
//           // dispatch(setCompletedNodes('input'));
//           // dispatch(setNodeStatus({ nodeId: 'input', status: 'success', progress: 100 }));
//         }

//         // Mark other nodes as completed based on available data
//         if (campaignData.assets) {
//           // dispatch(populateAssetsForm(campaignData?.assets));
//           // dispatch(setCompletedNodes('creative'));
//           // dispatch(setNodeStatus({ nodeId: 'creative', status: 'success', progress: 100 }));
//         }

//         if (campaignData?.distribution) {
//           dispatch(populateDistributionForm(campaignData?.distribution));
//           // dispatch(setCompletedNodes('validate'));
//           // dispatch(setNodeStatus({ nodeId: 'validate', status: 'success', progress: 100 }));
//         }

//         if (campaignData?.services && Object.keys(campaignData?.services)?.length > 0) {
//           // dispatch(populateServicesForm(campaignData?.services));
//           // dispatch(setCompletedNodes('generate'));
//           // dispatch(setNodeStatus({ nodeId: 'generate', status: 'success', progress: 100 }));
//         }
//       };
//       populateFormsWithCampaignData(data?.data);
//       // Auto-mark start as completed when loading existing campaign

//       dispatch(skipStartNode());

//       return data;
//     } catch (error) {
//       return rejectWithValue(error.message);
//     }
//   }
// );
// // Generic node submission function
// const createNodeSubmission = (nodeType, nodeId) =>
//   createAsyncThunk(
//     `adFactory/submit${nodeId.charAt(0).toUpperCase() + nodeId.slice(1)}Node`,
//     async (payload, { rejectWithValue, getState, dispatch }) => {
//       const { socket, adFactory } = getState();

//       if (!socket?.userData?.user_id) {
//         toast.error('User data not available');
//         return rejectWithValue('User data not available');
//       }

//       if (!adFactory.campaignId) {
//         toast.error('Campaign ID is required');
//         return rejectWithValue('Campaign ID is required');
//       }

//       const data = await makeApiRequest(
//         `${HOST}/adsgpt/campaign/update`,
//         {
//           method: 'PUT',
//           body: JSON.stringify(payload),
//         },
//         nodeId,
//         { rejectWithValue, dispatch }
//       );

//       return data;
//     }
//   );

// // Create all node submissions
// export const submitBrandNode = createNodeSubmission('brandInfo', 'brand');
// export const submitInputNode = createNodeSubmission('objectives', 'input');
// export const submitAssetsNode = createNodeSubmission('assets', 'creative');
// export const submitValidateNode = createNodeSubmission('distribution', 'validate');
// export const submitServicesNode = createNodeSubmission('services', 'generate');
