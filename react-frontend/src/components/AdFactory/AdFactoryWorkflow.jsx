import React, { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDispatch, useSelector } from 'react-redux';
import {
  resetAdFactory,
  resetNodeStatuses,
  setActiveForm,
  setCompletedNodes,
  setFormProgress,
  updateNodeEnabledStatus,
  updateNodeStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';
import { getSocket } from '@/store/reducers/socket/socketSlice';
import NodeModal from './NodeModal';
import AdFactoryStepCard from './Cards/AdFactoryStepCard';
import AdsDialogLayout from './NodeForms/AdsDialogLayout';
import FlowChartEffectBg from '@/assets/layouts/ad-factory/flow-chart-bg-layer.svg';
import BrandInfoIcon from '@/assets/layouts/ad-factory/flow-chart/brand-info.svg';
import ObjectiveIcon from '@/assets/layouts/ad-factory/flow-chart/objectives.svg';
import AssetsIcon from '@/assets/layouts/ad-factory/flow-chart/assets.svg';
import ServicesIcon from '@/assets/layouts/ad-factory/flow-chart/services.svg';
import imageGenerationIcon from '@/assets/layouts/ad-factory/flow-chart/image-generation.svg';
import textGenerationIcon from '@/assets/layouts/ad-factory/flow-chart/text-generation.svg';
import videoGenerationIcon from '@/assets/layouts/ad-factory/flow-chart/video-generation.svg';
import GeneratingLoader from './Loader/GeneratingLoader ';
import AdFactoryBgEffect from './NodeForms/AdFactoryBgEffect';
import ImageFormatDialog from '../BrandIQ/ImageFormating/ImageFormatDialog';
import { useDownloadWithFormat } from '@/hooks/useDownloadWithFormat';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader, RotateCcw } from 'lucide-react'; // Import back arrow icon
import AdsPreviewDialog from './AdPreview/AdsPreviewDialog';
import {
  setAdsDialogOpen,
  setAdsDialogType,
} from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  checkFbUser,
  checkGoogleUser,
} from '@/store/actions/adFactoryNew/adFactoryActions';

const nodeTypes = {
  customNode: AdFactoryStepCard,
};

