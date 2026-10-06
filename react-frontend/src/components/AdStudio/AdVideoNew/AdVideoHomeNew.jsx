import React, { useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { fadeUpVariants, containerFadeUpVariants } from '@/utils/ui/framerMotionVariants';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';
import { setActivePage, setRecreateInputs } from '@/store/reducers/adStudio/adVideoNewSlice';
import useStudioTemplates from '@/hooks/useStudioTemplates';
import AdVideoModuleCards from './components/AdVideoModuleCards';
import { StudioToolHeader } from '@/components/AdStudio/StudioToolTile';
import StudioTemplateDock, {
  useStudioDock,
  STUDIO_BLEED,
  STUDIO_GUTTER,
} from '@/components/AdStudio/StudioTemplateDock';

// Space above the heading. The tool stage is tall, so it sits close to the tabs.
const TOOLS_TOP = 'pt-[calc(0.75rem+3vh)] 2xl:pt-[calc(1rem+3vh)]';

// Single source for the module cards: AdVideoCard reads title/desc/img/gif/type
// and premium (plan-8 lock) / comingSoon from here. Titles now Title Case.
const cards = [
  {
    title: 'AI Ads',
    desc: 'Create full length AI ad videos',
    img: '/static/adVideo/ai_ads_thumb.jpg',
    gif: '/static/adVideo/ai_ads.gif',
    type: 'ai-ads',
    // comingSoon: true,
  },
  {
    title: 'AI UGC Ads',
    desc: 'Create AI UGC ad videos',
    img: '/static/adVideo/ai-ugc-ads-photo.jpg',
    gif: '/static/adVideo/ai-ugc-ads-gif.gif',
    type: 'ugc',
  },
  {
    title: 'Product B-Rolls',
    desc: 'Create cinematic b-rolls for your products',
    img: '/static/adVideo/product-b-rolls-photo.jpg',
    gif: '/static/adVideo/b-rolls-gif-1.gif',
    type: 'b-roll',
  },
  {
    title: 'Recreate Ad',
    desc: 'Create a new ad from an existing video',
    img: 'https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/4dcc2a50-47de-46a1-b7e6-d5bd378bb5d1-91841e48382ec5af.mp4',
    gif: 'https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/4dcc2a50-47de-46a1-b7e6-d5bd378bb5d1-91841e48382ec5af.mp4',
    type: 'clone-ad',
  },
  {
    title: 'AI Avatars',
    desc: 'Create ad videos with custom avatars',
    img: '/static/adVideo/ai-avatars-photo.jpg',
    gif: '/static/adVideo/ai-avatars-gif.gif',
    type: 'avatar',
    // comingSoon: true,
  },
  {
    title: 'Clone Yourself',
    desc: 'Create AI ad videos with your face and voice',
    img: '/static/adVideo/clone-yourself-photo.jpg',
    gif: '/static/adVideo/clone-yourself-gif.gif',
    type: 'clone',
    premium: true,
  },
];

// Same layout as AdCreativeNewHome.jsx: heading + tool tiles, with the
// template dock (brand-matched DS video templates) over them from the bottom.
const AdVideoHomeNew = () => {
  const dispatch = useDispatch();
  const { savedCount } = useSelector((state) => state.adVideoNew);

  const dock = useStudioDock();
  const templates = useStudioTemplates('video');
  const brandName = templates.brand?.name || '';

  useEffect(() => {
    dispatch(fetchProcessingCount());
  }, [dispatch, savedCount]);

  // Video template → Re Create Ad, on its first form with the template video
  // pre-filled; the user adds product images there and runs Analyze.
  // `prefillOnly` is handled at the top of CloneYourAdPage.handleRecreate.
  const openRecreateWithTemplate = useCallback(
    (template) => {
      dispatch(setRecreateInputs({ prefillOnly: true, sourceVideoUrl: template.url }));
      dispatch(setActivePage('clone-ad'));
    },
    [dispatch]
  );

  return (
    <div
      ref={dock.rootRef}
      className={`relative flex h-full flex-col overflow-hidden bg-transparent select-none dark:bg-transparent ${STUDIO_BLEED}`}
      style={{ maxHeight: 'calc(100svh - 74px)' }}
    >
      {/* ── 1. HEADING + TOOLS ── */}
      <motion.div
        variants={containerFadeUpVariants}
        initial="hidden"
        animate="visible"
        className={`relative w-full shrink-0 ${TOOLS_TOP} ${STUDIO_GUTTER}`}
      >
        <motion.div ref={dock.headRef} variants={fadeUpVariants} custom={0}>
          <StudioToolHeader kind="video" />
        </motion.div>
        {/* flow-root: keeps the row's negative hover margins inside this box, so
            its measured bottom (dock position) is the tiles' real bottom. */}
        <motion.div ref={dock.toolsRef} variants={fadeUpVariants} custom={1} className="flow-root">
          <AdVideoModuleCards cards={cards} />
        </motion.div>
      </motion.div>

      {/* ── 2. TEMPLATE DOCK ── */}
      <StudioTemplateDock
        {...dock.dockProps}
        title="Trending Video Templates"
        subtitle="Pick any video to recreate it with your product."
        brandName={brandName}
        media="video"
        view={templates.view}
        items={templates.items}
        error={templates.error}
        onRetry={templates.retry}
        onSelectTemplate={openRecreateWithTemplate}
        onRefresh={templates.refresh}
        isRefreshing={templates.isRefreshing || templates.view === 'loading'}
        refreshDisabled={!templates.brand}
        // Video templates page in as you scroll (10 at a time).
        hasMore={templates.hasMore}
        onLoadMore={templates.loadMore}
        isLoadingMore={templates.isLoadingMore}
        loadMoreError={templates.loadMoreError}
      />
    </div>
  );
};

export default AdVideoHomeNew;
