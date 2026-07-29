import React from 'react';
import bottomEffectImage from '@/assets/layouts/ad-factory/bottom-effect.svg';
import './AIAssistantBgEffect.css';

// AI-Assistant-only animated variant of AdFactoryBgEffect. Same two layers
// (top gradient blob + bottom beams image), same colors/blur/opacity — only
// motion is added, via the CSS classes. Kept as a separate component so Ad
// Factory's shared background stays static.
//
// The blob's vertical position is intentionally raised from Ad Factory's
// original -top-[40%] (which puts it almost entirely above the viewport) to
// -top-[18%], so its glow actually reaches down into view behind the AI
// Assistant's right-side Creative Studio panel — that panel spans the full
// page height, and at -40% essentially none of the blob's color was visible
// behind it. Same size/blur/color as Ad Factory, just repositioned to be seen.
const AIAssistantBgEffect = () => (
  <>
    <div className="aia-bg-blob fixed -top-[18%] right-[2vw] z-0 h-[19vw] w-[19vw] rounded-full opacity-50 blur-[100px] dark:opacity-100" />

    <img
      src={bottomEffectImage}
      className="aia-bg-bottom pointer-events-none fixed bottom-0 left-1/2 z-0 w-[120vw] opacity-20 xl:top-[28%] xl:bottom-auto xl:opacity-30 dark:xl:opacity-100"
      alt=""
    />
  </>
);

export default AIAssistantBgEffect;
