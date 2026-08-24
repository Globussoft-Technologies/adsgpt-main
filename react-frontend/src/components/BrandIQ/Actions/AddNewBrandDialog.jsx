import { useState, useEffect, useMemo } from 'react';
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
import CategoryCombobox from './CategoryCombobox';
import { ArrowLeft, ArrowRight, CloudUpload, Info, LoaderCircle, Plus, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import {
  createBrandList,
  fetchBrands,
  removeBrandImage,
  updateBrandList,
} from '@/store/actions/brandIQ/myBrandActions';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { getClipboardImageFiles } from '@/utils/clipboardImages';
import {
  checkImageTransparency,
  fileToBase64,
  tooltipDescriptions,
  urlToFile,
  validateUrl,
} from '@/utils/MyBrand/FileHandle';
import { setBrandIQError } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { useDynamicBackground } from '@/hooks/useDynamicBackground';
import { GA4Events } from '@/utils/ga4';
import { globalToast } from '@/utils/globalToast';

const AddNewBrandDialog = ({ fromComponent, brandData, setEditingBrand }) => {
  const [brandDetailsFormNumber, setBrandDetailsFormNumber] = useState(1);
  const { loading, updateLoading, error } = useSelector((state) => state.brandIQTabs);
  const [isOpen, setIsOpen] = useState(false);
  const { userData } = useSelector((state) => state.socket);
  const dispatch = useDispatch();
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [removedImages, setRemovedImages] = useState([]);
  const [brandLogos, setBrandLogos] = useState([]);
  const [brandIcons, setBrandIcons] = useState([]);
  const [productImages, setProductImages] = useState([]);

  const [originalFileUrls, setOriginalFileUrls] = useState({
    'Brand Logos*': [],
    'Brand Icon': [],
    'Product Image': [],
  });

  const [fileTypeLoading, setFileTypeLoading] = useState({
    'Brand Logos*': 0,
    'Brand Icon': 0,
    'Product Image': 0,
  });
  // Function to load brand data including images
  const loadBrandData = async (brandData) => {
    if (!brandData) return;
    setIsFileLoading(true);
    setFileTypeLoading({
      'Brand Logos*': brandData?.logoUrls?.length || 0,
      'Brand Icon': brandData?.iconUrl ? 1 : 0,
      'Product Image': brandData?.imageUrl?.length || 0,
    });
    formik.setValues({
      id: brandData?.id || '',
      brandName: brandData?.name || '',
      brandDescription: brandData?.description || '',
      websiteUrl: brandData?.websiteUrl || '',
      instagramUrl: brandData?.instagramUrl || '',
      facebookUrl: brandData?.facebookUrl || '',
      linkedinUrl: brandData?.linkedinUrl || '',
      region: brandData?.region || '',
      category: brandData?.category || '',
      brandLogo: brandData?.logoUrls || [],
      brandIcon: brandData?.iconUrl || '',
      productImage: brandData?.imageUrl || [],
    });

    try {
      const filesToSet = {
        'Brand Logos*': [],
        'Brand Icon': [],
        'Product Image': [],
      };

      const originalUrls = {
        'Brand Logos*': [],
        'Brand Icon': [],
        'Product Image': [],
      };

      if (brandData?.logoUrls && brandData?.logoUrls?.length > 0) {
        for (const logoUrl of brandData.logoUrls) {
          const file = await urlToFile(logoUrl, `${Date.now()}.png`);
          if (file) {
            filesToSet['Brand Logos*'].push(file);
            originalUrls['Brand Logos*'].push(logoUrl);
          }
        }
      }
      if (brandData?.iconUrl) {
        const file = await urlToFile(brandData?.iconUrl, `${Date.now()}.png`);
        if (file) {
          filesToSet['Brand Icon'].push(file);
          originalUrls['Brand Icon'].push(brandData.iconUrl);
        }
      }
      if (brandData?.imageUrl && brandData?.imageUrl?.length > 0) {
        for (const imageUrl of brandData.imageUrl) {
          const file = await urlToFile(imageUrl, `${Date.now()}.png`);
          if (file) {
            filesToSet['Product Image'].push(file);
            originalUrls['Product Image'].push(imageUrl);
          }
        }
      }

      setBrandLogos(filesToSet['Brand Logos*']);
      setBrandIcons(filesToSet['Brand Icon']);
      setProductImages(filesToSet['Product Image']);
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

  const rulesConfig = {
    'Brand Logos*': {
      types: ['image/png', 'image/jpeg'],
      maxSize: 2 * 1024 * 1024,
      maxFiles: 5,
      checkTransparency: true,
      single: false,
    },
    'Brand Icon': {
      types: ['image/png', 'image/jpeg'],
      maxSize: 200 * 1024,
      maxFiles: 1,
      checkTransparency: true,
      single: true,
    },
    'Product Image': {
      types: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'],
      maxSize: 5 * 1024 * 1024,
      maxFiles: 5,
      checkTransparency: false,
      single: false,
    },
  };

  const validateFiles = async (files, rules, label) => {
    const errors = [];
    const validFiles = [];
    if (isFileLoading) return false;
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

  // Separate file handlers for each type
  const handleBrandLogoChange = async (e) => {
    const filesArray = Array.from(e.target.files);
    const rules = rulesConfig['Brand Logos*'];
    let errorMsg = '';

    formik.setFieldTouched('brandLogo', true, false);
    const existingCount = brandLogos?.length;
    const newFilesCount = filesArray?.length;

    if (rules?.maxFiles && existingCount + newFilesCount > rules?.maxFiles) {
      errorMsg = `You can select up to ${rules.maxFiles} brand logos only`;
      formik.setFieldError('brandLogo', errorMsg);
      e.target.value = '';
      return;
    }

    const { valid, errors: validationErrors } = await validateFiles(
      filesArray,
      rules,
      'Brand Logos'
    );

    if (validationErrors?.length > 0) {
      errorMsg = validationErrors[0];
      formik.setFieldError('brandLogo', errorMsg);
      e.target.value = '';
      return;
    }

    if (valid?.length > 0) {
      const uniqueNew = valid?.filter(
        (f) => !brandLogos?.some((ex) => ex.name === f.name && ex.size === f.size)
      );
      const newFiles = [...brandLogos, ...uniqueNew]?.slice(0, rules?.maxFiles);
      setBrandLogos(newFiles);
      formik.setFieldError('brandLogo', '');
    }

    e.target.value = '';
  };

  const handleBrandIconChange = async (e) => {
    const filesArray = Array.from(e.target.files);
    const rules = rulesConfig['Brand Icon'];
    let errorMsg = '';

    formik.setFieldTouched('brandIcon', true, false);

    const { valid, errors: validationErrors } = await validateFiles(
      filesArray,
      rules,
      'Brand Icon'
    );

    if (validationErrors?.length > 0) {
      errorMsg = validationErrors[0];
      formik.setFieldError('brandIcon', errorMsg);
      e.target.value = '';
      return;
    }

    if (valid?.length > 0) {
      setBrandIcons(valid?.slice(0, 1));
      formik.setFieldError('brandIcon', '');
    }

    e.target.value = '';
  };

  const handleProductImageChange = async (e) => {
    const filesArray = Array.from(e.target.files);
    const rules = rulesConfig['Product Image'];
    let errorMsg = '';

    formik.setFieldTouched('productImage', true, false);
    const existingCount = productImages?.length;
    const newFilesCount = filesArray?.length;

    if (rules?.maxFiles && existingCount + newFilesCount > rules?.maxFiles) {
      errorMsg = `You can select up to ${rules?.maxFiles} product images only`;
      formik.setFieldError('productImage', errorMsg);
      e.target.value = '';
      return;
    }

    const { valid, errors: validationErrors } = await validateFiles(
      filesArray,
      rules,
      'Product Images'
    );

    if (validationErrors?.length > 0) {
      errorMsg = validationErrors[0];
      formik.setFieldError('productImage', errorMsg);
      e.target.value = '';
      return;
    }

    if (valid?.length > 0) {
      const uniqueNew = valid?.filter(
        (f) => !productImages?.some((ex) => ex.name === f.name && ex.size === f.size)
      );
      const newFiles = [...productImages, ...uniqueNew]?.slice(0, rules?.maxFiles);
      setProductImages(newFiles);
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
  const handleBrandIconPaste = async (e) => {
    const files = getClipboardImageFiles(e.clipboardData, 1);
    if (!files.length) return;
    e.preventDefault();
    await handleBrandIconChange({ target: { files, value: '' } });
  };
  const handleProductImagePaste = async (e) => {
    const files = getClipboardImageFiles(e.clipboardData, 5);
    if (!files.length) return;
    e.preventDefault();
    await handleProductImageChange({ target: { files, value: '' } });
  };

  // Separate remove handlers
  const handleRemoveBrandLogo = async (index) => {
    const file = brandLogos[index];

    if (brandData && (file?.originalUrl || originalFileUrls['Brand Logos*'][index])) {
      const originalUrl = file?.originalUrl || originalFileUrls['Brand Logos*'][index];
      setRemovedImages((prev) => [...prev, { label: 'Brand Logos*', originalUrl }]);
    }

    setBrandLogos((prev) => {
      const updated = prev?.filter((_, i) => i !== index);
      if (updated?.length > 0) {
        formik.setFieldError('brandLogo', '');
      }
      return updated;
    });

    setOriginalFileUrls((prev) => {
      const updated = prev['Brand Logos*']?.filter((_, i) => i !== index);
      return { ...prev, 'Brand Logos*': updated };
    });
  };

  const handleRemoveBrandIcon = async (index) => {
    const file = brandIcons[index];

    if (brandData && (file?.originalUrl || originalFileUrls['Brand Icon'][index])) {
      const originalUrl = file?.originalUrl || originalFileUrls['Brand Icon'][index];
      setRemovedImages((prev) => [...prev, { label: 'Brand Icon', originalUrl }]);
    }

    setBrandIcons([]);
    formik.setFieldError('brandIcon', '');

    setOriginalFileUrls((prev) => {
      return { ...prev, 'Brand Icon': [] };
    });
  };

  const handleRemoveProductImage = async (index) => {
    const file = productImages[index];

    if (brandData && (file?.originalUrl || originalFileUrls['Product Image'][index])) {
      const originalUrl = file?.originalUrl || originalFileUrls['Product Image'][index];
      setRemovedImages((prev) => [...prev, { label: 'Product Image', originalUrl }]);
    }

    setProductImages((prev) => {
      const updated = prev?.filter((_, i) => i !== index);
      if (updated?.length > 0) {
        formik.setFieldError('productImage', '');
      }
      return updated;
    });

    setOriginalFileUrls((prev) => {
      const updated = prev['Product Image']?.filter((_, i) => i !== index);
      return { ...prev, 'Product Image': updated };
    });
  };

  const formik = useFormik({
    initialValues: {
      brandName: '',
      brandDescription: '',
      websiteUrl: '',
      instagramUrl: '',
      facebookUrl: '',
      linkedinUrl: '',
      region: '',
      category: '',
      brandLogo: '',
      brandIcon: '',
      productImage: '',
    },
    validateOnBlur: true,
    validateOnChange: true,
    validate: (values) => {
      const errors = {};

      if (isFileLoading) return {};
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

        // if (brandIcons.length === 0) {
        //   errors.brandIcon = 'Brand icon is required';
        // }
        // if (productImages.length === 0) {
        //   errors.productImage = 'Product image is required';
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
        const processFiles = async (files, originalUrls, label) => {
          const result = [];

          for (let i = 0; i < files?.length; i++) {
            const file = files[i];
            const originalUrl = originalUrls[i];

            if (file?.originalUrl || originalUrl) {
              result.push(file.originalUrl || originalUrl);
            } else {
              const base64 = await fileToBase64(file);
              result.push(base64);
            }
          }
          return result;
        };

        const newBrand = {
          id: brandData?.id || '',
          userId: userData?.user_id,
          brandName: values.brandName.trim(),
          brandDescription: values.brandDescription || '',
          logoBase64s: await processFiles(
            brandLogos,
            originalFileUrls['Brand Logos*'],
            'Brand Logos*'
          ),
          iconBase64:
            (await processFiles(brandIcons, originalFileUrls['Brand Icon'], 'Brand Icon'))[0] || '',
          imageBase64: await processFiles(
            productImages,
            originalFileUrls['Product Image'],
            'Product Image'
          ),
          websiteUrl: values.websiteUrl.trim() || '',
          instagramUrl: values.instagramUrl || '',
          facebookUrl: values.facebookUrl || '',
          linkedinUrl: values.linkedinUrl || '',
          region: values.region.trim() || null,
          category: values.category || undefined,
        };

        if (brandData) {
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
          await dispatch(updateBrandList(newBrand)).unwrap();
          GA4Events.brandUpdated({ feature: 'brand_iq' });
          setRemovedImages([]);
          setEditingBrand(false);
        } else {
          await dispatch(createBrandList(newBrand)).unwrap();
          GA4Events.brandCreated({ feature: 'brand_iq' });
          globalToast.success('Brand created successfully!');
        }
        setBrandDetailsFormNumber(1);
        setBrandLogos([]);
        setBrandIcons([]);
        setProductImages([]);
        setOriginalFileUrls({
          'Brand Logos*': [],
          'Brand Icon': [],
          'Product Image': [],
        });
        setIsOpen(false);
        formik.resetForm();
        dispatch(fetchBrands(userData?.user_id));
      } catch (error) {
        console.error(error);
      }
    },
  });

  useEffect(() => {
    const hasMaxFilesError = formik.errors?.brandLogo?.includes('select');
    const hasMaxFilesErrorProductImage = formik.errors?.productImage?.includes('select');
    if (brandData && !isFileLoading && !hasMaxFilesError && !hasMaxFilesErrorProductImage) {
      formik.validateForm();
    }
  }, [brandLogos, brandIcons, productImages, isFileLoading, brandData]);

  const handleOpenChange = (open) => {
    setIsOpen(open);
    if (open) {
      GA4Events.brandSetupStarted();
    }
    if (brandData) setEditingBrand(open);
    if (!open) {
      setTimeout(() => {
        dispatch(setBrandIQError(null));
        setBrandDetailsFormNumber(1);
        setBrandLogos([]);
        setBrandIcons([]);
        setProductImages([]);
        setOriginalFileUrls({
          'Brand Logos*': [],
          'Brand Icon': [],
          'Product Image': [],
        });
        formik.resetForm();
      }, 200);
    }
  };

  const isStep1Valid = () => {
    if (isFileLoading) return false;
    const isMaxFilesError = formik.errors?.brandLogo?.includes('You can select up to');
    const isProductImageMaxFilesError =
      formik.errors?.productImage?.includes('You can select up to');
    return (
      formik.values.brandName.trim() &&
      formik.values.brandDescription.trim() &&
      brandLogos.length > 0 &&
      !formik.errors.brandName &&
      !formik.errors.brandDescription &&
      (!formik.errors.brandLogo || isMaxFilesError) &&
      (!formik.errors.productImage || isProductImageMaxFilesError)
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

  const handleNextStep = async () => {
    const errors = await formik.validateForm();
    const step1Errors = {};

    if (!formik.values.brandName.trim()) {
      step1Errors.brandName = 'Brand name is required';
    }
    if (!formik.values.brandDescription.trim()) {
      step1Errors.brandDescription = 'Brand description is required';
    }
    if (brandLogos.length === 0) {
      step1Errors.brandLogo = 'Brand logo is required';
    }

    Object.keys(step1Errors)?.forEach((key) => {
      formik.setFieldError(key, step1Errors[key]);
      formik.setFieldTouched(key, true);
    });

    if (Object.keys(step1Errors)?.length === 0) {
      setBrandDetailsFormNumber(2);
    }
  };

  const uploadedFiles = useMemo(() => {
    if (!brandLogos || brandLogos.length === 0) return [];
    return brandLogos.map((file, index) => ({
      id: file.name + index,
      url: URL.createObjectURL(file),
    }));
  }, [brandLogos]);

  const fileBgColors = useDynamicBackground(uploadedFiles);

  // Helper function to render file upload section
  const renderFileUploadSection = (label, files, handleChange, handleRemove, rules) => {
    const errorKey =
      label === 'Brand Logos*'
        ? 'brandLogo'
        : label === 'Brand Icon'
          ? 'brandIcon'
          : 'productImage';

    const handlePaste =
      label === 'Brand Logos*'
        ? handleBrandLogoPaste
        : label === 'Brand Icon'
          ? handleBrandIconPaste
          : handleProductImagePaste;

    return (
      <div className="flex flex-col gap-0">
        <label className="mb-0.5 flex items-center gap-1 text-[18px] text-[#AFAFAF] 2xl:mb-1">
          {label}
          <ShadcnTooltip
            label={tooltipDescriptions[label]}
            side="right"
            className="max-w-[290px] text-sm"
          >
            <span className="cursor-pointer">
              <Info className="h-3.5 w-3.5 text-[#AFAFAF] hover:text-white" />
            </span>
          </ShadcnTooltip>
        </label>
        <div
          className="flex items-center gap-3 rounded-[50px] border border-white/10 bg-[#383838]/50 px-1.5 py-1.5 backdrop-blur-[100px]"
          onPaste={handlePaste}
          tabIndex={0}
        >
          <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded-[50px] bg-[#FFFFFF]/20 px-3 py-1.5 text-xs font-extralight text-white">
            <input
              type="file"
              accept={label === 'Product Image' ? 'image/*' : 'image/png,image/jpeg'}
              multiple={label === 'Brand Logos*' || label === 'Product Image'}
              className="hidden"
              onBlur={() => formik.setFieldTouched(errorKey, true)}
              onChange={handleChange}
            />
            <CloudUpload className="h-3.5 w-3.5" />
            Choose File
          </label>

          <span className="mb-1.5 text-[18px] text-[#AFAFAF]">
            {files?.length === 0
              ? 'No files selected'
              : `${files?.length} file(s) selected (max ${rules?.maxFiles})`}
          </span>
        </div>
        {isFileLoading && fileTypeLoading[label] > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {Array.from({ length: fileTypeLoading[label] })?.map((_, index) => (
              <div
                key={index}
                className="relative h-12 w-12 overflow-hidden rounded-md border border-white/10"
              >
                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                  <LoaderCircle className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        ) : files?.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {files?.map((file, index) => {
              const fileId = file.name + index;
              return (
                <div
                  key={index}
                  className="relative h-12 w-12 overflow-hidden rounded-md border border-white/10"
                  style={{ backgroundColor: fileBgColors[fileId] || 'transparent' }}
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute top-0 right-0 rounded-full bg-black/50 p-0.5 text-white hover:bg-black"
                    onClick={() => handleRemove(index)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {formik.touched[errorKey] && formik.errors[errorKey] && (
          <p className="mt-1 ml-1 text-xs text-red-400">{formik.errors[errorKey]}</p>
        )}
      </div>
    );
  };
  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* Only show the trigger button if no brandData is provided */}
        {!brandData &&
          (fromComponent === 'topheader' ? (
            <button className="backdrop-blur-100 text-10 group relative flex items-center justify-center rounded-full border border-white/20 bg-[#0D0D0D]/50 p-[0.5px] px-5 py-1.5 text-[#AFAFAF] hover:text-white 2xl:py-2 2xl:text-sm">
              <span className="flex items-center gap-1.5 rounded-full">
                <Plus className="!h-3.5 !w-3.5 text-[#6b72f8] group-hover:text-white/70 2xl:h-5 2xl:w-5" />
                <span className="bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text font-medium text-transparent group-hover:text-white/60">
                  Add Brand
                </span>
              </span>
            </button>
          ) : (
            <button className="mt-4 rounded-full bg-gradient-to-br from-[#202020]/50 to-[#202020]/50 hover:from-[#222222] hover:to-[#5771F6]/50">
              <div className="prompt_selection_button flex items-center gap-2 rounded-full px-5 py-2 backdrop-blur-[100px] transition-all">
                <Plus className="h-4 w-4 text-[#6b72f8]" />
                <span className="bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text font-medium text-transparent">
                  Add Brand
                </span>
              </div>
            </button>
          ))}
      </DialogTrigger>
      <DialogContent
        className="max-w-[601px] scale-100 justify-normal overflow-y-auto rounded-[30px] border border-white/20 bg-[#303030]/50 text-white backdrop-blur-[100px] 2xl:max-h-screen"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="relative">
          <DialogTitle className="mt-2 text-center text-[22px] font-medium">
            {brandData ? 'Edit Your Brand' : 'Add New Brand'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={formik.handleSubmit} className="flex flex-col gap-[22px]">
          {brandDetailsFormNumber === 1 && (
            <>
              <div className="flex flex-col gap-0">
                <label className="mb-[13px] text-[18px] text-[#AFAFAF]">Brand Name*</label>
                <Input
                  type="text"
                  name="brandName"
                  value={formik.values.brandName}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  autoComplete="off"
                  className="h-[50px] rounded-[50px] border border-white/10 bg-[#383838]/50 text-sm text-white backdrop-blur-[100px] placeholder:text-gray-400"
                  placeholder="Enter brand name"
                />
                {formik.touched.brandName && formik.errors.brandName && (
                  <p className="mt-1 text-xs text-red-400">{formik.errors.brandName}</p>
                )}
              </div>

              <div className="flex flex-col gap-0">
                <label className="mb-[13px] text-[18px] text-[#AFAFAF]">Brand Description*</label>
                <Textarea
                  name="brandDescription"
                  value={formik.values.brandDescription}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  className="word_break h-[80px] max-h-[80px] min-h-[80px] rounded-[20px] border border-white/10 bg-[#383838]/50 text-white backdrop-blur-[100px] placeholder:text-gray-400"
                  placeholder="Enter brand description"
                />
                {formik.touched.brandDescription && formik.errors.brandDescription && (
                  <p className="mt-1 text-xs text-red-400">{formik.errors.brandDescription}</p>
                )}
              </div>

              <div className="flex flex-col gap-0">
                <label className="mb-[13px] text-[18px] text-[#AFAFAF]">Category</label>
                <CategoryCombobox
                  value={formik.values.category || ''}
                  onChange={(v) => formik.setFieldValue('category', v)}
                  triggerClassName="h-13 rounded-20 border border-white/10 bg-[#383838]/50 px-4 text-white backdrop-blur-100"
                />
              </div>

              {/* Separate file upload sections */}
              {renderFileUploadSection(
                'Brand Logos*',
                brandLogos,
                handleBrandLogoChange,
                handleRemoveBrandLogo,
                rulesConfig['Brand Logos*']
              )}

              {renderFileUploadSection(
                'Brand Icon',
                brandIcons,
                handleBrandIconChange,
                handleRemoveBrandIcon,
                rulesConfig['Brand Icon']
              )}

              {renderFileUploadSection(
                'Product Image',
                productImages,
                handleProductImageChange,
                handleRemoveProductImage,
                rulesConfig['Product Image']
              )}

              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={!isStep1Valid()}
                  className="mt-4 rounded-full bg-gradient-to-br from-[#202020]/50 to-[#202020]/50 hover:from-[#222222] hover:to-[#5771F6]/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="prompt_selection_button flex h-[58px] items-center gap-2 rounded-full px-10 py-2.5 pr-7 backdrop-blur-[100px] transition-all">
                    <span
                      className={`text-[18px] font-medium ${!isStep1Valid() ? 'text-gray-400' : 'bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-transparent'}`}
                    >
                      Next
                    </span>
                    <ArrowRight className="h-5 w-5 text-[#6b72f8]" />
                  </div>
                </button>
              </div>
            </>
          )}
          {/* after next form */}
          {brandDetailsFormNumber === 2 && (
            <>
              <div className="flex flex-col gap-0">
                <label
                  htmlFor="websiteUrl"
                  id="websiteUrl"
                  className="mb-[13px] text-[18px] text-[#AFAFAF]"
                >
                  Website URL*
                </label>
                <Input
                  type="url"
                  name="websiteUrl"
                  value={formik.values.websiteUrl}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  autoComplete="off"
                  className="h-[50px] rounded-[50px] border border-white/10 bg-[#383838]/50 text-white backdrop-blur-[100px] placeholder:text-gray-400"
                  placeholder="https://example.com"
                />
                {formik.touched.websiteUrl && formik.errors.websiteUrl && (
                  <p className="mt-1 text-xs text-red-400">{formik.errors.websiteUrl}</p>
                )}
              </div>
              <div className="flex flex-col gap-0">
                <label
                  htmlFor="instagramUrl"
                  id="instagramUrl"
                  className="mb-[13px] text-[18px] text-[#AFAFAF]"
                >
                  Instagram URL
                </label>
                <Input
                  type="url"
                  name="instagramUrl"
                  value={formik.values.instagramUrl}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  autoComplete="off"
                  className="h-[50px] rounded-[50px] border border-white/10 bg-[#383838]/50 text-white backdrop-blur-[100px] placeholder:text-gray-400"
                  placeholder="https://www.instagram.com/username"
                />
                {formik.touched.instagramUrl && formik.errors.instagramUrl && (
                  <p className="mt-1 text-xs text-red-400">{formik.errors.instagramUrl}</p>
                )}
              </div>
              <div className="flex flex-col gap-0">
                <label
                  htmlFor="facebookUrl"
                  id="facebookUrl"
                  className="mb-[13px] text-[18px] text-[#AFAFAF]"
                >
                  Facebook URL
                </label>
                <Input
                  type="url"
                  name="facebookUrl"
                  value={formik.values.facebookUrl}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  autoComplete="off"
                  className="h-[50px] rounded-[50px] border border-white/10 bg-[#383838]/50 text-white backdrop-blur-[100px] placeholder:text-gray-400"
                  placeholder="https://www.facebook.com/username"
                />
                {formik.touched.facebookUrl && formik.errors.facebookUrl && (
                  <p className="mt-1 text-xs text-red-400">{formik.errors.facebookUrl}</p>
                )}
              </div>
              <div className="flex flex-col gap-0">
                <label
                  htmlFor="linkedinUrl"
                  id="linkedinUrl"
                  className="mb-[13px] text-[18px] text-[#AFAFAF]"
                >
                  LinkedIn URL
                </label>
                <Input
                  type="url"
                  name="linkedinUrl"
                  value={formik.values.linkedinUrl}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  autoComplete="off"
                  className="h-[50px] rounded-[50px] border border-white/10 bg-[#383838]/50 text-white backdrop-blur-[100px] placeholder:text-gray-400"
                  placeholder="https://www.linkedin.com/in/username"
                />
                {formik.touched.linkedinUrl && formik.errors.linkedinUrl && (
                  <p className="mt-1 text-xs text-red-400">{formik.errors.linkedinUrl}</p>
                )}
              </div>
              <div className="flex flex-col gap-0">
                <label className="mb-[13px] text-[18px] text-[#AFAFAF]">
                  Primary Audience Region
                </label>
                <Input
                  type="text"
                  name="region"
                  value={formik.values.region}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  autoComplete="off"
                  className="h-[50px] rounded-[50px] border border-white/10 bg-[#383838]/50 text-white backdrop-blur-[100px] placeholder:text-gray-400"
                  placeholder="e.g. South India"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {['South India', 'North India', 'SE Asia', 'MENA', 'LATAM'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => formik.setFieldValue('region', chip)}
                      className={`rounded-full border px-3 py-1 text-xs transition-all ${
                        formik.values.region === chip
                          ? 'border-[#6b72f8] bg-[#6b72f8]/20 text-white'
                          : 'border-white/20 bg-white/5 text-[#AFAFAF] hover:border-white/40 hover:text-white'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="mt-0 ml-1 text-xs text-red-400">{error}</p>}
              <div className="flex flex-wrap items-center justify-center gap-5">
                <button
                  type="button"
                  disabled={loading || updateLoading}
                  onClick={() => setBrandDetailsFormNumber(1)}
                  className={`mt-4 rounded-full bg-gradient-to-br from-[#202020]/50 to-[#202020]/50 hover:from-[#222222] hover:to-[#5771F6]/50 ${
                    loading || updateLoading ? 'cursor-not-allowed opacity-50' : ''
                  }`}
                >
                  <div className="prompt_selection_button flex h-[58px] items-center gap-2.5 rounded-full px-10 py-2.5 backdrop-blur-[100px] transition-all">
                    <ArrowLeft className="h-5 w-5 text-[#6b72f8]" />
                    <span className="bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-[18px] font-medium text-transparent">
                      Prev
                    </span>
                  </div>
                </button>
                <button
                  type="submit"
                  disabled={!isStep2Valid() || loading || updateLoading}
                  className={`mt-4 rounded-full bg-gradient-to-br from-[#202020]/50 to-[#202020]/50 hover:from-[#222222] hover:to-[#5771F6]/50 ${
                    !isStep2Valid() || loading || updateLoading
                      ? 'cursor-not-allowed opacity-50'
                      : ''
                  }`}
                >
                  <div className="prompt_selection_button flex h-[58px] items-center gap-2 rounded-full px-10 py-2.5 backdrop-blur-[100px] transition-all">
                    {loading || updateLoading ? (
                      <div className="flex items-center gap-2">
                        <LoaderCircle className="h-3 w-3 animate-spin text-white" />
                        <span className="bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-[18px] font-medium text-transparent">
                          Saving
                        </span>
                      </div>
                    ) : (
                      <span className="bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-[18px] font-medium text-transparent">
                        {brandData ? 'Save' : 'Add Brand'}
                      </span>
                    )}
                  </div>
                </button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddNewBrandDialog;
