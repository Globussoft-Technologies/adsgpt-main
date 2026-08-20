import ReactGA from 'react-ga4';
import Cookies from 'js-cookie';

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID || 'G-Q3XPKCQXVP';

let initialized = false;
let sessionStartedFired = false;

// Anonymous ID per browser device
export const getAnonymousId = () => {
  try {
    let anonId = localStorage.getItem('adsgpt_ga4_anon_id');
    if (!anonId) {
      anonId = 'anon_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
      localStorage.setItem('adsgpt_ga4_anon_id', anonId);
    }
    return anonId;
  } catch {
    return 'anon_fallback_' + Date.now();
  }
};

// Session ID per browser tab session
export const getSessionId = () => {
  try {
    let sessId = sessionStorage.getItem('adsgpt_ga4_session_id');
    if (!sessId) {
      sessId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      sessionStorage.setItem('adsgpt_ga4_session_id', sessId);
    }
    return sessId;
  } catch {
    return 'sess_fallback_' + Date.now();
  }
};

// Generate a stable ID for flow, generation, or publish
export const generateStableId = (prefix = 'flow') => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

export const initGA4 = () => {
  if (!MEASUREMENT_ID || initialized) return;
  ReactGA.initialize(MEASUREMENT_ID);
  initialized = true;
};

// Tie GA4 session strictly to numeric/string user_id (no PII like user_name or email)
export const setGA4User = (userId) => {
  if (!initialized || !userId) return;
  ReactGA.set({ userId: String(userId) });
};

// Clean parameters to ensure no PII or sensitive keys are transmitted
const sanitizeParams = (params = {}) => {
  const clean = { ...params };
  delete clean.app_user_name;
  delete clean.user_name;
  delete clean.email;
  delete clean.prompt;
  delete clean.raw_prompt;
  delete clean.generated_content;
  delete clean.media_url;
  delete clean.access_token;
  delete clean.token;
  delete clean.stack_trace;
  return clean;
};

const PAGE_TITLES = {
  '/adstudio': 'AdsGPT - Ad Studio',
  '/adstudio/adCopy': 'AdsGPT - Ad Copy',
  '/adstudio/adCreative': 'AdsGPT - Ad Creative',
  '/adstudio/adCreativeNew': 'AdsGPT - Ad Creative',
  '/adstudio/adVideo': 'AdsGPT - Ad Video',
  '/adstudio/adVideoNew': 'AdsGPT - Ad Video',
  '/adinsights': 'AdsGPT - Ad Insights',
  '/ad-library': 'AdsGPT - Ad Library',
  '/brandiq': 'AdsGPT - Brand IQ',
  '/adfactory': 'AdsGPT - Ad Factory',
  '/ads-manager': 'AdsGPT - Ads Manager',
  '/meta-ads': 'AdsGPT - Meta Ads',
  '/google-ads': 'AdsGPT - Google Ads',
  '/tiktok-ads': 'AdsGPT - TikTok Ads',
  '/landing-page-analyzer': 'AdsGPT - Landing Page Analyzer',
  '/autopilot': 'AdsGPT - Autopilot',
  '/autopilot/meta': 'AdsGPT - Autopilot Meta',
  '/my-space': 'AdsGPT - My Space',
  '/assistant': 'AdsGPT - AI Assistant',
  '/profile': 'AdsGPT - Workspace Profile',
  '/workspace/members': 'AdsGPT - Workspace Members',
  '/workspace-invite': 'AdsGPT - Workspace Invite',
  '/workspace-login': 'AdsGPT - Workspace Login',
  '/onboarding': 'AdsGPT - Onboarding',
};

export const trackGA4PageView = (path, customTitle) => {
  if (!initialized) return;
  const userId = Cookies.get('user_id') || null;
  const normalizedPath = (path || '')
    .replace('/adstudio/adCreativeNew', '/adstudio/adCreative')
    .replace('/adstudio/adVideoNew', '/adstudio/adVideo')
    .replace(/^\/landing-page-analyzer\/[^/]+/, '/landing-page-analyzer')
    .replace(/^\/workspace-invite\/[^/]+/, '/workspace-invite')
    .replace(/^\/ad-library\/[^/]+/, '/ad-library')
    .replace(/^\/adfactory\/[^/]+/, '/adfactory');
  const resolvedTitle = customTitle || PAGE_TITLES[normalizedPath] || PAGE_TITLES[path] || document.title || 'AdsGPT';
  try {
    document.title = resolvedTitle;
  } catch (e) {
    /* ignore DOM errors */
  }

  ReactGA.send({
    hitType: 'pageview',
    page: normalizedPath || path,
    title: resolvedTitle,
    page_title: resolvedTitle,
    screen_name: resolvedTitle,
    page_location: window.location.href,
    user_id: userId ? String(userId) : undefined,
    anonymous_id: getAnonymousId(),
    session_id: getSessionId(),
  });

  try {
    ReactGA.event('page_view', {
      page_title: resolvedTitle,
      screen_name: resolvedTitle,
      page_location: window.location.href,
      page_path: normalizedPath || path,
    });
  } catch (e) {
    /* ignore */
  }
};

