import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Download,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
  Settings,
  Image as ImageIcon,
  Crop,
  Palette,
  Sliders,
  Check,
  RefreshCw,
  Ruler,
  FileImage,
  Sparkles,
  Contrast,
  Sun,
  Droplets,
  Grid,
  Layers,
  Wand2,
  Shield,
  Clock,
  HardDrive,
  Instagram,
  Facebook,
  Twitter,
  Youtube,
  Monitor,
  Smartphone,
} from 'lucide-react';
import getCookies from '@/utils/getCookies';

const HOST = import.meta.env.VITE_SOCKET_URL;

const ASPECT_RATIOS = [
  {
    label: 'Original',
    value: 'original',
    width: 0,
    height: 0,
    category: 'basic',
    premium: false,
    icon: <FileImage className="h-5 w-5" />,
  },
  {
    label: 'Square',
    value: '1:1',
    width: 1080,
    height: 1080,
    category: 'social',
    icon: <div className="h-5 w-5 rounded-sm bg-gradient-to-br from-gray-400 to-gray-600" />,
    premium: false,
  },
  {
    label: 'Portrait',
    value: '4:5',
    width: 1080,
    height: 1350,
    category: 'social',
    icon: <Smartphone className="h-5 w-5" />,
    premium: false,
  },
  {
    label: 'Cinematic',
    value: '21:9',
    width: 2560,
    height: 1080,
    category: 'premium',
    icon: <Monitor className="h-5 w-5" />,
    premium: true,
  },
  {
    label: 'Landscape',
    value: '16:9',
    width: 1920,
    height: 1080,
    category: 'display',
    icon: <Monitor className="h-5 w-5" />,
    premium: false,
  },
  {
    label: 'Story',
    value: '9:16',
    width: 1080,
    height: 1920,
    category: 'social',
    icon: <Smartphone className="h-5 w-5 rotate-90" />,
    premium: false,
  },
  {
    label: 'Facebook Cover',
    value: '1.91:1',
    width: 1200,
    height: 628,
    category: 'social',
    icon: <Facebook className="h-5 w-5" />,
    premium: false,
  },
  {
    label: 'Instagram Post',
    value: 'ig-1:1',
    width: 1080,
    height: 1080,
    category: 'social',
    icon: <Instagram className="h-5 w-5" />,
    premium: false,
  },
  {
    label: 'Twitter Header',
    value: 'twitter-3:1',
    width: 1500,
    height: 500,
    category: 'social',
    icon: <Twitter className="h-5 w-5" />,
    premium: true,
  },
  {
    label: 'YouTube Thumbnail',
    value: 'yt-16:9',
    width: 1280,
    height: 720,
    category: 'marketing',
    icon: <Youtube className="h-5 w-5" />,
    premium: false,
  },
];

const QUALITY_OPTIONS = [
  {
    label: 'Maximum',
    value: 1.0,
    description: 'Best quality, larger file',
    color: 'from-green-500 to-emerald-500',
    size: 'Large',
    premium: false,
  },
  {
    label: 'Balanced',
    value: 0.8,
    description: 'Recommended for web',
    color: 'from-blue-500 to-cyan-500',
    size: 'Medium',
    premium: false,
  },
  {
    label: 'Optimized',
    value: 0.6,
    description: 'Smaller file size',
    color: 'from-orange-500 to-amber-500',
    size: 'Small',
    premium: false,
  },
  {
    label: 'Ultra Premium',
    value: 0.95,
    description: 'Professional grade',
    color: 'from-purple-500 to-pink-500',
    size: 'Ultra',
    premium: true,
  },
];

const FORMAT_OPTIONS = [
  {
    label: 'PNG',
    value: 'png',
    description: 'Lossless transparency',
    color: 'from-blue-500 to-purple-500',
    premium: false,
  },
  {
    label: 'JPEG',
    value: 'jpeg',
    description: 'Web standard format',
    color: 'from-green-500 to-teal-500',
    premium: false,
  },
  {
    label: 'WEBP',
    value: 'webp',
    description: 'Modern compression',
    color: 'from-purple-500 to-pink-500',
    premium: false,
  },
  {
    label: 'AVIF',
    value: 'avif',
    description: 'Next-gen format',
    color: 'from-red-500 to-orange-500',
    premium: true,
  },
];

