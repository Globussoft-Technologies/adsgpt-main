// import {
//   // getCampaignData,
//   submitAssetsNode,
//   submitBrandNode,
//   submitInputNode,
//   submitServicesNode,
//   submitStartNode,
//   submitValidateNode,
// } from '@/store/actions/adFactory/adFactoryActions';
import { createSlice } from '@reduxjs/toolkit';

// Define node dependencies - which nodes need to be completed before others
const nodeDependencies = {
  'brand-info': [], // No dependencies
  objectives: ['brand-info'], // Requires brand-info to be completed
  assets: ['objectives'], // Requires objectives to be completed
  validate: ['assets'], // Requires assets to be completed
  services: ['validate'], // Requires assets to be completed
  'image-generation': ['services'], // Requires services to be completed AND image service selected
  'text-generation': ['services'], // Requires services to be completed AND text service selected
  preview: ['image-generation', 'text-generation'], // Requires generation to be done
  'post-ad': ['preview'], // Requires creatives to be done
  // 'video-generation': ['services'], // Requires services to be completed AND video service selected
};

const initialState = {
  campaignId: sessionStorage.getItem('campaignId') || null,
  campaignData: [],
  userId: null,
  formProgress: {},
  completedNodes: [],
  activeForm: null,
  error: null,
  loading: false,
  nodeStatus: {},
  // Track which services were selected
  selectedServices: {
    text: false,
    image: false,
    video: false,
  },
  nodes: [
    {
      id: 'brand-info',
      x: -250,
      y: 0,
      title: 'Brand Info',
      subtitle: 'Start by creating a creative campaign',
      status: 'idle',
      progress: 0,
      isEnabled: true, // Brand-info is always enabled initially
    },
    {
      id: 'objectives',
      x: 250,
      y: 60,
      title: 'Objectives',
      subtitle: 'Define the key objectives',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
    {
      id: 'assets',
      x: -300,
      y: 260,
      title: 'Assets',
      subtitle: 'Upload key visuals',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
    {
      id: 'validate',
      x: 100,
      y: 490,
      title: 'Platforms',
      subtitle: 'Select platforms for distribution',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
    {
      id: 'services',
      x: 200,
      y: 420,
      title: 'Services',
      subtitle: 'Select platforms for your campaign',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
    {
      id: 'image-generation',
      x: 700,
      y: 120,
      title: 'Image Generation',
      subtitle: 'Generate AI Images',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
    {
      id: 'text-generation',
      x: 700,
      y: 300,
      title: 'Text Generation',
      subtitle: 'Generate Ad Copy',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
    // {
    //   id: 'video-generation',
    //   x: 700,
    //   y: 470,
    //   title: 'Video Generation',
    //   subtitle: 'Generate Video Ads',
    //   status: 'idle',
    //   progress: 0,
    //   isEnabled: false,
    // },
    {
      id: 'preview',
      x: 1100,
      y: 250,
      title: 'Prepare Creatives',
      subtitle: 'Prepare your ad creatives',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
    {
      id: 'post-ad',
      x: 1100,
      y: 250,
      title: 'Post Ad',
      subtitle: 'Publish Your Ad to Facebook',
      status: 'idle',
      progress: 0,
      isEnabled: false,
    },
  ],
};

const adFactorySlice = createSlice({
  name: 'adFactory',
  initialState,
  reducers: {
    setUserId(state, action) {
      state.userId = action.payload;
    },

    setCampaignId(state, action) {
      state.campaignId = action.payload;
      sessionStorage.setItem('campaignId', action.payload);
    },

    setCompletedNodes(state, action) {
      const nodeId = action.payload;
      if (!state.completedNodes.includes(nodeId)) {
        state.completedNodes.push(nodeId);
      }
    },

    setFormProgress(state, action) {
      const { nodeId, progress } = action.payload;
      state.formProgress[nodeId] = progress;
    },

    setNodes(state, action) {
      if (Array.isArray(action.payload)) {
        state.nodes = action.payload;
      } else if (typeof action.payload === 'function') {
        state.nodes = action.payload(state.nodes);
      } else {
        const { nodeId, updates } = action.payload;
        state.nodes = state.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n));
      }
    },

    setActiveForm(state, action) {
      state.activeForm = action.payload;
    },

    setLoading(state, action) {
      state.loading = action.payload;
    },

    setError(state, action) {
      state.error = action.payload;
    },

    setActiveView(state, action) {
      state.activeView = action.payload;
    },

    setNodeStatus(state, action) {
      const { nodeId, status, progress, error } = action.payload;
      if (!state.nodeStatus[nodeId]) {
        state.nodeStatus[nodeId] = {};
      }
      state.nodeStatus[nodeId] = {
        ...state.nodeStatus[nodeId],
        status: status || state.nodeStatus[nodeId]?.status,
        progress: progress !== undefined ? progress : state.nodeStatus[nodeId]?.progress,
        error: error !== undefined ? error : state.nodeStatus[nodeId]?.error,
      };
    },

    clearNodeError(state, action) {
      const nodeId = action.payload;
      if (state.nodeStatus[nodeId]) {
        state.nodeStatus[nodeId].error = null;
      }
    },
    // New action to skip start node
    skipStartNode: (state) => {
      if (!state.completedNodes.includes('start')) {
        state.completedNodes.push('start');
      }
      state.nodeStatus['start'] = { status: 'success', progress: 100 };
    },
    setFormData: (state, action) => {
      state.formData = action.payload;
    },
    updateNodeEnabledStatus(state) {
      state.nodes = state?.nodes?.map((node) => {
        const dependencies = nodeDependencies[node?.id] || [];

        // Check if all dependencies are completed
        // IMPORTANT: Check BOTH formsCompleted AND completedNodes
        const allDependenciesMet = dependencies?.every((dep) => {
          // const formCompleted = state?.formsCompleted[dep] === true;
          const inCompletedNodes = state?.completedNodes?.includes(dep);
          return inCompletedNodes; // Either one indicates completion
        });

        // SPECIAL HANDLING FOR GENERATION NODES:
        if (
          node?.id === 'image-generation' ||
          node?.id === 'text-generation' ||
          node?.id === 'video-generation'
        ) {
          const serviceType = node?.id?.split('-')[0]; // 'image', 'text', or 'video'
          const serviceSelected = state?.selectedServices[serviceType];

          const hasResults = state?.completedNodes?.includes(node.id);

          const isEnabled = (allDependenciesMet && serviceSelected) || hasResults;

          return {
            ...node,
            isEnabled,
          };
        }

        // SPECIAL HANDLING FOR PREVIEW NODE:
        // Preview should only be enabled if BOTH image and text generations are in completedNodes
        // This ensures both have been generated and the user can proceed to prepare creatives
        if (node?.id === 'preview') {
          const imageGenCompleted = state?.completedNodes?.includes('image-generation');
          const textGenCompleted = state?.completedNodes?.includes('text-generation');
          const isEnabled = imageGenCompleted && textGenCompleted;

          return {
            ...node,
            isEnabled,
          };
        }

        // For non-generation nodes, just check dependencies
        const isEnabled = allDependenciesMet;

        return {
          ...node,
          isEnabled,
        };
      });
    },
    // Update a specific node's status
    updateNodeStatus: (state, action) => {
      const { nodeId, status, progress, error, isEnabled } = action.payload;

      // Update node in nodes array
      state.nodes = state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              status: status || node.status,
              progress: progress !== undefined ? progress : node.progress,
              isEnabled: isEnabled ?? node.isEnabled,
            }
          : node
      );

      // Also update in nodeStatus object
      if (!state.nodeStatus[nodeId]) {
        state.nodeStatus[nodeId] = {};
      }
      state.nodeStatus[nodeId] = {
        ...state.nodeStatus[nodeId],
        status: status || state.nodeStatus[nodeId]?.status,
        progress: progress !== undefined ? progress : state.nodeStatus[nodeId]?.progress,
        error: error !== undefined ? error : state.nodeStatus[nodeId]?.error,
      };
    },
    // New: Reset all node statuses when loading a new campaign
    resetNodeStatuses(state) {
      state.nodeStatus = {};
      state.completedNodes = [];
      state.formProgress = {};
      state.formsCompleted = {
        'brand-info': false,
        objectives: false,
        assets: false,
        services: false,
        validate: false,
      };
      state.selectedServices = {
        text: false,
        image: false,
        video: false,
      };
      // Reset nodes to initial enabled state
      state.nodes = state.nodes.map((node) => ({
        ...node,
        status: 'idle',
        progress: 0,
        isEnabled: node.id === 'brand-info', // Only brand-info enabled initially
      }));
    },

    // New: Set selected services
    setSelectedServices(state, action) {
      state.selectedServices = action.payload;
    },

    resetAdFactory: () => {
      // sessionStorage.removeItem('campaignId');
      return initialState;
    },
  },
});

export const {
  setUserId,
  setCampaignId,
  resetAdFactory,
  setNodes,
  setFormProgress,
  setCompletedNodes,
  setActiveForm,
  setLoading,
  setError,
  setNodeStatus,
  clearNodeError,
  updateNodeEnabledStatus,
  setSelectedServices,
  resetNodeStatuses,
  updateNodeStatus,
} = adFactorySlice.actions;

export default adFactorySlice.reducer;
