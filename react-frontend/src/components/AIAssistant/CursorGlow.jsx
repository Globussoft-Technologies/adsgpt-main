import { useEffect, useRef } from 'react';

// Barely-there glow that follows the native cursor on the AI Assistant page.
// The real pointer is untouched — this is a pointer-events-none light layered
// over the content. One uniform color from the background blob's gradient
// (#28bcfc), at an alpha low enough to read as ambience, not an effect.
//
// Performance: no React state — pointermove writes coordinates to locals and a
// requestAnimationFrame tick applies a compositor-only translate3d, so at most
// one transform update lands per display frame and nothing ever re-renders.
// The softness is baked into the radial gradient itself (no filter: blur, so
// no per-frame filter work). Touch devices skip the effect entirely.
const GLOW_SIZE = 160;

const CursorGlow = () => {
  const glowRef = useRef(null);

  useEffect(() => {
    const el = glowRef.current;
    if (!el) return undefined;
    // No meaningful cursor on touch devices — don't even attach listeners.
    if (window.matchMedia('(pointer: coarse)').matches) return undefined;

    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      el.style.transform = `translate3d(${x - GLOW_SIZE / 2}px, ${y - GLOW_SIZE / 2}px, 0)`;
    };
    const onMove = (e) => {
      x = e.clientX;
      y = e.clientY;
      el.style.opacity = '1';
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      el.style.opacity = '0';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={glowRef}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-[90] rounded-full opacity-0 transition-opacity duration-300 will-change-transform"
      style={{
        width: GLOW_SIZE,
        height: GLOW_SIZE,
        background:
          'radial-gradient(circle, rgba(40,188,252,0.05) 0%, rgba(40,188,252,0) 70%)',
      }}
    />
  );
};

export default CursorGlow;
