import React, { useRef, useState, useEffect } from 'react';
import { Formik, Form, FieldArray, useFormikContext } from 'formik';
import * as Yup from 'yup';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Plus,
  X,
  Link as LinkIcon,
  ClipboardPaste,
  Globe,
  Image as ImageIcon,
  Search,
  ArrowDown,
} from 'lucide-react';
import { uploadToS3 } from '@/utils/imageUpload';
import { useDispatch, useSelector } from 'react-redux';
import { updateAssets } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  AnalyzingsweburlForImages,
  fetchCampaignById,
  updateCampaign,
} from '@/store/actions/adFactoryNew/adFactoryActions';
// AdFactorySlice dispatches are handled via the onComplete() callback
import { useSearchParams } from 'react-router-dom';
import ShowLightBox from '../Cards/Lightbox';
import CompetitorVisualsModal from '../CompetitorVisualsModal/CompetitorVisualsModal';
import { fetchCompetitorAds } from '@/store/actions/feature/competitorSearchActions';
import { setActiveForm } from '@/store/reducers/AdFactory/AdFactorySlice';
const AD_FACTORY_WEB_URL = import.meta.env.VITE_AD_FACTORY_WEB_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const validateAssets = (assets) => {
  if (!assets || !Array.isArray(assets)) {
    return 'At least one asset is required';
  }
  if (assets.length === 0) {
    return 'At least one asset is required';
  }

  if (assets.length > 5) {
    return 'Maximum 5 assets allowed';
  }

  const invalidAssets = assets?.filter((asset) => {
    if (!asset) return true;
    return !asset.file && !asset.url;
  });

  if (invalidAssets.length > 0) {
    return 'Each asset must have either a file or URL';
  }
  return undefined;
};

// Helper function to validate if a string is a valid URL
const isValidUrl = (urlString) => {
  try {
    const url = new URL(urlString);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (_) {
    return false;
  }
};

// Helper function to check if URL is a direct image AND extract the clean image URL
const isDirectImageUrl = (url) => {
  if (!isValidUrl(url)) return { isDirect: false, cleanUrl: url };

  // Common image extensions
  const imageExtensions = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
    '.tiff',
    '.tif',
  ];
  const lowerUrl = url.toLowerCase();

  // Try to find and extract image URL from the given URL
  for (const ext of imageExtensions) {
    const extIndex = lowerUrl.indexOf(ext);
    if (extIndex !== -1) {
      // Found an image extension
      const endOfExtension = extIndex + ext.length;

      // Check what comes after the extension
      const afterExtension = lowerUrl.substring(endOfExtension);

      // If there's nothing after extension, or it starts with query/fragment, it's a direct image
      if (
        afterExtension === '' ||
        afterExtension.startsWith('?') ||
        afterExtension.startsWith('#') ||
        afterExtension.startsWith('&') ||
        afterExtension.startsWith('/')
      ) {
        // Extract clean URL up to the extension
        const cleanUrl = url.substring(0, endOfExtension);
        return { isDirect: true, cleanUrl };
      }
    }
  }

  return { isDirect: false, cleanUrl: url };
};

// Improved version that handles more complex URLs
const extractImageUrlFromAnyUrl = (url) => {
  if (!isValidUrl(url)) return url;

  const imageExtensions = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
    '.tiff',
    '.tif',
    '.ico',
    '.jfif',
    '.pjpeg',
    '.pjp',
    '.apng',
    '.avif',
    '.jxl',
  ];

  const lowerUrl = url.toLowerCase();

  // Try each extension
  for (const ext of imageExtensions) {
    const extIndex = lowerUrl.indexOf(ext);
    if (extIndex !== -1) {
      const endOfExt = extIndex + ext.length;
      const afterExt = lowerUrl.substring(endOfExt);

      // Check if extension is properly terminated (end of string or query/fragment)
      if (
        afterExt === '' ||
        afterExt.startsWith('?') ||
        afterExt.startsWith('#') ||
        afterExt.startsWith('&') ||
        afterExt.startsWith('/') ||
        // Some URLs might have parameters directly after extension without ?
        afterExt.match(/^[a-zA-Z0-9_-]*$/)
      ) {
        // Return URL up to the extension
        return url.substring(0, endOfExt);
      }
    }
  }

  // No image extension found
  return url;
};

// You can add a helper function for the UI indicator:
const getUrlType = (url) => {
  const result = isDirectImageUrl(url);
  if (result.isDirect) {
    return { type: 'direct-image', cleanUrl: result.cleanUrl };
  }

  const extracted = extractImageUrlFromAnyUrl(url);
  if (extracted !== url) {
    return { type: 'extractable-image', cleanUrl: extracted };
  }

  return { type: 'webpage', cleanUrl: url };
};

// Helper function to extract domain from URL
const getDomain = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
};