const FlowCardArray = [
  {
    id: 'brand-info',
    title: 'Brand Info',
    subtitle: 'Start by creating a creative campaign',
    type: 'trigger',
    position: {
      x: -295.95300261096605,
      y: 0,
    },
    handle: { target: '', source: 'right' },
    icon: BrandInfoIcon,
    infoMessage: 'Set up your brand profile',
  },
  {
    id: 'objectives',
    title: 'Objectives',
    subtitle: 'Define the key objectives',
    type: 'action',
    position: {
      x: 193.7075718015666,
      y: 105.95300261096607,
    },
    handle: { target: 'left', source: 'bottom' },
    icon: ObjectiveIcon,
    infoMessage: 'Set key goals for the campaign.',
  },
  {
    id: 'assets',
    title: 'Key visuals',
    subtitle: 'Upload key visuals',
    type: 'data',
    position: {
      x: -300,
      y: 260,
    },
    handle: { target: 'top', source: 'right' },
    icon: AssetsIcon,
    infoMessage: 'Upload key visuals for the campaign.',
  },
  {
    id: 'validate',
    title: 'Platforms',
    subtitle: 'Select platforms for your campaign',
    type: 'data',
    position: {
      x: -294.0469973890339,
      y: 552.7937336814622,
    },
    handle: { target: 'top', source: 'right' },
    icon: AssetsIcon,
    infoMessage: 'Choose ad platforms and image ratios',
  },
  {
    id: 'services',
    title: 'Services',
    subtitle: 'Select services for your campaign',
    type: 'action',
    position: {
      x: 200,
      y: 420,
    },
    handle: { target: 'left', source: 'right' },
    icon: ServicesIcon,
    infoMessage: 'Choose ad types and quantities.',
  },
  {
    id: 'image-generation',
    title: 'Image Generation',
    subtitle: 'Generate AI Images',
    type: 'action',
    position: { x: 679.8094658924065, y: 50.69346304242423 },
    handle: { target: 'left', source: 'right' },
    icon: imageGenerationIcon,
    requiresService: 'image',
    infoMessage: 'Generate AI visuals for your campaign',
  },
  {
    id: 'text-generation',
    title: 'Text Generation',
    subtitle: 'Generate Ad Copy',
    type: 'action',
    position: { x: 679.8613310873409, y: 463.1000166173079 },
    handle: { target: 'left', source: 'right' },
    icon: textGenerationIcon,
    requiresService: 'text',
    infoMessage: 'Generate text ads using AI',
  },
  {
    id: 'preview',
    title: 'Prepare Creatives',
    subtitle: 'Prepare your ad creatives',
    type: 'action',
    position: { x: 820, y: 250.1000166173079 },
    handle: { target: 'left', source: 'right' },
    icon: ServicesIcon,
    infoMessage: 'Prepare your ad creatives',
  },
  {
    id: 'post-ad',
    title: 'Post Ad',
    subtitle: 'Publish Your Ad ',
    type: 'action',
    position: { x: 1200, y: 247.1000166173079 },
    handle: { target: 'left', source: '' },
    icon: ServicesIcon,
    infoMessage: 'Publish your ad ',
    // Live publish flow is still being hardened end-to-end (creative
    // shape edge cases, page selection, status transitions). Surface a
    // Beta pill on the node title so users know.
    beta: true,
  },
  // {
  //   id: 'video-generation',
  //   title: 'Video Generation',
  //   subtitle: 'Generate Video Ads',
  //   type: 'action',
  //   position: {
  //     x: 686.2140992167102,
  //     y: 544.6736292428199,
  //   },
  //   handle: { target: 'left', source: 'right' },
  //   icon: videoGenerationIcon,
  //   requiresService: 'video',
  //infoMessage: 'Creates short video ads using AI, combining text, audio, and assets optimized for selected ad platforms.',
  // },
];

