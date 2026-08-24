import { useEffect, useRef, useState } from 'react';
import { useFormik } from 'formik';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BRAND_CATEGORIES } from '@/utils/brandCategories';
import CategoryCombobox from './CategoryCombobox';
import {
  ArrowLeft,
  ArrowRight,
  CloudUpload,
  Info,
  LoaderCircle,
  X,
  Sparkles,
  Target,
  Plus,
  Link,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import {
  analazeDomain,
  createBrandList,
  fetchBrands,
  removeBrandImage,
  updateBrandList,
} from '@/store/actions/brandIQ/myBrandActions';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { getClipboardImageFiles } from '@/utils/clipboardImages';
import {
  fileToBase64,
  tooltipDescriptions,
  urlToBase64,
  validateUrl,
  urlToFile,
} from '@/utils/MyBrand/FileHandle';
import ShowProductImages from '../Cards/ShowProductImages';
import { useNavigate } from 'react-router-dom';
import { setBrandIQError, setBrandIQLoading } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { globalToast } from '@/utils/globalToast';
import { GA4Events } from '@/utils/ga4';
import { getCompetitorAds } from '@/apis/brandIQ/competitorAdsApi';
import { showCompetitorAdsReadyNotification } from '@/utils/showNotification';
import {
  INPUT_BASE,
  INPUT_ERROR_RING,
  UPLOAD_FIELD_WRAPPER,
  UPLOAD_BUTTON,
  CARD_SHELL,
} from '@/components/AdStudio/AdCreativeNew/components/AdStudioPrimitives';

const AddNewBrand = ({ fromComponent, brandData, setEditingBrand, toast }) => {
  const [brandDetailsFormNumber, setBrandDetailsFormNumber] = useState(brandData ? 1 : 0);
  const { loading, updateLoading, error } = useSelector((state) => state.brandIQTabs);
  const [isOpen, setIsOpen] = useState(false);
  const { userData } = useSelector((state) => state.socket);
  const dispatch = useDispatch();
  const [brandLogos, setBrandLogos] = useState([]);
  const [productImages, setProductImages] = useState([]);
  const [removedImages, setRemovedImages] = useState([]);
  const [originalFileUrls, setOriginalFileUrls] = useState({
    'Brand Logos*': [],
    'Product Image*': [],
  });
  const [originalSelectedUrls, setOriginalSelectedUrls] = useState({
    'Brand Logos*': [],
    'Product Image*': [],
  });
  const [analyzeWebsiteUrl, setAnalyzeWebsiteUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [aiTargetAudiences, setAiTargetAudiences] = useState([]);
  const [selectedAudiences, setSelectedAudiences] = useState([]);
  const [customAudienceInput, setCustomAudienceInput] = useState('');

  const navigate = useNavigate();
  const competitorPollRef = useRef(null);

  // Helper: poll competitor discovery status and notify when ready
  const startCompetitorDiscoveryPoll = (brandId, brandName) => {
    if (competitorPollRef.current) {
      clearInterval(competitorPollRef.current);
    }

    const poll = async () => {
      try {
        const data = await getCompetitorAds(brandId, {
          userId: userData?.user_id,
          page: 1,
          pageSize: 1,
        });

        if (data.status === 'READY' || data.status === 'EMPTY' || data.status === 'FAILED') {
          if (competitorPollRef.current) {
            clearInterval(competitorPollRef.current);
            competitorPollRef.current = null;
          }
          if (data.status === 'READY') {
            showCompetitorAdsReadyNotification(
              { id: brandId, name: brandName },
              dispatch
            );
          }
        }
      } catch (err) {
        console.error('Competitor discovery poll error:', err);
      }
    };

    // Poll every 10 seconds for up to 5 minutes (30 polls)
    let pollCount = 0;
    const MAX_POLLS = 30;
    competitorPollRef.current = setInterval(() => {
      pollCount += 1;
      if (pollCount > MAX_POLLS) {
        clearInterval(competitorPollRef.current);
        competitorPollRef.current = null;
        return;
      }
      poll();
    }, 10000);

    // Run immediately once
    poll();
  };

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (competitorPollRef.current) {
        clearInterval(competitorPollRef.current);
      }
    };
  }, []);

  // Function to load brand data including images
  const loadBrandData = async (brandData) => {
    if (!brandData) return;
    setIsFileLoading(true);
    formik.setValues({
      id: brandData?.id || '',
      brandName: brandData?.brandName || brandData?.name || '',
      brandDescription: brandData?.brandDescription || brandData?.description || '',
      brandLogo: brandData?.logoUrls || [],
      brandIcon: brandData?.iconUrl || '',
      productImage: brandData?.imageUrl || [],
      websiteUrl: brandData?.websiteUrl || '',
      instagramUrl: brandData?.instagramUrl || '',
      facebookUrl: brandData?.facebookUrl || '',
      linkedinUrl: brandData?.linkedinUrl || '',
      region: brandData?.region || '',
      category: brandData?.category || '',
    });

    const saved = brandData?.targetAudiences || [];
    setAiTargetAudiences(saved);
    setSelectedAudiences(saved);
    if (brandData?.websiteUrl && saved.length === 0) {
      try {
        const result = await analazeDomain(brandData.websiteUrl);
        const audiences = result?.aiInsights?.aiTargetAudiences || [];
        setAiTargetAudiences(audiences);
      } catch {
        // silently ignore — field just won't show
      }
    }

    try {
      const filesToSet = {
        'Brand Logos*': [],
        'Product Image*': [],
      };

      const originalUrls = {
        'Brand Logos*': [],
        'Product Image*': [],
      };
      //       if (brandData?.brandLogo?.length > 0) {
      //   const logoFiles = [];

      //   for (const logoUrl of brandData.brandLogo) {
      //     try {
      //       const file = await urlToFile(
      //         logoUrl,
      //         `logo-${Date.now()}.png`
      //       );

      //       if (file) {
      //         file.originalUrl = logoUrl;
      //         logoFiles.push(file);
      //         originalUrls['Brand Logos*'].push(logoUrl);
      //       }
      //     } catch (err) {
      //       console.error("Logo conversion failed:", err);
      //     }
      //   }

      //   setBrandLogos(logoFiles);
      // }

      if (brandData?.logoUrls && brandData?.logoUrls?.length > 0) {
        for (const logoUrl of brandData.logoUrls) {
          const file = await urlToFile(logoUrl, `${Date.now()}.png`);
          if (file) {
            filesToSet['Brand Logos*']?.push(file);
            originalUrls['Brand Logos*']?.push(logoUrl);
          }
        }
      }

      // Load product images
      if (brandData?.imageUrl && brandData?.imageUrl?.length > 0) {
        for (const imageUrl of brandData.imageUrl) {
          const file = await urlToFile(imageUrl, `${Date.now()}.png`);
          if (file) {
            filesToSet['Product Image*']?.push(file);
            originalUrls['Product Image*']?.push(imageUrl);
          }
        }
      }

      setBrandLogos(filesToSet['Brand Logos*']);
      setProductImages(filesToSet['Product Image*']);
      setOriginalFileUrls(originalUrls);
      setIsFileLoading(false);
    } catch (error) {
      console.error('Error loading brand images:', error);
      setIsFileLoading(false);
    }
  };

  useEffect(() => {
    if (brandData) {
      setIsOpen(true);
      loadBrandData(brandData);
    }
  }, [brandData]);

  const handleAnalyzeWebsite = async () => {
    if (!analyzeWebsiteUrl) return;

    setIsAnalyzing(true);
    setAnalysisError('');

    try {
      const result = await analazeDomain(analyzeWebsiteUrl);
      if (result?.status == 500) {
        formik.setValues({
          ...formik.values,
          websiteUrl: analyzeWebsiteUrl,
        });
        setAnalysisError('Failed to analyze website. Please try again or enter details manually.');
        return;
      }
      if (!result?.aiInsights && Array.isArray(result?.images) && result?.images?.length === 0) {
        formik.setValues({
          ...formik.values,
          websiteUrl: analyzeWebsiteUrl,
        });
        setAnalysisError('Unable to fetch the url. Please enter the details manually');
        return;
      }
      // DS-supplied category (defensive: reads whichever shape the analyze
      // returns) — only prefill it if it's one of the 45 valid categories.
      const analyzedCategory =
        result?.brandInfo?.category ??
        result?.aiInsights?.category ??
        result?.category ??
        '';
      formik.setValues({
        ...formik.values,
        brandName: result?.meta?.title || '',
        brandDescription: result?.aiInsights?.aiSummary || '',
        websiteUrl: result?.url || analyzeWebsiteUrl,
        category: BRAND_CATEGORIES.includes(analyzedCategory) ? analyzedCategory : '',
      });

      const audiences = result?.aiInsights?.aiTargetAudiences || [];
      setAiTargetAudiences(audiences);
      setSelectedAudiences([]);

      const originalUrls = {
        'Brand Logos*': [],
        'Product Image*': [],
      };
      if (result?.brandLogo?.length > 0) {
        const validLogos = result.brandLogo.filter(
          (url) => url && !url.includes('undefined') && !url.includes('.svg')
        );

        const logoFiles = [];

        for (const logoUrl of validLogos) {
          try {
            const file = await urlToFile(logoUrl, `logo-${Date.now()}.png`);

            if (file) {
              file.originalUrl = logoUrl;
              logoFiles.push(file);
              originalUrls['Brand Logos*'].push(logoUrl);
            }
          } catch (err) {
            console.error('Logo conversion failed:', err);
          }
        }

        //  THIS drives UI rendering
        setBrandLogos(logoFiles);
      }
      if (result?.images?.length > 0) {
        const isValidProductImage = (url) => {
          if (!url) return false;

          //  base64 images
          if (url.startsWith('data:image')) return false;

          //  undefined garbage
          if (url.includes('undefined')) return false;

          //  svg icons
          if (url.includes('.svg')) return false;

          //  cloudinary transform without asset — match the host rather
          //  than a substring, which any URL could carry in its path or query
          let cloudinaryHost = false;
          try {
            cloudinaryHost = new URL(url).hostname === 'res.cloudinary.com';
          } catch {
            cloudinaryHost = false;
          }
          if (cloudinaryHost && /\/upload\/w_\d+\/?$/.test(url)) {
            return false;
          }

          //  must contain real image extension
          const validExtension = /\.(png|jpg|jpeg|webp|ico)(\?|$)/i.test(url);

          if (!validExtension) return false;

          return true;
        };

        const validImages = result.images.filter(isValidProductImage);
        originalUrls['Product Image*'] = validImages;
      }

      setOriginalFileUrls(originalUrls);
      setBrandDetailsFormNumber(1);
    } catch (error) {
      let status = error?.response?.status;
      if (status === 409) {
        formik.setFieldValue('websiteUrl', analyzeWebsiteUrl);
        // setAnalysisError('This website is already added for this user');
        return;
      }
      setAnalysisError(
        error?.response?.data?.detail ||
        'Failed to analyze website. Please try again or enter details manually.'
      );
      console.error('Website analysis error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSkipToManual = () => {
    setBrandDetailsFormNumber(1);
    formik.setValues({
      ...formik.values,
      websiteUrl: analyzeWebsiteUrl,
    });
  };

  useEffect(() => {
    const hasMaxFilesError = formik.errors?.brandLogo?.includes('select');
    const hasMaxFilesErrorProductImage = formik.errors?.productImage?.includes('select');
    if (brandData && !isFileLoading && !hasMaxFilesError && !hasMaxFilesErrorProductImage) {
      formik.validateForm();
    }
  }, [brandLogos, productImages, isFileLoading, brandData]);

  const handleSkipToRedirect = () => {
    navigate('/adstudio');
  };
  const rulesConfig = {
    'Brand Logos*': {
      types: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'],
      displayTypes: ['PNG', 'ICO'],
      maxSize: 2 * 1024 * 1024,
      maxFiles: 5,
      checkTransparency: true,
      single: false,
    },
    'Product Image*': {
      types: ['image/png', 'image/jpeg', 'image/webp'],
      displayTypes: ['PNG', 'JPG', 'JPEG', 'WEBP', 'ICO'],
      maxSize: 5 * 1024 * 1024,
      maxFiles: 5,
      checkTransparency: false,
      single: false,
    },
  };

  const validateFiles = async (files, rules, label) => {
    const errors = [];
    const validFiles = [];

    for (const file of files) {
      if (!rules?.types?.includes(file.type)) {
        errors.push(`${label} must be ${rules?.displayTypes?.join(', ')} format only`);

        continue;
      }

      if (file.size > rules?.maxSize) {
        errors.push(`${label} must be < ${Math.round(rules?.maxSize / 1024)}KB`);
        continue;
      }
      const checkTransparency = (file) => {
        return new Promise((resolve) => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, img.width, img.height).data;

            // Check if any pixel has alpha < 255
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] < 255) {
                resolve(true); // has transparency
                return;
              }
            }
            resolve(false); // no transparency
          };
          img.src = URL.createObjectURL(file);
        });
      };

      if (rules?.checkTransparency) {
        const hasTransparency = await checkTransparency(file);
        if (!hasTransparency) {
          errors.push(`${label} must have a transparent background`);
          continue;
        }
      }

      validFiles.push(file);
    }

    return { valid: validFiles, errors };
  };

  const formik = useFormik({
    initialValues: {
      id: '',
      brandName: '',
      brandDescription: '',
      websiteUrl: '',
      instagramUrl: '',
      facebookUrl: '',
      linkedinUrl: '',
      region: '',
      category: '',
      brandLogo: '',
      productImage: '',
      brandLogoError: '',
      productImageError: '',
    },
    validateOnBlur: true,
    validateOnChange: true,
    validate: (values) => {
      const errors = {};

      if (brandDetailsFormNumber === 1) {
        if (!values.brandName.trim()) {
          errors.brandName = 'Brand name is required';
        }

        if (!values.brandDescription.trim()) {
          errors.brandDescription = 'Brand description is required';
        }
        if (brandLogos.length === 0) {
          errors.brandLogo = 'Brand logo is required';
        }
        // const totalProductImages =
        //   productImages?.length + originalSelectedUrls['Product Image*']?.length;
        // if (totalProductImages === 0 && !values.productImageError) {
        //   errors.productImage = 'Product Image is required';
        // }
      } else {
        if (!values.websiteUrl.trim()) {
          errors.websiteUrl = 'Website URL is required';
        } else {
          const websiteError = validateUrl(values.websiteUrl, 'websiteUrl');
          if (websiteError) errors.websiteUrl = websiteError;
        }

        if (values.instagramUrl.trim()) {
          const instagramError = validateUrl(values.instagramUrl, 'instagramUrl');
          if (instagramError) errors.instagramUrl = instagramError;
        }

        if (values.facebookUrl.trim()) {
          const facebookError = validateUrl(values.facebookUrl, 'facebookUrl');
          if (facebookError) errors.facebookUrl = facebookError;
        }

        if (values.linkedinUrl.trim()) {
          const linkedinError = validateUrl(values.linkedinUrl, 'linkedinUrl');
          if (linkedinError) errors.linkedinUrl = linkedinError;
        }
      }

      return errors;
    },
    onSubmit: async (values) => {
      try {
        dispatch(setBrandIQLoading(true));
        const processFiles = async (files, originalUrls) => {
          const result = [];

          for (let i = 0; i < files?.length; i++) {
            try {
              const file = files[i];
              const originalUrl = originalUrls[i];

              if (file?.originalUrl || originalUrl) {
                result.push(file.originalUrl || originalUrl);
              } else {
                const base64 = await fileToBase64(file);
                result.push(base64);
              }
            } catch (err) {
              console.error('Error processing file:', err);
            }
          }
          return result;
        };
        const processProductFiles = async (files, originalUrls) => {
          const result = [];
          for (let i = 0; i < files?.length; i++) {
            try {
              const file = files[i];
              if (file) {
                const base64 = await fileToBase64(file);
                result.push(base64);
              }
            } catch (err) {
              console.error('Error processing product file:', err);
            }
          }

          for (let i = 0; i < originalUrls?.length; i++) {
            try {
              const originalUrl = originalUrls[i];
              if (originalUrl) {
                const base64 = await urlToBase64(originalUrl);
                result.push(base64);
              }
            } catch (err) {
              console.error('Error fetching product image from URL:', err);
              // Error is already toasted in urlToBase64
            }
          }
          return result;
        };

        const brandPayload = {
          id: values.id || '',
          userId: userData?.user_id,
          brandName: values.brandName.trim(),
          brandDescription: values.brandDescription || '',
          logoBase64s: brandData
            ? await processFiles(brandLogos, originalSelectedUrls['Brand Logos*'])
            : await processProductFiles(brandLogos, originalSelectedUrls['Brand Logos*']),
          imageBase64: brandData
            ? await processFiles(productImages, originalSelectedUrls['Product Image*'])
            : await processProductFiles(productImages, originalSelectedUrls['Product Image*']),
          websiteUrl: values.websiteUrl.trim() || '',
          instagramUrl: values.instagramUrl || '',
          facebookUrl: values.facebookUrl || '',
          linkedinUrl: values.linkedinUrl || '',
          region: values.region?.trim() || null,
          targetAudiences: selectedAudiences.length > 0 ? selectedAudiences : undefined,
          category: values.category || undefined,
        };

        if (brandData) {
          // Update existing brand
          if (brandData && removedImages?.length) {
            for (const { label, originalUrl } of removedImages) {
              const payload = {
                id: brandData?.id,
                imageUrl: originalUrl,
                userId: userData.user_id,
                labelName: label,
              };
              await dispatch(removeBrandImage(payload)).unwrap();
            }
          }
          await dispatch(updateBrandList(brandPayload)).unwrap();
          GA4Events.brandUpdated({ feature: 'brand_iq' });
          setRemovedImages([]);
          setEditingBrand(false);
          globalToast.success('Brand updated successfully!');
        } else {
          // Create new brand
          const result = await dispatch(createBrandList(brandPayload)).unwrap();
          GA4Events.brandCreated({ feature: 'brand_iq' });
          globalToast.success('Brand created successfully!');
          const createdBrandName = result?.data?.brandName || values.brandName.trim();
          const createdBrandId = result?.data?.id;
          if (createdBrandId) {
            globalToast.success(`Finding competitor ads for ${createdBrandName}...`);
            startCompetitorDiscoveryPoll(createdBrandId, createdBrandName);
          }
        }
        setBrandDetailsFormNumber(0);
        setBrandLogos([]);
        setProductImages([]);
        setAnalyzeWebsiteUrl('');
        setAiTargetAudiences([]);
        setSelectedAudiences([]);
        setCustomAudienceInput('');
        setOriginalFileUrls({
          'Brand Logos*': [],
          'Product Image*': [],
        });
        setOriginalSelectedUrls({
          'Brand Logos*': [],
          'Product Image*': [],
        });
        setIsOpen(false);
        formik.resetForm();
        dispatch(fetchBrands(userData?.user_id));
      } catch (error) {
        console.error('Brand creation/update error:', error);

        // globalToast.error('Failed to Save brand');
      } finally {
        dispatch(setBrandIQLoading(false));
      }
    },
  });

  const handleBrandLogoChange = async (e) => {
    const filesArray = Array.from(e.target.files);
    const rules = rulesConfig['Brand Logos*'];
    let errorMsg = '';
    const existingCount = brandLogos?.length;
    const newFilesCount = filesArray?.length;
    formik.setFieldTouched('brandLogo', true, false);
    formik.setFieldError('brandLogo', '');
    formik.setFieldError('brandLogoError', '');
    if (rules.maxFiles && existingCount + newFilesCount > rules.maxFiles) {
      errorMsg = `You can select up to ${rules.maxFiles} brand logos only`;
      formik.setFieldError('brandLogoError', errorMsg);
      formik.setFieldError('brandLogo', '');
      e.target.value = '';
      return;
    }

    // Validate files
    const { valid, errors: validationErrors } = await validateFiles(
      filesArray,
      rules,
      'Brand Logos'
    );

    if (validationErrors?.length > 0) {
      errorMsg = validationErrors[0];
      formik.setFieldError('brandLogoError', errorMsg);
      formik.setFieldError('brandLogo', '');
      e.target.value = '';
      return;
    }

    // Add valid files
    if (valid?.length > 0) {
      const duplicateFiles = valid?.filter((f) =>
        brandLogos.some((ex) => ex.name === f.name && ex.size === f.size)
      );

      if (duplicateFiles.length > 0) {
        formik.setFieldError('brandLogo', '');
        formik.setFieldError('brandLogo', 'This logo is already uploaded');
        e.target.value = '';
        return;
      }

      const newFiles = [...brandLogos, ...valid]?.slice(0, rules.maxFiles);
      setBrandLogos(newFiles);
      formik.setFieldError('brandLogo', '');
    }

    e.target.value = '';
  };

  const handleProductImageChange = async (e) => {
    const filesArray = Array.from(e.target.files);
    const rules = rulesConfig['Product Image*'];
    let errorMsg = '';

    // Check max files
    formik.setFieldTouched('productImage', true, false);
    const existingCount = productImages?.length + originalSelectedUrls['Product Image*']?.length;
    const newFilesCount = filesArray?.length;

    if (rules.maxFiles && existingCount + newFilesCount > rules.maxFiles) {
      errorMsg = `You can select up to ${rules.maxFiles} product images only`;
      formik.setFieldError('productImageError', errorMsg);
      formik.setFieldError('productImage', '');
      e.target.value = '';
      return;
    }

    const { valid, errors: validationErrors } = await validateFiles(
      filesArray,
      rules,
      'Product Images'
    );

    if (validationErrors.length > 0) {
      errorMsg = validationErrors[0];
      formik.setFieldError('productImageError', errorMsg);
      formik.setFieldError('productImage', '');
      e.target.value = '';
      return;
    }

    // Add valid files
    if (valid?.length > 0) {
      const duplicateFiles = valid.filter((f) =>
        productImages.some((ex) => ex.name === f.name && ex.size === f.size)
      );

      if (duplicateFiles.length > 0) {
        formik.setFieldError('productImageError', '');
        formik.setFieldError('productImage', 'This image is already uploaded');
        e.target.value = '';
        return;
      }

      const newFiles = [...productImages, ...valid].slice(0, rules.maxFiles);
      setProductImages(newFiles);
      formik.setFieldError('productImageError', '');
      formik.setFieldError('productImage', '');
    }

    e.target.value = '';
  };
  const handleBrandLogoPaste = async (e) => {
    const files = getClipboardImageFiles(e.clipboardData, 5);
    if (!files.length) return;
    e.preventDefault();
    await handleBrandLogoChange({ target: { files, value: '' } });
  };
  const handleProductImagePaste = async (e) => {
    const files = getClipboardImageFiles(e.clipboardData, 5);
    if (!files.length) return;
    e.preventDefault();
    await handleProductImageChange({ target: { files, value: '' } });
  };

  const handleRemoveBrandLogo = (index) => {
    const file = brandLogos[index];

    if (brandData && (file?.originalUrl || originalFileUrls['Brand Logos*'][index])) {
      const originalUrl = file?.originalUrl || originalFileUrls['Brand Logos*'][index];
      setRemovedImages((prev) => {
        const existingUrls = new Set(prev?.map((item) => item?.originalUrl));
        if (!existingUrls?.has(originalUrl)) {
          return [...prev, { label: 'Brand Logos*', originalUrl }];
        }
        return prev;
      });
    }

    setBrandLogos((prev) => {
      const updated = prev?.filter((_, i) => i !== index);
      if (updated?.length > 0) {
        formik.setFieldError('brandLogoError', '');
        formik.setFieldError('brandLogo', '');
      }
      return updated;
    });

    // Also remove from original URLs if editing
    if (brandData && originalSelectedUrls['Brand Logos*'][index]) {
      setOriginalSelectedUrls((prev) => ({
        ...prev,
        'Brand Logos*': prev['Brand Logos*'].filter((_, i) => i !== index),
      }));
    }
  };

  const handleRemoveProductImage = (index) => {
    const file = productImages[index];

    if (brandData && (file?.originalUrl || originalFileUrls['Product Image*'][index])) {
      const originalUrl = file?.originalUrl || originalFileUrls['Product Image*'][index];
      setRemovedImages((prev) => {
        const existingUrls = new Set(prev?.map((item) => item?.originalUrl));
        if (!existingUrls?.has(originalUrl)) {
          return [...prev, { label: 'Product Image*', originalUrl }];
        }
        return prev;
      });
    }
    setProductImages((prev) => {
      const updated = prev?.filter((_, i) => i !== index);
      if (updated?.length > 0 || originalSelectedUrls['Product Image*']?.length > 0) {
        formik.setFieldError('productImageError', '');
        formik.setFieldError('productImage', '');
      }
      return updated;
    });

    // Also remove from original URLs if editing
    if (brandData && originalSelectedUrls['Product Image*'][index]) {
      setOriginalSelectedUrls((prev) => ({
        ...prev,
        'Product Image*': prev['Product Image*'].filter((_, i) => i !== index),
      }));
    }
  };

  const handleOpenChange = (open) => {
    setIsOpen(open);
    dispatch(setBrandIQError(null));
    if (brandData) setEditingBrand(open);
    if (!open) {
      setTimeout(() => {
        dispatch(setBrandIQError(null));
        setBrandDetailsFormNumber(brandData ? 1 : 0);
        setBrandLogos([]);
        setProductImages([]);
        setAnalyzeWebsiteUrl('');
        setAnalysisError('');
        setAiTargetAudiences([]);
        setSelectedAudiences([]);
        setCustomAudienceInput('');
        setOriginalFileUrls({
          'Brand Logos*': [],
          'Product Image*': [],
        });
        setOriginalSelectedUrls({
          'Brand Logos*': [],
          'Product Image*': [],
        });
        formik.resetForm();
      }, 200);
    }
  };

  const isStep1Valid = () => {
    if (isFileLoading) return false;

    const hasLogos =
      brandLogos?.length > 0 ||
      formik.values.brandLogo?.length > 0 ||
      originalFileUrls['Brand Logos*']?.length > 0;

    return (
      Boolean(formik.values.brandName.trim()) &&
      Boolean(formik.values.brandDescription.trim()) &&
      hasLogos &&
      !formik.errors.brandName &&
      !formik.errors.brandDescription
    );
  };

  const isStep2Valid = () => {
    return (
      formik.values.websiteUrl.trim() &&
      !formik.errors.websiteUrl &&
      !formik.errors.instagramUrl &&
      !formik.errors.facebookUrl &&
      !formik.errors.linkedinUrl
    );
  };

  const handleProductImageSelect = (selectedImages) => {
    setOriginalSelectedUrls((prev) => ({
      ...prev,
      'Product Image*': selectedImages,
    }));

    formik.setFieldError('productImageError', '');
    formik.setFieldError('productImage', '');
  };

  const handleNextStep = () => {
    const step1Errors = {};

    if (!formik.values.brandName.trim()) {
      step1Errors.brandName = 'Brand name is required';
    }
    if (!formik.values.brandDescription.trim()) {
      step1Errors.brandDescription = 'Brand description is required';
    }
    if (brandLogos.length === 0 && !formik.errors.brandLogoError) {
      step1Errors.brandLogo = 'Brand logo is required';
    }
    // const totalProductImages =
    //   productImages?.length + originalSelectedUrls['Product Image*']?.length;
    // if (totalProductImages === 0 && !formik.errors.productImageError) {
    //   step1Errors.productImage = 'Product Image is required';
    // }

    Object.keys(step1Errors).forEach((key) => {
      formik.setFieldError(key, step1Errors[key]);
      formik.setFieldTouched(key, true);
    });

    if (Object.keys(step1Errors).length === 0) {
      setBrandDetailsFormNumber(2);
    }
  };

  const getFileFieldError = (fieldName) => {
    return formik.errors[`${fieldName}Error`] || formik.errors[fieldName];
  };

  const renderWelcomeStep = () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-base font-medium text-gray-900 dark:text-white">
          Website Analysis
        </label>
        <div className="relative">
          <Input
            type="url"
            value={analyzeWebsiteUrl}
            onChange={(e) => setAnalyzeWebsiteUrl(e.target.value)}
            autoComplete="off"
            className={`${INPUT_BASE} pr-12`}
            placeholder="Enter website URL for automatic setup"
          />
          <Link className="pointer-events-none absolute top-1/2 right-5 h-4 w-4 -translate-y-1/2 text-[#7A7369] dark:text-[#909294]" />
        </div>
        {analysisError && <p className="text-xs text-red-500">{analysisError}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          disabled={isAnalyzing}
          className="rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-5 py-2 text-xs font-semibold text-[#7A7369] shadow-xs transition-colors hover:bg-[#EAE5DC] hover:text-[#24211D] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-[#20202080] dark:text-gray-300 dark:hover:bg-[#90929430] dark:hover:text-white"
        >
          Close
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSkipToManual}
            disabled={isAnalyzing}
            className="rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-5 py-2 text-xs font-semibold whitespace-nowrap text-[#7A7369] shadow-xs transition-colors hover:bg-[#EAE5DC] hover:text-[#24211D] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-[#20202080] dark:text-gray-300 dark:hover:bg-[#90929430] dark:hover:text-white"
          >
            Manual Setup
          </button>
          <button
            type="button"
            onClick={handleAnalyzeWebsite}
            disabled={!analyzeWebsiteUrl || isAnalyzing}
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 py-2 text-xs font-semibold whitespace-nowrap text-white shadow-[0_2px_8px_rgba(21,220,255,0.25)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAnalyzing ? (
              <>
                <LoaderCircle className="h-3 w-3 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <span>Analyze Website</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const renderBrandLogoUpload = () => (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">
        Brand Logos*
        <ShadcnTooltip
          label={tooltipDescriptions['Brand Logos*']}
          side="right"
          className="max-w-[350px] text-sm"
        >
          <Info className="h-3.5 w-3.5 cursor-pointer text-gray-400 hover:text-black dark:hover:text-white" />
        </ShadcnTooltip>
      </label>
      <div className={`${UPLOAD_FIELD_WRAPPER} pl-1.5 pr-4`} onPaste={handleBrandLogoPaste} tabIndex={0}>
        <label className={`${UPLOAD_BUTTON} cursor-pointer`}>
          <input
            type="file"
            accept=".png,.ico,image/png,image/x-icon,image/vnd.microsoft.icon"
            multiple={true}
            className="hidden"
            onChange={handleBrandLogoChange}
            onBlur={formik.handleBlur}
          />
          <CloudUpload className="h-3.5 w-3.5" />
          Upload
        </label>
        <span className="truncate text-[12px] font-light text-gray-500 dark:text-white/60">
          {brandLogos?.length === 0 ? 'No files selected' : `${brandLogos?.length} files selected`}
        </span>
      </div>

      {isFileLoading ? (
        <div className="flex items-center justify-center py-4">
          <LoaderCircle className="h-5 w-5 animate-spin text-blue-500" />
          <span className="ml-2 text-sm text-gray-400">Loading brand images...</span>
        </div>
      ) : (
        <>
          {brandLogos?.length > 0 && (
            <div className="mt-1 mb-1">
              <div className="grid grid-cols-4 gap-2">
                {brandLogos?.map((file, index) => (
                  <div
                    key={index}
                    className="group relative flex h-16 items-center justify-center overflow-hidden rounded-[16px] bg-gray-50 dark:bg-[#202121] p-1.5 ring-1 ring-black/8 dark:ring-white/10 transition-all hover:scale-[1.02]"
                  >
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="h-full w-full object-contain rounded-[10px]"
                    />
                    <button
                      type="button"
                      className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-transform hover:scale-110"
                      onClick={() => handleRemoveBrandLogo(index)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {formik.touched.brandLogo && getFileFieldError('brandLogo') && (
        <p className="text-xs text-red-400">{getFileFieldError('brandLogo')}</p>
      )}
    </div>
  );

  const renderProductImageUpload = () => (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">
        Product Image
        <ShadcnTooltip
          label={tooltipDescriptions['Product Image*']}
          side="right"
          className="max-w-[350px] text-sm"
        >
          <Info className="h-3.5 w-3.5 cursor-pointer text-gray-400 hover:text-black dark:hover:text-white" />
        </ShadcnTooltip>
      </label>
      <div className={`${UPLOAD_FIELD_WRAPPER} pl-1.5 pr-4`} onPaste={handleProductImagePaste} tabIndex={0}>
        <label className={`${UPLOAD_BUTTON} cursor-pointer`}>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            multiple={true}
            className="hidden"
            onChange={handleProductImageChange}
            onBlur={formik.handleBlur}
          />
          <CloudUpload className="h-3.5 w-3.5" />
          Upload
        </label>
        <span className="truncate text-[12px] font-light text-gray-500 dark:text-white/60">
          {productImages?.length === 0
            ? 'No files selected'
            : `${productImages?.length} files selected`}
        </span>
      </div>

      {isFileLoading ? (
        <div className="flex items-center justify-center py-4">
          <LoaderCircle className="h-5 w-5 animate-spin text-blue-500" />
          <span className="ml-2 text-sm text-gray-400">Loading product images...</span>
        </div>
      ) : (
        <>
          {productImages?.length > 0 && (
            <div className="mt-1 mb-1">
              <div className="grid grid-cols-4 gap-2">
                {productImages.map((file, index) => (
                  <div
                    key={index}
                    className="group relative flex h-16 items-center justify-center overflow-hidden rounded-[16px] bg-gray-50 dark:bg-[#202121] p-1.5 ring-1 ring-black/8 dark:ring-white/10 transition-all hover:scale-[1.02]"
                  >
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="h-full w-full object-contain rounded-[10px]"
                    />
                    <button
                      type="button"
                      className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-transform hover:scale-110"
                      onClick={() => handleRemoveProductImage(index)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {formik.touched.productImage && getFileFieldError('productImage') && (
        <p className="text-xs text-red-400">{getFileFieldError('productImage')}</p>
      )}
      {!brandData && (
        <ShowProductImages
          Images={originalFileUrls['Product Image*']}
          onImageSelect={handleProductImageSelect}
          currentSelectedCount={productImages?.length}
          initialSelectedImages={originalSelectedUrls['Product Image*']}
        />
      )}
    </div>
  );

  const renderStep1 = () => (
    <>
      <div className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-gray-800 dark:text-white/90">Brand Identity *</label>
        <Input
          type="text"
          name="brandName"
          value={formik.values.brandName}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
          autoComplete="off"
          className={`${INPUT_BASE} ${formik.touched.brandName && formik.errors.brandName ? INPUT_ERROR_RING : ''}`}
          placeholder="Brand name"
        />
        {formik.touched.brandName && formik.errors.brandName && (
          <p className="text-xs text-red-400">{formik.errors.brandName}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-[#24211D] dark:text-white/90">Brand Description *</label>
        <Textarea
          name="brandDescription"
          value={formik.values.brandDescription}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
          style={{ overflowWrap: 'anywhere' }}
          className={`min-h-[85px] max-h-[110px] w-full rounded-2xl bg-[#FCFAF7] border border-[#DDD7CD] p-4 text-[13px] font-normal text-[#24211D] outline-none placeholder:text-[#948C80] focus-visible:ring-2 focus-visible:ring-[#02C8C4]/20 focus-visible:border-[#02C8C4] transition-all dark:bg-[#202124] dark:border-white/10 dark:text-white dark:placeholder:text-[#afafaf]/70 ${formik.touched.brandDescription && formik.errors.brandDescription ? INPUT_ERROR_RING : ''}`}
          placeholder="Describe your brand for campaign optimization"
        />
        {formik.touched.brandDescription && formik.errors.brandDescription && (
          <p className="text-xs text-red-500">{formik.errors.brandDescription}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-[#24211D] dark:text-white/90">Category</label>
        <CategoryCombobox
          value={formik.values.category || ''}
          onChange={(v) => formik.setFieldValue('category', v)}
          triggerClassName={`${INPUT_BASE} justify-between flex items-center cursor-pointer`}
        />
      </div>

      {renderBrandLogoUpload()}
      {renderProductImageUpload()}

      <div className="flex items-center justify-between pt-3">
        {!brandData && (
          <button
            type="button"
            onClick={() => {
              dispatch(setBrandIQError(null));
              setBrandDetailsFormNumber(0);
              setAnalysisError('');
            }}
            className="flex items-center gap-1.5 rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-5 py-2.5 text-[13px] font-medium text-[#7A7369] shadow-xs transition-all hover:bg-[#EAE5DC] hover:text-[#24211D] dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}
        {brandData && (
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-5 py-2.5 text-[13px] font-medium text-[#7A7369] shadow-xs transition-all hover:bg-[#EAE5DC] hover:text-[#24211D] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            Close
          </button>
        )}
        <button
          type="button"
          onClick={handleNextStep}
          disabled={!isStep1Valid()}
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-6 py-2.5 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(21,220,255,0.25)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </>
  );

  const renderStep2 = () => (
    <>
      <div className="flex flex-col gap-4">
        <label className="text-[15px] font-semibold text-gray-900 dark:text-white">Digital Presence</label>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">Website URL *</label>
          <Input
            type="text"
            name="websiteUrl"
            value={formik.values.websiteUrl}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            autoComplete="off"
            className={`${INPUT_BASE} ${formik.touched.websiteUrl && formik.errors.websiteUrl ? INPUT_ERROR_RING : ''}`}
            placeholder="https://example.com"
          />
          {formik.touched.websiteUrl && formik.errors.websiteUrl && (
            <p className="text-xs text-red-400">{formik.errors.websiteUrl}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">Instagram</label>
            <Input
              type="url"
              name="instagramUrl"
              value={formik.values.instagramUrl}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              autoComplete="off"
              className={INPUT_BASE}
              placeholder="https://instagram.com/username"
            />
            {formik.touched.instagramUrl && formik.errors.instagramUrl && (
              <p className="text-xs text-red-400">{formik.errors.instagramUrl}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">Facebook</label>
            <Input
              type="url"
              name="facebookUrl"
              value={formik.values.facebookUrl}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              autoComplete="off"
              className={INPUT_BASE}
              placeholder="https://facebook.com/username"
            />
            {formik.touched.facebookUrl && formik.errors.facebookUrl && (
              <p className="text-xs text-red-400">{formik.errors.facebookUrl}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">LinkedIn</label>
          <Input
            type="url"
            name="linkedinUrl"
            value={formik.values.linkedinUrl}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            autoComplete="off"
            className={INPUT_BASE}
            placeholder="https://linkedin.com/in/username"
          />
          {formik.touched.linkedinUrl && formik.errors.linkedinUrl && (
            <p className="text-xs text-red-400">{formik.errors.linkedinUrl}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">Primary Audience Region</label>
          <Input
            type="text"
            name="region"
            value={formik.values.region}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            autoComplete="off"
            className={INPUT_BASE}
            placeholder="e.g. South India"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {['South India', 'North India', 'SE Asia', 'MENA', 'LATAM'].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => formik.setFieldValue('region', chip)}
                className={`rounded-full px-3.5 py-1 text-xs transition-all ${
                  formik.values.region === chip
                    ? 'border-2 border-[#02C8C4] bg-[#02C8C4]/15 text-[#02C8C4] font-medium'
                    : 'border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/70 hover:border-black/20 dark:hover:border-white/30'
                }`}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-white/90">Target Audiences</label>
          <div className={UPLOAD_FIELD_WRAPPER}>
            <input
              type="text"
              value={customAudienceInput}
              onChange={(e) => setCustomAudienceInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && customAudienceInput.trim()) {
                  e.preventDefault();
                  const val = customAudienceInput.trim();
                  if (!selectedAudiences.includes(val)) {
                    setSelectedAudiences((prev) => [...prev, val]);
                  }
                  setCustomAudienceInput('');
                }
              }}
              placeholder="Type an audience and press Enter"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-light text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-[#afafaf]/70"
            />
            <button
              type="button"
              onClick={() => {
                const val = customAudienceInput.trim();
                if (val && !selectedAudiences.includes(val)) {
                  setSelectedAudiences((prev) => [...prev, val]);
                }
                setCustomAudienceInput('');
              }}
              disabled={!customAudienceInput.trim()}
              className={UPLOAD_BUTTON}
            >
              Add
            </button>
          </div>

          {aiTargetAudiences.length > 0 && (
            <div className="scrollbar-thin flex max-h-[120px] flex-wrap gap-2 overflow-y-auto pr-1 pt-1">
              {aiTargetAudiences.map((audience) => {
                const isSelected = selectedAudiences.includes(audience);
                return (
                  <button
                    key={audience}
                    type="button"
                    onClick={() => {
                      setSelectedAudiences((prev) =>
                        isSelected ? prev.filter((a) => a !== audience) : [...prev, audience]
                      );
                    }}
                    className={`rounded-full border px-3 py-1 text-xs transition-all ${
                      isSelected
                        ? 'border-[#02C8C4]/60 bg-[#02C8C4]/20 text-[#02C8C4] font-medium'
                        : 'border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/70 hover:border-black/20 dark:hover:border-white/30'
                    }`}
                  >
                    {audience}
                  </button>
                );
              })}
            </div>
          )}

          {selectedAudiences.length > 0 && (
            <div className="scrollbar-thin flex max-h-[100px] flex-wrap gap-2 overflow-y-auto rounded-[16px] ring-1 ring-black/8 dark:ring-white/10 bg-gray-50 dark:bg-[#202121] p-3">
              {selectedAudiences.map((audience) => (
                <span
                  key={audience}
                  className="flex items-center gap-1.5 rounded-full border border-[#02C8C4]/40 bg-[#02C8C4]/10 px-3 py-1 text-xs text-[#02C8C4] font-medium"
                >
                  {audience}
                  <button
                    type="button"
                    onClick={() => setSelectedAudiences((prev) => prev.filter((a) => a !== audience))}
                    className="ml-0.5 text-[#02C8C4]/70 hover:text-red-400 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          disabled={loading || updateLoading}
          onClick={() => {
            dispatch(setBrandIQError(null));
            setBrandDetailsFormNumber(1);
            setAnalysisError('');
          }}
          className="flex items-center gap-1.5 rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-5 py-2.5 text-[13px] font-medium text-[#7A7369] shadow-xs transition-all hover:bg-[#EAE5DC] hover:text-[#24211D] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Previous
        </button>
        <button
          type="submit"
          disabled={!isStep2Valid() || loading || updateLoading}
          className="rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-7 py-2.5 text-[13px] font-semibold whitespace-nowrap text-white shadow-[0_2px_8px_rgba(21,220,255,0.25)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading || updateLoading ? (
            <div className="flex items-center gap-1.5">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              <span>{brandData ? 'Updating brand...' : 'Setting up brand...'}</span>
            </div>
          ) : brandData ? (
            'Save'
          ) : (
            'Add Brand'
          )}
        </button>
      </div>
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* Only show the trigger button if no brandData is provided */}
        {!brandData &&
          (fromComponent === 'topheader' ? (
            <button className="text-10 group relative flex items-center justify-center rounded-full border border-[#DDD7CD] bg-[#FCFAF7] p-[0.5px] px-5 py-1.5 text-[#24211D] shadow-xs hover:bg-[#EAE5DC] 2xl:py-2 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:text-white">
              <span className="flex items-center gap-1.5 rounded-full">
                <Plus className="!h-3.5 !w-3.5 text-[#02C8C4] 2xl:h-5 2xl:w-5" />
                <span className="bg-gradient-to-t from-[#0c9fbd] to-[#5057d6] bg-clip-text font-semibold text-transparent dark:from-[#15DCFF] dark:to-[#6b72f8]">
                  Add Brand
                </span>
              </span>
            </button>
          ) : (
            <button className="mt-4 rounded-full border border-[#DDD7CD] bg-[#FCFAF7] shadow-xs hover:bg-[#EAE5DC] dark:border-0 dark:bg-gradient-to-br dark:from-[#202020]/50 dark:to-[#202020]/50">
              <div className="prompt_selection_button flex items-center gap-2 rounded-full px-5 py-2 transition-all">
                <Plus className="h-4 w-4 text-[#02C8C4]" />
                <span className="bg-gradient-to-t from-[#0c9fbd] to-[#5057d6] bg-clip-text font-semibold text-transparent dark:from-[#15DCFF] dark:to-[#6b72f8]">
                  Add Brand
                </span>
              </div>
            </button>
          ))}
      </DialogTrigger>
      <DialogContent
        className="light-glass-dialog mx-auto max-h-[95vh] w-[95%] max-w-[750px]! scale-100 overflow-x-hidden overflow-y-auto rounded-2xl border border-[#DDD7CD] bg-[var(--ws-surface-control)] py-7 text-[#24211D] shadow-[0_20px_50px_rgba(80,70,58,0.12)] backdrop-blur-[100px] dark:border-white/10 dark:bg-[#141414]/95 dark:text-white"
        onInteractOutside={(e) => {
          if (isAnalyzing) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isAnalyzing) e.preventDefault();
        }}
        showCloseButton={!isAnalyzing}
      >
        <DialogHeader className="relative px-4 pt-3">
          <DialogTitle className="text-center text-xl font-semibold">
            {brandDetailsFormNumber === 0 ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2.5">
                  <span className="bg-gradient-to-t from-[#0c9fbd] to-[#5057d6] bg-clip-text text-2xl font-semibold text-transparent dark:from-[#15DCFF] dark:to-[#5E66F5]">
                    Welcome to AdsGPT
                  </span>
                </div>
                <div className="text-sm font-normal text-[#7A7369] dark:text-[#afafaf]">
                  Configure your brand for advertising campaigns
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Target className="h-6 w-6 text-[#24211D] dark:text-white" />
                <span className="text-xl font-medium text-[#24211D] md:text-2xl dark:text-white">
                  {brandData ? 'Edit Brand' : 'Brand Configuration'}
                </span>
              </div>
            )}
          </DialogTitle>

          {brandDetailsFormNumber > 0 && (
            <div className="mt-2 flex justify-center">
              <div className="flex items-center gap-1">
                {[1, 2].map((step) => (
                  <div key={step} className="flex items-center gap-1.5">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-medium ${brandDetailsFormNumber >= step
                          ? 'border-[#02C8C4] bg-[#02C8C4]/15 text-[#24211D] dark:border-white dark:bg-blue-500/10 dark:text-white'
                          : 'border-[#DDD7CD] text-[#7A7369] dark:border-[#676E74] dark:text-[#676E74]'
                        }`}
                    >
                      {step}
                    </div>
                    {step < 2 && (
                      <div
                        className={`h-1 w-16 ${brandDetailsFormNumber > step ? 'bg-[#02C8C4] dark:bg-white' : 'bg-[#DDD7CD] dark:bg-[#676E74]'
                          }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogHeader>

        <form onSubmit={formik.handleSubmit} className="flex flex-col gap-3 px-4 py-2">
          {brandDetailsFormNumber === 0 && renderWelcomeStep()}
          {brandDetailsFormNumber === 1 && renderStep1()}
          {brandDetailsFormNumber === 2 && renderStep2()}
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddNewBrand;
