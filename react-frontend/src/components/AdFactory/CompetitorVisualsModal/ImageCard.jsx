import { useState } from 'react';

const ImageCard = ({ image, isSelected, onSelect }) => {
  const [loading, setLoading] = useState(true);

  return (
    <div onClick={() => onSelect(image)} className="relative cursor-pointer rounded-xl">
      {/* Skeleton */}
      {loading && <div className="absolute inset-0 animate-pulse rounded-xl bg-[#1a1a1a]" />}
      {/* {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[#1a1a1a]">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
        </div>
      )} */}

      <div
        className={`relative overflow-hidden rounded-2xl transition-all duration-200 ${
          isSelected ? 'border-3 border-[#2364B8]' : ''
        }`}
      >
        <img
          src={image.url}
          alt=""
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
          className={`w-full rounded-xl object-cover transition-transform duration-300 hover:scale-[1.02] ${
            loading ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>

      {/* Selection Ring */}
      {/* <div
        className={`absolute inset-0 rounded-xl transition-all ${
          isSelected ? 'ring-3 ring-[#2364B8]' : ''
        }`}
      /> */}

      {/* Selection Indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#2364B8]">
          <div className="h-2 w-2 rounded-full bg-white" />
        </div>
      )}
    </div>
  );
};

export default ImageCard;