export default function AdFactoryWorkflowDarkReal() {
  const [rfInstance, setRfInstance] = useState(null);
  const [showGeneratingLoader, setShowGeneratingLoader] = useState(false);
  const [searchParams] = useSearchParams();
  const queryCampaignId = searchParams?.get?.('campaignId');
  const { userData } = useSelector((state) => state?.socket) || {};
  const { handleDownloadWithFormat, formatDialog, setFormatDialog } = useDownloadWithFormat();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const socketio = getSocket();
  const {
    campaignId,
    activeForm,
    formProgress,
    completedNodes,
    nodes: reduxNodes,
    selectedServices,
    formsCompleted,
  } = useSelector((state) => state.adFactory);
  const {
    assets,
    brandInfo,
    objectives,
    productionAndServices,
    distribution,
    adsDialogType,
    adsDialogOpen,
    loading,
    results,
  } = useSelector((state) => state.adFactoryNew);
  // console.log("results",results)

  const hasImageVersions = results?.image?.some((img) => img?.status === 200);

  const hasTextVersions = results?.text?.some((txt) => txt?.status === 200);

  const imageNode = reduxNodes?.find((n) => n.id === 'image-generation');
  const textNode = reduxNodes?.find((n) => n.id === 'text-generation');

  const isImageNodeEnabled = imageNode?.isEnabled;
  const isTextNodeEnabled = textNode?.isEnabled;

  const selectedPlatforms = React.useMemo(
    () => distribution?.platforms?.map((p) => p.platformName) || [],
    [distribution]
  );
  // console.log("distribution",distribution)

  const isGenerating = loading;

  const canEnablePreview = React.useMemo(
    () =>
      isImageNodeEnabled &&
      isTextNodeEnabled &&
      hasImageVersions &&
      hasTextVersions &&
      !isGenerating,
    [isImageNodeEnabled, isTextNodeEnabled, hasImageVersions, hasTextVersions, isGenerating]
  );

  const initialEdges = [
    {
      id: 'e1',
      source: 'brand-info',
      target: 'objectives',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e2',
      source: 'objectives',
      target: 'assets',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e3',
      source: 'assets',
      target: 'validate',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e4',
      source: 'validate',
      target: 'services',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e5',
      source: 'services',
      target: 'text-generation',
      // animated: true,
      type: 'smoothstep',
      style: { stroke: '#3e3b3bff', strokeWidth: 3 },
      animated: selectedServices.text, // Only animate if text service is selected
    },
    // {
    //   id: 'e6',
    //   source: 'services',
    //   target: 'video-generation',
    //   animated: true,
    //   type: 'smoothstep',
    //   style: { stroke: '#737373', strokeWidth: 3 },
    //   animated: selectedServices.video, // Only animate if video service is selected
    // },
    {
      id: 'e7',
      source: 'services',
      target: 'image-generation',
      // animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
      animated: selectedServices.image, // Only animate if image service is selected
    },
    {
      id: 'e8',
      source: 'image-generation',
      target: 'preview',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e9',
      source: 'text-generation',
      target: 'preview',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e10',
      source: 'preview',
      target: 'post-ad',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [socketConnected, setSocketConnected] = useState(false);
  const [adsPreviewDialog, setAdsPreviewDialog] = useState(null);

  // Handle back button click
  const handleBackClick = () => {
    // Reset any active form or state if needed
    if (activeForm) {
      dispatch(setActiveForm(null));
    }
    // Navigate back to /adfactory
    navigate('/adfactory');
  };

  // Helper function to generate nodes based on current state
  const generateNodes = useCallback(() => {
    const isValidateCompleted = completedNodes.includes('validate');
    const isMetaSelected = distribution?.platforms?.some((p) => p.platformName === 'meta');

    // Only hide nodes if validation is completed and meta is NOT selected
    const isGoogleSelected = distribution?.platforms?.some((p) => p.platformName === 'google');
    const hideMetaNodes = isValidateCompleted && !isMetaSelected && !isGoogleSelected;

    return FlowCardArray.filter((card) => {
      if (hideMetaNodes && (card.id === 'preview' || card.id === 'post-ad')) {
        return false;
      }
      return true;
    }).map((card) => {
      // Find the corresponding node from Redux state
      const reduxNode = reduxNodes?.find((n) => n.id === card.id);
      const isCompleted = completedNodes.includes(card.id);
      const progress = formProgress[card.id] || reduxNode?.progress || 0;

      const isActive = activeForm === card.id;
      let isEnabled = reduxNode?.isEnabled || completedNodes.includes(card.id);

      // "Prepare Creatives" (preview node) enabled if Meta or Google is selected.
      if (card.id === 'preview') {
        const hasMetaOrGoogle = selectedPlatforms?.includes('meta') || selectedPlatforms?.includes('google');
        isEnabled = isEnabled && hasMetaOrGoogle;
      }

      // "Post Ad" node enabled if Meta or Google is selected.
      if (card.id === 'post-ad') {
        const hasMetaOrGoogle = selectedPlatforms?.includes('meta') || selectedPlatforms?.includes('google');
        isEnabled = isEnabled && hasMetaOrGoogle;
      }

      // Determine status
      let status = 'idle';
      if (isCompleted) status = 'success';
      else if (isActive || (progress > 0 && progress < 100)) status = 'running';

      return {
        id: card.id,
        type: 'customNode',
        position: card.position,
        data: {
          ...card,
          status,
          progress,
          isEnabled,
          workflowStatus: isActive ? 'running' : 'idle',
          onNodeClick: (id) => {
            if (!isEnabled) {
              // Show message about why node is disabled
              let message = 'Complete previous steps first.';
              if (card.requiresService && !selectedServices[card.requiresService]) {
                message = `Select ${card.requiresService} service in the Services node first.`;
              }
              alert(message);
              return;
            }

            // Check if it's a generation node
            if (id === 'image-generation') {
              dispatch(setAdsDialogType('image'));
              // setShowGeneratingLoader(true);
              // setTimeout(() => {
              dispatch(setAdsDialogOpen(true));
              // setTimeout(() => {
              //   setShowGeneratingLoader(false);
              // }, 300);
              // }, 1000);
            } else if (id === 'text-generation') {
              dispatch(setAdsDialogType('text'));
              dispatch(setAdsDialogOpen(true));
            } else if (id === 'video-generation') {
              dispatch(setAdsDialogType('video'));
              dispatch(setAdsDialogOpen(true));
            } else if (id === 'post-ad') {
              // Refresh the connected-account records the instant the post
              // node is clicked so the dialog opens with the live state
              // from GoogleUsers / ad-posting users — not the cached value
              // captured when AdFactoryPage first mounted.
              if (userData?.user_id) {
                dispatch(checkGoogleUser(userData.user_id));
                dispatch(checkFbUser(userData.user_id));
              }
              dispatch(setAdsDialogType('post-ad'));
              dispatch(setAdsDialogOpen(true));
            } else if (id === 'preview') {
              setAdsPreviewDialog(true);
            } else {
              dispatch(setActiveForm(id));
            }
          },
        },
      };
    });
  }, [
    reduxNodes,
    completedNodes,
    formProgress,
    activeForm,
    selectedServices,
    dispatch,
    distribution?.platforms,
    userData?.user_id,
  ]);

  const handleReset = useCallback(() => {
    const resetNodes = generateNodes();
    setNodes(resetNodes);
    if (rfInstance) {
      rfInstance.fitView({
        padding: 0.2,
        duration: 800,
      });
    }
  }, [generateNodes, rfInstance, setNodes]);

  // Initialize nodes with Redux state
  useEffect(() => {
    setNodes(generateNodes());
  }, [generateNodes, setNodes]);

  // Consolidatied effect to update edges based on services and completion status
  useEffect(() => {
    setEdges((prevEdges) =>
      initialEdges
        .filter(() => true)
        .map((edge) => {
          const isSourceCompleted = completedNodes.includes(edge.source);
          const isTargetCompleted = completedNodes.includes(edge.target);
          const isCompleted = isSourceCompleted && isTargetCompleted;

          // Determine animation
          let animated = true;
          if (isCompleted) {
            animated = false;
          } else {
            if (edge.target === 'text-generation') {
              animated = !!selectedServices.text;
            } else if (edge.target === 'video-generation') {
              animated = !!selectedServices.video;
            } else if (edge.target === 'image-generation') {
              animated = !!selectedServices.image;
            }
          }

          // Determine style
          const style = isCompleted
            ? { stroke: '#3CE0A8', strokeWidth: 3, opacity: 0.9 }
            : { stroke: '#6B7280', strokeWidth: 3, opacity: 0.5 };

          return { ...edge, animated, style };
        })
    );
  }, [selectedServices, completedNodes, setEdges]);

  const onConnect = useCallback(
    (params) =>
      setEdges((eds) =>
        addEdge({ ...params, animated: true, style: { stroke: '#ec4899', strokeWidth: 3 } }, eds)
      ),
    [setEdges]
  );

  const handleFormProgressUpdate = useCallback(
    (nodeId, progress) => {
      dispatch(
        setFormProgress({
          nodeId,
          progress,
        })
      );

      // Generation nodes (image-generation, text-generation, video-generation) should NOT be
      // marked as completed here — they get marked complete when actual results arrive via socket.
      // This prevents the preview node from enabling too early.
      const isGenerationNode =
        nodeId === 'image-generation' ||
        nodeId === 'text-generation' ||
        nodeId === 'video-generation';

      if (progress >= 100 && !isGenerationNode) {
        dispatch(setCompletedNodes(nodeId));
        // Update node enabled status after completion
        dispatch(updateNodeEnabledStatus());
      }
    },
    [dispatch]
  );

  // Socket connection logic
  // useEffect(() => {
  //   if (socketio) {
  //     const handleConnect = () => setSocketConnected(true);
  //     const handleDisconnect = () => setSocketConnected(false);

  //     socketio.on('connect', handleConnect);
  //     socketio.on('disconnect', handleDisconnect);

  //     if (socketio.connected) setSocketConnected(true);

  //     return () => {
  //       socketio.off('connect', handleConnect);
  //       socketio.off('disconnect', handleDisconnect);
  //     };
  //   }
  // }, [socketio]);

  return (
    <div className="relative h-[calc(100svh-130px)] w-full">
      {/* Back Button at Top Left Corner */}
      <div className="absolute top-0 right-5 left-4 z-50 flex items-center justify-between gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleBackClick();
          }}
          className="group flex items-center gap-2 rounded-full bg-[#0D0D0D]/80 px-4 py-2.5 text-sm font-medium text-gray-300 backdrop-blur-md transition-all duration-300 hover:bg-[#1A1A1A] hover:text-white hover:shadow-lg"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>Back</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleReset();
          }}
          className="group flex items-center gap-2 rounded-full bg-[#0D0D0D]/80 px-4 py-2.5 text-sm font-medium text-gray-300 backdrop-blur-md transition-all duration-300 hover:bg-[#1A1A1A] hover:text-white hover:shadow-lg"
          title="Reset Flow"
        >
          <RotateCcw className="h-4 w-4 transition-transform group-hover:rotate-180" />
          <span>Reset</span>
        </button>
      </div>
      <div className="relative h-full w-full">
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm">
            <Loader className="h-8 w-8 animate-spin text-white" />
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setRfInstance}
          fitView
          fitViewOptions={
            window.innerWidth < 1380
              ? {}
              : {
                  padding: { top: '40px', right: '100px', bottom: '100px', left: '100px' },
                  // minZoom: 0.5,
                  // maxZoom: 1.5,
                }
          }
          zoomOnScroll={false}
          zoomOnPinch={false}
          panOnScroll={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          className="bg-gray-900/50"
        >
          <Background color="#333" gap={16} />
          <Controls />
          <img
            src={FlowChartEffectBg}
            className="pointer-events-none fixed top-1/2 left-1/2 z-[-1] h-screen w-screen -translate-x-1/2 -translate-y-1/2 object-cover select-none"
            alt=""
          />
        </ReactFlow>
      </div>
      {/* Node Modal */}
      <NodeModal
        open={!!activeForm}
        nodeId={activeForm}
        onClose={() => dispatch(setActiveForm(null))}
        formProgress={formProgress[activeForm]}
        onProgressUpdate={handleFormProgressUpdate}
      />

      {/* Ads Dialog for Generation Nodes */}
      {adsDialogOpen && (
        <AdsDialogLayout
          type={adsDialogType}
          open={adsDialogOpen}
          onOpenChange={(open) => dispatch(setAdsDialogOpen(open))}
          handleDownloadWithFormat={handleDownloadWithFormat}
        />
      )}

      {/* Ads Preview Dialog */}
      {adsPreviewDialog && (
        <AdsPreviewDialog
          open={!!adsPreviewDialog}
          onOpenChange={(open) => !open && setAdsPreviewDialog(null)}
          onProgressUpdate={handleFormProgressUpdate}
        />
      )}

      {/* // And render ImageFormatDialog at the top level */}
      <ImageFormatDialog
        isOpen={formatDialog.isOpen}
        onClose={() => setFormatDialog({ isOpen: false, imageUrl: null })}
        imageUrl={formatDialog.imageUrl}
      />
      {/* {showGeneratingLoader && <GeneratingLoader />} */}
    </div>
  );
}
