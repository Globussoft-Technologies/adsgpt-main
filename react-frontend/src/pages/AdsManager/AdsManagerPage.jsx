import React from 'react';
import PlatformPicker from '@/components/PlatformPicker/PlatformPicker';

/**
 * Ads Manager home — pick a platform to manage. Currently only Meta is
 * enabled; clicking Meta navigates to the full Ads Manager dashboard at
 * `/meta-ads`.
 */
const AdsManagerPage = () => (
  <PlatformPicker
    metaDestination="/meta-ads"
    title="Choose Your Ad Platform"
    subtitle="Select where you want to manage your ads"
    // Gate the Google Ads card behind the same env switch used across the
    // Google posting flows. When VITE_ENABLE_GOOGLE_POSTING !== 'true' the card
    // falls back to "Coming Soon" / inactive, just like Autopilot.
    googleComingSoon={import.meta.env.VITE_ENABLE_GOOGLE_POSTING !== 'true'}
  />
);

export default AdsManagerPage;
