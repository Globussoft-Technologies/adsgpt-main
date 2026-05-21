import StepContent from './StepContent';
const tour_url = import.meta.env.VITE_YOUTUBE_URL;
// Build steps at call-time to avoid reading window/DOM at module load
const buildCommonStart = (isMobile) => {
  const headerAdCopySelector = isMobile ? '#tour_mobile_tabs_open' : '#tour_header_ad-copy_tabs';
  const headerAdCreativesSelector = isMobile
    ? '#tour_mobile_tabs_open'
    : '#tour_header_ad-creative_tabs';
  const headerAdVideoSelector = isMobile ? '#tour_mobile_tabs_open' : '#tour_header_ad-video_tabs';
  const headerGallerySelector = isMobile ? '#tour_mobile_tabs_open' : '#tour_header_gallery_tabs';
  const headerMyBrandSelector = isMobile ? '#tour_mobile_tabs_open' : '#tour_header_my-brands_tabs';

  const makeStep = (selector, title, body = null, position = 'bottom') => ({
    selector,
    content: () => (
      <StepContent title={title}>
        <div className="flex flex-col gap-3">
          {body && <div>{body}</div>}
          <div className="h-[180px] w-full overflow-hidden rounded-lg">
            <iframe
              width="100%"
              height="100%"
              src={tour_url}
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            ></iframe>
          </div>
        </div>
      </StepContent>
    ),
    position,
  });

  return [
    makeStep(
      '#tour_start',
      'Welcome to AdsGPT',
      'Take a quick tour to discover the main areas of the app.',
      isMobile ? 'center' : 'right'
    ),
    // Show app navigation step only on non-mobile viewports
    ...(!isMobile
      ? [
          makeStep(
            '#tour_ad-insights_navigation',
            'Ad Insights',
            'Access detailed analytics and performance metrics for your ads in the Ad Insights section.',
            'right'
          ),
          makeStep(
            '#tour_ad-studio_navigation',
            'Ad Studio',
            'Create, manage, and customize your ads in Ad Studio.',
            'right'
          ),
          makeStep(
            '#tour_brandiq_navigation',
            'BrandIQ',
            'Add and manage your brands here. Use them in Ad Studio to quickly create branded ads.',
            'right'
          ),
          makeStep(
            '#tour_ad-factory_navigation',
            'adfactory',
            'Access Ad Factory to plan, generate, and manage AI-powered ad creatives through a guided workflow.',
            'right'
          ),
        ]
      : []),
    // makeStep(
    //   headerSelector,
    //   'Header Tabs',
    //   'These tabs provide quick access to key sections on this page.',
    //   'bottom'
    // ),
    ...(window.location.pathname === '/adstudio'
      ? [
          makeStep(
            headerAdCopySelector,
            'Ad Copy',
            'Use this tab to create and manage your text ads.',
            'bottom'
          ),
          makeStep(
            headerAdCreativesSelector,
            'Ad Creative',
            'Use this tab to create and manage image ads.',
            'bottom'
          ),
          makeStep(
            headerAdVideoSelector,
            'Ad Videos',
            'Use this tab to create and manage video ads.',
            'bottom'
          ),
        ]
      : []),
    ...(window.location.pathname === '/brandiq'
      ? [
          makeStep(
            headerMyBrandSelector,
            'My Brands',
            'Add and manage your brands here. Use them in Ad Studio to quickly create branded ads.',
            'bottom'
          ),
          makeStep(
            headerGallerySelector,
            'Gallery',
            'Access all your saved ad creatives in the Gallery.',
            'bottom'
          ),
        ]
      : []),
  ];
};

const makeStep = (selector, title, body = null, position = 'bottom') => ({
  selector,
  content: () => (
    <StepContent title={title}>
      <div className="flex flex-col gap-3">
        {body && <div>{body}</div>}
        <div className="h-[180px] w-full overflow-hidden rounded-lg">
          <iframe
            width="100%"
            height="100%"
            src={tour_url}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          ></iframe>
        </div>
      </div>
    </StepContent>
  ),
  position,
});

