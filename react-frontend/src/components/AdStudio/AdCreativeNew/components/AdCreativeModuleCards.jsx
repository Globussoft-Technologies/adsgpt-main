import React from 'react';
import StudioToolStage from '@/components/AdStudio/StudioToolStage';

// Same five modules, same images and hover GIFs as before. Titles in Title Case.
export const MODULES = [
  {
    key: 'ai-creatives',
    title: 'AI Creatives',
    subtitle: 'Create custom image ads',
    defaultImage: '/adcreative/ai.png',
    hoverImage: '/adcreative/ai-hover.png',
  },
  {
    key: 'lifestyle',
    title: 'Lifestyle Ad',
    subtitle: 'Model-led lifestyle creative',
    defaultImage: '/adcreative/lifestyle.png',
    hoverImage: '/adcreative/lifestyle-hover.gif',
  },
  {
    key: 'product-shot',
    title: 'Product Shot',
    subtitle: 'Turn your product into a meaningful shot',
    defaultImage: '/adcreative/product.jpg',
    hoverImage: '/adcreative/product-hover.gif',
  },
  {
    key: 'apps-saas',
    title: 'Apps / SaaS',
    subtitle: 'Device mockups and UI screens that convert',
    defaultImage: '/adcreative/saas.png',
    hoverImage: '/adcreative/saas-hover.gif',
  },
  {
    key: 'brand-awareness',
    title: 'Brand Awareness',
    subtitle: 'Identity-first creatives built around your brand',
    defaultImage: '/adcreative/brand.jpg',
    hoverImage: '/adcreative/brand-hover.gif',
  },
];

// The V2 Ad Creative tools: the tool stage (deck + tab bar). V1 has its own
// home (components/AdStudio/v1/AdCreativeHomeV1.jsx).
export default function AdCreativeModuleCards({ onSelectCategory }) {
  return (
    <StudioToolStage
      label="Image ad tools"
      kindLabel="Ad creative"
      tools={MODULES.map((mod) => ({
        key: mod.key,
        tourId: `tour_ad-creative-module_${mod.key}`,
        title: mod.title,
        desc: mod.subtitle,
        img: mod.defaultImage,
        gif: mod.hoverImage,
        onOpen: () => onSelectCategory?.(mod.key),
      }))}
    />
  );
}
