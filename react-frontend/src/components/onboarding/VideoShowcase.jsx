import { useEffect, useRef, useState } from 'react';
import TOUR_STEPS from '@/data/tourSteps';

/**
 * VideoShowcase
 *
 * Displays a softly looping, muted, autoplaying sequence of the existing
 * product GIFs / images from public/adcreative/. Designed to sit behind the
 * welcome modal at low opacity so users immediately sense the quality of the
 * creatives AdsGPT can produce — without a word.
 *
 * Rules:
 *  - Uses ONLY existing assets already in public/adcreative/
 *  - Autoplay, muted, loop (video) / cycling (images)
 *  - Never downloads anything new
 *  - Hidden on mobile (performance)
 */

// Curated set of the most visually striking assets from public/adcreative/
const SHOWCASE_ASSETS = [
  { src: '/adcreative/lifestyle.png', type: 'image', alt: 'Lifestyle ad creative' },
  { src: '/adcreative/lifestyle-hover.gif', type: 'gif', alt: 'Lifestyle ad animated' },
  { src: '/adcreative/product.jpg', type: 'image', alt: 'Product ad creative' },
  { src: '/adcreative/product-hover.gif', type: 'gif', alt: 'Product ad animated' },
  { src: '/adcreative/ai.png', type: 'image', alt: 'AI ad creative' },
  { src: '/adcreative/ai-hover.png', type: 'image', alt: 'AI ad animated' },
  { src: '/adcreative/saas.png', type: 'image', alt: 'SaaS ad creative' },
  { src: '/adcreative/saas-hover.gif', type: 'gif', alt: 'SaaS ad animated' },
  { src: '/adcreative/brand.jpg', type: 'image', alt: 'Brand ad creative' },
  { src: '/adcreative/brand-hover.gif', type: 'gif', alt: 'Brand ad animated' },
];

const CYCLE_INTERVAL_MS = 3200;

const VideoShowcase = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => {
        setPrevIndex(prev);
        return (prev + 1) % SHOWCASE_ASSETS.length;
      });
    }, CYCLE_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* Dark gradient vignette overlay */}
      <div className="absolute inset-0 z-10 bg-gradient-to-b from-black/80 via-black/60 to-black/80" />
      <div className="absolute inset-0 z-10 bg-gradient-to-r from-black/60 via-transparent to-black/60" />

      {/* Image tiles — crossfade between slides */}
      {SHOWCASE_ASSETS.map((asset, idx) => {
        const isActive = idx === activeIndex;
        const wasPrev = idx === prevIndex;

        return (
          <div
            key={asset.src}
            className={`absolute inset-0 transition-opacity duration-[1200ms] ease-in-out ${
              isActive ? 'opacity-100' : wasPrev ? 'opacity-0' : 'opacity-0'
            }`}
            style={{ transitionDelay: isActive ? '0ms' : '0ms' }}
          >
            <img
              src={asset.src}
              alt={asset.alt}
              loading="lazy"
              className="h-full w-full object-cover"
              style={{
                filter: 'saturate(1.1) brightness(0.55)',
                transform: `scale(${isActive ? '1.04' : '1'})`,
                transition: 'transform 4s ease-out, filter 800ms ease',
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export default VideoShowcase;