// Function to fetch image from URL and convert to File object
const urlToFile = async (url, filename) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error('URL does not point to a valid image');
    }

    // Generate a filename if not provided
    const actualFilename = filename || url.split('/').pop() || 'image.jpg';

    return new File([blob], actualFilename, { type: blob.type });
  } catch (error) {
    console.error('Error converting URL to file:', error);
    throw error;
  }
};

// Helper function to decode URL if it's encoded
const decodeUrlIfEncoded = (url) => {
  try {
    // Check if URL contains encoded characters
    const hasEncodedChars = /%[0-9A-Fa-f]{2}/.test(url);
    if (hasEncodedChars) {
      // Try to decode the URL
      const decoded = decodeURI(url);
      // Check if decoding was successful and results in a valid URL
      return decoded;
    }
    return url;
  } catch (error) {
    // If decoding fails, return original URL
    console.warn('Failed to decode URL:', url, error);
    return url;
  }
};

// Helper component to keep formik helpers in sync with parent state
const FormikHelperUpdater = ({ setFormikHelpers }) => {
  const { values, setFieldValue } = useFormikContext();

  useEffect(() => {
    setFormikHelpers({
      push: (asset) => {
        const newAssets = [...(values.assets || []), asset];
        setFieldValue('assets', newAssets);
      },
      values,
    });
  }, [values, setFieldValue, setFormikHelpers]);

  return null;
};