export const trackGA4Event = (eventName, params = {}) => {
  const userId = Cookies.get('user_id') || null;
  if (userId && initialized) {
    try {
      ReactGA.set({ userId: String(userId) });
    } catch (e) {
      // Error is completely empty
    }
  }

  const standardPayload = sanitizeParams({
    event_id: params.event_id || generateStableId('evt'),
    occurred_at: params.occurred_at || new Date().toISOString(),
    user_id: userId ? String(userId) : (params.user_id ? String(params.user_id) : 'anonymous'),
    anonymous_id: getAnonymousId(),
    session_id: getSessionId(),
    flow_id: params.flow_id || 'none',
    source: params.source || 'frontend',
    feature: params.feature || 'app',
    flow_version: params.flow_version || 'v1',
    platform: params.platform || 'web',
    asset_type: params.asset_type || 'none',
    ...params,
  });

  try {
    ReactGA.event(eventName, standardPayload);
  } catch (err) {
    // Error is completely empty
  }

  try {
    if (typeof ReactGA.gtag === 'function') {
      ReactGA.gtag('event', eventName, standardPayload);
    }
  } catch (err) {
    // Error is completely empty
  }

  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', eventName, standardPayload);
    }
  } catch (err) {
    // Error is completely empty
  }
};

const TAB_LABELS = {
  myBrands: 'brand_iq',
  competitors: 'brand_iq',
  adCopy: 'ad_copy',
  adCreativeNew: 'ad_creative',
  adVideoNew: 'ad_video',
};

const ROUTE_LABELS = {
  '/adstudio': 'ad_studio',
  '/adinsights': 'ad_insights',
  '/ad-library': 'ad_library',
  '/brandiq': 'brand_iq',
  '/adfactory': 'ad_factory',
  '/ads-manager': 'ads_manager',
  '/meta-ads': 'meta_ads',
  '/google-ads': 'google_ads',
  '/tiktok-ads': 'tiktok_ads',
  '/landing-page-analyzer': 'landing_page_analyzer',
  '/autopilot': 'autopilot',
  '/autopilot/meta': 'autopilot',
  '/my-space': 'my_space',
  '/assistant': 'ai_assistant',
  '/profile': 'workspace',
  '/workspace/members': 'workspace',
  '/workspace-invite': 'workspace',
  '/workspace-login': 'workspace',
  '/onboarding': 'onboarding',
};

