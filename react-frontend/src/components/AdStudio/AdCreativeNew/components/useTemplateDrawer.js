import { useCallback, useRef, useState } from 'react';

// How far (px) the upper area (StudioToolHeader + tool tiles) can slide up over
// the template sheet. Shared by the Ad Creative and Ad Video home screens.
// Measured 2026-10-01 in Chrome: 203.5px at 1440, 216.5px at ≥1536 (2xl:pt-6).
// Uses the larger one; below 2xl the extra ~13px only eats into the sheet's mt-6.
// Was 370 for the old greeting + 305px cards. Re-measure if the header or
// TOOL_SLOT height (StudioToolTile.jsx) changes.
export const MAX_DRAWER_PULL = 217;

const clamp = (value) => Math.min(MAX_DRAWER_PULL, Math.max(0, value));

/**
 * Drawer behaviour for the Ad Creative / Ad Video home screens: the module-card
 * area collapses as the template grid scrolls, and can also be dragged with the
 * handle or toggled with Expand/Collapse.
 *
 * How far it is collapsed (`effectiveDrawerY`) = drag offset + grid scrollTop,
 * clamped to 0..MAX_DRAWER_PULL.
 *
 * Fix (2026-09-29): the old per-screen copy measured drags and snapped on the
 * drag offset alone, ignoring scrollTop. After scrolling the grid, a drag
 * started from the wrong position, dragging down could not bring the cards
 * back, and the snap decision used the wrong number. Drags now start from, and
 * snap on, the effective position; `drawerY` may go negative to cancel out
 * scrollTop.
 *
 * Wire-up: `containerRef` + `onScroll` go on the scrolling grid, `handleProps`
 * spread onto <AdCreativeDrawerHandle>, `toggle` on the Expand button.
 */
export default function useTemplateDrawer() {
  const containerRef = useRef(null);
  const dragRef = useRef({ startY: 0, startEffective: 0, hasMoved: false });
  const [scrollTop, setScrollTop] = useState(0);
  const [drawerY, setDrawerY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const effectiveDrawerY = clamp(drawerY + scrollTop);
  const isExpanded = effectiveDrawerY > MAX_DRAWER_PULL * 0.5;

  const onScroll = useCallback(() => {
    if (!containerRef.current) return;
    const top = containerRef.current.scrollTop;
    setScrollTop(top);
    // A negative offset only exists to cancel scrollTop during a drag; once the
    // grid is back at the top it would just delay the next scroll-collapse.
    if (top === 0) setDrawerY((y) => Math.max(y, 0));
  }, []);

  const collapse = useCallback(() => {
    setDrawerY(0);
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const expand = useCallback(() => setDrawerY(MAX_DRAWER_PULL), []);

  const toggle = useCallback(() => {
    if (effectiveDrawerY > 50) collapse();
    else expand();
  }, [effectiveDrawerY, collapse, expand]);

  const onPointerDown = (e) => {
    dragRef.current = { startY: e.clientY, startEffective: effectiveDrawerY, hasMoved: false };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const deltaY = dragRef.current.startY - e.clientY; // positive = dragging up
    if (Math.abs(deltaY) > 3) dragRef.current.hasMoved = true;
    setDrawerY(clamp(dragRef.current.startEffective + deltaY) - scrollTop);
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture already released */
    }
    if (dragRef.current.hasMoved) {
      if (effectiveDrawerY > MAX_DRAWER_PULL * 0.35) expand();
      else collapse();
    }
    // Let the click that follows pointerup see `hasMoved`, then reset it.
    setTimeout(() => {
      dragRef.current.hasMoved = false;
    }, 50);
  };

  const handleProps = {
    isDragging,
    isExpanded: effectiveDrawerY > 50,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClick: () => {
      if (!dragRef.current.hasMoved) toggle();
    },
  };

  // Styles for the collapsing upper area.
  const upperStyle = {
    marginTop: `-${effectiveDrawerY}px`,
    opacity: Math.max(1 - (effectiveDrawerY / MAX_DRAWER_PULL) * 1.05, 0),
    transition: isDragging ? 'none' : 'margin-top 0.15s ease-out, opacity 0.2s ease-out',
  };

  // Wheel over the header scrolls the grid, so the upper area collapses too.
  const onHeaderWheel = (e) => {
    if (containerRef.current) containerRef.current.scrollTop += e.deltaY;
  };

  return {
    containerRef,
    onScroll,
    onHeaderWheel,
    effectiveDrawerY,
    isExpanded,
    toggle,
    handleProps,
    upperStyle,
  };
}
