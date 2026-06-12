import React from 'react';
import PlatformPicker from '@/components/PlatformPicker/PlatformPicker';

/**
 * Autopilot home — pick a platform to put on Autopilot. Currently only
 * Meta is enabled; clicking Meta navigates to the Autopilot dashboard for
 * Meta at `/autopilot/meta`. Google + TikTok land on the same picker once
 * those integrations exist.
 */
const AutopilotHomePage = () => (
  <PlatformPicker
    metaDestination="/autopilot/meta"
    title="Put your ads on Autopilot"
    subtitle="Pick the platform you want Autopilot to manage"
    googleComingSoon
  />
);

export default AutopilotHomePage;
