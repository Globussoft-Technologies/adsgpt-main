import { useState } from 'react';
import { useFormik } from 'formik';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft,
  ArrowRight,
  CloudUpload,
  Info,
  LoaderCircle,
  X,
  Sparkles,
  Target,
  Paperclip,
  Link,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { analazeDomain, createBrandList } from '@/store/actions/brandIQ/myBrandActions';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import {
  checkImageTransparency,
  fileToBase64,
  tooltipDescriptions,
  urlToBase64,
  validateUrl,
} from '@/utils/MyBrand/FileHandle';
import ShowProductImages from '../Cards/ShowProductImages';
import { useNavigate } from 'react-router-dom';
import { setBrandIQLoading } from '@/store/reducers/brandIQ/brandIQTabsSlice';

import { GA4Events, generateStableId } from '@/utils/ga4';
import { useEffect, useRef } from 'react';

import {
  INPUT_BASE,
  INPUT_ERROR_RING,
  UPLOAD_FIELD_WRAPPER,
  UPLOAD_BUTTON,
} from '@/components/AdStudio/AdCreativeNew/components/AdStudioPrimitives';


const OnBoardBrandDialog = () => {
  const [brandDetailsFormNumber, setBrandDetailsFormNumber] = useState(0);
  const flowIdRef = useRef(generateStableId('onboard'));

  useEffect(() => {
    GA4Events.onboardingStarted({ flow_id: flowIdRef.current });
  }, []);
  const { loading } = useSelector((state) => state.brandIQTabs);
  const [isOpen, setIsOpen] = useState(true);
  const { userData } = useSelector((state) => state.socket);
  const dispatch = useDispatch();
  const [brandLogos, setBrandLogos] = useState([]);
  const [productImages, setProductImages] = useState([]);
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

  const navigate = useNavigate();

  const handleAnalyzeWebsite = async () => {
    if (!analyzeWebsiteUrl) return;

    // const websiteError = validateUrl(analyzeWebsiteUrl, 'websiteUrl');
    // if (websiteError) {
    //   setAnalysisError('Please enter a valid URL');
    //   return;
    // }

    setIsAnalyzing(true);
    setAnalysisError('');

    try {
      const result = await analazeDomain(analyzeWebsiteUrl);
      if (result?.status == 500) {
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
      formik.setValues({
        ...formik.values,
        brandName: result?.meta?.title || '',
        brandDescription: result?.aiInsights?.aiSummary || '',
        websiteUrl: result?.url || analyzeWebsiteUrl,
      });

      const originalUrls = {
        'Brand Logos*': [],
        'Product Image*': [],
      };

      if (result?.images?.length > 0) {
        const validImages = result?.images?.filter(
          (url) => !url.includes('undefined') && !url.includes('.svg')
        );
        originalUrls['Product Image*'] = validImages;
      }

      setOriginalFileUrls(originalUrls);
      GA4Events.brandSetupStarted({ flow_id: flowIdRef.current });
      setBrandDetailsFormNumber(1);
    } catch (error) {
      setAnalysisError('Failed to analyze website. Please try again or enter details manually.');
      console.error('Website analysis error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSkipToManual = () => {
    GA4Events.brandSetupStarted({ flow_id: flowIdRef.current });
    setBrandDetailsFormNumber(1);
  };

  const handleSkipToRedirect = () => {
    navigate('/adstudio');
  };
  const rulesConfig = {
    'Brand Logos*': {
      types: ['image/png', 'image/jpeg'],
      maxSize: 2 * 1024 * 1024,
      maxFiles: 5,
      checkTransparency: true,
      single: false,
    },
    'Product Image*': {
      types: ['image/png', 'image/jpeg', 'image/*'],
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
        errors.push(`${label} must be one of: ${rules?.types?.join(', ')}`);
        continue;
      }

      if (file.size > rules?.maxSize) {
        errors.push(`${label} must be < ${Math.round(rules?.maxSize / 1024)}KB`);
        continue;
      }

      if (rules?.checkTransparency) {
        const hasTransparency = await checkImageTransparency(file);
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
      brandName: '',
      brandDescription: '',
      websiteUrl: '',
      instagramUrl: '',
      facebookUrl: '',
      linkedinUrl: '',
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
        if (brandLogos.length === 0 && !values.brandLogoError) {
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

        const newBrand = {
          id: '',
          userId: userData?.user_id,
          brandName: values.brandName.trim(),
          brandDescription: values.brandDescription || '',
          logoBase64s: await processFiles(brandLogos, originalSelectedUrls['Brand Logos*']),
          imageBase64: await processProductFiles(
            productImages,
            originalSelectedUrls['Product Image*']
          ),
          websiteUrl: values.websiteUrl.trim() || '',
          instagramUrl: values.instagramUrl || '',
          facebookUrl: values.facebookUrl || '',
          linkedinUrl: values.linkedinUrl || '',
        };
        await dispatch(createBrandList(newBrand));
        GA4Events.onboardingCompleted({ flow_id: flowIdRef.current });
        GA4Events.brandCreated({ flow_id: flowIdRef.current, feature: 'brand_iq' });
        setIsOpen(false);
        formik.resetForm();
        navigate('/brandiq', { state: { from: 'onBoard' } });
      } catch (error) {
        console.error('Brand creation error:', error);
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
      const uniqueNew = valid?.filter(
        (f) => !brandLogos.some((ex) => ex.name === f.name && ex.size === f.size)
      );
      const newFiles = [...brandLogos, ...uniqueNew]?.slice(0, rules.maxFiles);
      setBrandLogos(newFiles);
      formik.setFieldError('brandLogoError', '');
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
      const uniqueNew = valid?.filter(
        (f) => !productImages?.some((ex) => ex.name === f.name && ex.size === f.size)
      );
      const newFiles = [...productImages, ...uniqueNew]?.slice(0, rules?.maxFiles);
      setProductImages(newFiles);
      formik.setFieldError('productImageError', '');
      formik.setFieldError('productImage', '');
    }

    e.target.value = '';
  };

  const handleRemoveBrandLogo = (index) => {
    setBrandLogos((prev) => {
      const updated = prev?.filter((_, i) => i !== index);
      if (updated?.length > 0) {
        formik.setFieldError('brandLogoError', '');
        formik.setFieldError('brandLogo', '');
      }
      return updated;
    });
  };

  const handleRemoveProductImage = (index) => {
    setProductImages((prev) => {
      const updated = prev?.filter((_, i) => i !== index);
      if (updated?.length > 0 || originalSelectedUrls['Product Image*']?.length > 0) {
        formik.setFieldError('productImageError', '');
        formik.setFieldError('productImage', '');
      }
      return updated;
    });
  };

  const handleOpenChange = (open) => {
    setIsOpen(open);
    if (!open) {
      setTimeout(() => {
        setBrandDetailsFormNumber(1);
        setBrandLogos([]);
        setProductImages([]);
        setOriginalFileUrls({
          'Brand Logos*': [],
          'Product Image*': [],
        });
        formik.resetForm();
      }, 200);
    }
  };

  const isStep1Valid = () => {
    const totalProductImages =
      productImages?.length + originalSelectedUrls['Product Image*']?.length;
    const hasBrandLogoErrors = formik.errors.brandLogo || formik.errors.brandLogoError;
    const hasProductImageErrors = formik.errors.productImage || formik.errors.productImageError;
    const hasBrandErr = hasBrandLogoErrors?.includes('select');
    const hasProductErr = hasProductImageErrors?.includes('select');
    return (
      formik.values.brandName.trim() &&
      formik.values.brandDescription.trim() &&
      brandLogos?.length > 0 &&
      !formik.errors.brandName &&
      !formik.errors.brandDescription &&
      (!hasBrandLogoErrors || hasBrandErr) &&
      (!hasProductImageErrors || hasProductErr)
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

  const handleProductImageSelect = (imageURL) => {
    const originalUrls = {
      'Brand Logos*': [],
      'Product Image*': imageURL,
    };
    setOriginalSelectedUrls(originalUrls);
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
        <label className="flex items-center gap-2 text-base font-medium text-white">
          Website Analysis
        </label>
        <div className="relative flex items-center justify-between rounded-md bg-[#90929430]! px-3 focus-within:ring-3 focus-within:ring-white/20">
          <Input
            type="url"
            value={analyzeWebsiteUrl}
            onChange={(e) => setAnalyzeWebsiteUrl(e.target.value)}
            autoComplete="off"
            className="h-10 w-[90%] border-0! bg-transparent! px-0 pr-3 text-sm text-white placeholder:text-[#afafaf] focus-visible:ring-0 focus-visible:ring-offset-0 lg:w-[95%]"
            placeholder="Enter website URL for automatic setup"
          />
          <Link className="h-4 w-4 text-[#909294]" />
        </div>
        {analysisError && <p className="text-xs text-red-400">{analysisError}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={handleSkipToRedirect}
          disabled={isAnalyzing}
          className="rounded-md border border-white/20 bg-[#20202080] px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-[#90929430] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSkipToManual}
            disabled={isAnalyzing}
            className="rounded-md border border-white/20 bg-[#20202080] px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#90929430] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Manual Setup
          </button>
          <button
            type="button"
            onClick={handleAnalyzeWebsite}
            disabled={!analyzeWebsiteUrl || isAnalyzing}
            className="flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-bold whitespace-nowrap text-[#151515] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className={UPLOAD_FIELD_WRAPPER}>
        <label className={`${UPLOAD_BUTTON} cursor-pointer`}>
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple={true}
            className="hidden"
            onChange={handleBrandLogoChange}
            onBlur={formik.handleBlur}
          />
          <CloudUpload className="h-3.5 w-3.5" />
          Upload
        </label>
        <span className="text-[12px] font-light text-gray-500 dark:text-white/60">
          {brandLogos?.length === 0 ? 'No files selected' : `${brandLogos?.length} files selected`}
        </span>
      </div>

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
      <div className={UPLOAD_FIELD_WRAPPER}>
        <label className={`${UPLOAD_BUTTON} cursor-pointer`}>
          <input
            type="file"
            accept="image/*"
            multiple={true}
            className="hidden"
            onChange={handleProductImageChange}
            onBlur={formik.handleBlur}
          />
          <CloudUpload className="h-3.5 w-3.5" />
          Upload
        </label>
        <span className="text-[12px] font-light text-gray-500 dark:text-white/60">
          {productImages?.length === 0
            ? 'No files selected'
            : `${productImages?.length} files selected`}
        </span>
      </div>

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

      {formik.touched.productImage && getFileFieldError('productImage') && (
        <p className="text-xs text-red-400">{getFileFieldError('productImage')}</p>
      )}

      <ShowProductImages
        Images={originalFileUrls['Product Image*']}
        onImageSelect={handleProductImageSelect}
        selectedLogo={formik.values.productImage}
        currentSelectedCount={productImages?.length}
      />
    </div>
  );

  const renderStep1 = () => (
    <>
      <div className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-gray-800 dark:text-white/90">Brand Identity</label>
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
        <label className="text-[13px] font-medium text-gray-800 dark:text-white/90">Brand Description</label>
        <Textarea
          name="brandDescription"
          value={formik.values.brandDescription}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
          className={`min-h-[85px] max-h-[110px] w-full rounded-[20px] bg-[#f3f4f6] dark:bg-[#202124] border border-gray-300 dark:border-white/10 p-4 text-[13px] font-normal text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-[#afafaf]/70 focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-white/20 transition-all ${formik.touched.brandDescription && formik.errors.brandDescription ? INPUT_ERROR_RING : ''}`}
          placeholder="Describe your brand for campaign optimization"
        />
        {formik.touched.brandDescription && formik.errors.brandDescription && (
          <p className="text-xs text-red-400">{formik.errors.brandDescription}</p>
        )}
      </div>

      {renderBrandLogoUpload()}
      {renderProductImageUpload()}

      <div className="flex items-center justify-between pt-3">
        <button
          type="button"
          onClick={() => setBrandDetailsFormNumber(0)}
          className="flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 bg-gray-100 dark:bg-white/5 px-5 py-2.5 text-[13px] font-medium text-gray-700 dark:text-white transition-all hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <button
          type="button"
          onClick={handleNextStep}
          disabled={!isStep1Valid()}
          className="flex items-center gap-1.5 rounded-full bg-gray-900 text-white dark:bg-white dark:text-black px-6 py-2.5 text-[13px] font-medium transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </>
  );

  const renderStep2 = () => (
    <>
      <div className="flex flex-col gap-3">
        <label className="text-base font-medium text-gray-200">Digital Presence</label>

        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2 text-gray-300">Website URL</label>
          <Input
            type="url"
            name="websiteUrl"
            value={formik.values.websiteUrl}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            autoComplete="off"
            className="h-10 rounded-sm border-0! bg-[#90929430]! text-sm text-white placeholder:text-[#afafaf]"
            placeholder="https://example.com"
          />
          {formik.touched.websiteUrl && formik.errors.websiteUrl && (
            <p className="text-xs text-red-400">{formik.errors.websiteUrl}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-gray-300">Instagram</label>
            <Input
              type="url"
              name="instagramUrl"
              value={formik.values.instagramUrl}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              autoComplete="off"
              className="h-10 rounded-sm border-0! bg-[#90929430]! text-sm text-white placeholder:text-[#afafaf] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="https://instagram.com/username"
            />
            {formik.touched.instagramUrl && formik.errors.instagramUrl && (
              <p className="text-xs text-red-400">{formik.errors.instagramUrl}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-gray-300">Facebook</label>
            <Input
              type="url"
              name="facebookUrl"
              value={formik.values.facebookUrl}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              autoComplete="off"
              className="h-10 rounded-sm border-0! bg-[#90929430]! text-sm text-white placeholder:text-[#afafaf] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="https://facebook.com/username"
            />
            {formik.touched.facebookUrl && formik.errors.facebookUrl && (
              <p className="text-xs text-red-400">{formik.errors.facebookUrl}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2 text-gray-300">LinkedIn</label>
          <Input
            type="url"
            name="linkedinUrl"
            value={formik.values.linkedinUrl}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            autoComplete="off"
            className="h-10 rounded-sm border-0! bg-[#90929430]! text-sm text-white placeholder:text-[#afafaf] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="https://linkedin.com/in/username"
          />
          {formik.touched.linkedinUrl && formik.errors.linkedinUrl && (
            <p className="text-xs text-red-400">{formik.errors.linkedinUrl}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-3">
        <button
          type="button"
          disabled={loading}
          onClick={() => setBrandDetailsFormNumber(1)}
          className="flex items-center gap-1.5 rounded-md border border-white/20 bg-[#20202080] px-4 py-2 text-sm text-[#E8E8E8] transition-colors hover:bg-[#90929430] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="submit"
          disabled={!isStep2Valid() || loading}
          className="rounded-sm bg-white px-6 py-2 text-sm font-bold text-[#151515] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <div className="flex items-center gap-1">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              <span>Setting up brand...</span>
            </div>
          ) : (
            'Complete Setup'
          )}
        </button>
      </div>
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="glow-box mx-auto max-h-[95vh] w-[95%] max-w-[800px]! scale-100 overflow-x-hidden overflow-y-auto rounded-2xl border border-gray-700 bg-[#13162782] py-7 text-white backdrop-blur-[130px]"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader className="relative px-4 pt-3">
          <DialogTitle className="text-center text-xl font-semibold">
            {brandDetailsFormNumber === 0 ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2.5">
                  <span className="bg-gradient-to-t from-[#15DCFF] to-[#5E66F5] bg-clip-text text-2xl font-semibold text-transparent">
                    Welcome to AdsGPT
                  </span>
                </div>
                <div className="text-sm font-normal text-[#afafaf]">
                  Configure your brand for advertising campaigns
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Target className="h-6 w-6 text-white" />
                <span className="text-xl font-medium md:text-2xl">Brand Configuration</span>
              </div>
            )}
          </DialogTitle>

          {brandDetailsFormNumber > 0 && (
            <div className="mt-5 flex justify-center">
              <div className="flex items-center gap-1">
                {[1, 2].map((step) => (
                  <div key={step} className="flex items-center gap-1.5">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-medium ${brandDetailsFormNumber >= step
                          ? 'border-white bg-blue-500/10 text-white'
                          : 'border-[#676E74] text-[#676E74]'
                        }`}
                    >
                      {step}
                    </div>
                    {step < 2 && (
                      <div
                        className={`h-1 w-16 ${brandDetailsFormNumber > step ? 'bg-white' : 'bg-[#676E74]'
                          }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogHeader>

        <form onSubmit={formik.handleSubmit} className="flex flex-col gap-5 px-4 py-2">
          {brandDetailsFormNumber === 0 && renderWelcomeStep()}
          {brandDetailsFormNumber === 1 && renderStep1()}
          {brandDetailsFormNumber === 2 && renderStep2()}
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default OnBoardBrandDialog;
