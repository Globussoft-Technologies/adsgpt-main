import React from 'react';
import { useSelector } from 'react-redux';
import ReactDOM from 'react-dom';

// Simple world map background SVG
const WORLD_MAP_SVG =
  'https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg';

// Accurate Google Maps location pin SVG
const LocationPinIcon = ({ size = 32, hovered = false, color = '#EA4335' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Pin shadow */}
    <path
      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
      fill="#000000"
      fillOpacity="0.2"
      transform="translate(1, 1)"
    />
    {/* Main pin body */}
    <path
      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
      fill={color}
      stroke="#FFFFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Pin hole */}
    <circle cx="12" cy="9" r="2.5" fill="#FFFFFF" />
    {/* Pin point */}
    <circle cx="12" cy="20.5" r="1.5" fill={color} stroke="#FFFFFF" strokeWidth="1" />
  </svg>
);

const LocationMarker = ({
  left,
  top,
  value,
  name,
  size = 20,
  isHighlighted = false,
  onCountryHover,
  onCountryLeave,
}) => {
  const [hovered, setHovered] = React.useState(false);
  const [zoomed, setZoomed] = React.useState(false);
  const markerRef = React.useRef(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });

  // Combine manual hover (from list) and natural hover
  const isActive = isHighlighted || hovered;

  const handleMouseEnter = () => {
    setHovered(true);
    setZoomed(true);
    if (markerRef.current) {
      const rect = markerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const topY = rect.top;
      setTooltipPos({ x: centerX, y: topY });
    }
  };

  const handleMouseLeave = () => {
    setHovered(false);
    setZoomed(false);
  };

  // 3D Zoom effect focusing on the pin tip
  const zoomStyle = isActive
    ? {
        transform: 'translate(-50%, -100%) scale(1.5)',
        transformOrigin: 'center bottom',
        zIndex: 1000,
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        filter: 'drop-shadow(0 8px 20px rgba(234, 67, 53, 0.4))',
      }
    : {
        transform: 'translate(-50%, -100%)',
        transformOrigin: 'center bottom',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        filter: 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3))',
      };

  return (
    <>
      <div
        style={{
          left,
          top,
          ...zoomStyle,
        }}
        className="absolute cursor-pointer select-none"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        ref={markerRef}
      >
        {/* 3D Pulsating zone effect - positioned exactly at the pin tip */}
        {isActive && (
          <>
            {/* Base glow layer */}
            <div
              className="absolute rounded-full"
              style={{
                width: '15px',
                height: '15px',
                left: '50%',
                top: '100%',
                transform: 'translate(-50%, -50%)',
                background:
                  'radial-gradient(circle, rgba(34, 197, 94, 0.6) 0%, rgba(34, 197, 94, 0.3) 30%, transparent 70%)',
                boxShadow: '0 0 30px rgba(34, 197, 94, 0.8)',
                animation: 'pulse3d 2s infinite',
                zIndex: -1,
              }}
            />

            {/* Main 3D pulse ring */}
            <div
              className="absolute rounded-full border-2 border-green-400"
              style={{
                width: '10px',
                height: '10px',
                left: '50%',
                top: '100%',
                transform: 'translate(-50%, -50%)',
                background:
                  'radial-gradient(circle, rgba(234, 67, 53, 0.4) 0%, rgba(234, 67, 53, 0.1) 50%, transparent 70%)',
                boxShadow: `
                  0 0 0 3px rgba(34, 197, 94, 0.6),
                  0 0 0 6px rgba(34, 197, 94, 0.3),
                  0 0 25px rgba(34, 197, 94, 0.8),
                  0 0 40px rgba(34, 197, 94, 0.4),
                  inset 0 0 20px rgba(234, 67, 53, 0.4)
                `,
                animation: 'pulse3d 2s infinite, glow3d 3s ease-in-out infinite',
                zIndex: 10,
              }}
            />

            {/* 3D Ripple effect 1 */}
            <div
              className="absolute rounded-full border-2 border-green-300"
              style={{
                width: '15px',
                height: '15px',
                left: '50%',
                top: '100%',
                transform: 'translate(-50%, -50%)',
                animation: 'ripple3d 3s linear infinite',
                zIndex: 9,
              }}
            />

            {/* 3D Ripple effect 2 */}
            <div
              className="absolute rounded-full border-2 border-green-300"
              style={{
                width: '15px',
                height: '15px',
                left: '50%',
                top: '100%',
                transform: 'translate(-50%, -50%)',
                animation: 'ripple3d 3s linear infinite 1s',
                zIndex: 8,
              }}
            />

            {/* 3D Ripple effect 3 */}
            <div
              className="absolute rounded-full border-2 border-green-300"
              style={{
                width: '15px',
                height: '15px',
                left: '50%',
                top: '100%',
                transform: 'translate(-50%, -50%)',
                animation: 'ripple3d 3s linear infinite 2s',
                zIndex: 7,
              }}
            />

            {/* Pin tip highlight */}
            <div
              className="absolute rounded-full bg-white"
              style={{
                width: '6px',
                height: '6px',
                left: '50%',
                top: '100%',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 10px rgba(255, 255, 255, 0.8)',
                animation: 'tipGlow 1.5s ease-in-out infinite',
                zIndex: 11,
              }}
            />
          </>
        )}

        {/* Main pin container with 3D perspective */}
        <div
          className="relative"
          style={{
            transform: isActive ? 'translateZ(10px)' : 'translateZ(0)',
            transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
            filter: isActive ? 'brightness(1.2) contrast(1.1)' : 'none',
            zIndex: isActive ? 1000 : 10,
          }}
        >
          <LocationPinIcon size={size} hovered={isActive} />
        </div>
      </div>

      {isActive &&
        hovered &&
        ReactDOM.createPortal(
          <div
            className="fixed z-[999999] mb-2 rounded-lg px-3 py-2 text-xs shadow-2xl"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y - 20,
              transform: 'translate(-50%, -100%)',
              background: 'linear-gradient(135deg, #0D0D0D 0%, #1a1a1a 100%)',
              color: '#FFFFFF',
              border: '1px solid rgba(255,255,255,0.3)',
              pointerEvents: 'none',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="flex-shrink-0"
                style={{
                  transform: 'scale(1.2)',
                  transition: 'transform 0.3s ease',
                }}
              >
                <LocationPinIcon size={16} />
              </div>
              <div>
                <div className="text-xs font-semibold whitespace-nowrap">{name}</div>
                <div className="mt-0.5 text-xs text-[#AFAFAF]">Ads: {value}</div>
              </div>
            </div>
            {/* Tooltip arrow pointing to pin */}
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1a1a1a]"
              style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))' }}
            />
          </div>,
          document.body
        )}
    </>
  );
};

