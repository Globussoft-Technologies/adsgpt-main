const SPOKES = 8;

export function Loader({ size = 56, className }) {
  const spokeWidth = Math.max(3, Math.round(size * 0.09));
  const spokeHeight = Math.round(size * 0.3);
  const center = size / 2;

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      className={`relative inline-block animate-spin ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        animationDuration: '0.9s',
        animationTimingFunction: 'linear',
      }}
    >
      {Array.from({ length: SPOKES }).map((_, i) => {
        const angle = (360 / SPOKES) * i;
        const opacity = 0.18 + ((SPOKES - i) / SPOKES) * 0.82;
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              top: 0,
              left: center - spokeWidth / 2,
              width: spokeWidth,
              height: spokeHeight,
              transform: `rotate(${angle}deg)`,
              transformOrigin: `${spokeWidth / 2}px ${center}px`,
              background: 'linear-gradient(180deg, #15dcff 0%, #5e66f5 100%)',
              opacity,
            }}
          />
        );
      })}
    </div>
  );
}
