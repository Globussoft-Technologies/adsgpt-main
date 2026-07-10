import React from 'react';
import bottomEffectImage from '@/assets/layouts/ad-factory/bottom-effect.svg';
import './AIAssistantBgEffect.css';

// AI-Assistant-only animated variant of AdFactoryBgEffect. Renders the exact
// same two layers (top gradient blob + bottom beams image) with identical
// colors, sizes, blur and opacities — only motion is added, via the CSS
// classes. Kept as a separate component so Ad Factory's shared background
// stays static.
const AIAssistantBgEffect = () => (
  <>
    <div className="aia-bg-blob fixed -top-[40%] right-[2vw] z-0 h-[19vw] w-[19vw] rounded-full opacity-50 blur-[100px] dark:opacity-100" />

    <img
      src={bottomEffectImage}
      className="aia-bg-bottom pointer-events-none fixed bottom-0 left-1/2 z-0 w-[120vw] opacity-20 xl:top-[28%] xl:bottom-auto xl:opacity-30 dark:xl:opacity-100"
      alt=""
    />
  </>
);

export default AIAssistantBgEffect;