const FILTER_PRESETS = [
  {
    name: 'Original',
    value: 'none',
    class: '',
    color: 'from-gray-600 to-gray-400',
    premium: false,
  },
  {
    name: 'Warm Sun',
    value: 'warm',
    class: 'sepia(0.3) hue-rotate(-10deg) saturate(1.1)',
    color: 'from-orange-500 to-amber-500',
    premium: false,
  },
  {
    name: 'Arctic',
    value: 'cool',
    class: 'hue-rotate(180deg) saturate(0.9) brightness(1.05)',
    color: 'from-blue-500 to-cyan-500',
    premium: false,
  },
  {
    name: 'Vintage',
    value: 'vintage',
    class: 'sepia(0.4) hue-rotate(-15deg) contrast(1.1)',
    color: 'from-yellow-600 to-orange-600',
    premium: false,
  },
  {
    name: 'Monochrome',
    value: 'bw',
    class: 'grayscale(1) contrast(1.1)',
    color: 'from-gray-700 to-gray-500',
    premium: false,
  },
  {
    name: 'Cinematic',
    value: 'enhanced',
    class: 'contrast(1.2) brightness(1.05) saturate(1.1)',
    color: 'from-purple-500 to-pink-500',
    premium: false,
  },
  {
    name: 'Neon',
    value: 'neon',
    class: 'hue-rotate(90deg) saturate(1.4) contrast(1.3)',
    color: 'from-green-400 to-cyan-400',
    premium: true,
  },
  {
    name: 'Golden Hour',
    value: 'golden',
    class: 'sepia(0.2) hue-rotate(-20deg) saturate(1.3) brightness(1.1)',
    color: 'from-yellow-400 to-orange-400',
    premium: true,
  },
];

