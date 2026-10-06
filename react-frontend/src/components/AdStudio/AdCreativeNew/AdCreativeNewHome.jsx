import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { fadeUpVariants, containerFadeUpVariants } from '@/utils/ui/framerMotionVariants';
import useStudioTemplates from '@/hooks/useStudioTemplates';
import AdCreativeModuleCards from './components/AdCreativeModuleCards';
import { StudioToolHeader } from '@/components/AdStudio/StudioToolTile';
import ImageTemplateModal from './components/ImageTemplateModal';
import StudioTemplateDock, {
  useStudioDock,
  STUDIO_BLEED,
  STUDIO_GUTTER,
} from '@/components/AdStudio/StudioTemplateDock';

// Space above the heading. The tool stage is tall, so it sits close to the tabs.
const TOOLS_TOP = 'pt-[calc(0.75rem+3vh)] 2xl:pt-[calc(1rem+3vh)]';

// Layout:
//   1. "Create an image ad" heading + tool tiles. Static: the dock covers them
//      on its way up rather than pushing them away (onboarding's model).
//   2. StudioTemplateDock, absolutely positioned at the bottom of this root.
//      Its collapsed top sits a fixed gap under the tool row; raised, it stops
//      under the heading. See StudioTemplateDock.jsx.
export default function AdCreativeNewHome({ onSelectCategory }) {
  const dock = useStudioDock();
  // Image templates matched to the brand selected in the header.
  const templates = useStudioTemplates('image');
  const brandName = templates.brand?.name || '';
  // The image template open in the "Recreate this ad" modal; null = closed.
  const [selectedTemplate, setSelectedTemplate] = useState(null);

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
          <StudioToolHeader kind="image" />
        </motion.div>
        {/* flow-root: keeps the row's negative hover margins inside this box, so
            its measured bottom (dock position) is the tiles' real bottom. */}
        <motion.div ref={dock.toolsRef} variants={fadeUpVariants} custom={1} className="flow-root">
          <AdCreativeModuleCards onSelectCategory={onSelectCategory} />
        </motion.div>
      </motion.div>

      {/* ── 2. TEMPLATE DOCK ── */}
      <StudioTemplateDock
        {...dock.dockProps}
        title="Trending Image Templates"
        subtitle="Pick any ad to recreate it for your brand."
        brandName={brandName}
        media="image"
        view={templates.view}
        items={templates.items}
        error={templates.error}
        onRetry={templates.retry}
        onSelectTemplate={setSelectedTemplate}
        onRefresh={templates.refresh}
        isRefreshing={templates.isRefreshing || templates.view === 'loading'}
        refreshDisabled={!templates.brand}
        // Image templates page in as you scroll (20 at a time), like video.
        hasMore={templates.hasMore}
        onLoadMore={templates.loadMore}
        isLoadingMore={templates.isLoadingMore}
        loadMoreError={templates.loadMoreError}
      />

      <ImageTemplateModal
        template={selectedTemplate}
        brand={templates.brand}
        onClose={() => setSelectedTemplate(null)}
      />
    </div>
  );
}
