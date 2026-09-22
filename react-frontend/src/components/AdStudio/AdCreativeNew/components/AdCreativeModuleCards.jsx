import React, { useState } from 'react';
import CreateCardButton from '@/components/AdStudio/CreateCardButton';

const MODULES = [
  {
    key: 'ai-creatives',
    title: 'AI Creatives',
    subtitle: 'Create custom Image ads',
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
    title: 'PRODUCT SHOT',
    subtitle: 'Turn your product to meaningful shot',
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
    subtitle: 'Identity-first creatives built around your colors, voice, and story.',
    defaultImage: '/adcreative/brand.jpg',
    hoverImage: '/adcreative/brand-hover.gif',
  },
];

export default function AdCreativeModuleCards({
  progress = 0,
  onSelectCategory,
  className = '',
}) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  // Progressive compression & layering calculations
  // Progress is clamped [0, 1]
  const p = Math.min(Math.max(progress, 0), 1);
  const isLayered = p > 0.45;

  return (
    <div
      className={`relative w-full max-w-[1320px] mx-auto px-2 sm:px-4 transition-transform duration-200 ease-out select-none ${className}`}
      style={{
        transform: `translateY(${-p * 18}px)`,
      }}
    >
      <div className="flex items-center justify-center w-full min-h-[285px] 2xl:min-h-[315px]">
        {MODULES.map((mod, idx) => {
          // Card hierarchy heights:
          // Center (idx 2): base 280px -> 295px
          // Medium (idx 1, 3): base 280px -> 264px
          // Outer (idx 0, 4): base 280px -> 242px
          let targetHeight = 280;
          let zIndex = 10;
          let overlapX = 0; // horizontal offset in px due to compression

          if (idx === 2) {
            // Center (PRODUCT SHOT)
            targetHeight = 280 + p * 16; // 280 -> 296
            zIndex = 30;
            overlapX = 0;
          } else if (idx === 1) {
            // Card 2 (Lifestyle Ad)
            targetHeight = 280 - p * 16; // 280 -> 264
            zIndex = 20;
            overlapX = p * 42; // shifts right towards center
          } else if (idx === 3) {
            // Card 4 (Apps / SaaS)
            targetHeight = 280 - p * 16; // 280 -> 264
            zIndex = 20;
            overlapX = -p * 42; // shifts left towards center
          } else if (idx === 0) {
            // Card 1 (AI Creatives)
            targetHeight = 280 - p * 38; // 280 -> 242
            zIndex = 10;
            overlapX = p * 78; // shifts right towards center
          } else if (idx === 4) {
            // Card 5 (Brand Awareness)
            targetHeight = 280 - p * 38; // 280 -> 242
            zIndex = 10;
            overlapX = -p * 78; // shifts left towards center
          }

          // Hover expansions when layered
          let hoverShiftX = 0;
          let hoverScale = 1;
          let activeZ = zIndex;

          if (isLayered && hoveredIdx !== null) {
            if (hoveredIdx === idx) {
              hoverScale = 1.025;
              activeZ = 40;
            }

            // When hovering Card 2 (idx 1):
            // Card 2 lifts, Card 1 (idx 0) gains a little visible space to the left
            if (hoveredIdx === 1) {
              if (idx === 0) {
                hoverShiftX = -26; // move Card 1 left
                activeZ = 15;
              }
            }

            // When hovering Card 4 (idx 3):
            // Card 4 lifts, Card 5 (idx 4) gains a little visible space to the right
            if (hoveredIdx === 3) {
              if (idx === 4) {
                hoverShiftX = 26; // move Card 5 right
                activeZ = 15;
              }
            }

            // When hovering Card 1 (idx 0): shifts slightly left for emphasis
            if (hoveredIdx === 0 && idx === 0) {
              hoverShiftX = -12;
            }

            // When hovering Card 5 (idx 4): shifts slightly right for emphasis
            if (hoveredIdx === 4 && idx === 4) {
              hoverShiftX = 12;
            }
          }

          // Margin gaps: initial 14px, reduces down to ~0px or negative with overlapX
          const marginInline = Math.max(7 - p * 7, 0);

          return (
            <div
              key={mod.key}
              id={`tour_ad-creative-module_${mod.key}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onSelectCategory?.(mod.key)}
              style={{
                height: `${targetHeight}px`,
                zIndex: activeZ,
                marginInline: `${marginInline}px`,
                transform: `translateX(${overlapX + hoverShiftX}px) scale(${hoverScale})`,
                transition:
                  'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.25s ease-out, margin 0.25s ease-out, box-shadow 0.3s ease',
              }}
              className="group relative flex-1 min-w-[150px] max-w-[245px] cursor-pointer overflow-hidden rounded-xl 2xl:rounded-2xl bg-[#141416] text-white shadow-md transition-all duration-300"
            >
              {/* Default Thumbnail */}
              <img
                src={mod.defaultImage}
                alt={mod.title}
                className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-0"
              />

              {/* Hover Animated Thumbnail / GIF */}
              <img
                src={mod.hoverImage}
                alt={`${mod.title}-preview`}
                className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />

              {/* Original Dark Gradient Overlay */}
              <div className="absolute inset-0 bg-[linear-gradient(0deg,#0f0f0f_10.93%,rgba(15,15,15,0)_84.92%)]" />

              {/* Card Content & Action Button */}
              <div className="absolute right-0 bottom-3.5 left-2 sm:left-3.5 flex items-end justify-between transition duration-300 group-hover:-translate-y-1 sm:right-2">
                <div className="pr-1.5">
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-wide leading-snug">
                    {mod.title}
                  </h3>
                  {mod.subtitle && (
                    <p className="text-[10px] sm:text-xs text-white/90 leading-tight mt-0.5 line-clamp-2">
                      {mod.subtitle}
                    </p>
                  )}
                </div>

                <CreateCardButton />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