export const GA4Events = {
  // Session
  sessionStarted: () => {
    if (sessionStartedFired) return;
    sessionStartedFired = true;
    trackGA4Event('session_started', {
      feature: 'App',
    });
  },

  // Navigation / Feature viewing
  featureViewed: ({ feature, tab, route }) => {
    const resolvedFeature = feature || TAB_LABELS[tab] || ROUTE_LABELS[route] || tab || route || '(unknown)';
    trackGA4Event('feature_viewed', { feature: resolvedFeature });
  },

  // Backward compatibility alias
  featureVisited: ({ tab }) => {
    const resolvedFeature = TAB_LABELS[tab] || tab || '(unknown)';
    trackGA4Event('feature_viewed', { feature: resolvedFeature });
  },

  featureVisitedByRoute: (pathname) => {
    const label = ROUTE_LABELS[pathname];
    if (label) trackGA4Event('feature_viewed', { feature: label });
  },

  // Onboarding
  onboardingStarted: (params = {}) => {
    trackGA4Event('onboarding_started', {
      feature: 'onboarding',
      flow_version: 'v1',
      ...params,
    });
  },

  onboardingCompleted: (params = {}) => {
    trackGA4Event('onboarding_completed', {
      feature: 'onboarding',
      flow_version: 'v1',
      success: true,
      ...params,
    });
  },

  // Brand IQ (Unified Event: brand_iq)
  brandSetupStarted: (params = {}) => {
    trackGA4Event('brand_iq', {
      action_name: 'brand_setup_started',
      source: params.source || 'brand_form',
      success: true,
      ...params,
    });
  },

  brandAdded: (params = {}) => {
    trackGA4Event('brand_iq', {
      action_name: 'brand_added',
      source: params.source || 'brand_form',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  brandCreated: (params = {}) => {
    trackGA4Event('brand_iq', {
      action_name: 'brand_added',
      source: params.source || 'brand_form',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  brandUpdated: (params = {}) => {
    trackGA4Event('brand_iq', {
      action_name: 'brand_updated',
      source: params.source || 'brand_form',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  brandDeleted: (params = {}) => {
    trackGA4Event('brand_iq', {
      action_name: 'brand_deleted',
      source: params.source || 'brand_list',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  brandSelected: (params = {}) => {
    trackGA4Event('brand_iq', {
      action_name: 'brand_selected',
      source: params.source || 'brand_list',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  brandViewed: (params = {}) => {
    trackGA4Event('brand_iq', {
      action_name: 'brand_viewed',
      source: params.source || 'brand_details',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  // Account connection
  accountConnectionStarted: (platform, params = {}) => {
    trackGA4Event('account_connection_started', {
      feature: 'ads_manager',
      platform: platform || 'unknown',
      ...params,
    });
  },

  // Ad Copy Module (Event: ad_studio)
  generationStarted: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_copy',
      action_name: 'ad_copy_requested',
      ...params,
    });
  },

  adCopyRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_copy',
      action_name: 'ad_copy_requested',
      source: params.source || 'adcopy_prompt',
      success: true,
      ...params,
    });
  },

  adCopyGenerationStarted: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_copy',
      action_name: 'ad_copy_requested',
      source: params.source || 'adcopy_prompt',
      success: true,
      ...params,
    });
  },

  adCopyGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_copy',
      action_name: 'ad_copy_generated',
      source: params.source || 'adcopy_chat',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adCopyViewed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_copy',
      action_name: 'ad_copy_viewed',
      source: params.source || 'adcopy_tab',
      success: true,
      ...params,
    });
  },

  // AI Creatives (Event: ad_studio)
  adCreativeAICreativesRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_ai_creatives_requested',
      source: params.source || 'ai_creatives_form',
      success: true,
      ...params,
    });
  },

  adCreativeAICreativesGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_ai_creatives_generated',
      source: params.source || 'ai_creatives_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adCreativeAICreativesFailure: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_ai_creatives_failed',
      source: params.source || 'ai_creatives_studio',
      success: false,
      ...params,
    });
  },

  // Lifestyle Ad (Event: ad_studio)
  adCreativeLifestyleAdRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_lifestyle_ad_requested',
      source: params.source || 'lifestyle_ad_form',
      success: true,
      ...params,
    });
  },

  adCreativeLifestyleAdGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_lifestyle_ad_generated',
      source: params.source || 'lifestyle_ad_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adCreativeLifestyleAdFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_lifestyle_ad_failed',
      source: params.source || 'lifestyle_ad_studio',
      success: false,
      ...params,
    });
  },

  // Product Shot (Event: ad_studio)
  adCreativeProductShotRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_product_shot_requested',
      source: params.source || 'product_shot_form',
      success: true,
      ...params,
    });
  },

  adCreativeProductShotGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_product_shot_generated',
      source: params.source || 'product_shot_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adCreativeProductShotFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_product_shot_failed',
      source: params.source || 'product_shot_studio',
      success: false,
      ...params,
    });
  },

  // Brand Awareness (Event: ad_studio)
  adCreativeBrandAwarenessRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_brand_awareness_requested',
      source: params.source || 'brand_awareness_form',
      success: true,
      ...params,
    });
  },

  adCreativeBrandAwarenessGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_brand_awareness_generated',
      source: params.source || 'brand_awareness_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adCreativeBrandAwarenessFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_brand_awareness_failed',
      source: params.source || 'brand_awareness_studio',
      success: false,
      ...params,
    });
  },

  // Apps / SaaS (Event: ad_studio)
  adCreativeAppsSaasRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_apps_saas_requested',
      source: params.source || 'apps_saas_form',
      success: true,
      ...params,
    });
  },

  adCreativeAppsSaasGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_apps_saas_generated',
      source: params.source || 'apps_saas_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adCreativeAppsSaasFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_creative',
      action_name: 'ad_creative_apps_saas_failed',
      source: params.source || 'apps_saas_studio',
      success: false,
      ...params,
    });
  },

  // AI UGC Ads (Event: ad_studio)
  adVideoAIUGCAdsRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_ugc_ads_requested',
      source: params.source || 'ai_ugc_ads_form',
      success: true,
      ...params,
    });
  },

  adVideoAIUGCAdsGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_ugc_ads_generated',
      source: params.source || 'ai_ugc_ads_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adVideoAIUGCAdsFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_ugc_ads_failed',
      source: params.source || 'ai_ugc_ads_studio',
      success: false,
      ...params,
    });
  },

  // AI Ads (Event: ad_studio)
  adVideoAIAdsRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_ads_requested',
      source: params.source || 'ai_ads_form',
      success: true,
      ...params,
    });
  },
  adVideoAIAdsGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_ads_generated',
      source: params.source || 'ai_ads_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },
  adVideoAIAdsFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_ads_failed',
      source: params.source || 'ai_ads_studio',
      success: false,
      ...params,
    });
  },

  // Product B-Rolls (Event: ad_studio)
  adVideoProductBrollsRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_product_brolls_requested',
      source: params.source || 'product_brolls_form',
      success: true,
      ...params,
    });
  },
  adVideoProductBrollsGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_product_brolls_generated',
      source: params.source || 'product_brolls_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },
  adVideoProductBrollsFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_product_brolls_failed',
      source: params.source || 'product_brolls_studio',
      success: false,
      ...params,
    });
  },

  // Clone Yourself (Event: ad_studio)
  adVideoCloneYourselfRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_clone_yourself_requested',
      source: params.source || 'clone_yourself_form',
      success: true,
      ...params,
    });
  },
  adVideoCloneYourselfGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_clone_yourself_generated',
      source: params.source || 'clone_yourself_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },
  adVideoCloneYourselfFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_clone_yourself_failed',
      source: params.source || 'clone_yourself_studio',
      success: false,
      ...params,
    });
  },

  // AI Avatars (Event: ad_studio)
  adVideoAIAvatarsRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_avatars_requested',
      source: params.source || 'ai_avatars_form',
      success: true,
      ...params,
    });
  },
  adVideoAIAvatarsGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_avatars_generated',
      source: params.source || 'ai_avatars_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },
  adVideoAIAvatarsFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_video',
      action_name: 'ad_video_ai_avatars_failed',
      source: params.source || 'ai_avatars_studio',
      success: false,
      ...params,
    });
  },

  // Ad Library (Event: ad_studio)
  adLibraryRecreateRequested: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_library',
      action_name: 'ad_library_recreate_requested',
      source: params.source || 'ad_library_recreate_form',
      success: true,
      ...params,
    });
  },

  adLibraryRecreateGenerated: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_library',
      action_name: 'ad_library_recreate_generated',
      source: params.source || 'ad_library_recreate_studio',
      success: params.success !== undefined ? params.success : true,
      ...params,
    });
  },

  adLibraryRecreateFailed: (params = {}) => {
    trackGA4Event('ad_studio', {
      feature: 'ad_library',
      action_name: 'ad_library_recreate_failed',
      source: params.source || 'ad_library_recreate_studio',
      success: false,
      ...params,
    });
  },

  // Ad Factory (Event: ad_factory)
  adFactoryCampaignAdded: (params = {}) => {
    trackGA4Event('ad_factory', {
      feature: 'ad_factory',
      action_name: 'ad_factory_campaign_added',
      source: params.source || 'ad_factory_form',
      success: true,
      ...params,
    });
  },

  adFactoryCampaignUpdated: (params = {}) => {
    trackGA4Event('ad_factory', {
      feature: 'ad_factory',
      action_name: 'ad_factory_campaign_updated',
      source: params.source || 'ad_factory_form',
      success: true,
      ...params,
    });
  },

  adFactoryCampaignDeleted: (params = {}) => {
    trackGA4Event('ad_factory', {
      feature: 'ad_factory',
      action_name: 'ad_factory_campaign_deleted',
      source: params.source || 'ad_factory_form',
      success: true,
      ...params,
    });
  },

  adFactoryCampaignStarted: (platforms = ['meta'], params = {}) => {
    const rawPlatforms = Array.isArray(platforms) ? platforms : [platforms];
    const cleanList = rawPlatforms
      .map((p) => String(p || '').toLowerCase().trim())
      .filter(Boolean);
    const platformStr = cleanList.length > 0 ? cleanList.sort().join('_') : 'meta';
    const actionName = `ad_factory_campaign_started_${platformStr}`;
    trackGA4Event('ad_factory', {
      feature: 'ad_factory',
      action_name: actionName,
      source: params.source || 'ad_factory_automation',
      platforms: platformStr,
      success: true,
      ...params,
    });
  },

  adFactoryCampaignStopped: (platforms = ['meta'], params = {}) => {
    const rawPlatforms = Array.isArray(platforms) ? platforms : [platforms];
    const cleanList = rawPlatforms
      .map((p) => String(p || '').toLowerCase().trim())
      .filter(Boolean);
    const platformStr = cleanList.length > 0 ? cleanList.sort().join('_') : 'meta';
    const actionName = `ad_factory_campaign_stopped_${platformStr}`;
    trackGA4Event('ad_factory', {
      feature: 'ad_factory',
      action_name: actionName,
      source: params.source || 'ad_factory_automation',
      platforms: platformStr,
      success: true,
      ...params,
    });
  },

  // Workspace (Event: workspace)
  workspaceInvitationSent: (params = {}) => {
    trackGA4Event('workspace', {
      feature: 'workspace',
      action_name: 'workspace_invitation_sent',
      source: params.source || 'workspace_members_page',
      success: true,
      ...params,
    });
  },

  workspaceInvitationRevoked: (params = {}) => {
    trackGA4Event('workspace', {
      feature: 'workspace',
      action_name: 'workspace_invitation_revoked',
      source: params.source || 'workspace_members_page',
      success: true,
      ...params,
    });
  },

  workspaceInvitationAccepted: (params = {}) => {
    trackGA4Event('workspace', {
      feature: 'workspace',
      action_name: 'workspace_invitation_accepted',
      source: params.source || 'workspace_invitation_accept_page',
      success: true,
      ...params,
    });
  },

  // Ads Manager (Event: ads_manager)
  adsManagerConnectedWithMeta: (params = {}) => {
    trackGA4Event('ads_manager', {
      feature: 'ads_manager',
      action_name: 'ads_manager_connected_with_meta',
      source: params.source || 'meta_oauth',
      success: true,
      ...params,
    });
  },

  adsManagerUsingChatbot: (params = {}) => {
    trackGA4Event('ads_manager', {
      feature: 'ads_manager',
      action_name: 'ads_manager_using_chatbot',
      source: params.source || 'ads_manager_chat',
      success: true,
      ...params,
    });
  },

  adsManagerAddedNewCampaign: (params = {}) => {
    trackGA4Event('ads_manager', {
      feature: 'ads_manager',
      action_name: 'ads_manager_added_new_campaign',
      source: params.source || 'meta_ads_dashboard',
      success: true,
      ...params,
    });
  },

  adsManagerUsingLeads: (params = {}) => {
    trackGA4Event('ads_manager', {
      feature: 'ads_manager',
      action_name: 'ads_manager_using_leads',
      source: params.source || 'leads_tab',
      success: true,
      ...params,
    });
  },

  // Autopilot inside Ads Manager (Event: ads_manager)
  autopilotUsingAiAudit: (params = {}) => {
    trackGA4Event('ads_manager', {
      feature: 'ads_manager',
      action_name: 'ads_manager_autopilot_using_ai_audit',
      source: params.source || 'ai_audit_tab',
      success: true,
      ...params,
    });
  },

  autopilotAddedNewRule: (params = {}) => {
    trackGA4Event('ads_manager', {
      feature: 'ads_manager',
      action_name: 'ads_manager_autopilot_added_new_rule',
      source: params.source || 'autopilot_settings',
      success: true,
      ...params,
    });
  },

  generationCancelled: (params = {}) => {
    trackGA4Event('generation_cancelled', {
      ...params,
    });
  },

  generationRegenerated: (params = {}) => {
    trackGA4Event('generation_regenerated', {
      ...params,
    });
  },

  // Asset Editing
  assetEditStarted: (params = {}) => {
    trackGA4Event('asset_edit_started', {
      ...params,
    });
  },

  assetEditCompleted: (params = {}) => {
    trackGA4Event('asset_edit_completed', {
      success: true,
      ...params,
    });
  },

  // Asset Export
  assetExportStarted: (params = {}) => {
    trackGA4Event('asset_export_started', {
      ...params,
    });
  },

  // Publishing
  publishStarted: (params = {}) => {
    trackGA4Event('publish_started', {
      feature: 'ads_manager',
      ...params,
    });
  },

  publishRetried: (params = {}) => {
    trackGA4Event('publish_retried', {
      feature: 'ads_manager',
      ...params,
    });
  },

  // Feedback
  feedbackSubmitted: (params = {}) => {
    trackGA4Event('feedback_submitted', {
      ...params,
    });
  },
};
