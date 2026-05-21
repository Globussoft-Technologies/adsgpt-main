import { useState, useEffect, useCallback, useMemo } from 'react';

const ShowProductImages = ({
  Images = [],
  onImageSelect,
  currentSelectedCount,
  initialSelectedImages = [],
}) => {
  const [selectedImages, setSelectedImages] = useState(initialSelectedImages);
  const [selectionError, setSelectionError] = useState('');

  const MAX_SELECTION = 5;

  useEffect(() => {
    if (selectedImages.length === 0 && Images?.length > 0) {
      const initialSelection = [Images[0]];
      setSelectedImages(initialSelection);
      onImageSelect?.(initialSelection);
    }
  }, [Images]);

  const totalSelectedCount = useMemo(() => {
    return (selectedImages?.length || 0) + (currentSelectedCount || 0);
  }, [selectedImages, currentSelectedCount]);

  const canSelectMore = useMemo(() => {
    return totalSelectedCount < MAX_SELECTION;
  }, [totalSelectedCount]);

  const handleImageSelect = useCallback(
    (image) => {
      setSelectedImages((prevSelected) => {
        const isCurrentlySelected = prevSelected?.includes(image);

        if (isCurrentlySelected) {
          const newSelectedImages = prevSelected?.filter((selected) => selected !== image);
          onImageSelect?.(newSelectedImages);
          setSelectionError('');
          return newSelectedImages;
        }

        if (!canSelectMore) {
          setSelectionError(`You can select only ${MAX_SELECTION} images`);
          return prevSelected;
        }

        const newSelectedImages = [...prevSelected, image];
        onImageSelect?.(newSelectedImages);
        setSelectionError('');
        return newSelectedImages;
      });
    },
    [onImageSelect, canSelectMore]
  );

  const isImageSelected = useCallback((image) => selectedImages?.includes(image), [selectedImages]);

  const ImagesGrid = useMemo(
    () => (
      <div className="grid grid-cols-3 gap-2 pr-3">
        {Images.map((image, index) => (
          <ImageItem
            key={`${image}-${index}`}
            image={image}
            index={index}
            isSelected={isImageSelected(image)}
            onSelect={handleImageSelect}
          />
        ))}
      </div>
    ),
    [Images, isImageSelected, handleImageSelect]
  );

  return (
    <div className="w-full">
      {/* Error Message */}
      {selectionError && (
        <div className="mb-2 rounded p-2 text-xs text-red-400">{selectionError}</div>
      )}

      <div className="overflow-y-auto" style={{ maxHeight: '180px' }}>
        {ImagesGrid}
      </div>
    </div>
  );
};

const ImageItem = ({ image, index, isSelected, onSelect }) => {
  const [imageError, setImageError] = useState(false);

  const handleClick = () => onSelect(image);
  const handleError = () => setImageError(true);

  const containerClasses = `
    relative cursor-pointer rounded-lg border-2 p-2 transition-all duration-200
    hover:shadow-sm
    ${
      isSelected
        ? 'border-blue-500 bg-blue-500/10'
        : 'border-[#333] bg-[#1E1E1E] hover:border-[#555]'
    }
  `;

  return (
    <div onClick={handleClick} className={containerClasses} style={{ height: '80px' }}>
      <div className="flex h-full w-full items-center justify-center">
        {!imageError ? (
          <img
            src={image}
            className="max-h-10 max-w-full object-contain"
            alt={`Image ${index + 1}`}
            onError={handleError}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
            Image
          </div>
        )}
      </div>

      {isSelected && <SelectionIndicator />}
    </div>
  );
};

const SelectionIndicator = () => (
  <div className="absolute -top-1 -right-1">
    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500">
      <CheckIcon />
    </div>
  </div>
);

const CheckIcon = () => (
  <svg className="h-2 w-2 text-white" fill="currentColor" viewBox="0 0 20 20">
    <path
      fillRule="evenodd"
      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
      clipRule="evenodd"
    />
  </svg>
);

export default ShowProductImages;