const GeographicalAdDistribution = () => {
  const geoData = useSelector((state) => state?.addie?.geoData);
  const isLoading = useSelector((state) => state?.addie?.loading);
  const [highlightedCountry, setHighlightedCountry] = React.useState(null);
  const [scale, setScale] = React.useState(1);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const mapRef = React.useRef(null);
  const isMouseOver = React.useRef(false);

  // Handle zoom with mouse wheel
  const handleWheel = (e) => {
    if (!isMouseOver.current) return;
    e.preventDefault();
    e.stopPropagation();

    const delta = e.deltaY;
    const zoomFactor = 0.4;

    const nextScale = delta > 0 ? Math.max(1, scale - zoomFactor) : Math.min(7, scale + zoomFactor);

    if (mapRef.current) {
      const rect = mapRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const scaleChange = nextScale - scale;
      const newX = position.x - ((mouseX - rect.width / 2) * scaleChange) / scale;
      const newY = position.y - ((mouseY - rect.height / 2) * scaleChange) / scale;

      setScale(nextScale);
      setPosition({
        x: Math.max(Math.min(newX, rect.width * (nextScale - 1)), -rect.width * (nextScale - 1)),
        y: Math.max(Math.min(newY, rect.height * (nextScale - 1)), -rect.height * (nextScale - 1)),
      });
    }
  };

  // Handle mouse enter/leave for map container
  const handleMouseEnter = () => {
    isMouseOver.current = true;
    const parent = document.querySelector('.adinsight_graphs_right_container');
    if (parent) {
      parent.style.overflowY = 'hidden';
    }
  };

  const handleMouseLeave = () => {
    isMouseOver.current = false;
    const parent = document.querySelector('.adinsight_graphs_right_container');
    if (parent) {
      parent.style.overflowY = 'auto';
    }
  };

  // Add CSS for 3D animations
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse3d {
        0% {
          transform: translate(-50%, -50%) scale(0.8) translateZ(0);
          opacity: 0.8;
          border-color: rgba(34, 197, 94, 0.9);
        }
        50% {
          transform: translate(-50%, -50%) scale(1.4) translateZ(10px);
          opacity: 0.4;
          border-color: rgba(34, 197, 94, 0.6);
          box-shadow: 
            0 0 0 4px rgba(34, 197, 94, 0.8),
            0 0 0 8px rgba(34, 197, 94, 0.4),
            0 0 35px rgba(34, 197, 94, 1),
            0 0 50px rgba(34, 197, 94, 0.6),
            inset 0 0 25px rgba(234, 67, 53, 0.5);
        }
        100% {
          transform: translate(-50%, -50%) scale(0.8) translateZ(0);
          opacity: 0.8;
          border-color: rgba(34, 197, 94, 0.9);
        }
      }
      
      @keyframes glow3d {
        0%, 100% {
          box-shadow: 
            0 0 0 3px rgba(34, 197, 94, 0.6),
            0 0 0 6px rgba(34, 197, 94, 0.3),
            0 0 25px rgba(34, 197, 94, 0.8),
            0 0 40px rgba(34, 197, 94, 0.4),
            inset 0 0 20px rgba(234, 67, 53, 0.4);
          filter: brightness(1);
        }
        50% {
          box-shadow: 
            0 0 0 5px rgba(34, 197, 94, 0.8),
            0 0 0 10px rgba(34, 197, 94, 0.4),
            0 0 40px rgba(34, 197, 94, 1),
            0 0 60px rgba(34, 197, 94, 0.6),
            inset 0 0 30px rgba(234, 67, 53, 0.6);
          filter: brightness(1.3);
        }
      }
      
      @keyframes ripple3d {
        0% {
          transform: translate(-50%, -50%) scale(1) translateZ(0);
          opacity: 0.8;
          border-width: 2px;
          border-color: rgba(34, 197, 94, 0.8);
        }
        50% {
          transform: translate(-50%, -50%) scale(2.2) translateZ(5px);
          border-color: rgba(34, 197, 94, 0.4);
          opacity: 0.5;
        }
        100% {
          transform: translate(-50%, -50%) scale(3.2) translateZ(0);
          opacity: 0;
          border-width: 1px;
          border-color: rgba(34, 197, 94, 0.1);
        }
      }
      
      @keyframes tipGlow {
        0%, 100% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 0.8;
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
        }
        50% {
          transform: translate(-50%, -50%) scale(1.3);
          opacity: 1;
          box-shadow: 0 0 20px rgba(255, 255, 255, 1);
        }
      }

      .country-tab-highlight {
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(147, 51, 234, 0.3) 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        transition: all 0.3s ease;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Transform API data for the map
  const markers = React.useMemo(() => {
    if (!geoData?.chartData || !Array.isArray(geoData.chartData)) {
      return [];
    }

    // Map country codes to positions on the map
    const countryPositions = {
      US: { left: '28%', top: '41%' },
      IN: { left: '58%', top: '58%' },
      GB: { left: '48%', top: '35%' },
      NL: { left: '49%', top: '35%' },
      DE: { left: '50%', top: '35%' },
      FR: { left: '48%', top: '38%' },
      IT: { left: '51%', top: '40%' },
      ES: { left: '46%', top: '42%' },
      RO: { left: '52%', top: '38%' },
      BE: { left: '48%', top: '35%' },
      CA: { left: '25%', top: '35%' },
      AU: { left: '72%', top: '70%' },
      BR: { left: '40%', top: '65%' },
      CN: { left: '65%', top: '45%' },
      JP: { left: '75%', top: '45%' },
      RU: { left: '60%', top: '30%' },
    };

    return geoData.chartData.map((country) => {
      const position = countryPositions[country?.id] || { left: '50%', top: '50%' };
      return {
        name: country?.name,
        value: country?.value,
        left: position.left,
        top: position.top,
        id: country?.id || country?.name,
      };
    });
  }, [geoData]);

  // Handle country tab hover
  const handleCountryTabHover = (countryName) => {
    setHighlightedCountry(countryName);
  };

  const handleCountryTabLeave = () => {
    setHighlightedCountry(null);
  };

  // Check if data is available
  const hasData = markers?.length > 0;
  const isEmpty = !isLoading && !hasData;

  // Shimmer Loading Component
  const ShimmerLoader = () => (
    <div className="animate-pulse">
      {/* Header Shimmer */}
      <div className="mb-8 flex items-center justify-between">
        <div className="mx-auto h-7 w-80 rounded bg-gray-700"></div>
      </div>

      {/* Map Container Shimmer */}
      <div className="relative mx-auto w-full overflow-hidden rounded-2xl lg:p-6">
        <div className="relative mx-auto aspect-video w-full max-w-[1200px]">
          {/* Map Background Shimmer */}
          <div className="relative h-full w-full rounded-2xl bg-linear-to-br from-gray-700 to-gray-900">
            {/* Map Pattern Shimmer */}
            <div className="absolute inset-0 opacity-20">
              <div className="h-full w-full rounded-2xl bg-linear-to-br from-gray-700 to-gray-900"></div>
            </div>

            {/* Bubbles Shimmer */}
            {[...Array(7)].map((_, index) => {
              const positions = [
                { left: '22%', top: '34%' },
                { left: '28%', top: '41%' },
                { left: '35%', top: '66%' },
                { left: '58%', top: '58%' },
                { left: '64%', top: '50%' },
                { left: '76%', top: '76%' },
                { left: '50%', top: '35%' },
              ];
              const pos = positions[index % positions.length];

              return (
                <div
                  key={index}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pos.left, top: pos.top }}
                >
                  <div className="h-20 w-20 animate-pulse rounded-full bg-gray-700 opacity-70"></div>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="h-4 w-8 rounded bg-gray-600"></div>
                  </div>
                  <div className="absolute top-full left-1/2 mt-2 -translate-x-1/2">
                    <div className="h-3 w-16 rounded bg-gray-600"></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // No Data Component
  const NoDataState = () => (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-gray-200 bg-gray-100">
        <div className="text-3xl">🌍</div>
      </div>
      <h3 className="mb-2 text-xl font-medium text-[#AFAFAF]">No Geographical Data</h3>
      <p className="max-w-md text-center text-sm text-[#7E7E7E]">
        There's no geographical distribution data to display at the moment. Please check back later
        or ensure your data sources are connected.
      </p>
    </div>
  );
  if (isLoading) {
    return (
      <div className="backdrop-blur-100 mb-3 w-full max-w-7xl rounded-3xl border border-white/10 bg-[#0D0D0D]/50 px-0 py-8 lg:px-8">
        <ShimmerLoader />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="backdrop-blur-100 mb-3 w-full max-w-7xl rounded-3xl border border-white/20 bg-[#0D0D0D]/50 px-0 py-8 lg:px-8">
        <NoDataState />
      </div>
    );
  }

  return (
    <div
      id="tour_geographical_ads_distribution_graph"
      className="backdrop-blur-100 mb-3 w-full max-w-7xl rounded-3xl border border-white/20 bg-[#0D0D0D]/50 px-0 py-8 lg:px-8"
    >
      <div className="mb-4 flex items-center justify-between">
        <h1 className="w-full text-center text-lg font-medium text-[#AFAFAF] 2xl:text-2xl">
          {geoData?.title || 'Geographical Distribution of Ads'}
        </h1>
      </div>

      <div className="relative mx-auto w-full overflow-hidden rounded-2xl lg:pt-6" ref={mapRef}>
        <div
          onWheel={handleWheel}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="relative mx-auto aspect-video w-full max-w-[1200px]"
          style={{
            transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
            transformOrigin: 'center',
            transition: 'transform 0.1s ease-out',
          }}
        >
          <div
            aria-label="World map"
            className="h-full w-full opacity-90 select-none"
            draggable={false}
            style={{
              backgroundColor: '#4E85CF',
              WebkitMaskImage: `url(${WORLD_MAP_SVG})`,
              maskImage: `url(${WORLD_MAP_SVG})`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />

          {markers?.map((m) => (
            <LocationMarker
              key={m?.name}
              left={m?.left}
              top={m?.top}
              value={m?.value}
              name={m?.name}
              isHighlighted={highlightedCountry === m.name}
            />
          ))}
        </div>

        <div className="countries_list backdrop-blur-100 mt-6 flex flex-wrap gap-1.5 rounded-xl bg-linear-to-r from-[#1B3F8C]/40 to-[#4E85CF]/20 p-3 2xl:gap-2">
          {markers?.map((country) => {
            const isHighlighted = highlightedCountry === country.name;
            return (
              <div
                key={country.name}
                className={`flex w-auto cursor-pointer items-center gap-1.5 rounded-sm border border-transparent bg-[#0D0D0D]/60 px-2 py-1 shadow-sm transition-all duration-300 2xl:py-1.5 ${
                  isHighlighted ? 'country-tab-highlight' : 'hover:bg-[#1a1a1a]/80'
                }`}
                onMouseEnter={() => handleCountryTabHover(country.name)}
                onMouseLeave={handleCountryTabLeave}
              >
                <LocationPinIcon size={12} color="#EA4335" />
                <span
                  className={`text-10 font-medium whitespace-nowrap 2xl:text-xs ${
                    isHighlighted ? 'font-bold text-white' : 'text-white'
                  }`}
                >
                  {country.name}
                </span>
                <span
                  className={`text-10 ml-1 font-semibold whitespace-nowrap 2xl:text-xs ${
                    isHighlighted ? 'font-bold text-white' : 'text-[#AFAFAF]'
                  }`}
                >
                  {country.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default GeographicalAdDistribution;