export default function AssetsForm({ onComplete, handleGenerateCreatives }) {
  const fileInputRef = useRef(null);
  const formContainerRef = useRef(null);
  const { userData } = useSelector((state) => state.socket);
  const { assets, productionAndServices, results } = useSelector((state) => state.adFactoryNew);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  const [showPasteHint, setShowPasteHint] = useState(false);
  const [pasteLoaderIndex, setPasteLoaderIndex] = useState(null);
  const [showImageSelector, setShowImageSelector] = useState(false);
  const [extractedImages, setExtractedImages] = useState([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [isExtractingImages, setIsExtractingImages] = useState(false);
  // Backend validation / reachability error surfaced inline under the URL
  // input (e.g. "We couldn't reach this URL right now. Try again or set up
  // manually.").
  const [urlError, setUrlError] = useState('');
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');

  // Store formik helpers reference
  const [formikHelpers, setFormikHelpers] = useState(null);

  const getInitialValues = () => {
    const urls = assets?.keyVisuals?.urls || [];
    const initialAssets = urls?.map((url) => {
      // Decode the URL when loading from backend to avoid double encoding
      const decodedUrl = decodeUrlIfEncoded(url);
      return {
        url: decodedUrl,
        tempUrl: null,
        file: null,
        name: decodedUrl.split('/').pop() || 'asset',
        isUploading: false,
        isExisting: true,
        source: 'existing', // 'existing', 'upload', 'url', 'clipboard'
      };
    });
    return {
      assets: initialAssets,
    };
  };

  const initialValues = getInitialValues();

  // Handle clipboard paste
  const handlePaste = async (event) => {
    if (!formikHelpers) return;

    const currentAssets = formikHelpers.values.assets || [];
    if (currentAssets.length >= 5) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    // 1️⃣ Check for image file
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault(); // only prevent here

        const file = item.getAsFile();
        if (!file) return;

        const tempUrl = URL.createObjectURL(file);

        formikHelpers.push({
          file,
          tempUrl,
          url: '',
          name: file.name || `pasted-${Date.now()}.png`,
          isUploading: false,
          isExisting: false,
          source: 'clipboard',
        });

        return;
      }
    }

    const text = event.clipboardData.getData('text')?.trim();
    if (!text) return;

    if (isValidUrl(text)) {
      event.preventDefault();

      const urlType = getUrlType(text);

      if (urlType.type === 'direct-image' || urlType.type === 'extractable-image') {
        formikHelpers.push({
          file: null,
          tempUrl: urlType.cleanUrl,
          url: urlType.cleanUrl,
          name: urlType.cleanUrl.split('/').pop() || 'image.jpg',
          isUploading: false,
          isExisting: false,
          source: 'url',
          originalUrl: urlType.cleanUrl,
        });
      } else {
        setUrlInput(text);
        setIsAddingUrl(true);
      }
    }
  };

  // Set up paste event listener
  useEffect(() => {
    const handleGlobalPaste = (event) => {
      if (formContainerRef.current && formContainerRef.current.contains(event.target)) {
        handlePaste(event);
      }
    };

    document.addEventListener('paste', handleGlobalPaste);

    return () => {
      document.removeEventListener('paste', handleGlobalPaste);
    };
  }, [formikHelpers]);

  // Handle URL submission - check if it's direct image or webpage
  const handleAddUrl = async (helpers) => {
    const currentAssets = helpers.form.values.assets || [];
    if (currentAssets.length >= 5) {
      setUrlInput('');
      setIsAddingUrl(false);
      return;
    }

    // Check if it's a direct image URL
    if (isDirectImageUrl(urlInput.trim()).isDirect) {
      // Handle as direct image

      const imageExtensions = [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.bmp',
        '.svg',
        '.tiff',
        '.tif',
      ];
      const lowerUrl = urlInput.trim().toLowerCase();
      let endOfExtension;
      // Try to find and extract image URL from the given URL
      for (const ext of imageExtensions) {
        const extIndex = lowerUrl.indexOf(ext);
        if (extIndex !== -1) {
          // Found an image extension
          endOfExtension = extIndex + ext.length;
        }
      }

      try {
        const tempUrl = urlInput.trim().substring(0, endOfExtension);
        const filename = urlInput.split('/').pop() || 'image.jpg';

        const newAsset = {
          file: null,
          tempUrl: tempUrl,
          url: urlInput.trim().substring(0, endOfExtension),
          name: filename,
          isUploading: false,
          isExisting: false,
          source: 'url',
          originalUrl: urlInput.trim().substring(0, endOfExtension),
        };

        helpers.push(newAsset);
        setUrlInput('');
        setIsAddingUrl(false);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoadingUrl(false);
      }
    } else {
      // It's a webpage URL - extract images from it
      setIsExtractingImages(true);
      setUrlError('');

      try {
        // `.unwrap()` rethrows the rejectWithValue payload as the catch
        // `error` so the backend's `detail` message surfaces here intact.
        const res = await dispatch(
          AnalyzingsweburlForImages({ website_url: urlInput?.trim() })
        ).unwrap();
        const result = res.data.images;

        setExtractedImages(result);
        setShowImageSelector(true);
      } catch (error) {
        console.error(error);
        const message =
          typeof error === 'string'
            ? error
            : error?.message || 'Failed to analyze website URL';
        setUrlError(message);

        // try {
        //   const tempUrl = urlInput.trim();
        //   const filename = urlInput.split('/').pop() || 'image.jpg';

        //   const newAsset = {
        //     file: null,
        //     tempUrl: tempUrl,
        //     url: urlInput.trim(),
        //     name: filename,
        //     isUploading: false,
        //     isExisting: false,
        //     source: 'url',
        //     originalUrl: urlInput.trim(),
        //   };

        //   helpers.push(newAsset);
        //   setUrlInput('');
        //   setIsAddingUrl(false);
        // } catch (fallbackError) {
        //   console.error('Fallback error:', fallbackError);
        // }
      } finally {
        setIsExtractingImages(false);
      }
    }
  };

  // Handle selecting an image from extracted images
  const handleSelectExtractedImage = (helpers, imageUrl, index) => {
    const currentAssets = helpers.form.values.assets || [];
    if (currentAssets.length >= 5) return;

    try {
      const filename = imageUrl.split('/').pop() || 'extracted-image.jpg';
      const newAsset = {
        file: null,
        tempUrl: imageUrl,
        url: imageUrl,
        name: filename,
        isUploading: false,
        isExisting: false,
        source: 'url',
        originalUrl: imageUrl,
      };

      helpers.push(newAsset);
      // setShowImageSelector(false);
      // setExtractedImages([]);
      setUrlInput('');
      setIsAddingUrl(false);
    } catch (error) {
      console.error('Error adding extracted image:', error);
    }
  };

  const handleFileSelect = async (event, helpers) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    const currentAssets = helpers.form.values.assets || [];

    if (currentAssets.length + files.length > 5) {
      event.target.value = '';
      return;
    }

    for (const file of files) {
      const tempUrl = URL.createObjectURL(file);
      const newAsset = {
        file: file,
        tempUrl: tempUrl,
        url: '',
        name: file.name,
        isUploading: false,
        isExisting: false,
        source: 'upload',
      };

      helpers.push(newAsset);
    }
    event.target.value = '';
  };

  const uploadAssets = async (assets) => {
    const uploadPromises = assets.map(async (asset) => {
      // Check if the image is from competitor/keyword search (contains 'poweradspy')
      // If so, skip the upload process and treat it as an existing asset
      if (
        (asset.url && asset.url.includes('poweradspy')) ||
        (asset.originalUrl && asset.originalUrl.includes('poweradspy'))
      ) {
        return {
          ...asset,
          url: asset.url || asset.originalUrl,
          isExisting: true,
        };
      }

      if (asset.url && (asset.isExisting || asset.source === 'url')) {
        return {
          ...asset,
          isExisting: true,
        };
      }

      if (asset.file && (asset.source === 'upload' || asset.source === 'clipboard')) {
        try {
          const uploadedUrl = await uploadToS3(asset.file, userData?.user_id, true);
          return {
            ...asset,
            file: null,
            url: `${S3_BASE_URL}${uploadedUrl}`,
            isUploading: false,
            isExisting: true,
          };
        } catch (error) {
          console.error('Upload failed:', error);
          throw new Error(`Failed to upload ${asset.name}`);
        }
      }

      if (asset.source === 'url' && asset.originalUrl) {
        try {
          const file = await urlToFile(asset.originalUrl, asset.name);
          const uploadedUrl = await uploadToS3(file, userData?.user_id, true);
          return {
            ...asset,
            file: null,
            url: `${S3_BASE_URL}${uploadedUrl}`,
            isUploading: false,
            isExisting: true,
            originalUrl: undefined,
          };
        } catch (error) {
          console.error('Failed to process URL asset:', error);
          throw new Error(`Failed to process image from URL: ${asset.originalUrl}`);
        }
      }

      throw new Error(`Invalid asset: ${asset.name}`);
    });

    return Promise.all(uploadPromises);
  };

  const handleSubmit = async (values, { setSubmitting, setErrors }) => {
    setSubmitting(true);

    try {
      const validationError = validateAssets(values.assets);
      if (validationError) {
        setErrors({ assets: validationError });
        return;
      }

      const validAssets = values?.assets || [];

      if (validAssets?.length === 0) {
        setErrors({ assets: 'No valid assets to upload' });
        return;
      }

      const uploadedAssets = await uploadAssets(validAssets);
      const assetUrls = uploadedAssets
        .map((asset) => asset.url)
        .filter((url) => url && url.trim() !== '')
        .map((url) => encodeURI(url)); // Encode each URL

      if (assetUrls.length === 0) {
        throw new Error('No assets were successfully uploaded');
      }

      const payload = {
        campaignId: campaignId,
        nodeType: 'assets',
        data: {
          keyVisuals: {
            type: 'image',
            urls: assetUrls, // Now contains encoded URLs
          },
        },
      };

      (values.assets || [])?.forEach((asset) => {
        if (asset?.tempUrl && (asset.source === 'upload' || asset.source === 'clipboard')) {
          URL.revokeObjectURL(asset.tempUrl);
        }
      });

      const result = await dispatch(updateCampaign(payload));
      const campaignPayload = {
        campaignId: campaignId,
        userId: userData?.user_id,
      };

      if (updateCampaign.fulfilled.match(result)) {
        if (onComplete) {
          onComplete();
        }
      }
    } catch (error) {
      console.error('Form submission error:', error);
      setErrors({ assets: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  function handleCloseLightbox() {
    setLightboxOpen(false);
    setLightboxImage(null);
  }

  const renderForm = ({ values, errors, touched, isSubmitting, setFieldValue, ...helpers }) => {
    const assetsArray = values.assets || [];

    return (
      <Form
        className="max-h-[calc(100svh-190px)] space-y-3.5 overflow-y-auto p-2"
        ref={formContainerRef}
      >
        <div className="flex flex-col">
          <div className="mb-2.5 flex items-center justify-between">
            <label className="mb-0.5 text-sm text-gray-500 dark:text-[#AFAFAF] 2xl:text-[18px]">
              Upload a key visual
            </label>
            <span className="text-xs text-gray-500 dark:text-[#AFAFAF] 2xl:text-sm">
              {assetsArray?.length} / 5 assets
            </span>
          </div>

          <FieldArray
            name="assets"
            render={(fieldArrayHelpers) => (
              <div className="space-y-5">
                {/* URL Input Section */}
                {/* Upload Area */}
                <div
                  className={`backdrop-blur-100 flex max-w-full items-center gap-6 overflow-x-auto rounded-[20px] border border-black/10 bg-gray-50 dark:border-gray-100/10 dark:bg-[#383838]/50 p-1.5 transition ${
                    !isSubmitting && assetsArray?.length < 5
                      ? 'cursor-pointer hover:border-black/20 hover:bg-gray-100 dark:hover:border-[#4D4D4D]/60 dark:hover:bg-[#2F2F2F]'
                      : 'cursor-pointer opacity-50'
                  }`}
                >
                  <div className="uploading flex gap-2">
                    {/* Display selected assets */}
                    {assetsArray.map((asset, index) =>
                      asset ? (
                        <div
                          key={index}
                          className="group relative h-fit w-fit overflow-hidden rounded-xl bg-gray-50 dark:bg-[#383838] p-[1px]"
                        >
                          <div className="relative">
                            {pasteLoaderIndex === index && (
                              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/70">
                                <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white"></div>
                              </div>
                            )}

                            <img
                              src={asset.tempUrl || asset.url || ''}
                              alt={`Upload ${asset.name || 'asset'}`}
                              className={`h-26 min-w-[7rem] rounded-lg object-cover 2xl:h-28 2xl:min-w-[7.99rem] ${
                                pasteLoaderIndex === index ? 'opacity-50' : ''
                              }`}
                              onClick={() => {
                                const images = assetsArray.map((a) => a.tempUrl || a.url);
                                setLightboxImages(images);
                                setLightboxImage(asset.tempUrl || asset.url || '');
                                setLightboxOpen(true);
                              }}
                            />
                          </div>

                          {/* Remove Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                asset.tempUrl &&
                                (asset.source === 'upload' || asset.source === 'clipboard')
                              ) {
                                URL.revokeObjectURL(asset.tempUrl);
                              }
                              fieldArrayHelpers.remove(index);
                            }}
                            className="absolute top-1 right-1 z-20 rounded-full bg-red-500/80 p-1 opacity-100 transition group-hover:opacity-100 hover:bg-red-600 md:opacity-0"
                            disabled={isSubmitting || pasteLoaderIndex === index}
                          >
                            <X className="h-3 w-3 text-white" />
                          </button>
                        </div>
                      ) : null
                    )}

                    {/* Show paste loader in the next empty slot */}
                    {isPasting && pasteLoaderIndex === assetsArray.length && (
                      <div className="flex min-w-[7rem] flex-col items-center justify-center gap-1 rounded-xl border border-amber-500/30 bg-gray-50 dark:bg-[#383838] px-4 py-5">
                        <div className="mb-2 h-7 w-7 animate-spin rounded-full border-2 border-amber-400 border-t-transparent 2xl:h-8 2xl:w-8"></div>
                        <span className="text-center text-xs font-medium text-amber-400 2xl:text-sm">
                          Pasting...
                        </span>
                      </div>
                    )}

                    {/* Upload box - only show if we can upload more */}
                    {assetsArray.length < 5 && !isPasting && (
                      <div
                        onClick={() => {
                          if (isSubmitting || assetsArray?.length >= 5) return;
                          fileInputRef.current?.click();
                        }}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-black/10 bg-gray-50 dark:border-white/10 dark:bg-[#383838] px-4 py-5"
                      >
                        <Plus
                          className="mb-2 h-7 w-7 text-gray-500 dark:text-[#EDE8E8] 2xl:h-8 2xl:w-8"
                          strokeWidth={2}
                        />
                        <span className="text-center text-xs font-medium text-gray-500 dark:text-[#EDE8E8] 2xl:text-sm">
                          Upload from device
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* File input with Formik context */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, fieldArrayHelpers)}
                  disabled={isSubmitting}
                />
                {/* Helper text */}
                <div className="mt-1 space-y-1">
                  <p className="text-sm text-gray-500 dark:text-[#AFAFAF] 2xl:text-base">
                    You can upload up to 5 images. Supported formats: JPG, PNG, WebP, GIF, SVG
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="h-px flex-1 bg-black/10 dark:bg-gray-100/10"></div>
                  <span className="text-xs text-gray-400 2xl:text-sm">OR</span>
                  <div className="h-px flex-1 bg-black/10 dark:bg-gray-100/10"></div>
                </div>

                <div className="space-y-2">
                  {isAddingUrl ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={urlInput}
                          onChange={(e) => {
                            setUrlInput(e.target.value);
                            if (urlError) setUrlError('');
                          }}
                          placeholder="Enter any URL (image URL or webpage)"
                          className={`flex-1 rounded-lg border bg-gray-100 text-gray-900 dark:bg-[#2F2F2F] dark:text-white px-4 py-2.5 text-sm placeholder-gray-400 focus:ring-1 focus:outline-none 2xl:text-base ${
                            urlError
                              ? 'border-red-500/60 focus:border-red-500 focus:ring-red-500/40'
                              : 'border-black/10 dark:border-gray-100/10 focus:border-[#5867EB] focus:ring-[#5867EB]'
                          }`}
                          disabled={isLoadingUrl || isExtractingImages || isSubmitting}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddUrl(fieldArrayHelpers);
                            }
                            if (e.key === 'Escape') {
                              setIsAddingUrl(false);
                              setUrlInput('');
                            }
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => handleAddUrl(fieldArrayHelpers)}
                          disabled={
                            isLoadingUrl || isExtractingImages || isSubmitting || !urlInput.trim()
                          }
                          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 2xl:text-base"
                        >
                          {isLoadingUrl || isExtractingImages ? (
                            <>
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                              {(() => {
                                const urlType = getUrlType(urlInput.trim());
                                return urlType.type === 'webpage' ? 'Analyzing...' : 'Loading...';
                              })()}
                            </>
                          ) : (
                            <>
                              {(() => {
                                const urlType = getUrlType(urlInput.trim());
                                switch (urlType.type) {
                                  case 'direct-image':
                                  case 'extractable-image':
                                    return 'Add Image';
                                  case 'webpage':
                                    return 'Analyze';
                                  default:
                                    return 'Add';
                                }
                              })()}
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingUrl(false);
                            setUrlInput('');
                            setShowImageSelector(false);
                            setExtractedImages([]);
                            setUrlError('');
                          }}
                          disabled={isLoadingUrl || isExtractingImages}
                          className="rounded-lg border border-black/10 bg-gray-100 text-gray-500 dark:border-gray-100/10 dark:bg-[#2F2F2F] dark:text-gray-300 px-4 py-2.5 text-sm transition hover:bg-gray-200 dark:hover:bg-[#383838] disabled:opacity-50 2xl:text-base"
                        >
                          Cancel
                        </button>
                      </div>

                      {urlError && (
                        <p className="text-xs text-red-500 dark:text-red-400 2xl:text-sm">
                          {urlError}
                        </p>
                      )}

                      {/* URL type indicator with extraction preview */}
                      {urlInput.trim() && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs">
                            {(() => {
                              const urlType = getUrlType(urlInput.trim());
                              switch (urlType.type) {
                                case 'direct-image':
                                  return (
                                    <div className="flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-1 text-green-400">
                                      <ImageIcon className="h-3 w-3" />
                                      <span>Direct image URL detected</span>
                                    </div>
                                  );
                                case 'extractable-image':
                                  return (
                                    <div className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-1 text-amber-400">
                                      <Search className="h-3 w-3" />
                                      <span>Image URL can be extracted</span>
                                    </div>
                                  );
                                case 'webpage':
                                  return (
                                    <div className="flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-1 text-blue-400">
                                      <Globe className="h-3 w-3" />
                                      <span>Webpage URL - will analyze for images</span>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            })()}
                          </div>

                          {/* Show extracted URL preview if applicable */}
                          {(() => {
                            const urlType = getUrlType(urlInput.trim());
                            if (
                              urlType.type === 'extractable-image' &&
                              urlType.cleanUrl !== urlInput.trim()
                            ) {
                              return (
                                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
                                  <div className="flex items-center gap-2 text-xs text-amber-300">
                                    <Search className="h-3 w-3" />
                                    <span>Will extract:</span>
                                  </div>
                                  <div className="mt-1 truncate text-xs text-amber-200">
                                    {urlType.cleanUrl}
                                  </div>
                                </div>
                              );
                            }
                          })()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                      <div className="group w-full rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-[1px] hover:bg-gradient-to-tr">
                        <button
                          type="button"
                          onClick={() => setCurrentStep(2)}
                          disabled={isSubmitting || assetsArray?.length >= 5}
                          className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/10 bg-gray-100 text-gray-500 dark:border-gray-100/10 dark:bg-[#2F2F2F] dark:text-gray-300 px-4 py-3 text-xs whitespace-nowrap transition hover:border-black/20 hover:bg-gray-200 dark:hover:border-[#4D4D4D]/60 dark:hover:bg-[#383838] disabled:opacity-50 sm:text-sm 2xl:text-base"
                        >
                          Add visuals of your competitors ads
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setIsAddingUrl(true)}
                        disabled={isSubmitting || assetsArray?.length >= 5}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/10 bg-gray-100 text-gray-500 dark:border-gray-100/10 dark:bg-[#2F2F2F] dark:text-gray-300 px-4 py-3 text-xs transition hover:border-black/20 hover:bg-gray-200 dark:hover:border-[#4D4D4D]/60 dark:hover:bg-[#383838] disabled:opacity-50 sm:text-sm 2xl:text-base"
                      >
                        <LinkIcon className="h-4 w-4" />
                        Add image from URL
                      </button>
                    </div>
                  )}

                  {isAddingUrl && (
                    <p className="text-xs text-gray-400 2xl:text-sm">
                      Tip: Enter any URL - direct image URLs (.jpg, .png, etc.) or webpage URLs to
                      extract images Or you can copy paste the image
                    </p>
                  )}
                </div>

                {/* Extracted Images Selector Modal */}
                {/* {showImageSelector && extractedImages.length > 0 && (
                  <div className="rounded-lg border border-gray-100/10 bg-[#2F2F2F] p-4">
                    <div className="mb-3">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-blue-400" />
                          <h3 className="text-sm font-medium text-white 2xl:text-base">
                            Select images from {getDomain(urlInput) || 'webpage'}
                          </h3>
                        </div>
                        <span className="text-xs text-gray-400">
                          Found {extractedImages.length} images
                        </span>
                      </div>


                      <div className="relative">
            
                        <div
                          className="scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent grid grid-cols-2 gap-3 overflow-y-auto pr-2 sm:grid-cols-3"
                          style={{ maxHeight: '400px' }}
                        >
                          {extractedImages.map((image, index) => (
                            <div
                              key={index}
                              className="group relative cursor-pointer overflow-hidden rounded-lg border border-gray-100/10 bg-[#383838] transition hover:border-[#5867EB]"
                              onClick={() => {
                                setLightboxOpen(true);
                                setLightboxImages(extractedImages);
                                setLightboxImage(image);
                              }}
                            >
  
                              <div className="aspect-square overflow-hidden">
                                <img
                                  src={image}
                                  alt={image.alt || `Image ${index + 1}`}
                                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src =
                                      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPHJlY3Qgd2lkdGg9IjE1MCIgaGVpZ2h0PSIxNTAiIGZpbGw9IiMzODM4MzgiLz4KICA8cGF0aCBkPSJNNzUgNTBDNjcuNDU3NSA1MCA2MS40MjUgNTYuMDMyNSA2MS40MjUgNjMuNTc1QzYxLjQyNSA3MS4xMTc1IDY3LjQ1NzUgNzcuMTUgNzUgNzcuMTVDODIuNTQyNSA3Ny4xNSA4OC41NzUgNzEuMTE3NSA4OC41NzUgNjMuNTc1Qzg4LjU3NSA1Ni4wMzI1IDgyLjU0MjUgNTAgNzUgNTBaTTk0LjI3NSA0Ni45NzVMODYuNDUgNzAuNDVMODMuNTI1IDY0LjA1TDc1IDgxLjE1TDY2LjQ3NSA2NC4wNUw2My41NSA3MC40NUw1NS43MjUgNDYuOTc1SDQzTDM1LjUgNjBMNDUuODc1IDk0LjVIMTA0LjEyNUwxMTQuNSA2MEwxMDYuNzc1IDQ2Ljk3NUg5NC4yNzVaTTM5LjUgMTAwSDExMC41TDEwNiAxMDkuNUg0NEwzOS41IDEwMFoiIGZpbGw9IiM1ODY3RUIiIGZpbGwtb3BhY2l0eT0iMC4zIi8+Cjwvc3ZnPgo=';
                                  }}
                                />
                              </div>

                   
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                                <div className="absolute right-2 bottom-2 left-2">
                                  <div className="truncate text-xs font-medium text-white">
                                    {image.alt?.substring(0, 50) || `Image ${index + 1}`}
                                  </div>
                                  {image.width && image.height && (
                                    <div className="text-[10px] text-gray-300">
                                      {image.width}×{image.height}
                                    </div>
                                  )}
                                </div>
                              </div>

       
                              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                                <div className="rounded-full bg-[#5867EB] p-3 shadow-lg">
                                  <Plus
                                    className="h-5 w-5 text-white"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectExtractedImage(fieldArrayHelpers, image, index);
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

          
                        {extractedImages.length > 9 && (
                          <div className="mt-2 flex items-center justify-center border-t border-gray-100/10 pt-2"></div>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setShowImageSelector(false);
                          setExtractedImages([]);
                        }}
                        className="rounded-lg border border-gray-100/10 bg-[#383838] px-3 py-1.5 text-xs text-gray-300 transition hover:bg-[#444] 2xl:text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )} */}
                {/* Extracted Images Selector Modal */}
                {showImageSelector && extractedImages.length > 0 && (
                  <div className="rounded-lg border border-black/10 bg-gray-50 dark:border-gray-100/10 dark:bg-[#2F2F2F] p-4">
                    <div className="mb-3">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-blue-400" />
                          <h3 className="text-sm font-medium text-gray-900 dark:text-white 2xl:text-base">
                            Select images from {getDomain(urlInput) || 'webpage'}
                          </h3>
                        </div>
                        <span className="text-xs text-gray-400">
                          Found {extractedImages.length} images
                        </span>
                      </div>

                      {/* Vertical scroll container */}
                      <div className="relative">
                        {/* Container with max height and vertical scroll */}
                        <div
                          className="scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent grid grid-cols-2 gap-3 overflow-y-auto pr-2 sm:grid-cols-3"
                          style={{ maxHeight: '400px' }}
                        >
                          {extractedImages.map((image, index) => {
                            // Check if this image is already in assets
                            const isSelected = assetsArray.some(
                              (asset) =>
                                (asset.tempUrl === image || asset.url === image) &&
                                (asset.source === 'url' || asset.isExisting)
                            );

                            return (
                              <div
                                key={index}
                                className="group relative cursor-pointer overflow-hidden rounded-lg border border-black/10 bg-gray-50 dark:border-gray-100/10 dark:bg-[#383838] transition hover:border-[#5867EB]"
                                onClick={() => {
                                  setLightboxOpen(true);
                                  setLightboxImages(extractedImages);
                                  setLightboxImage(image);
                                }}
                              >
                                {/* Aspect ratio container */}
                                <div className="aspect-square overflow-hidden">
                                  <img
                                    src={image}
                                    alt={image.alt || `Image ${index + 1}`}
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.target.onerror = null;
                                      e.target.src =
                                        'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPHJlY3Qgd2lkdGg9IjE1MCIgaGVpZ2h0PSIxNTAiIGZpbGw9IiMzODM4MzgiLz4KICA8cGF0aCBkPSJNNzUgNTBDNjcuNDU3NSA1MCA2MS40MjUgNTYuMDMyNSA2MS40MjUgNjMuNTc1QzYxLjQyNSA3MS4xMTc1IDY3LjQ1NzUgNzcuMTUgNzUgNzcuMTVDODIuNTQyNSA3Ny4xNSA4OC41NzUgNzEuMTE3NSA4OC41NzUgNjMuNTc1Qzg4LjU3NSA1Ni4wMzI1IDgyLjU0MjUgNTAgNzUgNTBaTTk0LjI3NSA0Ni45NzVMODYuNDUgNzAuNDVMODMuNTI1IDY0LjA1TDc1IDgxLjE1TDY2LjQ3NSA2NC4wNUw2My41NSA3MC40NUw1NS43MjUgNDYuOTc1SDQzTDM1LjUgNjBMNDUuODc1IDk0LjVIMTA0LjEyNUwxMTQuNSA2MEwxMDYuNzc1IDQ2Ljk3NUg5NC4yNzVaTTM5LjUgMTAwSDExMC41TDEwNiAxMDkuNUg0NEwzOS41IDEwMFoiIGZpbGw9IiM1ODY3RUIiIGZpbGwtb3BhY2l0eT0iMC4zIi8+Cjwvc3ZnPgo=';
                                    }}
                                  />
                                </div>

                                {/* Image info overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                                  <div className="absolute right-2 bottom-2 left-2">
                                    <div className="truncate text-xs font-medium text-white">
                                      {image.alt?.substring(0, 50) || `Image ${index + 1}`}
                                    </div>
                                    {image.width && image.height && (
                                      <div className="text-[10px] text-gray-300">
                                        {image.width}×{image.height}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Select button in top right corner */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isSelected && assetsArray.length < 5) {
                                      handleSelectExtractedImage(fieldArrayHelpers, image, index);
                                      setIsAddingUrl(true);
                                    }
                                  }}
                                  className={`absolute top-2 right-2 z-10 flex items-center justify-center rounded-full p-1.5 shadow-lg transition-all duration-200 ${
                                    isSelected
                                      ? 'bg-green-500 hover:bg-green-600'
                                      : 'bg-[#5867EB] opacity-0 group-hover:opacity-100 hover:bg-[#6a77f0]'
                                  }`}
                                  disabled={isSelected}
                                  title={isSelected ? 'Already selected' : 'Add to assets'}
                                >
                                  {isSelected ? (
                                    <svg
                                      className="h-4 w-4 text-white"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={3}
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  ) : (
                                    <Plus className="h-4 w-4 text-white" />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* Scroll indicator for many images */}
                        {extractedImages.length > 9 && (
                          <div className="mt-2 flex items-center justify-center border-t border-black/10 dark:border-gray-100/10 pt-2">
                            <ArrowDown className="h-4 w-4 animate-bounce text-gray-400" />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setShowImageSelector(false);
                          setExtractedImages([]);
                        }}
                        className="rounded-lg border border-black/10 bg-gray-100 text-gray-500 dark:border-gray-100/10 dark:bg-[#383838] dark:text-gray-300 px-3 py-1.5 text-xs transition hover:bg-gray-200 dark:hover:bg-[#444] 2xl:text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          />

          {errors.assets && touched.assets && (
            <div className="mt-2 text-xs text-red-400 2xl:text-sm">
              {typeof errors.assets === 'string' ? errors.assets : 'Invalid assets configuration'}
            </div>
          )}
        </div>

        <div className="mt-12 flex flex-wrap justify-end gap-3 sm:mt-16">
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-transparent text-gray-700 dark:border-[#E3E3E3] dark:text-[#E3E3E3] px-10 py-1.5 text-sm transition hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-50 2xl:text-base"
            disabled={isSubmitting}
            onClick={() => dispatch(setActiveForm(null))}
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={
              isSubmitting ||
              assetsArray?.length === 0 ||
              (productionAndServices?.status == 'success' && results?.status != 'success')
            }
            className="rounded-lg bg-gray-900 text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-semibold shadow-lg shadow-emerald-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 2xl:text-base"
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white dark:border-black border-t-transparent"></div>
                Uploading...
              </div>
            ) : (
              'Save & Continue'
            )}
          </button>
        </div>
      </Form>
    );
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 25, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="text-gray-900 dark:text-white"
      >
        <>
          <h2 className="mb-5 text-center text-xl font-semibold text-gray-900 dark:text-white 2xl:text-[23px]">
            Key visuals
          </h2>

          <Formik
            initialValues={initialValues}
            onSubmit={handleSubmit}
            enableReinitialize
            validate={(values) => {
              const errors = {};
              const assetsError = validateAssets(values.assets);
              if (assetsError) {
                errors.assets = assetsError;
              }
              return errors;
            }}
          >
            {(formikProps) => (
              <>
                <FormikHelperUpdater setFormikHelpers={setFormikHelpers} />
                {currentStep === 1 && renderForm(formikProps)}

                {currentStep === 2 && <CompetitorVisualsModal setCurrentStep={setCurrentStep} />}
              </>
            )}
          </Formik>
        </>
      </motion.div>

      {lightboxOpen && (
        <ShowLightBox
          lightboxImage={lightboxImage}
          closeLightbox={handleCloseLightbox}
          images={lightboxImages}
        />
      )}
    </>
  );
}
