import React from 'react';
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
  onSelectCategory,
  className = '',
}) {
  return (
    <div
      className={`relative w-full max-w-[1340px] mx-auto px-2 sm:px-4 select-none ${className}`}
    >
      <div className="flex items-center justify-center gap-3 sm:gap-3.5 2xl:gap-4 w-full">
        {MODULES.map((mod) => (
          <div
            key={mod.key}
            id={`tour_ad-creative-module_${mod.key}`}
            onClick={() => onSelectCategory?.(mod.key)}
            className="group relative flex-1 min-w-[140px] max-w-[245px] h-[275px] sm:h-[280px] 2xl:h-[305px] cursor-pointer overflow-hidden rounded-xl 2xl:rounded-2xl bg-[#141416] text-white shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
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
        ))}
      </div>
    </div>
  );
}
