import React, { useState, useRef, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { fadeUpVariants, containerFadeUpVariants } from '@/utils/ui/framerMotionVariants';
import AdCreativeModuleCards from './components/AdCreativeModuleCards';
import AdCreativeDrawerHandle from './components/AdCreativeDrawerHandle';
import {
  AdCreativeTemplateHeader,
  AdCreativeTemplateMasonry,
} from './components/AdCreativeTemplateGallery';

const SCROLL_THRESHOLD = 120; // ~2 scroll steps distance in px
const MAX_DRAWER_PULL = 340; // maximum upward pull in px for draggable drawer

export default function AdCreativeNewHome({ onSelectCategory }) {
  const { userData } = useSelector((state) => state.socket);
  const userName = userData?.user_name || 'User';

  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [drawerY, setDrawerY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');

  const dragStartRef = useRef({ startY: 0, startDrawerY: 0, hasMoved: false });

  // Handle single continuous page scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    setScrollTop(containerRef.current.scrollTop);
  }, []);

  // Compute normalized bounded progress [0, 1] for card compression over first ~2 scrolls
  const effectiveOffset = scrollTop + drawerY;
  const progress = Math.min(Math.max(effectiveOffset / SCROLL_THRESHOLD, 0), 1);

  // Pointer drag events for the drawer handle (Mouse, Touch, Pen)
  const handlePointerDown = (e) => {
    dragStartRef.current = {
      startY: e.clientY,
      startDrawerY: drawerY,
      hasMoved: false,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const deltaY = dragStartRef.current.startY - e.clientY; // positive = dragging UP
    if (Math.abs(deltaY) > 3) {
      dragStartRef.current.hasMoved = true;
    }
    const nextY = Math.min(
      MAX_DRAWER_PULL,
      Math.max(0, dragStartRef.current.startDrawerY + deltaY)
    );
    setDrawerY(nextY);
  };

  const handlePointerUp = (e) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture already released */
    }

    const hasMoved = dragStartRef.current.hasMoved;

    // Snap to expanded or collapsed resting point
    if (hasMoved) {
      if (drawerY > MAX_DRAWER_PULL * 0.35) {
        setDrawerY(MAX_DRAWER_PULL);
        setIsExpanded(true);
      } else {
        setDrawerY(0);
        setIsExpanded(false);
      }
    }

    // Reset hasMoved flag after current pointer event cycle
    setTimeout(() => {
      dragStartRef.current.hasMoved = false;
    }, 50);
  };

  const handleToggleDrawer = () => {
    if (isExpanded || drawerY > 0) {
      setDrawerY(0);
      setIsExpanded(false);
    } else {
      setDrawerY(MAX_DRAWER_PULL);
      setIsExpanded(true);
    }
  };

  return (
    <div
      className="relative flex flex-col h-full w-full overflow-hidden bg-transparent dark:bg-transparent select-none"
      style={{
        maxHeight: 'calc(100svh - 74px)',
      }}
    >
      {/* ── TOP PRESENTATION HEADER (Hello + 5 Module Cards + Handle + Trending Header + Filters) ── */}
      <div
        onWheel={(e) => {
          if (containerRef.current) {
            containerRef.current.scrollTop += e.deltaY;
          }
        }}
        className="relative z-30 w-full shrink-0 bg-transparent dark:bg-transparent pt-1 sm:pt-1.5"
      >
        <div className="mx-auto flex flex-col items-center w-full max-w-full px-2 sm:px-4 2xl:px-6 pt-1 sm:pt-1.5">
          {/* Collapsible Upper Area (Hello + 5 Module Cards) */}
          <div
            className="w-full flex flex-col items-center overflow-hidden"
            style={{
              marginTop: `-${drawerY + progress * 18}px`,
              opacity: Math.max(1 - (drawerY / MAX_DRAWER_PULL) * 0.95, 0),
              transition: isDragging
                ? 'none'
                : 'margin-top 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease-out',
            }}
          >
            {/* Dynamic Greeting Hero Area: "Hello, {userName}" */}
            <motion.div
              variants={containerFadeUpVariants}
              initial="hidden"
              animate="visible"
              style={{
                transform: `scale(${1 - progress * 0.08})`,
                transformOrigin: 'center top',
                transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
              className="flex w-full flex-col items-center justify-center px-4 text-center select-none shrink-0"
            >
              <motion.h1
                variants={fadeUpVariants}
                custom={0}
                className="mb-0 bg-gradient-to-t from-[#0c9fbd] to-[#5057d6] dark:from-[#15DCFF] dark:to-[#6b72f8] bg-clip-text text-2xl font-bold text-transparent sm:text-3xl 2xl:text-4xl tracking-tight leading-tight"
              >
                Hello, {userName}
              </motion.h1>

              <motion.p
                variants={fadeUpVariants}
                custom={1}
                style={{
                  transform: `translateY(${-progress * 9}px)`,
                  transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
                }}
                className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 max-w-xl leading-relaxed mt-0.5"
              >
                Create scroll-stopping Image ads with AI that understands your business.
              </motion.p>
            </motion.div>

            {/* Five Module Cards Row */}
            <div className="relative w-full pt-1.5 sm:pt-2 pb-[3.4px] shrink-0">
              <AdCreativeModuleCards
                progress={progress}
                onSelectCategory={onSelectCategory}
              />
            </div>
          </div>

          {/* Sticky Drawer Handle & Trending Image Templates Header Area */}
          <div className="w-full">
            {/* Draggable Drawer Handle */}
            <AdCreativeDrawerHandle
              isDragging={isDragging}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onClick={() => {
                if (!dragStartRef.current.hasMoved) {
                  handleToggleDrawer();
                }
              }}
              isExpanded={isExpanded || drawerY > 0}
              className="my-0.5"
            />

            {/* Trending Image Templates Header & Filter Pills + Expand/Collapse Button */}
            <div className="w-full px-3 sm:px-6 2xl:px-8 pt-0.5 pb-2.5">
              <AdCreativeTemplateHeader
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                isExpanded={isExpanded || drawerY > 0}
                onToggleExpand={handleToggleDrawer}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── IMAGE TEMPLATE SCROLL AREA (Flex-1 naturally fills remaining viewport height) ── */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 min-h-0 w-full overflow-x-hidden overflow-y-auto scrollbar-thin scrollbar-thumb-black/10 dark:scrollbar-thumb-white/10 bg-transparent dark:bg-transparent"
      >
        <div className="w-full max-w-full mx-auto px-3 sm:px-6 2xl:px-8 pt-1 pb-32">
          <AdCreativeTemplateMasonry
            activeCategory={activeCategory}
            onSelectCategory={onSelectCategory}
          />
        </div>
      </div>
    </div>
  );
}