const getRouteSteps = (pathname, isAddieChatVisible) => {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
  const commonStart = buildCommonStart(isMobile);

  const routes = {
    '/adinsights': [
      ...commonStart,
      makeStep(
        '#tour_image_adcard',
        'Image Ad Card',
        'Explore detailed insights of individual image ads here.'
      ),
      makeStep(
        '#tour_show_analytics_button',
        'Show Analytics Button',
        'Click this button to view comprehensive analytics for the selected ad.'
      ),
      makeStep(
        '#tour_adpopularity',
        'Ad Popularity',
        'Check the popularity score of the ad to gauge its effectiveness and audience engagement.'
      ),
      // Graphs Tour
      makeStep(
        '#tour_overall_market_analysis_graph',
        'Overall Market Analysis',
        'Visualize monthly campaign insights across all ad networks!'
      ),
      makeStep(
        '#tour_engagement_comparison_graph',
        'Engagement Comparison',
        'Compare engagement levels across various ad formats for deeper insights.'
      ),
      makeStep(
        '#tour_postowner_graph',
        'Brand Ad Overview',
        'View total ad counts for each brand.'
      ),
      makeStep(
        '#tour_geographical_ads_distribution_graph',
        'Geographical Ad Distribution',
        'Explore how brands target their ads across different countries.'
      ),
      // Addie Tour
      ...(isAddieChatVisible
        ? [
            makeStep(
              '#tour_show_chat_history',
              'Chat History',
              'View your previous conversations with Addie to reference past ad copies.'
            ),
            makeStep(
              '#tour_search_advertiser',
              'Search Advertisers',
              'Search for advertisers and explore ad strategies used by competitors.'
            ),
            makeStep(
              '#tour_open_newchat',
              'Start New Chat',
              'Start a new chat with Addie to generate fresh ad copies instantly.'
            ),
            makeStep(
              '#tour_close_addie',
              'Close Chatbox',
              'Close Addie’s chatbox when you’re done generating ad content.'
            ),
            makeStep(
              '#tour_addie_chatbox',
              'Addie Chatbox',
              'Interact with Addie’s chatbox to generate and refine ad copies effortlessly.'
            ),
          ]
        : [
            makeStep(
              '#tour_addie_open_section',
              'Addie Chat Section',
              "Chat with Addie to quickly discover competitors' ads."
            ),
          ]),
    ],
    '/adstudio/adCopy': [
      ...commonStart.filter(
        (step) =>
          ![
            '#tour_brandiq_navigation',
            '#tour_ad-factory_navigation',
            '#tour_header_ad-creative_tabs',
            '#tour_header_ad-video_tabs',
          ].includes(step.selector)
      ),
      makeStep('#tour_filter_adcreatives_prompt', 'New Chat', 'Create a new chat.'),
      makeStep(
        '.left_side_filter_adcopy',
        'Generation Filters',
        'Adjust generation options to control platform and output variations.'
      ),
      makeStep(
        '#tour_describe_brand_for_copy',
        'Brand Preferences',
        'Select your brand and add a call to action.'
      ),
      makeStep(
        '#tour_copy_prompt_by_mic',
        'Voice Input',
        'Prefer speaking? Use the mic to quickly dictate your prompt instead of typing.'
      ),
      makeStep(
        '.chat_history',
        'Chat History',
        'View and manage all your previously generated ads.'
      ),
    ],

    '/adstudio/adCreative': [
      ...commonStart.filter(
        (step) =>
          ![
            '#tour_brandiq_navigation',
            '#tour_ad-factory_navigation',
            '#tour_header_ad-copy_tabs',
            '#tour_header_ad-video_tabs',
          ].includes(step.selector)
      ),
      makeStep(
        '#tour_filter_adcreatives_prompt',
        'Creative Filters',
        'Use these filters to refine your search and quickly find the ads you need.'
      ),
      makeStep(
        '#tour_adcreatives_upload',
        'Upload Images',
        'Upload assets to personalize results and guide creative generation.'
      ),
      makeStep(
        '#tour_creatives_config_filters',
        'Generation Filters',
        'Adjust generation options to control size, and output variations.'
      ),
      makeStep(
        '#tour_describe_brand_for_creative',
        'Brand Preferences',
        'Describe your brand’s tone and guidelines to keep outputs on‑brand.'
      ),
      makeStep(
        '#tour_creative_prompt_by_mic',
        'Voice Input',
        'Prefer speaking? Use the mic to quickly dictate your prompt instead of typing.'
      ),
      makeStep(
        '.chat_history',
        'Chat History',
        'View and manage all your previously generated ads.'
      ),
    ],

    '/adstudio/adVideo': [
      ...commonStart.filter(
        (step) =>
          ![
            '#tour_brandiq_navigation',
            '#tour_ad-factory_navigation',
            '#tour_header_ad-copy_tabs',
            '#tour_header_ad-creative_tabs',
          ].includes(step.selector)
      ),
      makeStep('#tour_filter_adcreatives_prompt', 'New Chat', 'Create a new chat.'),
      makeStep(
        '.left_side_filter_advideo',
        'Generation Filters',
        'Adjust generation options and upload product image to control size, and output variations.'
      ),
      makeStep(
        '#video_type_preference',
        'Brand Preferences',
        'Choose video type and style that aligns with your brand identity.'
      ),
      makeStep(
        '#tour_video_prompt_by_mic',
        'Voice Input',
        'Prefer speaking? Use the mic to quickly dictate your prompt instead of typing.'
      ),
      makeStep(
        '.chat_history',
        'Chat History',
        'View and manage all your previously generated ads.'
      ),
    ],

    '/adstudio/adVideoNew': [
      ...commonStart.filter(
        (step) =>
          ![
            '#tour_brandiq_navigation',
            '#tour_ad-factory_navigation',
            '#tour_header_ad-copy_tabs',
            '#tour_header_ad-creative_tabs',
            '#tour_header_gallery_tabs',
            '#tour_header_my-brands_tabs',
            '#tour_ad-studio_navigation',
          ].includes(step.selector)
      ),

      makeStep(
        '#saved-folder-icon',
        'My Videos',
        'Access all your generated video ads here. You can preview, download, and manage your video library effortlessly.'
      ),
      makeStep(
        '#tour_ad-video-card_ugc',
        'AI UGC ADS',
        'Create high-converting User Generated Content ads. Just upload your product and let AI handle the rest!'
      ),
      makeStep(
        '#tour_ad-video-card_b-roll',
        'PRODUCT B-ROLLS',
        'Transform static product images into cinematic, high-quality b-rolls with stunning camera movements.'
      ),
      makeStep(
        '#tour_ad-video-card_avatar',
        'AI AVATARS',
        'Create talking-head video ads with custom AI avatars that perfectly represent your brand identity.'
      ),
      makeStep(
        '#tour_ad-video-card_clone',
        'CLONE YOURSELF',
        'Personalize your ads by cloning your face and voice, creating authentic connections with your audience at scale.'
      ),
    ],

    '/brandiq/myBrands': [
      makeStep(
        '#tour_brandiq_navigation',
        'BrandIQ',
        'Add and manage your brands here. Use them in Ad Studio to quickly create branded ads.',
        'right'
      ),
      makeStep(
        '#tour_filter_adcreatives_prompt',
        'Add New Brand',
        'Create and add a new brand to your workspace.'
      ),
      makeStep(
        '#tour_brand_individual_card',
        'Brand Card',
        'View all your added brands displayed as individual cards here.'
      ),
      makeStep(
        '#tour_edit_brand',
        'Edit Brand',
        'Update your brand information anytime by editing the details.'
      ),
      makeStep(
        '#tour_delete_brand',
        'Delete Brand',
        'Remove a brand from your list if it’s no longer needed.'
      ),
    ],
    '/brandiq/Gallery': [
      ...commonStart.filter(
        (step) =>
          ![
            '#tour_ad-studio_navigation',
            '#tour_brandiq_navigation',
            '#tour_ad-factory_navigation',
            '#tour_header_my-brands_tabs',
          ].includes(step.selector)
      ),
      makeStep(
        '#tour_gallery_card',
        'Saved Ad Creative',
        'This is a saved ad creative. Click on it to view a larger version or to edit it.',
        'bottom'
      ),
    ],

    '/adfactory': [
      ...commonStart.filter(
        (step) =>
          !['#tour_ad-studio_navigation', '#tour_brandiq_navigation'].includes(step.selector)
      ),
      makeStep(
        '#new_campaign_button',
        'New Campaign',
        'Start a new campaign by setting up your brand, defining objectives, and generating AI-powered creatives in one guided flow.'
      ),
      makeStep(
        '#tour_brand-info',
        'Brand Info',
        'Define your brand identity,description,logos and other core details. '
      ),
      makeStep(
        '#tour_objectives',
        'Objectives',
        'Choose what you want to achieve with this campaign, such as target audience, promotional details, or core idea.'
      ),
      makeStep(
        '#tour_assets',
        'Key visuals',
        'Upload brand assets like logos, images, or reference creatives that will be used to generate high-quality ad visuals.'
      ),
      makeStep(
        '#tour_validate',
        'Platforms',
        'Choose the platforms where your ads will run. This ensures creatives are generated in the right formats, dimensions, and specifications.'
      ),
      makeStep(
        '#tour_services',
        'Services',
        'Choose the types of AI services you want to use, such as image generation or text generation, for this campaign.'
      ),
      makeStep(
        '#tour_image-generation',
        'Image Generation',
        'Generate AI-powered ad visuals based on your brand inputs, assets, and selected platforms.'
      ),
      makeStep(
        '#tour_text-generation',
        'Text Generation',
        'Generate high-quality, AI-written ad copy aligned with your campaign goals, brand voice, and selected platforms.'
      ),
      makeStep(
        '#tour_preview',
        'Preview Campaign Ads',
        'Review all generated ad creatives together in a comprehensive preview before finalizing your campaign.'
      ),
      makeStep(
        '#tour_post-ad',
        'Launch Campaign',
        'Once satisfied with the generated ads, launch your campaign to deploy the creatives to your selected platforms.'
      ),
    ],
    '/default': [],
  };

  return routes[pathname] || routes['/default'];
};

export default getRouteSteps;
