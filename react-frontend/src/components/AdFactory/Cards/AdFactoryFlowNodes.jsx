import React, { useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AdFactoryStepCard from './Cards/AdFactoryStepCard';
import BrandInfoIcon from '@/assets/layouts/ad-factory/flow-chart/brand-info.svg';
import ObjectiveIcon from '@/assets/layouts/ad-factory/flow-chart/objectives.svg';
import AssetsIcon from '@/assets/layouts/ad-factory/flow-chart/assets.svg';
import ServicesIcon from '@/assets/layouts/ad-factory/flow-chart/services.svg';
import imageGenerationIcon from '@/assets/layouts/ad-factory/flow-chart/image-generation.svg';
import textGenerationIcon from '@/assets/layouts/ad-factory/flow-chart/text-generation.svg';

const nodeTypes = {
  customNode: AdFactoryStepCard,
};

const AdFactoryFlowNodes = () => {
  // ---- Define all flow cards with positions matching Figma ----
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
    // },
  ];

  // ---- Convert array to node objects ----
  const initialNodes = FlowCardArray.map((card) => ({
    id: card.id,
    type: 'customNode',
    position: card.position,
    data: card,
  }));

  // ---- Define simple edges matching Figma ----
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
      target: 'services',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e4',
      source: 'validate',
      target: 'validate',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    {
      id: 'e5',
      source: 'services',
      target: 'text-generation',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
    // {
    //   id: 'e6',
    //   source: 'services',
    //   target: 'video-generation',
    //   animated: true,
    //   type: 'smoothstep',
    //   style: { stroke: '#737373', strokeWidth: 3 },
    // },
    {
      id: 'e7',
      source: 'services',
      target: 'image-generation',
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#737373', strokeWidth: 3 },
    },
  ];

  // ---- React state ----
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  // ---- Handlers ----
  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: '#ec4899', strokeWidth: 3 },
          },
          eds
        )
      ),
    []
  );

  return (
    <div
      style={{
        width: '100%',
        height: '85vh',
        background: 'transparent',
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        selectionOnDrag
        panOnDrag
        selectionMode="partial"
        zoomOnScroll
      >
        <Background color="#333" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
};

export default AdFactoryFlowNodes;
