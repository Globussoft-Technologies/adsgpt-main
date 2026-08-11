/**
 * tourSteps.js
 * Data-driven configuration for the premium onboarding tour.
 *
 * Each step now carries a `videoUrl` field pointing to a YouTube link defined
 * in src/config/videos.js. VideoDemo reads this URL to:
 *   - Display the YouTube thumbnail as the in-card preview image
 *   - Embed the YouTube player (iframe) when the fullscreen modal opens
 *
 * The `poster` field is kept as a final local fallback image in case the
 * YouTube thumbnail request fails (e.g. offline).
 */

import { VIDEO_LINKS } from '@/config/videos';

export const TOUR_STEPS = [
  {
    id: 'ad-factory',
    title: 'Ad Factory',
    tagline: 'From prompt to full campaign — instantly',
    description:
      'Describe your product and target audience. Ad Factory generates complete, ready-to-launch campaign ad sets using AI.',
    targetSelector: '#tour_ad-factory_navigation',
    route: '/adfactory',
    features: ['AI Campaign Generation', 'Complete Ad Sets', 'Multi-Platform Export'],
    previewImages: ['/adcreative/lifestyle.png'],
    previewGifs: ['/adcreative/lifestyle-hover.gif'],
    videoUrl: VIDEO_LINKS.adFactory,
    poster: '/adcreative/lifestyle-hover.gif',
    accent: 'from-[#F5A524] to-[#F31260]',
  },
  {
    id: 'ai',
    title: 'AI Assistant',
    tagline: 'Your 24/7 AI Marketing Co-Pilot',
    description:
      'Brainstorm campaign ideas, optimize ad copy, analyze marketing angles, and get instant recommendations from AdsGPT AI.',
    targetSelector: '#tour_ai_navigation',
    route: '/assistant',
    features: ['AI Co-Pilot', 'Campaign Ideas', 'Instant Creative Insights'],
    previewImages: ['/adcreative/ai.png'],
    previewGifs: ['/adcreative/ai-hover.png'],
    videoUrl: VIDEO_LINKS.ai,
    poster: '/adcreative/ai-hover.png',
    accent: 'from-[#15DCFF] to-[#5E66F5]',
  },
  {
    id: 'ad-studio',
    title: 'Ad Studio',
    tagline: 'Create high-converting ads with AI',
    description:
      'Your complete AI creative workspace — generate text copy, studio image ads, video creatives, and UGC in seconds.',
    targetSelector: '#tour_ad-studio_navigation',
    route: '/adstudio',
    features: ['Ad Copy', 'Ad Creative', 'Ad Video', 'Ad Library'],
    previewImages: ['/adcreative/product.jpg'],
    previewGifs: ['/adcreative/product-hover.gif'],
    videoUrl: VIDEO_LINKS.adStudio,
    poster: '/adcreative/product-hover.gif',
    accent: 'from-[#15DCFF] to-[#5E66F5]',
  },
  {
    id: 'ad-copy',
    title: 'Ad Copy Studio',
    tagline: 'AI headlines, hooks & converting copy',
    description:
      'Generate scroll-stopping ad headlines, primary text, hooks, and persuasive angles tailored for Meta & Google ads.',
    targetSelector: '#tour_header_ad-copy_tabs',
    route: '/adstudio',
    features: ['AI Headlines', 'Hooks & Angles', 'Multi-Copy Variations'],
    previewImages: ['/adcreative/saas.png'],
    previewGifs: ['/adcreative/saas-hover.gif'],
    videoUrl: VIDEO_LINKS.adCopy,
    poster: '/adcreative/saas-hover.gif',
    accent: 'from-[#15DCFF] to-[#5E66F5]',
  },
  {
    id: 'ad-creative',
    title: 'Ad Creative Studio',
    tagline: 'Studio-quality AI visual ads',
    description:
      'Transform raw product photos into professional lifestyle shoots, eCommerce visual ads, and branded mockups.',
    targetSelector: '#tour_header_ad-creative_tabs',
    route: '/adstudio',
    features: ['Lifestyle Shoots', 'Product Shots', 'Brand Creatives'],
    previewImages: ['/adcreative/lifestyle.png'],
    previewGifs: ['/adcreative/lifestyle-hover.gif'],
    videoUrl: VIDEO_LINKS.adCreative,
    poster: '/adcreative/lifestyle-hover.gif',
    accent: 'from-[#15DCFF] to-[#5E66F5]',
  },
  {
    id: 'ad-video',
    title: 'Ad Video Studio',
    tagline: 'AI motion ads & UGC video scripts',
    description:
      'Produce high-converting video ads, dynamic motion creatives, and engaging UGC-style video content.',
    targetSelector: '#tour_header_ad-video_tabs',
    route: '/adstudio',
    features: ['AI Motion Ads', 'UGC Video Scripts', 'Dynamic Video'],
    previewImages: ['/adcreative/product.jpg'],
    previewGifs: ['/adcreative/product-hover.gif'],
    videoUrl: VIDEO_LINKS.adVideo,
    poster: '/adcreative/product-hover.gif',
    accent: 'from-[#15DCFF] to-[#5E66F5]',
  },
  {
    id: 'ad-library',
    title: 'Ad Library',
    tagline: 'Central hub for all saved ad creatives',
    description:
      'Store, organize, and reuse all your generated image ads, video creatives, copy variations, and brand templates in one place.',
    targetSelector: '#tour_header_ad-library_tabs',
    route: '/adstudio',
    features: ['Saved Creatives', 'Asset Management', 'Campaign Reuse'],
    previewImages: ['/adcreative/brand.jpg'],
    previewGifs: ['/adcreative/brand-hover.gif'],
    videoUrl: VIDEO_LINKS.adLibrary,
    poster: '/adcreative/brand-hover.gif',
    accent: 'from-[#15DCFF] to-[#5E66F5]',
  },
  {
    id: 'brandiq',
    title: 'BrandIQ',
    tagline: 'Know your market. Outsmart competitors',
    description:
      'Analyze competitors, uncover market opportunities, and refine your brand strategy with AI intelligence.',
    targetSelector: '#tour_brandiq_navigation',
    route: '/brandiq',
    features: ['My Brands', 'Competitor Intelligence', 'Market Strategy'],
    previewImages: ['/adcreative/brand.jpg'],
    previewGifs: ['/adcreative/brand-hover.gif'],
    videoUrl: VIDEO_LINKS.brandIQ,
    poster: '/adcreative/brand-hover.gif',
    accent: 'from-[#a855f7] to-[#6366f1]',
  },
  {
    id: 'my-brands',
    title: 'My Brands',
    tagline: 'Manage brand identities & guidelines',
    description:
      'Add and manage brand assets, logos, colors, and tone of voice so AI always generates 100% on-brand creatives.',
    targetSelector: '#tour_header_my-brands_tabs',
    route: '/brandiq',
    features: ['Brand Guidelines', 'Logo & Color Assets', 'Tone of Voice'],
    previewImages: ['/adcreative/brand.jpg'],
    previewGifs: ['/adcreative/brand-hover.gif'],
    videoUrl: VIDEO_LINKS.myBrands,
    poster: '/adcreative/brand-hover.gif',
    accent: 'from-[#a855f7] to-[#6366f1]',
  },
  {
    id: 'competitors',
    title: 'Competitor Intelligence',
    tagline: 'Outsmart & benchmark your competitors',
    description:
      'Track competitor ad strategies, extract top-converting hooks, analyze market gaps, and benchmark performance.',
    targetSelector: '#tour_header_competitors_tabs',
    route: '/brandiq',
    features: ['Ad Vault Search', 'Hook Extraction', 'Market Gap Analysis'],
    previewImages: ['/adcreative/saas.png'],
    previewGifs: ['/adcreative/saas-hover.gif'],
    videoUrl: VIDEO_LINKS.competitors,
    poster: '/adcreative/saas-hover.gif',
    accent: 'from-[#a855f7] to-[#6366f1]',
  },
  {
    id: 'ads-manager',
    title: 'Ads Manager',
    tagline: 'Track, optimise and scale ROI',
    description:
      'Manage all your active campaigns in one place. Track real-time performance metrics, optimize spend, and scale.',
    targetSelector: '#tour_ads-manager_navigation',
    route: '/ads-manager',
    features: ['Campaign Analytics', 'Performance Tracking', 'Budget Optimisation'],
    previewImages: ['/adcreative/saas.png'],
    previewGifs: ['/adcreative/saas-hover.gif'],
    videoUrl: VIDEO_LINKS.adsManager,
    poster: '/adcreative/saas-hover.gif',
    accent: 'from-[#10b981] to-[#06b6d4]',
  },
];

export default TOUR_STEPS;
