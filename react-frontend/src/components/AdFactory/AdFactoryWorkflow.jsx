import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import { toast } from 'react-toastify';
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
import { ManualGroupNode, AutoGroupNode } from './Cards/PipelineGroupNode';
import AutomationActiveNode from './Automation/AutomationActiveNode';
import AutomationHistoryPanel from './Automation/AutomationHistoryPanel';
import AutomationStopConfirm from './Automation/AutomationStopConfirm';
import PublishedAdsModal from './Automation/PublishedAdsModal';
import {
  selectIsAutomationActive,
  selectAutomationEntry,
  selectHistoryOpenFor,
  selectStopConfirmFor,
  selectPublishedAdsOpenFor,
  openAutomationHistory,
  openAutomationStopConfirm,
  openPublishedAds,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import { AUTOMATION_STATUS } from '@/store/reducers/adFactoryAutomation/constants';
import {
  fetchAutomation,
  fetchAutomationStats,
  pauseAutomation,
  resumeAutomation,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import { AnimatePresence } from 'framer-motion';
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
import { IS_AUTOMATION_ENABLED, IS_GOOGLE_AUTOMATION_ENABLED } from '@/utils/featureFlags';

const nodeTypes = {
  customNode: AdFactoryStepCard,
  automationActiveNode: AutomationActiveNode,
  manualGroupNode: ManualGroupNode,
  autoGroupNode: AutoGroupNode,
};

// After Services the canvas branches into two collapsible containers. The
// manual sub-pipeline (image gen / text gen / prepare / post ad) and the
// automation sub-pipeline (active stat card + result) render *inside* their
// respective group container when expanded, via ReactFlow's parentId.
const MANUAL_GROUP_ID = 'manual-group';
const AUTO_GROUP_ID = 'auto-group';
// TEMPORARILY DISABLED: auto-pause on platform removal is turned off for now.
// Flip to true to re-enable the "Automation paused — Meta was removed from
// platforms" behavior. (When re-enabling, also update the Meta-only check
// inside the effect to the meta-and/or-google model.)
const AUTO_PAUSE_ON_PLATFORM_REMOVAL = false;
// Manual sits upper-right, auto lower-right of the trunk. Y positions leave
// enough room for the manual container to expand downwards (height 500)
// without colliding with the collapsed auto card below.
const MANUAL_GROUP_POSITION = { x: 700, y: 60 };
const AUTO_GROUP_POSITION = { x: 700, y: 600 };

// FlowCardArray ids that belong inside the manual group container. When the
// manual group is expanded they are re-emitted as ReactFlow nodes with
// `parentId: MANUAL_GROUP_ID`, positioned in a fan-in layout (image + text
// on the left merging into preview in the middle, then post-ad on the
// right) that mirrors the original pre-container canvas arrangement.
const INNER_MANUAL_NODE_IDS = ['image-generation', 'text-generation', 'preview', 'post-ad'];

// Container dimensions when expanded — wide enough to host three w-80
// columns (image / preview / post-ad) and tall enough for image + text to
// stack vertically on the left side.
const MANUAL_GROUP_EXPANDED_SIZE = { width: 1080, height: 500 };

// Positions of each child relative to the manual group's top-left corner.
// Fan-in: image (top-left) + text (bottom-left) → preview (middle, vertically
// centred between them) → post-ad (right of preview).
const INNER_MANUAL_POSITIONS = {
  'image-generation': { x: 20, y: 70 },
  'text-generation': { x: 20, y: 280 },
  preview: { x: 380, y: 170 },
  'post-ad': { x: 740, y: 170 },
};

// Synthetic node ids for the auto sub-pipeline. These don't live in
// FlowCardArray — they are constructed inline in generateNodes when the
// auto group is expanded.
const AUTOMATION_ACTIVE_NODE_ID = 'automation-active';
const AUTOMATION_RESULT_NODE_ID = 'automation-result';

// Auto container — narrower than manual since it only hosts two w-80 cards
// laid out horizontally (active stat card → result preview). Sized with a
// bit of breathing room around the cards rather than tightly hugging them.
const AUTO_GROUP_EXPANDED_SIZE = { width: 900, height: 320 };

const INNER_AUTO_POSITIONS = {
  [AUTOMATION_ACTIVE_NODE_ID]: { x: 30, y: 80 },
  [AUTOMATION_RESULT_NODE_ID]: { x: 510, y: 80 },
};

// Pre-compute the viewport for the flat (no-automation) layout so the
// canvas paints at the correct zoom on the FIRST render — no fitView
// race against ReactFlow's per-node ResizeObserver, no setNodes-on-
// timeout dance, no visible flicker. Produces the same numbers
// fitView({ padding: 0.2 }) would converge to once measurement is done.
//
// Bounds come from FlowCardArray's static positions + the AdFactoryStepCard
// render size (~340w × ~140h):
//   x ∈ [-300, 1540]   (Brand Info left edge → Post Ad right edge)
//   y ∈ [   0,  700]   (Brand Info top      → Platforms bottom)
const FLAT_BOUNDS = { left: -300, right: 1540, top: 0, bottom: 700 };
const FLAT_PADDING = 0.2; // matches Reset's fitView padding
const computeFlatViewport = () => {
  const W = FLAT_BOUNDS.right - FLAT_BOUNDS.left;
  const H = FLAT_BOUNDS.bottom - FLAT_BOUNDS.top;
  // Approximate the ReactFlow container size from the window. Sidebar
  // (~85px) + page padding (~32px) horizontally; header (~80px) +
  // padding (~32px) vertically. Falls back to FHD when window dims
  // aren't available (SSR-safe defaults).
  const containerW = Math.max(800, (typeof window !== 'undefined' ? window.innerWidth : 1700) - 120);
  const containerH = Math.max(500, (typeof window !== 'undefined' ? window.innerHeight : 800) - 110);
  // ReactFlow's actual fitView math (from @xyflow/system):
  //   zoom = container / (bounds * (1 + padding))
  // i.e. padding inflates the bounds once, not the container twice. My
  // earlier 0.6×container formula treated padding as 20% on each side
  // (40% total), producing a far smaller zoom than Reset does.
  const zoom = Math.min(
    containerW / (W * (1 + FLAT_PADDING)),
    containerH / (H * (1 + FLAT_PADDING)),
  );
  const boundsCenterX = (FLAT_BOUNDS.left + FLAT_BOUNDS.right) / 2;
  const boundsCenterY = (FLAT_BOUNDS.top + FLAT_BOUNDS.bottom) / 2;
  return {
    x: containerW / 2 - boundsCenterX * zoom,
    y: containerH / 2 - boundsCenterY * zoom,
    zoom,
  };
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
  // Expand/collapse state for the two pipeline group containers. Both can be
  // open simultaneously (decided in the design forks). Chunk 4 wires
  // autoExpanded the same way.
  const [manualExpanded, setManualExpanded] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);
  const toggleManualExpanded = useCallback(() => setManualExpanded((v) => !v), []);
  const toggleAutoExpanded = useCallback(() => setAutoExpanded((v) => !v), []);
  const [searchParams] = useSearchParams();
  const queryCampaignId = searchParams?.get?.('campaignId');
  const { userData } = useSelector((state) => state?.socket) || {};
  const { handleDownloadWithFormat, formatDialog, setFormatDialog } = useDownloadWithFormat();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const socketio = getSocket();
  // React Flow edges, the dot grid and the canvas tint are styled with inline
  // SVG/CSS values, so they can't use Tailwind `dark:` variants — switch them
  // off the theme flag instead. Light mode uses darker greys so lines stay
  // legible on the white canvas.
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);
  const trunkStroke = isDarkMode ? '#737373' : '#94a3b8';
  const idleEdgeStroke = isDarkMode ? '#6B7280' : '#94a3b8';
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

  // Automation lifecycle — drives the auto group's active state + the live
  // AutomationActiveNode shown inside the expanded auto container.
  const isAutomationActive = useSelector((state) =>
    selectIsAutomationActive(state, queryCampaignId)
  );
  const automationEntry = useSelector((state) =>
    selectAutomationEntry(state, queryCampaignId)
  );
  const automationHistoryOpen = useSelector(selectHistoryOpenFor) === queryCampaignId;
  const automationStopConfirmOpen = useSelector(selectStopConfirmFor) === queryCampaignId;
  const publishedAdsOpen = useSelector(selectPublishedAdsOpenFor) === queryCampaignId;
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

  // ---------------------------------------------------------------------------
  // Auto-pause when Meta is removed from the Platforms node.
  //
  // The automation requires Meta in distribution.platforms to fire — the same
  // precondition that gates the Schedule mode in ServicesForm. When the user
  // genuinely removes Meta while an automation is ACTIVE, we silently pause
  // it on the backend (POST /jobs/:id/pause). The entry is preserved with
  // status=paused so re-adding Meta later surfaces it with the original
  // config intact.
  //
  // Important: this must only fire on a transition (hasMeta was true, now
  // false) — NOT on initial mount when distribution hasn't loaded yet.
  // fetchAutomation can resolve before fetchCampaignById, so on a refresh
  // the slice briefly looks like "active automation + no Meta in platforms"
  // even though the campaign genuinely has Meta. previousHasMetaRef tracks
  // the last value we saw so we can distinguish "Meta was removed" from
  // "distribution hasn't been hydrated yet".
  //
  // null = never seen distribution.platforms in a loaded state.
  // ---------------------------------------------------------------------------
  const previousHasMetaRef = React.useRef(null);
  React.useEffect(() => {
    if (!AUTO_PAUSE_ON_PLATFORM_REMOVAL) return;

    // Don't make a decision until distribution.platforms is actually defined.
    // (undefined → still hydrating; [] → user explicitly cleared platforms.)
    if (!Array.isArray(distribution?.platforms)) return;

    const hasMeta = selectedPlatforms.includes('meta');
    const previousHasMeta = previousHasMetaRef.current;
    previousHasMetaRef.current = hasMeta;

    // First time we've seen distribution loaded — just record state.
    if (previousHasMeta === null) return;

    // Only react to a true → false transition (genuine user removal).
    if (!previousHasMeta || hasMeta) return;

    // Only pause if the automation is currently ACTIVE — paused / completed
    // / failed entries are left alone (the dormant card handles paused).
    if (automationEntry?.status !== AUTOMATION_STATUS.ACTIVE) return;

    dispatch(pauseAutomation(queryCampaignId)).then((res) => {
      if (pauseAutomation.fulfilled.match(res)) {
        toast.info('Automation paused — Meta was removed from platforms');
      }
    });
  }, [
    distribution?.platforms,
    selectedPlatforms,
    automationEntry?.status,
    queryCampaignId,
    dispatch,
  ]);

  // Dormant = the automation precondition (Meta in platforms) is broken but
  // the backend entry is still there. Only applies to active/paused — the
  // terminal statuses (completed/failed) keep their normal visuals per the
  // locked decision. Drives the lock-card swap on AutomationActiveNode.
  const automationDormant = React.useMemo(() => {
    if (!automationEntry?.jobId) return false;
    // Automation stays live while EITHER Meta or (flag-gated) Google is still
    // selected — mirrors the meta-and/or-google precondition in ServicesForm /
    // AutomationForm. Only dormant once neither platform remains.
    const hasMeta = selectedPlatforms.includes('meta');
    const hasGoogle =
      IS_GOOGLE_AUTOMATION_ENABLED && selectedPlatforms.includes('google');
    if (hasMeta || hasGoogle) return false;
    const status = automationEntry?.status;
    return (
      status === AUTOMATION_STATUS.ACTIVE || status === AUTOMATION_STATUS.PAUSED
    );
  }, [automationEntry?.jobId, automationEntry?.status, selectedPlatforms]);

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

  // Pipeline active flags — drive the active visual treatment on each group
  // container AND the services→branch wrapper edge styling. Manual is
  // "active" the moment the user opts into the manual flow (Services form
  // submitted with text or image > 0) OR once real results exist; auto is
  // "active" while an automation entry is visible. Both can be true
  // simultaneously when the user runs both paths.
  //
  // The selectedServices signal is what flips on submit of the manual
  // ('once' mode) Services form — without it the manual group would stay
  // locked from click → first result, which feels broken to the user.
  // `selectedServices` is set by ServicesForm.handleSubmit (Generate Once) but
  // is NOT persisted across reloads, and is never set by AutomationForm. So if
  // a user activates automation and refreshes, this flag would be false and
  // the manual group would render locked even though Services is green-
  // checked. Fall back to the campaign's persisted services config (which
  // survives reload) so the manual fork stays unlockable post-refresh.
  const hasConfiguredServices = (productionAndServices?.servicesSelected || []).some(
    (s) => Number(s?.serviceParams?.quantity) > 0
  );
  const isManualActive =
    (results?.image?.length || 0) > 0 ||
    (results?.text?.length || 0) > 0 ||
    !!selectedServices?.image ||
    !!selectedServices?.text ||
    hasConfiguredServices;
  // Force-collapse the entire auto pipeline when the feature flag is off,
  // OR when the automation is dormant (Meta no longer in platforms). Every
  // downstream check (auto-group expansion, AutomationActiveNode isActive,
  // fetchAutomationStats poll) keys off this one boolean, so a single gate
  // here is enough to revert the canvas to its pre-automation shape without
  // touching the node graph itself.
  const isAutoActive = !!isAutomationActive && !automationDormant && IS_AUTOMATION_ENABLED;

  // If the user deletes / stops their automation while the auto container
  // is expanded, collapse it — the inactive card is non-clickable, so
  // leaving it open would strand the user inside an empty container.
  useEffect(() => {
    if (!isAutoActive && autoExpanded) {
      setAutoExpanded(false);
    }
  }, [isAutoActive, autoExpanded]);

  // Whenever a group container toggles expand state, pan + zoom the canvas
  // so the new bounds stay in view. ReactFlow's built-in fitView prop
  // handles the initial render — we only animate for subsequent toggles, so
  // the user isn't yanked around on mount.
  const skipFitOnNextRender = useRef(true);
  useEffect(() => {
    if (!rfInstance) return undefined;
    if (skipFitOnNextRender.current) {
      skipFitOnNextRender.current = false;
      return undefined;
    }
    // Defer one tick so the node's new width/height has actually applied
    // before fitView reads its dimensions.
    const id = setTimeout(() => {
      rfInstance.fitView({ duration: 600, padding: 0.15 });
    }, 60);
    return () => clearTimeout(id);
  }, [manualExpanded, autoExpanded, rfInstance]);

  // Pull authoritative stats from /jobs/:id/stats. Fires once when auto goes
  // active (so the collapsed card reflects real counts the moment the user
  // expands).
  //
  // This is the FALLBACK refresh in the hybrid model — the primary trigger
  // is the `adsFactory:runComplete` socket event (see socketSlice), which
  // dispatches the same thunk the instant a cycle finishes. The 5-min
  // interval below only covers socket disconnects, missed events on
  // reconnect, and post-deploy gaps. Don't tighten it back to 30s without
  // also removing the socket listener — you'd just be double-dispatching.
  useEffect(() => {
    if (!queryCampaignId || !isAutoActive) return undefined;
    dispatch(fetchAutomationStats(queryCampaignId));
    if (!autoExpanded) return undefined;
    const id = setInterval(() => {
      dispatch(fetchAutomationStats(queryCampaignId));
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [queryCampaignId, isAutoActive, autoExpanded, dispatch]);

  // Refresh stats when the Services / Edit-automation modal closes. The
  // save/update thunks already chain into fetchAutomationStats on success,
  // but a user who opens Edit, glances at it, and closes via X / Cancel
  // walks back to a canvas card showing stale numbers — anything the cron
  // worker did while the modal was open (or any pause/resume done in another
  // tab) is invisible until the next 5-min poll. Watch activeForm
  // transitions: when it goes 'services' → null and automation is live,
  // re-poll. Double-dispatch on save is harmless — fetchStats is idempotent.
  const previousActiveFormRef = React.useRef(activeForm);
  useEffect(() => {
    const closed =
      previousActiveFormRef.current === 'services' && !activeForm;
    previousActiveFormRef.current = activeForm;
    if (closed && queryCampaignId && isAutoActive) {
      dispatch(fetchAutomationStats(queryCampaignId));
    }
  }, [activeForm, queryCampaignId, isAutoActive, dispatch]);

  // Trunk + (in automation mode) the two services → group edges. Inner edges
  // (image-gen → preview, text-gen → preview, preview → post-ad,
  // automation-active → automation-result) live inside their respective group
  // container and are appended dynamically in the edges effect when that
  // container is expanded.
  //
  // When the automation feature flag is off, the group containers don't
  // render — services connects straight to the flat image-gen / text-gen
  // nodes (the pre-automation layout).
  const trunkEdges = [
    {
      id: 'e1',
      source: 'brand-info',
      target: 'objectives',
      animated: true,
      type: 'smoothstep',
      style: { stroke: trunkStroke, strokeWidth: 3 },
    },
    {
      id: 'e2',
      source: 'objectives',
      target: 'assets',
      animated: true,
      type: 'smoothstep',
      style: { stroke: trunkStroke, strokeWidth: 3 },
    },
    {
      id: 'e3',
      source: 'assets',
      target: 'validate',
      animated: true,
      type: 'smoothstep',
      style: { stroke: trunkStroke, strokeWidth: 3 },
    },
    {
      id: 'e4',
      source: 'validate',
      target: 'services',
      animated: true,
      type: 'smoothstep',
      style: { stroke: trunkStroke, strokeWidth: 3 },
    },
  ];
  const initialEdges = IS_AUTOMATION_ENABLED
    ? [
        ...trunkEdges,
        {
          id: 'e-services-to-manual',
          source: 'services',
          target: MANUAL_GROUP_ID,
          animated: true,
          type: 'smoothstep',
          style: { stroke: trunkStroke, strokeWidth: 3 },
        },
        {
          id: 'e-services-to-auto',
          source: 'services',
          target: AUTO_GROUP_ID,
          animated: true,
          type: 'smoothstep',
          style: { stroke: trunkStroke, strokeWidth: 3 },
        },
      ]
    : [
        ...trunkEdges,
        {
          id: 'e-services-to-image',
          source: 'services',
          target: 'image-generation',
          animated: true,
          type: 'smoothstep',
          style: { stroke: trunkStroke, strokeWidth: 3 },
        },
        {
          id: 'e-services-to-text',
          source: 'services',
          target: 'text-generation',
          animated: true,
          type: 'smoothstep',
          style: { stroke: trunkStroke, strokeWidth: 3 },
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
    const hasMeta = selectedPlatforms?.includes('meta');
    const hasGoogle = selectedPlatforms?.includes('google');
    const enableGooglePosting = import.meta.env.VITE_ENABLE_GOOGLE_POSTING === 'true';

    const stepNodes = FlowCardArray.filter((card) => {
      // Manual sub-pipeline nodes live inside the manual group container.
      // They only render while the manual group is expanded; collapsed =
      // hidden. With the automation flag off, the group container doesn't
      // exist at all — the inner nodes become flat top-level nodes that
      // always render (pre-automation layout).
      //
      // Preview and Post Ad additionally require Meta (or Google with
      // posting enabled) to be selected. Both filters must apply — earlier
      // code returned early on the Meta check and bypassed the expansion
      // gate, causing post-ad to leak out as a floating top-level node at
      // its original FlowCardArray position whenever Meta was picked.
      if (INNER_MANUAL_NODE_IDS.includes(card.id)) {
        if (card.id === 'preview' || card.id === 'post-ad') {
          const allowedByPlatform = hasMeta || (enableGooglePosting && hasGoogle);
          if (!allowedByPlatform) return false;
        }
        return IS_AUTOMATION_ENABLED ? manualExpanded : true;
      }
      return true;
    }).map((card) => {
      // Find the corresponding node from Redux state
      const reduxNode = reduxNodes?.find((n) => n.id === card.id);
      const isCompleted = completedNodes.includes(card.id);
      const progress = formProgress[card.id] || reduxNode?.progress || 0;

      const isActive = activeForm === card.id;
      let isEnabled = reduxNode?.isEnabled || completedNodes.includes(card.id);

      // "Prepare Creatives" and "Post Ad" nodes enabled only when Meta (or Google if posting enabled) is selected.
      if (card.id === 'preview' || card.id === 'post-ad') {
        const allowedByPlatform = hasMeta || (enableGooglePosting && hasGoogle);
        isEnabled = isEnabled && allowedByPlatform;
      }

      // Determine status
      let status = 'idle';
      if (isCompleted) status = 'success';
      else if (isActive || (progress > 0 && progress < 100)) status = 'running';

      // With the automation flag off the manual group container doesn't
      // render, so the inner-manual treatment (parented children inside the
      // group, sub-positions relative to it) doesn't apply — the nodes use
      // their original FlowCardArray positions and sit at the top level.
      const isInnerManual =
        IS_AUTOMATION_ENABLED && INNER_MANUAL_NODE_IDS.includes(card.id);

      return {
        id: card.id,
        type: 'customNode',
        position: isInnerManual ? INNER_MANUAL_POSITIONS[card.id] : card.position,
        ...(isInnerManual
          ? { parentId: MANUAL_GROUP_ID, extent: 'parent', draggable: false }
          : {}),
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

    // Feature flag off → render the original flat layout (no group
    // containers, no automation nodes). Every node already has its
    // FlowCardArray position because the isInnerManual check above is gated
    // on the flag, so we can return them all as a single flat list.
    if (!IS_AUTOMATION_ENABLED) {
      return stepNodes;
    }

    // ReactFlow v12 requires that a parent node appears in the nodes array
    // BEFORE any of its children (via parentId), otherwise the children's
    // positions are interpreted as absolute canvas coordinates instead of
    // relative-to-parent. Split the step nodes into the manual children
    // bucket and everything else so we can interleave the manual group
    // container between them.
    const trunkAndLeafNodes = stepNodes.filter(
      (n) => !INNER_MANUAL_NODE_IDS.includes(n.id)
    );
    const innerManualNodes = stepNodes.filter((n) =>
      INNER_MANUAL_NODE_IDS.includes(n.id)
    );

    const baseNodes = [...trunkAndLeafNodes];

    // The two collapsible group containers always render — both branches are
    // always visible. Manual group is pushed before its inner children so
    // ReactFlow correctly parents them.
    baseNodes.push({
      id: MANUAL_GROUP_ID,
      type: 'manualGroupNode',
      position: MANUAL_GROUP_POSITION,
      // Explicit dimensions on expand let ReactFlow size the wrapper so the
      // parented children sit cleanly inside, and so the CSS transition has
      // concrete from/to width + height values to animate.
      style: manualExpanded
        ? {
            width: MANUAL_GROUP_EXPANDED_SIZE.width,
            height: MANUAL_GROUP_EXPANDED_SIZE.height,
            transition:
              'width 0.35s cubic-bezier(.22,1,.36,1), height 0.35s cubic-bezier(.22,1,.36,1)',
          }
        : { transition: 'width 0.35s cubic-bezier(.22,1,.36,1), height 0.35s cubic-bezier(.22,1,.36,1)' },
      data: {
        id: MANUAL_GROUP_ID,
        title: 'Manual Fabrication',
        subtitle: 'Generate ads on demand · ship when ready',
        infoMessage: 'Generate, prepare, and post creatives one at a time.',
        inactiveText: 'Generate ads to activate',
        isActive: isManualActive,
        expanded: manualExpanded,
        onToggleExpand: toggleManualExpanded,
      },
    });

    // Inner manual children must appear AFTER their parent in the array.
    innerManualNodes.forEach((node) => baseNodes.push(node));

    baseNodes.push({
      id: AUTO_GROUP_ID,
      type: 'autoGroupNode',
      position: AUTO_GROUP_POSITION,
      style: autoExpanded
        ? {
            width: AUTO_GROUP_EXPANDED_SIZE.width,
            height: AUTO_GROUP_EXPANDED_SIZE.height,
            transition:
              'width 0.35s cubic-bezier(.22,1,.36,1), height 0.35s cubic-bezier(.22,1,.36,1)',
          }
        : { transition: 'width 0.35s cubic-bezier(.22,1,.36,1), height 0.35s cubic-bezier(.22,1,.36,1)' },
      data: {
        id: AUTO_GROUP_ID,
        title: 'Auto-Forge',
        subtitle: 'Generate & post on a schedule, hands-free',
        infoMessage: 'Runs the manual pipeline on a recurring schedule.',
        inactiveText: 'Set up automation to activate',
        isActive: isAutoActive,
        expanded: autoExpanded,
        onToggleExpand: toggleAutoExpanded,
      },
    });

    // Inner auto children — automation stat card + result preview. Pushed
    // after the auto-group so ReactFlow parents them correctly. Lifecycle
    // handlers wire back through the existing automation slice thunks.
    if (autoExpanded) {
      baseNodes.push({
        id: AUTOMATION_ACTIVE_NODE_ID,
        type: 'automationActiveNode',
        parentId: AUTO_GROUP_ID,
        extent: 'parent',
        draggable: false,
        position: INNER_AUTO_POSITIONS[AUTOMATION_ACTIVE_NODE_ID],
        data: {
          status: automationEntry?.status || 'active',
          frequency: automationEntry?.config?.frequency,
          stats: automationEntry?.stats || {},
          onPause: async () => {
            const res = await dispatch(pauseAutomation(queryCampaignId));
            if (pauseAutomation.fulfilled.match(res)) {
              toast.success('Automation paused');
            } else {
              toast.error(
                res?.payload?.message || res?.error?.message || 'Failed to pause automation'
              );
            }
          },
          onResume: async () => {
            const res = await dispatch(resumeAutomation(queryCampaignId));
            if (resumeAutomation.fulfilled.match(res)) {
              toast.success('Automation resumed');
            } else {
              toast.error(
                res?.payload?.message || res?.error?.message || 'Failed to resume automation'
              );
            }
          },
          // Edit opens the Services modal — ServicesForm auto-defaults to
          // Schedule mode when an automation entry exists, so the inline
          // AutomationForm appears pre-filled.
          onEdit: () => dispatch(setActiveForm('services')),
          onStop: () => dispatch(openAutomationStopConfirm(queryCampaignId)),
          onViewHistory: () => dispatch(openAutomationHistory(queryCampaignId)),
        },
      });

      baseNodes.push({
        id: AUTOMATION_RESULT_NODE_ID,
        type: 'customNode',
        parentId: AUTO_GROUP_ID,
        extent: 'parent',
        draggable: false,
        position: INNER_AUTO_POSITIONS[AUTOMATION_RESULT_NODE_ID],
        data: {
          id: AUTOMATION_RESULT_NODE_ID,
          title: 'Automation Result',
          subtitle: 'Preview your published Ads',
          infoMessage: 'Preview the ads published by your automation runs.',
          type: 'action',
          icon: ServicesIcon,
          status: 'idle',
          progress: 0,
          isEnabled: true,
          handle: { target: 'left', source: '' },
          onNodeClick: () => dispatch(openPublishedAds(queryCampaignId)),
        },
      });
    }

    return baseNodes;
  }, [
    reduxNodes,
    completedNodes,
    formProgress,
    activeForm,
    selectedServices,
    dispatch,
    distribution?.platforms,
    userData?.user_id,
    isManualActive,
    isAutoActive,
    manualExpanded,
    toggleManualExpanded,
    autoExpanded,
    toggleAutoExpanded,
    automationEntry,
    queryCampaignId,
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

  // No measurement-based fitting when the automation feature is OFF —
  // the flat-layout viewport is pre-computed via `computeFlatViewport()`
  // and passed as `defaultViewport` to ReactFlow below, so the very
  // first paint is at the Reset state. No effect, no timeouts, no
  // re-render flicker.

  // Hydrate automation state on mount so an active automation shows up on the
  // canvas without the user having to open the form first. Skipped entirely
  // when the feature flag is off — slice stays at initialState.
  useEffect(() => {
    if (!IS_AUTOMATION_ENABLED) return;
    if (queryCampaignId) {
      dispatch(fetchAutomation(queryCampaignId));
    }
  }, [queryCampaignId, dispatch]);

  // After the Facebook OAuth round-trip, AutomationForm left a breadcrumb
  // in sessionStorage. If it matches the current campaign, auto-open the
  // Services modal — ServicesForm then flips itself into Schedule mode and
  // the inline form appears with the now-connected Meta state. Skipped
  // entirely when the feature flag is off (the breadcrumb can't be set in
  // that case anyway because AutomationForm never renders).
  useEffect(() => {
    if (!IS_AUTOMATION_ENABLED) return;
    if (!queryCampaignId) return;
    if (sessionStorage.getItem('adsgpt:reopen-automation-for') === queryCampaignId) {
      dispatch(setActiveForm('services'));
    }
  }, [queryCampaignId, dispatch]);

  // Recompute edge style based on which trunk nodes have been completed.
  // Inner edges only render alongside their group container's expanded state
  // — they would otherwise dangle on nodes that aren't present.
  useEffect(() => {
    // Manual sub-pipeline edges. With automation enabled these only render
    // when the manual group is expanded (children are hidden otherwise so
    // the edges would dangle). With the flag off the inner nodes are flat
    // and always present, so the edges should always render too.
    const showInnerManual = IS_AUTOMATION_ENABLED ? manualExpanded : true;
    const innerManualEdges = showInnerManual
      ? [
          {
            id: 'e-img-prep',
            source: 'image-generation',
            target: 'preview',
            type: 'smoothstep',
            animated: true,
            style: { stroke: trunkStroke, strokeWidth: 3 },
          },
          {
            id: 'e-text-prep',
            source: 'text-generation',
            target: 'preview',
            type: 'smoothstep',
            animated: true,
            style: { stroke: trunkStroke, strokeWidth: 3 },
          },
          {
            id: 'e-prep-post',
            source: 'preview',
            target: 'post-ad',
            type: 'smoothstep',
            animated: true,
            style: { stroke: trunkStroke, strokeWidth: 3 },
          },
        ]
      : [];

    const innerAutoEdges = IS_AUTOMATION_ENABLED && autoExpanded
      ? [
          {
            id: 'e-active-result',
            source: AUTOMATION_ACTIVE_NODE_ID,
            target: AUTOMATION_RESULT_NODE_ID,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#15DCFF', strokeWidth: 3, opacity: 0.9 },
          },
        ]
      : [];

    // Wrapper-edge active styling — bright cyan + animated, used when a
    // branch is the chosen path. Inactive wrapper edges go dim + static so
    // the unused branch fades into the background.
    const branchActiveStyle = { stroke: '#15DCFF', strokeWidth: 3, opacity: 0.9 };
    const branchInactiveStyle = { stroke: '#6B7280', strokeWidth: 3, opacity: 0.35 };

    // The services step is the gate before either branch can be "the
    // active path". Until it's done, both wrapper edges stay dim.
    const servicesDone = completedNodes.includes('services');

    setEdges(
      [...initialEdges, ...innerManualEdges, ...innerAutoEdges].map((edge) => {
        const isSourceCompleted = completedNodes.includes(edge.source);
        const isTargetCompleted = completedNodes.includes(edge.target);
        const isCompleted = isSourceCompleted && isTargetCompleted;

        // Inner auto edge already carries its own cyan style — leave it
        // alone so the active automation visually stands out from the
        // greyscale trunk edges.
        if (edge.id === 'e-active-result') {
          return { ...edge, animated: true };
        }

        // Wrapper edge → auto group. Lights up the moment the campaign
        // has a visible automation entry (active/paused/completed/failed),
        // independent of completedNodes — the group container itself never
        // makes it into that array.
        if (edge.id === 'e-services-to-auto') {
          const active = servicesDone && isAutoActive;
          return {
            ...edge,
            animated: active,
            style: active ? branchActiveStyle : branchInactiveStyle,
          };
        }

        // Wrapper edge → manual group. Lights up the moment the user
        // commits to the manual flow (Services submitted with quantities
        // > 0 OR any real results already exist). Independent of the auto
        // branch — a campaign can run both paths and both edges light.
        if (edge.id === 'e-services-to-manual') {
          const active = servicesDone && isManualActive;
          return {
            ...edge,
            animated: active,
            style: active ? branchActiveStyle : branchInactiveStyle,
          };
        }

        return {
          ...edge,
          animated: !isCompleted,
          style: isCompleted
            ? { stroke: '#3CE0A8', strokeWidth: 3, opacity: 0.9 }
            : { stroke: idleEdgeStroke, strokeWidth: 3, opacity: isDarkMode ? 0.5 : 0.8 },
        };
      })
    );
  }, [
    completedNodes,
    manualExpanded,
    autoExpanded,
    isAutoActive,
    isManualActive,
    setEdges,
    isDarkMode,
    trunkStroke,
    idleEdgeStroke,
  ]);

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
          className="group flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2.5 text-sm font-medium text-gray-700 backdrop-blur-md transition-all duration-300 hover:bg-white hover:text-black hover:shadow-lg dark:border-transparent dark:bg-[#0D0D0D]/80 dark:text-gray-300 dark:hover:bg-[#1A1A1A] dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>Back</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleReset();
          }}
          className="group flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2.5 text-sm font-medium text-gray-700 backdrop-blur-md transition-all duration-300 hover:bg-white hover:text-black hover:shadow-lg dark:border-transparent dark:bg-[#0D0D0D]/80 dark:text-gray-300 dark:hover:bg-[#1A1A1A] dark:hover:text-white"
          title="Reset Flow"
        >
          <RotateCcw className="h-4 w-4 transition-transform group-hover:rotate-180" />
          <span>Reset</span>
        </button>
      </div>
      <div className="relative h-full w-full">
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm dark:bg-gray-900/40">
            <Loader className="h-8 w-8 animate-spin text-gray-700 dark:text-white" />
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
          // When the automation feature is OFF, skip ReactFlow's built-in
          // fitView (which fires before nodes are measured and crops Post
          // Ad on the right) and hand it a pre-computed viewport instead.
          // The defaultViewport matches what fitView({ padding: 0.2 })
          // would converge to — same numbers Reset produces — so the very
          // first paint lands in the correct state with no flicker.
          fitView={IS_AUTOMATION_ENABLED}
          fitViewOptions={
            IS_AUTOMATION_ENABLED && window.innerWidth < 1380
              ? {}
              : IS_AUTOMATION_ENABLED
                ? {
                    padding: { top: '40px', right: '100px', bottom: '100px', left: '100px' },
                  }
                : undefined
          }
          defaultViewport={IS_AUTOMATION_ENABLED ? undefined : computeFlatViewport()}
          zoomOnScroll={false}
          zoomOnPinch={false}
          panOnScroll={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          className="bg-transparent dark:bg-gray-900/50"
        >
          <Background color={isDarkMode ? '#333' : '#a3acba'} gap={16} />
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

      {/* Automation history + stop-confirm overlays. The setup form itself
          lives inline inside the Services modal (see ServicesForm). */}
      {IS_AUTOMATION_ENABLED && (
        <>
          <AnimatePresence>
            {automationHistoryOpen && <AutomationHistoryPanel />}
          </AnimatePresence>
          <AnimatePresence>
            {automationStopConfirmOpen && <AutomationStopConfirm />}
          </AnimatePresence>
          <AnimatePresence>
            {publishedAdsOpen && <PublishedAdsModal />}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