const ImageFormatDialog = ({ isOpen, onClose, imageUrl, onDownload, defaultFormat = 'png' }) => {
  const [selectedRatio, setSelectedRatio] = useState('original');
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });
  const [quality, setQuality] = useState(0.8);
  const [format, setFormat] = useState(defaultFormat);
  const [filter, setFilter] = useState('none');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activeTab, setActiveTab] = useState('crop');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presetHistory, setPresetHistory] = useState([]);
  const [estimatedSize, setEstimatedSize] = useState('Calculating...');
  const canvasRef = useRef(null);
  const imageRef = useRef(new Image());

  useEffect(() => {
    if (isOpen && imageUrl) {
      loadImage();
    }
  }, [isOpen, imageUrl]);

  useEffect(() => {
    if (isImageLoaded) {
      calculateFileSize();
    }
  }, [selectedRatio, format, quality, isImageLoaded, filter, brightness, contrast, saturation]);

  const calculateFileSize = async () => {
    if (!isImageLoaded || !canvasRef.current) {
      setEstimatedSize('Calculating...');
      return;
    }

    try {
      const canvas = canvasRef.current;

      // Get the actual blob to calculate real file size
      const blob = await new Promise((resolve) => {
        const mimeType =
          format === 'png'
            ? 'image/png'
            : format === 'webp'
              ? 'image/webp'
              : format === 'avif'
                ? 'image/avif'
                : 'image/jpeg';

        if (format === 'avif') {
          // AVIF might not be supported in all browsers, fallback to JPEG
          canvas.toBlob(resolve, 'image/jpeg', quality);
        } else {
          canvas.toBlob(resolve, mimeType, format === 'png' ? undefined : quality);
        }
      });

      if (blob) {
        const sizeInBytes = blob.size;

        if (sizeInBytes > 1024 * 1024) {
          setEstimatedSize(`${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`);
        } else if (sizeInBytes > 1024) {
          setEstimatedSize(`${Math.round(sizeInBytes / 1024)} KB`);
        } else {
          setEstimatedSize(`${Math.round(sizeInBytes)} B`);
        }
      } else {
        setEstimatedSize('Unknown');
      }
    } catch (error) {
      console.error('Error calculating file size:', error);
      setEstimatedSize('Error');
    }
  };

  const loadImage = async () => {
    if (!imageUrl) return;

    setIsImageLoaded(false);
    setImageError(false);

    try {
      const proxyUrl = `${HOST}/adsgpt/img/preview?url=${encodeURIComponent(imageUrl)}`;

      const response = await fetch(proxyUrl, {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
        },
        mode: 'cors',
      });

      if (!response.ok) throw new Error(`Failed to load image: ${response.status}`);

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const img = imageRef.current;
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        setIsImageLoaded(true);
        setImageError(false);
        drawImage();
        calculateFileSize();
        URL.revokeObjectURL(objectUrl);
      };

      img.onerror = () => {
        setImageError(true);
        setIsImageLoaded(false);
        URL.revokeObjectURL(objectUrl);
      };

      img.src = objectUrl;
    } catch (error) {
      console.error('Error loading image:', error);
      setImageError(true);
      setIsImageLoaded(false);
    }
  };

  const drawImage = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;

    if (!canvas || !img || !isImageLoaded) return;

    const ctx = canvas.getContext('2d');
    const { width: outputWidth, height: outputHeight } = getOutputDimensions();

    canvas.width = outputWidth;
    canvas.height = outputHeight;

    // Set canvas background based on format
    if (format === 'png' || format === 'webp') {
      ctx.clearRect(0, 0, outputWidth, outputHeight);
    } else {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, outputWidth, outputHeight);
    }

    const imgAspectRatio = img.width / img.height;
    const outputAspectRatio = outputWidth / outputHeight;

    let drawWidth, drawHeight;

    if (imgAspectRatio > outputAspectRatio) {
      drawWidth = outputWidth * scale;
      drawHeight = drawWidth / imgAspectRatio;
    } else {
      drawHeight = outputHeight * scale;
      drawWidth = drawHeight * imgAspectRatio;
    }

    ctx.save();
    ctx.translate(outputWidth / 2, outputHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);

    const filterValue = getFilterValue();
    ctx.filter = filterValue;

    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
  };

  const getFilterValue = () => {
    const baseFilter = FILTER_PRESETS.find((f) => f.value === filter)?.class || '';
    const adjustments = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    return `${baseFilter} ${adjustments}`.trim();
  };

  const getOutputDimensions = () => {
    const img = imageRef.current;

    if (selectedRatio === 'original' || !isImageLoaded) {
      return { width: img.width || 800, height: img.height || 600 };
    }

    const ratio = ASPECT_RATIOS.find((r) => r.value === selectedRatio);
    return ratio && ratio.value !== 'original'
      ? { width: ratio.width, height: ratio.height }
      : { width: img.width || 800, height: img.height || 600 };
  };

  const handleDownload = async () => {
    if (!canvasRef.current || !isImageLoaded) return;

    setIsProcessing(true);
    try {
      drawImage(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const canvas = canvasRef.current;
      const blob = await new Promise((resolve) => {
        const mimeType =
          format === 'png'
            ? 'image/png'
            : format === 'webp'
              ? 'image/webp'
              : format === 'avif'
                ? 'image/avif'
                : 'image/jpeg';

        if (format === 'avif') {
          canvas.toBlob(resolve, 'image/jpeg', quality);
        } else {
          canvas.toBlob(resolve, mimeType, format === 'png' ? undefined : quality);
        }
      });

      if (blob) {
        const timestamp = new Date().toISOString().split('T')[0];
        const dimensions = getOutputDimensions();
        const filename = `creative-${dimensions.width}x${dimensions.height}-${timestamp}.${format}`;

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // Update estimated size with actual size
        const actualSize = blob.size;
        let actualSizeFormatted;
        if (actualSize > 1024 * 1024) {
          actualSizeFormatted = `${(actualSize / (1024 * 1024)).toFixed(1)} MB`;
        } else if (actualSize > 1024) {
          actualSizeFormatted = `${Math.round(actualSize / 1024)} KB`;
        } else {
          actualSizeFormatted = `${Math.round(actualSize)} B`;
        }

        // Save to preset history with actual size
        const preset = {
          format,
          quality: quality * 100,
          aspectRatio: selectedRatio,
          dimensions,
          rotation,
          scale,
          flip,
          filter,
          brightness,
          contrast,
          saturation,
          actualSize: actualSizeFormatted,
          timestamp: new Date().toISOString(),
        };

        setPresetHistory((prev) => [preset, ...prev.slice(0, 4)]);

        onDownload?.(preset);

        // Show success message with actual file size
        console.log(`Downloaded: ${filename} (${actualSizeFormatted})`);
      }
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        onClose();
      }, 300);
    }
  };

  const handleReset = () => {
    setSelectedRatio('original');
    setRotation(0);
    setScale(1);
    setFlip({ horizontal: false, vertical: false });
    setQuality(0.8);
    setFilter('none');
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
  };

  const applyPreset = (preset) => {
    setSelectedRatio(preset.aspectRatio);
    setRotation(preset.rotation);
    setScale(preset.scale);
    setFlip(preset.flip);
    setQuality(preset.quality / 100);
    setFilter(preset.filter);
    setBrightness(preset.brightness);
    setContrast(preset.contrast);
    setSaturation(preset.saturation);
  };

  const rotateImage = (degrees) => setRotation((prev) => (prev + degrees) % 360);
  const zoomImage = (factor) => setScale((prev) => Math.max(0.1, Math.min(5, prev + factor)));

  useEffect(() => {
    if (isImageLoaded) drawImage();
  }, [
    selectedRatio,
    rotation,
    scale,
    flip,
    quality,
    format,
    filter,
    brightness,
    contrast,
    saturation,
    isImageLoaded,
  ]);

  const tabs = [
    // {
    //   id: 'crop',
    //   label: 'Layout',
    //   icon: Crop,
    //   description: 'Dimensions & Orientation',
    //   color: 'from-blue-500 to-cyan-500',
    // },
    // {
    //   id: 'adjust',
    //   label: 'Enhance',
    //   icon: Sliders,
    //   description: 'Image Quality',
    //   color: 'from-green-500 to-emerald-500',
    // },
    // {
    //   id: 'filters',
    //   label: 'Style',
    //   icon: Palette,
    //   description: 'Visual Effects',
    //   color: 'from-purple-500 to-pink-500',
    // },
    {
      id: 'export',
      label: 'Export',
      icon: FileImage,
      description: 'Output Settings',
      color: 'from-orange-500 to-amber-500',
    },
    // {
    //   id: 'presets',
    //   label: 'Presets',
    //   icon: Layers,
    //   description: 'Saved Configurations',
    //   color: 'from-indigo-500 to-blue-500',
    // },
  ];

  const PremiumBadge = () => (
    <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 px-2 py-1 text-xs font-semibold text-black shadow-lg">
      <Sparkles className="h-3 w-3" />
      PRO
    </div>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          {/* Enhanced Glass Background - Matching AdGalleryCard */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-br from-gray-900/80 via-gray-800/60 to-gray-900/80"
          />
          <div className="absolute inset-0 bg-black/40 backdrop-blur-3xl" />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            className="max-w-8xl relative flex h-[95vh] w-full flex-col overflow-hidden rounded-3xl border border-gray-700 bg-gradient-to-br from-gray-900/80 via-gray-800/60 to-gray-900/80 shadow-2xl backdrop-blur-2xl"
          >
            {/* Glassmorphic Header - Updated to match AdGalleryCard */}
            <div className="relative flex items-center justify-between border-b border-gray-600 bg-gradient-to-r from-gray-800/40 to-gray-900/40 p-6 backdrop-blur-xl">
              <div className="absolute inset-0 rounded-t-3xl bg-gradient-to-r from-blue-500/5 to-purple-500/5" />
              <div className="relative z-10 flex items-center gap-4">
                <div className="relative">
                  <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/20 via-purple-600/20 to-cyan-500/20 p-3 shadow-2xl backdrop-blur-xl">
                    <ImageIcon className="h-7 w-7 text-white" />
                  </div>
                  <motion.div
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full border-2 border-gray-900 bg-green-400 shadow-lg"
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </div>
                <div>
                  <h1 className="bg-gradient-to-r from-white to-gray-300 bg-clip-text text-2xl font-bold text-transparent">
                    Customize Image
                  </h1>
                  <p className="flex items-center gap-2 text-sm text-gray-300/80">
                    <Shield className="h-3 w-3 text-green-400" />
                    AdsGpt Professional image Customizing suite
                  </p>
                </div>
              </div>

              <div className="relative z-10 flex items-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="group rounded-2xl border border-gray-600 p-3 backdrop-blur-sm transition-all duration-200 hover:bg-red-500/20"
                >
                  <X className="h-5 w-5 text-gray-300 group-hover:text-red-300" />
                </motion.button>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Enhanced Preview Panel with Glass Effect */}
              <div className="relative flex flex-1 items-center justify-center p-8">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5" />
                <div className="bg-grid-white/[0.02] absolute inset-0 bg-[size:60px_60px]" />

                <div className="relative w-full max-w-4xl rounded-3xl border border-gray-600 bg-gray-800/20 p-8 shadow-2xl backdrop-blur-xl">
                  {!isImageLoaded && !imageError && (
                    <div className="flex h-96 w-full flex-col items-center justify-center">
                      <motion.div
                        animate={{ rotate: 360, scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        className="relative mb-6 h-20 w-20 rounded-full border-4 border-blue-400/50 border-t-blue-400"
                      >
                        <div className="absolute inset-0 animate-pulse rounded-full border-4 border-purple-400/30 border-b-purple-400" />
                      </motion.div>
                      <p className="text-lg text-gray-300">Loading creative asset...</p>

                      <p className="flex items-center gap-1 text-sm text-gray-300/80">
                        <Shield className="h-3 w-3 text-green-400" />
                        Preparing AdsGpt professional editing tools
                      </p>
                    </div>
                  )}

                  {imageError && (
                    <div className="flex h-96 w-full flex-col items-center justify-center text-center">
                      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl border border-red-400/30 bg-red-500/20 backdrop-blur-sm">
                        <X className="h-12 w-12 text-red-300" />
                      </div>
                      <h3 className="mb-3 text-2xl font-semibold text-white">Asset Unavailable</h3>
                      <p className="mb-6 max-w-md text-gray-300">
                        Unable to load the creative content. Please check the URL or try again.
                      </p>
                      <div className="flex gap-4">
                        <button
                          onClick={loadImage}
                          className="flex items-center gap-2 rounded-2xl border border-gray-600 bg-gradient-to-r from-blue-500/90 to-purple-600/90 px-8 py-3 text-white shadow-lg backdrop-blur-sm transition-all duration-200 hover:from-blue-600/90 hover:to-purple-700/90 hover:shadow-xl"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Retry Loading
                        </button>
                        <button
                          onClick={onClose}
                          className="rounded-2xl border border-gray-600 bg-white/5 px-8 py-3 text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <canvas
                    ref={canvasRef}
                    className={`shadow-3xl mx-auto rounded-2xl transition-all duration-500 ${!isImageLoaded || imageError ? 'hidden' : 'block'}`}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '70vh',
                      width: 'auto',
                      height: 'auto',
                      boxShadow:
                        '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.1)',
                    }}
                  />

                  {isImageLoaded && !imageError && (
                    <motion.div
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      className="absolute bottom-6 left-1/2 flex -translate-x-1/2 transform gap-3 rounded-2xl border border-gray-600 bg-gray-800/40 p-4 shadow-2xl backdrop-blur-xl"
                    >
                      {[
                        {
                          icon: RotateCw,
                          action: () => rotateImage(-90),
                          label: 'Rotate Left',
                          transform: 'rotate-90',
                        },
                        {
                          icon: RotateCw,
                          action: () => rotateImage(90),
                          label: 'Rotate Right',
                          transform: '-rotate-90',
                        },
                        {
                          icon: FlipHorizontal,
                          action: () =>
                            setFlip((prev) => ({ ...prev, horizontal: !prev.horizontal })),
                          label: 'Flip Horizontal',
                        },
                        {
                          icon: FlipVertical,
                          action: () => setFlip((prev) => ({ ...prev, vertical: !prev.vertical })),
                          label: 'Flip Vertical',
                        },
                        { icon: ZoomOut, action: () => zoomImage(-0.1), label: 'Zoom Out' },
                        { icon: ZoomIn, action: () => zoomImage(0.1), label: 'Zoom In' },
                      ].map(({ icon: Icon, action, label, transform }) => (
                        <motion.button
                          key={label}
                          whileHover={{ scale: 1.15, y: -2 }}
                          whileTap={{ scale: 0.85 }}
                          onClick={action}
                          className="group relative rounded-xl border border-gray-600 bg-white/5 p-3 backdrop-blur-sm transition-all duration-200 hover:bg-white/10"
                          title={label}
                        >
                          <Icon
                            className={`h-5 w-5 text-gray-300 group-hover:text-white ${transform || ''}`}
                          />
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 transform rounded-lg border border-gray-600 bg-gray-900/90 px-3 py-2 text-xs whitespace-nowrap text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100">
                            {label}
                            <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1 rotate-45 transform border-r border-b border-gray-600 bg-gray-900/90" />
                          </div>
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Enhanced Glassmorphic Controls Panel */}
              <div className="relative flex w-96 flex-col border-l border-gray-600 bg-gradient-to-b from-gray-800/40 to-gray-900/40 backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/3 via-transparent to-purple-500/3" />

                {/* Enhanced Tab Navigation */}
                <div className="relative z-10 flex border-b border-gray-600 bg-gray-800/20 p-2">
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <motion.button
                        key={tab.id}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setActiveTab(tab.id)}
                        className={`mx-1 flex flex-1 flex-col items-center rounded-xl border p-3 backdrop-blur-sm transition-all duration-200 ${
                          activeTab === tab.id
                            ? `bg-gradient-to-r ${tab.color} border-transparent text-white shadow-lg`
                            : 'border-gray-600 text-gray-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <Icon className="mb-1 h-5 w-5" />
                        <div className="text-xs font-medium">{tab.label}</div>
                      </motion.button>
                    );
                  })}
                </div>

                <div className="custom-scrollbar relative z-10 flex-1 overflow-y-auto p-6">
                  {/* {activeTab === 'crop' && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-4 flex items-center gap-3 text-lg font-semibold text-white">
                          <div className="rounded-lg border border-gray-600 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 p-2 backdrop-blur-sm">
                            <Crop className="h-4 w-4 text-blue-300" />
                          </div>
                          Canvas Layout
                        </h3>
                        <div className="grid gap-3">
                          {ASPECT_RATIOS.map((ratio) => (
                            <motion.button
                              key={ratio.value}
                              whileHover={{ scale: 1.02, y: -2 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => setSelectedRatio(ratio.value)}
                              disabled={!isImageLoaded}
                              className={`relative overflow-hidden rounded-2xl border p-4 text-left backdrop-blur-sm transition-all duration-200 ${
                                selectedRatio === ratio.value
                                  ? 'border-blue-400 bg-blue-500/20 text-white shadow-lg shadow-blue-500/20'
                                  : 'border-gray-600 bg-white/5 text-gray-300 hover:border-gray-500 hover:bg-white/10'
                              } ${!isImageLoaded ? 'cursor-not-allowed opacity-50' : ''}`}
                            >
                              {ratio.premium && <PremiumBadge />}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="text-blue-300">{ratio.icon}</div>
                                  <div>
                                    <div className="font-medium">{ratio.label}</div>
                                    <div className="text-xs text-gray-400 capitalize">
                                      {ratio.category}
                                    </div>
                                  </div>
                                </div>
                                {ratio.width > 0 && (
                                  <span className="rounded-lg border border-gray-600 bg-black/30 px-3 py-1 font-mono text-sm text-gray-400">
                                    {ratio.width}×{ratio.height}
                                  </span>
                                )}
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'adjust' && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-4 flex items-center gap-3 text-lg font-semibold text-white">
                          <div className="rounded-lg border border-gray-600 bg-gradient-to-r from-green-500/20 to-emerald-500/20 p-2 backdrop-blur-sm">
                            <Sliders className="h-4 w-4 text-green-300" />
                          </div>
                          Image Enhancement
                        </h3>
                        <div className="space-y-6">
                          {[
                            {
                              label: 'Brightness',
                              value: brightness,
                              onChange: setBrightness,
                              icon: Sun,
                              color: 'from-yellow-400 to-orange-500',
                            },
                            {
                              label: 'Contrast',
                              value: contrast,
                              onChange: setContrast,
                              icon: Contrast,
                              color: 'from-purple-500 to-pink-500',
                            },
                            {
                              label: 'Saturation',
                              value: saturation,
                              onChange: setSaturation,
                              icon: Droplets,
                              color: 'from-blue-500 to-cyan-500',
                            },
                          ].map(({ label, value, onChange, icon: Icon, color }) => (
                            <div key={label} className="space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-gray-300">
                                  <Icon className="h-4 w-4" />
                                  <span className="text-sm font-medium">{label}</span>
                                </div>
                                <span className="rounded-lg border border-gray-600 bg-black/30 px-3 py-1 font-mono text-sm text-gray-400">
                                  {value}%
                                </span>
                              </div>
                              <div className="relative">
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={value}
                                  onChange={(e) => onChange(Number(e.target.value))}
                                  className="slider-thumb h-2 w-full cursor-pointer appearance-none rounded-lg border border-gray-600 bg-gray-600/30"
                                />
                                <div
                                  className={`absolute top-0 left-0 h-2 bg-gradient-to-r ${color} pointer-events-none rounded-lg`}
                                  style={{ width: `${value}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'filters' && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-4 flex items-center gap-3 text-lg font-semibold text-white">
                          <div className="rounded-lg border border-gray-600 bg-gradient-to-r from-purple-500/20 to-pink-500/20 p-2 backdrop-blur-sm">
                            <Palette className="h-4 w-4 text-purple-300" />
                          </div>
                          Visual Style
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                          {FILTER_PRESETS.map((preset) => (
                            <motion.button
                              key={preset.value}
                              whileHover={{ scale: 1.05, y: -2 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setFilter(preset.value)}
                              className={`group relative overflow-hidden rounded-2xl border p-4 backdrop-blur-sm transition-all duration-200 ${
                                filter === preset.value
                                  ? 'border-purple-400 bg-purple-500/20 text-white shadow-lg shadow-purple-500/20'
                                  : 'border-gray-600 bg-white/5 text-gray-300 hover:border-gray-500 hover:bg-white/10'
                              }`}
                            >
                              {preset.premium && <PremiumBadge />}
                              <div
                                className={`absolute inset-0 bg-gradient-to-br ${preset.color} rounded-2xl opacity-10`}
                              />
                              <div className="relative flex items-center justify-between">
                                <span className="text-sm font-medium">{preset.name}</span>
                                {filter === preset.value && (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 shadow-lg"
                                  >
                                    <Check className="h-3 w-3 text-white" />
                                  </motion.div>
                                )}
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )} */}

                  {activeTab === 'export' && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-4 flex items-center gap-3 text-lg font-semibold text-white">
                          <div className="rounded-lg border border-gray-600 bg-gradient-to-r from-orange-500/20 to-amber-500/20 p-2 backdrop-blur-sm">
                            <FileImage className="h-4 w-4 text-orange-300" />
                          </div>
                          Export Configuration
                        </h3>

                        <div className="space-y-6">
                          <div>
                            <label className="mb-3 block text-sm font-medium text-gray-300">
                              File Format
                            </label>
                            <div className="grid gap-3">
                              {FORMAT_OPTIONS.map((option) => (
                                <motion.button
                                  key={option.value}
                                  whileHover={{ scale: 1.02, y: -1 }}
                                  whileTap={{ scale: 0.98 }}
                                  onClick={() => setFormat(option.value)}
                                  className={`relative overflow-hidden rounded-2xl border p-4 text-left backdrop-blur-sm transition-all duration-200 ${
                                    format === option.value
                                      ? 'border-blue-400 bg-blue-500/20 text-white shadow-lg'
                                      : 'border-gray-600 bg-white/5 text-gray-300 hover:border-gray-500'
                                  }`}
                                >
                                  {option.premium && <PremiumBadge />}
                                  <div className="relative flex items-center justify-between">
                                    <div>
                                      <div className="font-medium">{option.label}</div>
                                      <div className="mt-1 text-sm text-gray-400">
                                        {option.description}
                                      </div>
                                    </div>
                                    <div
                                      className={`h-3 w-3 rounded-full bg-gradient-to-r ${option.color}`}
                                    />
                                  </div>
                                </motion.button>
                              ))}
                            </div>
                          </div>

                          {(format === 'jpeg' || format === 'webp' || format === 'avif') && (
                            <div>
                              <label className="mb-3 block text-sm font-medium text-gray-300">
                                Quality Preset
                              </label>
                              <div className="space-y-2">
                                {QUALITY_OPTIONS.map((option) => (
                                  <motion.button
                                    key={option.value}
                                    whileHover={{ scale: 1.02, y: -1 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => setQuality(option.value)}
                                    className={`relative w-full rounded-2xl border p-4 text-left backdrop-blur-sm transition-all duration-200 ${
                                      quality === option.value
                                        ? 'border-green-400 bg-green-500/20 text-white shadow-lg'
                                        : 'border-gray-600 bg-white/5 text-gray-300 hover:border-gray-500'
                                    }`}
                                  >
                                    {option.premium && <PremiumBadge />}
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <div className="font-medium">{option.label}</div>
                                        <div className="text-sm text-gray-400">
                                          {option.description}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="rounded border border-gray-600 bg-black/30 px-2 py-1 text-xs text-gray-400">
                                          {option.size}
                                        </span>
                                        <div
                                          className={`h-3 w-3 rounded-full bg-gradient-to-r ${option.color}`}
                                        />
                                      </div>
                                    </div>
                                  </motion.button>
                                ))}
                              </div>
                            </div>
                          )}

                          {isImageLoaded && (
                            <div className="rounded-2xl border border-gray-600 bg-white/5 p-4 backdrop-blur-sm">
                              <h4 className="mb-3 flex items-center gap-2 font-medium text-white">
                                <Ruler className="h-4 w-4 text-blue-300" />
                                Output Specifications
                              </h4>
                              <div className="space-y-3 text-sm text-gray-300">
                                <div className="flex items-center justify-between">
                                  <span>Dimensions:</span>
                                  <span className="rounded border border-gray-600 bg-black/30 px-3 py-1 font-mono font-semibold">
                                    {getOutputDimensions().width} × {getOutputDimensions().height}px
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span>Format:</span>
                                  <span className="rounded border border-gray-600 bg-black/30 px-3 py-1 font-semibold">
                                    {format.toUpperCase()}
                                  </span>
                                </div>
                                {(format === 'jpeg' || format === 'webp' || format === 'avif') && (
                                  <div className="flex items-center justify-between">
                                    <span>Quality:</span>
                                    <span className="rounded border border-gray-600 bg-black/30 px-3 py-1 font-semibold">
                                      {Math.round(quality * 100)}%
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between">
                                  <span>Estimated Size:</span>
                                  <span className="flex items-center gap-1 rounded border border-gray-600 bg-black/30 px-3 py-1 font-semibold text-green-300">
                                    <HardDrive className="h-3 w-3" />
                                    {estimatedSize}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* {activeTab === 'presets' && presetHistory.length > 0 && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-4 flex items-center gap-3 text-lg font-semibold text-white">
                          <div className="rounded-lg border border-gray-600 bg-gradient-to-r from-indigo-500/20 to-blue-500/20 p-2 backdrop-blur-sm">
                            <Layers className="h-4 w-4 text-indigo-300" />
                          </div>
                          Recent Presets
                        </h3>
                        <div className="space-y-3">
                          {presetHistory.map((preset, index) => (
                            <motion.button
                              key={index}
                              whileHover={{ scale: 1.02, x: 5 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => applyPreset(preset)}
                              className="group w-full rounded-2xl border border-gray-600 bg-white/5 p-4 text-left backdrop-blur-sm transition-all duration-200 hover:bg-white/10"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-white transition-colors group-hover:text-blue-300">
                                    Preset {index + 1}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-400">
                                    <span className="whitespace-nowrap">
                                      {preset.dimensions.width}×{preset.dimensions.height}
                                    </span>
                                    <span className="whitespace-nowrap">•</span>
                                    <span className="whitespace-nowrap">
                                      {preset.format.toUpperCase()}
                                    </span>
                                    <span className="whitespace-nowrap">•</span>
                                    <span className="whitespace-nowrap">
                                      {preset.quality}% quality
                                    </span>
                                    {preset.actualSize && (
                                      <span className="whitespace-nowrap">
                                        <span>•</span>
                                        <span className="text-green-300">{preset.actualSize}</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs whitespace-nowrap text-gray-500">
                                  <Clock className="h-3 w-3" />
                                  {new Date(preset.timestamp).toLocaleTimeString()}
                                </div>
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )} */}
                </div>

                {/* Enhanced Glass Action Buttons */}
                <div className="relative z-10 border-t border-gray-600 bg-gray-800/20 p-6 backdrop-blur-lg">
                  <div className="flex gap-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleReset}
                      disabled={!isImageLoaded}
                      className="flex flex-1 items-center justify-center gap-3 rounded-2xl border border-gray-600 px-6 py-4 text-gray-300 backdrop-blur-sm transition-all duration-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reset All
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleDownload}
                      disabled={isProcessing || !isImageLoaded || imageError}
                      className="relative flex flex-1 items-center justify-center gap-3 overflow-hidden rounded-2xl border border-gray-600 bg-gradient-to-r from-blue-500/80 to-cyan-500/10 px-6 py-1 text-white shadow-2xl shadow-blue-500/25 backdrop-blur-sm transition-all duration-200 hover:from-cyan-500/10 hover:to-blue-500/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent" />
                      {isProcessing ? (
                        <>
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                            className="h-5 w-5 rounded-full border-2 border-white border-t-transparent"
                          />
                          <span className="relative">Processing...</span>
                        </>
                      ) : (
                        <>
                          <Download className="relative h-5 w-5" />
                          <span className="relative">Export Creative</span>
                        </>
                      )}
                    </motion.button>
                  </div>

                  {isImageLoaded && (
                    <div className="mt-4 rounded-xl border border-green-400/20 bg-green-500/10 p-3 backdrop-blur-sm">
                      <div className="flex items-center justify-between text-xs text-green-300">
                        <span>AdsGpt Image Customizer</span>
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          Ready for export
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ImageFormatDialog;
