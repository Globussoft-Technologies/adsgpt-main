import React, { useState, useEffect, useRef } from 'react';
import { Formik, Form, Field, FieldArray, ErrorMessage, useFormikContext } from 'formik';
import * as Yup from 'yup';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { CloudUpload, X, Plus, Minus, Hash, RotateCcw } from 'lucide-react';
import BrandSelect from '../../AdFactory/BrandsDropDown/BrandSelect';
import InputCommonDropdown from './InputCommonDropdown';
import ColorPicker from '../../common/ColorPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fetchCampaignById, updateCampaign } from '@/store/actions/adFactoryNew/adFactoryActions';
import { setFields, updateBrandInfo } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  setActiveForm,
  setCompletedNodes,
  setFormProgress,
  updateNodeEnabledStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';
import { uploadToS3 } from '@/utils/imageUpload';
import { useSearchParams } from 'react-router-dom';
import { checkImageTransparency } from '@/utils/MyBrand/FileHandle';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;

const schema = Yup.object({
  brandName: Yup.string()
    .min(2, 'Brand name must be at least 2 characters')
    .max(100, 'Brand name must be less than 100 characters'),

  brandDescription: Yup.string()
    .required('Brand description is required')
    .min(10, 'Description must be at least 10 characters')
    .max(10000, 'Description must be less than 10000 characters'),

  category: Yup.string().optional(),

  brandLogo: Yup.array()
    .of(Yup.string().url('Please upload a valid image file with a transparent background.'))
    .max(5, 'Maximum 5 logos allowed'),

  brandVoice: Yup.array()
    .of(Yup.string().min(2, 'Brand voice item must be at least 2 characters'))
    .min(1, 'At least one brand voice item is required')
    .max(5, 'Maximum 5 brand voice items allowed'),

  brandGuidelines: Yup.object({
    toneOfVoice: Yup.string().optional(),

    dos: Yup.array()
      .of(Yup.string().min(2, 'Do item must be at least 2 characters'))
      .min(1, 'At least one "Do" is required')
      .max(5, 'Maximum 5 "Do" items allowed'),

    donts: Yup.array()
      .of(Yup.string().min(2, "Don't item must be at least 2 characters"))
      .min(1, 'At least one "Don\'t" is required')
      .max(5, 'Maximum 5 "Don\'t" items allowed'),

    colorPalette: Yup.array()
      .of(
        Yup.string().matches(
          /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
          'Must be a valid hex color code (e.g., #FFFFFF or #FFF)'
        )
      )
      .min(1, 'At least one color is required')
      .test('unique-colors', 'Colors must be unique', function (colors) {
        if (!colors) return true;
        const uniqueColors = new Set(colors.map((color) => color?.toLowerCase().trim()));
        return uniqueColors.size === colors.length;
      }),
  }),
});

const brandVoiceTags = ['Friendly', 'Modern'];
const toneOfVoiceTags = ['Formal', 'Casual'];
const dosTags = ['Benefits', 'Consistency'];
const dontsTags = ['Avoid jargon', "Don't use slang"];

const TagInput = ({
  name,
  values,
  setFieldValue,
  placeholder,
  maxTags = 5,
  disabled = false,
  tagSuggestions = [],
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showLimitError, setShowLimitError] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const handleAddTag = () => {
    const tag = inputValue.trim().replace(/,/g, '');
    if (!tag) return;

    if (values.length >= maxTags) {
      setShowLimitError(true);
      return;
    }

    if (!values.includes(tag)) {
      setFieldValue(name, [...values, tag]);
      setInputValue('');
      setShowLimitError(false);
    }
  };

  const handleRemoveTag = (indexToRemove) => {
    setFieldValue(
      name,
      values.filter((_, index) => index !== indexToRemove)
    );
    setShowLimitError(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Backspace' && inputValue === '' && values.length > 0) {
      handleRemoveTag(values.length - 1);
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    if (showLimitError) setShowLimitError(false);
    if (value.endsWith(',')) {
      const tag = value.slice(0, -1).trim();
      if (!tag) return;

      if (values.length >= maxTags) {
        setShowLimitError(true);
        return;
      }

      if (!values.includes(tag)) {
        setFieldValue(name, [...values, tag]);
        setInputValue('');
      }
    } else {
      setInputValue(value);
    }
  };

  // Blur handler
  const handleBlur = () => {
    if (inputValue.trim()) {
      handleAddTag();
    }
    setShowLimitError(false);
  };

  // Outside click handler
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        if (inputValue.trim()) {
          handleAddTag();
        }
        setShowLimitError(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inputValue, values, setFieldValue, maxTags]);

  const focusInput = () => {
    if (!disabled) inputRef.current?.focus();
  };

  const handleTagSuggestionClick = (tag) => {
    if (disabled) return;

    if (values.includes(tag)) return;

    if (values.length >= maxTags) {
      setShowLimitError(true);
      return;
    }

    setFieldValue(name, [...values, tag]);
    setShowLimitError(false);
  };

  return (
    <div ref={containerRef} className="space-y-2">
      <div
        className="input-gradient-border flex min-h-9 cursor-text bg-gray-100 px-4 py-2 backdrop-blur-md transition 2xl:min-h-[49px] dark:bg-[#383838]/50"
        onClick={focusInput}
      >
        <div className="flex flex-wrap items-center gap-2 p-2 2xl:p-2.5">
          {values.map((tag, index) => (
            <div
              key={index}
              className="group flex cursor-pointer items-center gap-1 rounded-full bg-black/5 px-3 py-1 text-sm text-gray-900 transition-colors hover:bg-black/10 dark:bg-white/20 dark:text-white dark:hover:bg-white/30"
            >
              <span className="text-xs break-all 2xl:text-sm">{tag}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTag(index);
                }}
                disabled={disabled}
                className="rounded-full p-0.5 text-gray-900 opacity-70 transition-all hover:bg-red-500/30 hover:text-red-200 hover:opacity-100 disabled:opacity-50 dark:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={values.length === 0 ? placeholder : ''}
            disabled={disabled}
            className="flex-1 bg-transparent pl-3 text-sm text-gray-900 outline-none placeholder:text-sm placeholder:text-gray-500 disabled:opacity-50 2xl:text-base placeholder:2xl:text-base dark:text-white dark:placeholder:text-[#AFAFAF]"
            style={{ minWidth: '120px' }}
          />
        </div>
      </div>
      {/* Tag Suggestions */}
      {tagSuggestions?.length > 0 && (
        <div className="no-scrollbar mt-3 w-full overflow-x-auto">
          <div className="flex w-max gap-2 px-1 2xl:gap-3">
            {tagSuggestions?.map((item, idx) => (
              <div
                key={idx}
                className={`cursor-pointer rounded-[47px] bg-gray-100 px-5 py-1.5 text-sm whitespace-nowrap text-gray-900 hover:bg-gray-400/30 2xl:text-base dark:bg-[#373637] dark:text-white ${
                  values.includes(item) ? 'cursor-not-allowed opacity-50' : ''
                }`}
                onClick={() => handleTagSuggestionClick(item)}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-between px-1">
        {showLimitError && (
          <span className="text-xs text-red-400">Max 5 tags reached. Remove one to add more.</span>
        )}
      </div>
    </div>
  );
};

export default function BrandForm({ onComplete }) {
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  const dispatch = useDispatch();
  const { loading, brandInfo, productionAndServices, results } = useSelector(
    (state) => state.adFactoryNew
  );
  const { userData } = useSelector((s) => s.socket);
  const { selectedBrand, brand_name, brand_description } = useSelector(
    (state) => state.adFactoryNew
  );
  const isSubmitting = loading;
  const [uploadingLogos, setUploadingLogos] = useState({});
  const [selectedBrandLogos, setSelectedBrandLogos] = useState([]);
  const [tempColor, setTempColor] = useState('#000000');
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showAllColors, setShowAllColors] = useState(false);
  // File upload handler
  const handleFileUpload = async (file, helpers, index) => {
    if (!file) return;
    const hasTransparency = await checkImageTransparency(file);
    if (!hasTransparency) {
      console.error('please upload transperency image');
      toast.warn('Logo must have a transparent background', { autoClose: 5000 });
      return;
    }
    const fileKey = `logo-${index}-${Date.now()}`;
    setUploadingLogos((prev) => ({ ...prev, [fileKey]: true }));

    try {
      const uploadedUrl = await uploadToS3(file, userData?.user_id, true);
      if (uploadedUrl) {
        helpers.push(`${S3_BASE}${uploadedUrl}`);
        // toast.success('Logo uploaded successfully!');
      }
    } catch (error) {
      console.error('Logo upload failed:', error);
      toast.error('Failed to upload logo');
    } finally {
      setUploadingLogos((prev) => ({ ...prev, [fileKey]: false }));
    }
  };

  // Effect to update logos when brand is selected
  useEffect(() => {
    if (selectedBrand?.logoUrls && selectedBrand?.logoUrls?.length > 0) {
      setSelectedBrandLogos(selectedBrand.logoUrls);
    } else {
      setSelectedBrandLogos([]);
    }
  }, [selectedBrand, brand_description, brand_name]);

  const initialValues = {
    brandId: selectedBrand?.id || '',
    brandName: brand_name || brandInfo?.brandName || '',
    brandDescription: brand_description || brandInfo?.brandDescription || '',
    brandLogo:
      selectedBrand?.logoUrls?.length > 0
        ? [...selectedBrand.logoUrls]
        : brandInfo?.brandLogo || [],
    brandVoice: brandInfo?.brandVoice || [],
    category: brandInfo?.category || '',
    brandGuidelines: {
      toneOfVoice: brandInfo?.brandGuidelines?.toneOfVoice || '',
      dos: brandInfo?.brandGuidelines?.dos || [],
      donts: brandInfo?.brandGuidelines?.donts || [],
      colorPalette: brandInfo?.brandGuidelines?.colorPalette || [],
    },
  };

  // Helper function to check if form has any values filled
  const hasFormValues = (values) => {
    // Check brand name
    if (values.brandName?.trim()) return true;

    // Check brand description
    if (values.brandDescription?.trim()) return true;

    // Check brand logo
    if (values.brandLogo?.length > 0) return true;

    // Check brand voice
    if (values.brandVoice?.length > 0) return true;

    // Check category
    if (values.category?.trim()) return true;

    // Check brand guidelines
    if (values.brandGuidelines?.toneOfVoice?.trim()) return true;
    if (values.brandGuidelines?.dos?.length > 0) return true;
    if (values.brandGuidelines?.donts?.length > 0) return true;
    if (values.brandGuidelines?.colorPalette?.length > 0) return true;

    return false;
  };

  // Custom validation for form submission
  const validateOnSubmit = (values) => {
    const errors = {};

    if (!values.brandName || values.brandName.trim() === '') {
      errors.brandName = 'Brand name is required';
    }

    if (!values.brandVoice || values.brandVoice.length === 0) {
      errors.brandVoice = 'At least one brand voice item is required';
    }

    if (!values.brandGuidelines?.dos || values.brandGuidelines.dos.length === 0) {
      if (!errors.brandGuidelines) errors.brandGuidelines = {};
      errors.brandGuidelines.dos = 'At least one "Do" item is required';
    }

    if (!values.brandGuidelines?.donts || values.brandGuidelines.donts.length === 0) {
      if (!errors.brandGuidelines) errors.brandGuidelines = {};
      errors.brandGuidelines.donts = 'At least one "Don\'t" item is required';
    }

    if (!values.brandGuidelines?.colorPalette || values.brandGuidelines.colorPalette.length === 0) {
      if (!errors.brandGuidelines) errors.brandGuidelines = {};
      errors.brandGuidelines.colorPalette = 'At least one color is required';
    }

    return errors;
  };

  // Handle form submission
  const handleSubmit = async (values, { setSubmitting }) => {
    try {
      const cleanedValues = {
        ...values,
        brandName: values.brandName,
        brandDescription: values.brandDescription,
        brandLogo: values.brandLogo.slice(0, 5),
        brandGuidelines: {
          ...values.brandGuidelines,
        },
      };

      const payload = {
        campaignId: campaignId,
        nodeType: 'brandInfo',
        data: cleanedValues,
      };

      dispatch(updateBrandInfo(payload?.data));
      const result = await dispatch(updateCampaign(payload));
      const fetchPayload = {
        campaignId: campaignId,
        userId: userData?.user_id,
      };
      // dispatch(fetchCampaignById(fetchPayload));
      if (updateCampaign.fulfilled.match(result)) {
        dispatch(setCompletedNodes('brand-info'));
        dispatch(setFormProgress({ nodeId: 'brand-info', progress: 100 }));
        dispatch(updateNodeEnabledStatus());
        // toast.success('Brand information saved successfully!');
        if (onComplete) {
          onComplete();
        }
      } else if (updateCampaign.rejected.match(result)) {
        toast.error('Failed to save brand information');
      }
    } catch (error) {
      console.error('Form submission error:', error);
      toast.error('Failed to save brand information');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle reset form with confirmation
  const handleReset = (formik) => {
    setIsResetting(true);
    try {
      // Reset Redux state
      dispatch(updateBrandInfo({}));
      dispatch(
        setFields({
          // selectedBrand: '',
          brand_name: '',
          selectedBrand: {},
          brand_description: '',
          brand_logo: '',
        })
      );

      // Reset Formik form
      formik.resetForm({
        values: {
          brandName: '',
          brandDescription: '',
          brandLogo: [],
          brandVoice: [],
          category: '',
          brandGuidelines: {
            toneOfVoice: '',
            dos: [],
            donts: [],
            colorPalette: [],
          },
        },
      });

      // Clear validation errors
      formik.setErrors({});
      formik.setTouched({});

      toast.success('Form reset successfully!');
    } catch (error) {
      console.error('Error resetting form:', error);
      toast.error('Failed to reset form');
    } finally {
      setIsResetting(false);
      setResetDialogOpen(false);
    }
  };

  const ResetButton = ({ disabled, hasValues }) => {
    const dispatch = useDispatch();
    const formik = useFormikContext();

    const isResetDisabled = disabled || !hasValues;

    return (
      <>
        <button
          type="button"
          onClick={() => setResetDialogOpen(true)}
          className={`group mb-1.5 flex items-center gap-1 rounded-full px-4 py-2.5 text-xs font-medium backdrop-blur-md transition-all duration-300 hover:shadow-lg 2xl:gap-2 2xl:text-sm ${
            isResetDisabled
              ? 'cursor-not-allowed bg-transparent text-gray-500 opacity-50'
              : 'text-gray-500 hover:bg-black/5 hover:text-black dark:text-gray-300 dark:hover:bg-[#1A1A1A] dark:hover:text-white'
          }`}
          title={isResetDisabled ? 'No values to reset' : 'Reset Form'}
          disabled={isResetDisabled}
        >
          <RotateCcw
            className={`h-3 w-3 transition-transform 2xl:h-4 2xl:w-4 ${
              isResetting ? 'animate-spin' : isResetDisabled ? '' : 'group-hover:rotate-180'
            }`}
          />
          {isResetting ? 'Resetting...' : 'Reset'}
        </button>

        {/* Reset Confirmation Dialog */}
        <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
          <DialogContent className="z-[9999] flex w-full !max-w-[380px] flex-col overflow-x-hidden rounded-[24px] border-none !bg-gradient-to-b from-white to-gray-50 p-6 shadow-2xl shadow-orange-500/10 !backdrop-blur-[100px] sm:p-8 dark:from-[#1A1A1A] dark:to-[#0D0D0D]">
            <div className="mb-4 flex flex-col items-center justify-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/20 to-orange-600/20">
                <AlertTriangle className="h-7 w-7 text-orange-500" />
              </div>
              <DialogTitle className="text-center text-xl font-semibold text-gray-900 dark:text-white">
                Reset Form?
              </DialogTitle>
            </div>

            <DialogDescription className="text-center text-gray-500 dark:text-[#CCCCCC]">
              <p>Are you sure you want to reset all fields?</p>
              {/* <ul className="mt-3 space-y-1 text-sm">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Brand name and description</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>All uploaded logos</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Brand voice and tone</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Do's and Don'ts guidelines</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Color palette</span>
                </li>
              </ul> */}
              <p className="mt-4 text-sm font-medium text-red-300">This action cannot be undone.</p>
            </DialogDescription>

            <div className="flex w-full flex-col items-center justify-center space-y-4 pt-6">
              <div className="flex w-full items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setResetDialogOpen(false);
                  }}
                  className="flex-1 rounded-xl bg-gray-50 px-6 py-2.5 text-sm font-medium text-gray-500 transition-all hover:bg-black/5 hover:text-black dark:bg-[#2A2A2A] dark:text-gray-300 dark:hover:bg-[#3A3A3A] dark:hover:text-white"
                  disabled={isResetting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReset(formik)}
                  className="flex-1 rounded-xl bg-gradient-to-r from-red-400 to-red-500 px-6 py-2.5 text-sm font-medium text-white transition-all hover:from-red-500 hover:to-red-600 hover:shadow-lg hover:shadow-orange-500/20 disabled:opacity-50"
                  disabled={isResetting}
                >
                  {isResetting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      Resetting...
                    </span>
                  ) : (
                    'Reset Form'
                  )}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 25, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="relative z-10 text-gray-900 dark:text-white"
    >
      <h2 className="mb-5 text-center text-xl font-semibold text-gray-900 2xl:text-[23px] dark:text-white">
        Brand Information
      </h2>

      <Formik
        initialValues={initialValues}
        validationSchema={schema}
        validate={validateOnSubmit}
        validateOnChange={true}
        validateOnBlur={true}
        enableReinitialize={true}
        onSubmit={handleSubmit}
      >
        {({
          values,
          setFieldValue,
          errors,
          touched,
          isValid,
          dirty,
          isSubmitting: formikSubmitting,
          resetForm,
        }) => {
          const allLogos = values.brandLogo?.slice(0, 5);
          const totalLogosCount = allLogos.length;

          // Count logos by source for display purposes
          const selectedBrandLogosCount = selectedBrandLogos?.filter((logo) =>
            allLogos?.includes(logo)
          )?.length;
          const uploadedLogosCount = totalLogosCount - selectedBrandLogosCount;

          const isFormSubmitting = isSubmitting || formikSubmitting;

          // Check if form has any values
          const hasValues = hasFormValues(values);

          return (
            <Form className="">
              <div className="max-h-[calc(100svh-280px)] space-y-4 overflow-y-auto p-2 sm:pr-6">
                <div className="flex flex-col">
                  {/* BRAND NAME */}
                  <div className="flex items-center justify-between">
                    <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                      Brand Name *
                    </label>
                    <ResetButton disabled={isFormSubmitting} hasValues={hasValues} />
                  </div>
                  <div className="flex w-full items-center justify-between gap-1">
                    <div className="input w-full">
                      <BrandSelect />
                    </div>
                  </div>
                  <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                    <ErrorMessage name="brandName" className="error" />
                  </span>
                </div>

                {/* DESCRIPTION */}
                <div className="flex flex-col">
                  <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                    Brand Description *
                  </label>
                  <Field
                    as="textarea"
                    name="brandDescription"
                    className={`max-h-20 w-full resize-none rounded-[20px] border border-black/10 bg-gray-100 px-[18px] py-3 text-sm text-gray-900 backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-gray-500 2xl:max-h-[91px] 2xl:text-base placeholder:2xl:text-base dark:border-white/10 dark:bg-[#383838]/50 dark:text-white dark:placeholder:text-[#AFAFAF] ${errors.brandDescription && touched.brandDescription ? 'border-red-500' : ''}`}
                    placeholder="Briefly describe your brand including key features."
                    rows={3}
                    disabled={isFormSubmitting}
                    value={values.brandDescription}
                    onChange={(e) => {
                      setFieldValue('brandDescription', e.target.value);
                    }}
                  />
                  <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                    <ErrorMessage name="brandDescription" className="error" />
                  </span>
                  <div className="mt-0.5 hidden text-xs text-zinc-400 2xl:text-sm">
                    {(brand_description || values.brandDescription).length}/500 characters
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-x-7 gap-y-5 sm:grid-cols-2">
                  {/* BRAND LOGO */}
                  <div className="flex flex-col">
                    <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                      Brand Logos
                    </label>
                    <FieldArray
                      name="brandLogo"
                      render={(helpers) => (
                        <>
                          <div className="input-gradient-border">
                            <div className="backdrop-blur-100 flex h-9 w-full items-center justify-between rounded-full bg-gray-100 p-1 2xl:h-[49px] dark:bg-[#383838]/50">
                              <div
                                className={`flex h-full cursor-pointer items-center gap-1 rounded-full bg-black/5 px-4 transition-colors hover:bg-black/10 dark:bg-white/20 dark:hover:bg-[#454545] ${
                                  Object.values(uploadingLogos).some(Boolean)
                                    ? 'cursor-not-allowed opacity-50'
                                    : ''
                                }`}
                                onClick={() => {
                                  if (isFormSubmitting) return;
                                  const picker = document.createElement('input');
                                  picker.type = 'file';
                                  picker.accept = 'image/*';
                                  picker.onchange = async (e) => {
                                    const file = e.target.files[0];
                                    if (!file) return;
                                    if (totalLogosCount >= 5) {
                                      toast.warn('Maximum 5 logos allowed');
                                      return;
                                    }
                                    await handleFileUpload(file, helpers, values.brandLogo.length);
                                  };
                                  picker.click();
                                }}
                              >
                                <CloudUpload className="h-3.5 w-3.5 text-gray-900 2xl:h-4 2xl:w-4 dark:text-white" />
                                <span className="text-xs font-normal text-gray-900 2xl:text-sm dark:text-white">
                                  Choose file
                                </span>
                              </div>
                            </div>
                          </div>

                          {totalLogosCount > 0 && (
                            <div className="">
                              <div className="flex max-w-full gap-4 overflow-x-auto pt-6">
                                {allLogos.map((logo, idx) => {
                                  const isFromSelectedBrand = selectedBrandLogos.includes(logo);
                                  return (
                                    <div
                                      key={idx}
                                      className="relative h-16 min-w-fit rounded-lg border border-black/10 shadow-md dark:border-white/10"
                                    >
                                      <img
                                        src={logo}
                                        alt="Brand Logo"
                                        className="h-full w-full rounded-md object-contain"
                                      />
                                      {/* {isFromSelectedBrand && (
                                        <div className="absolute -top-2 right-3 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
                                          B
                                        </div>
                                      )} */}
                                      <button
                                        type="button"
                                        onClick={() => helpers.remove(idx)}
                                        className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow-md"
                                        disabled={isFormSubmitting}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    />
                    <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                      <ErrorMessage name="brandLogo" className="error" />
                    </span>
                    <div className="mt-1 text-sm text-zinc-400">
                      {/* {totalLogosCount}/5 logos
                      {selectedBrandLogosCount > 0 && ` • ${selectedBrandLogosCount} from selected brand`}
                      {uploadedLogosCount > 0 && ` • ${uploadedLogosCount} uploaded`} */}
                    </div>
                  </div>

                  {/* CATEGORY */}
                  <div className="flex flex-col">
                    <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">Category</label>
                    <div className="input-gradient-border">
                      <Field
                        name="category"
                        className={`h-9 w-full rounded-full bg-gray-100 px-5 py-2.5 pl-6 text-sm text-gray-900 backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-gray-500 2xl:h-[49px] 2xl:text-base placeholder:2xl:text-base dark:bg-[#383838]/50 dark:text-white dark:placeholder:text-[#AFAFAF] ${errors.category && touched.category ? 'border-red-500' : ''}`}
                        placeholder="Enter Category"
                        disabled={isFormSubmitting}
                      />
                    </div>
                    <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                      <ErrorMessage name="category" className="error" />
                    </span>
                  </div>
                </div>

                {/* GUIDELINES */}
                <div className="">
                  <h3 className="my-2 mt-5 text-lg text-gray-900 2xl:text-[21px] dark:text-white">Brand Guidelines</h3>

                  <div className="grid grid-cols-1 gap-x-7 gap-y-4 sm:grid-cols-2">
                    {/* BRAND VOICE */}
                    <div className="flex flex-col">
                      <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                        Brand Voice *
                      </label>
                      <TagInput
                        name="brandVoice"
                        values={values.brandVoice}
                        setFieldValue={setFieldValue}
                        placeholder="Choose your brand voice"
                        maxTags={5}
                        disabled={isFormSubmitting}
                        tagSuggestions={brandVoiceTags}
                        className="h-52"
                      />

                      <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                        <ErrorMessage name="brandVoice">
                          {(msg) => {
                            let displayError = '';
                            if (Array.isArray(msg)) {
                              displayError =
                                msg.find((e) => typeof e === 'string' && e.length > 0) || '';
                            } else if (typeof msg === 'string') {
                              displayError = msg;
                            }
                            return displayError ? (
                              <span className="error">{displayError}</span>
                            ) : null;
                          }}
                        </ErrorMessage>
                      </span>
                    </div>

                    {/* TONE OF VOICE */}
                    <div className="flex flex-col">
                      <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                        Tone of Voice
                      </label>
                      <div className="input-gradient-border">
                        <Field
                          name="brandGuidelines.toneOfVoice"
                          className={`h-9 w-full rounded-full bg-gray-100 px-5 py-2.5 pl-6 text-sm text-gray-900 backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-gray-500 2xl:h-[49px] 2xl:text-base placeholder:2xl:text-base dark:bg-[#383838]/50 dark:text-white dark:placeholder:text-[#AFAFAF] ${errors.brandGuidelines?.toneOfVoice && touched.brandGuidelines?.toneOfVoice ? 'border-red-500' : ''}`}
                          placeholder="Choose your brand tone"
                          disabled={isFormSubmitting}
                        />
                      </div>
                      <div className="no-scrollbar mt-3 w-full overflow-x-auto">
                        <div className="flex w-max gap-3 px-1">
                          {toneOfVoiceTags?.map((item, idx) => (
                            <div
                              key={idx}
                              className="cursor-pointer rounded-[47px] bg-gray-100 px-5 py-1.5 text-sm whitespace-nowrap text-gray-900 hover:bg-gray-400/30 2xl:text-base dark:bg-[#373637] dark:text-white"
                              onClick={() => {
                                if (!isFormSubmitting) {
                                  setFieldValue('brandGuidelines.toneOfVoice', item);
                                }
                              }}
                            >
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                      <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                        <ErrorMessage name="brandGuidelines.toneOfVoice" className="error" />
                      </span>
                    </div>

                    {/* DOs */}
                    <div className="flex flex-col">
                      <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">Do's *</label>
                      <TagInput
                        name="brandGuidelines.dos"
                        values={values.brandGuidelines.dos}
                        setFieldValue={setFieldValue}
                        placeholder="Use simple words..."
                        maxTags={5}
                        disabled={isFormSubmitting}
                        tagSuggestions={dosTags}
                      />

                      <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                        <ErrorMessage name="brandGuidelines.dos">
                          {(msg) => {
                            let displayError = '';
                            if (Array.isArray(msg)) {
                              displayError =
                                msg.find((e) => typeof e === 'string' && e.length > 0) || '';
                            } else if (typeof msg === 'string') {
                              displayError = msg;
                            }
                            return displayError ? (
                              <span className="error">{displayError}</span>
                            ) : null;
                          }}
                        </ErrorMessage>
                      </span>
                    </div>

                    {/* DON'Ts */}
                    <div className="flex flex-col">
                      <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                        Don'ts *
                      </label>
                      <TagInput
                        name="brandGuidelines.donts"
                        values={values.brandGuidelines.donts}
                        setFieldValue={setFieldValue}
                        placeholder="Avoid jargon..."
                        maxTags={5}
                        disabled={isFormSubmitting}
                        tagSuggestions={dontsTags}
                      />
                      <span className="mt-1 text-xs text-red-400 2xl:text-sm">
                        <ErrorMessage name="brandGuidelines.donts">
                          {(msg) => {
                            let displayError = '';
                            if (Array.isArray(msg)) {
                              displayError =
                                msg.find((e) => typeof e === 'string' && e.length > 0) || '';
                            } else if (typeof msg === 'string') {
                              displayError = msg;
                            }
                            return displayError ? (
                              <span className="error">{displayError}</span>
                            ) : null;
                          }}
                        </ErrorMessage>
                      </span>
                    </div>
                  </div>

                  {/* COLOR PALETTE */}
                  <div className="mt-3 flex flex-col">
                    <label className="mb-2 text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                      Color Palette *
                    </label>
                    <FieldArray
                      name="brandGuidelines.colorPalette"
                      render={(helpers) => {
                        const colors = values.brandGuidelines.colorPalette;
                        const visibleColors = showAllColors ? colors : colors.slice(0, 5);
                        const hiddenCount = colors.length - 5;
                        return (
                          <div className="flex flex-wrap gap-2">
                            {visibleColors.map((color, idx) => (
                              <div key={idx} className="group relative">
                                <Popover modal={true}>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className="h-10 w-10 overflow-hidden rounded-lg border border-black/10 shadow-sm transition-transform hover:scale-105 focus:ring-2 focus:ring-white/20 focus:outline-none dark:border-white/10"
                                      style={{ backgroundColor: color || '#383838' }}
                                    />
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="z-[9999] w-auto border-none bg-transparent p-0 shadow-none"
                                    side="top"
                                    onOpenAutoFocus={(e) => e.preventDefault()}
                                  >
                                    <ColorPicker
                                      color={color}
                                      onChange={(newColor) => {
                                        setFieldValue(
                                          `brandGuidelines.colorPalette[${idx}]`,
                                          newColor.toUpperCase()
                                        );
                                      }}
                                    />
                                  </PopoverContent>
                                </Popover>
                                <button
                                  type="button"
                                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-black/10 bg-gray-100 text-zinc-400 opacity-100 shadow-md transition-colors group-hover:opacity-100 hover:border-red-500 hover:bg-red-500/80 hover:text-white md:opacity-0 dark:border-zinc-600 dark:bg-zinc-800"
                                  onClick={() => helpers.remove(idx)}
                                  disabled={isFormSubmitting}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                            {!showAllColors && hiddenCount > 0 && (
                              <button
                                type="button"
                                onClick={() => setShowAllColors(true)}
                                className="flex h-10 w-10 items-center justify-center rounded-lg border border-black/10 bg-gray-100 text-xs text-gray-900 hover:bg-black/5 dark:border-white/10 dark:bg-[#383838] dark:text-white dark:hover:bg-[#454545]"
                              >
                                +{hiddenCount}
                              </button>
                            )}
                            {values.brandGuidelines.colorPalette.length < 8 && (
                              <Popover
                                modal={true}
                                onOpenChange={(isOpen) => {
                                  if (!isOpen) {
                                    helpers.push(tempColor);
                                    setTempColor('#000000');
                                  }
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <div className="ml-1 h-fit rounded-[10px] bg-gradient-to-br from-black/20 to-black/5 p-[0.7px] 2xl:p-[1px] dark:from-white/40 dark:to-white/10">
                                    <button
                                      type="button"
                                      className="m-0 flex min-h-9 min-w-9 items-center justify-center rounded-[10px] bg-gray-100 text-gray-500 transition-all hover:text-black dark:bg-[#333440] dark:text-[#AAAAAA] dark:hover:text-white"
                                      disabled={isFormSubmitting}
                                    >
                                      <Plus className="h-6 w-6" />
                                    </button>
                                  </div>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="z-[9999] w-auto border-none bg-transparent p-0 shadow-none"
                                  side="top"
                                  onOpenAutoFocus={(e) => e.preventDefault()}
                                >
                                  <ColorPicker
                                    color={tempColor}
                                    onChange={(newColor) => setTempColor(newColor.toUpperCase())}
                                  />
                                </PopoverContent>
                              </Popover>
                            )}
                            {showAllColors && colors.length > 5 && (
                              <button
                                type="button"
                                onClick={() => setShowAllColors(false)}
                                className="text-xs text-blue-400 underline"
                              >
                                Show less
                              </button>
                            )}
                          </div>
                        );
                      }}
                    />

                    <span className="mt-1 text-xs text-red-400">
                      <ErrorMessage name="brandGuidelines.colorPalette" className="error" />
                    </span>
                    <div className="mt-1 text-xs text-zinc-400 2xl:text-sm">
                      {values.brandGuidelines.colorPalette.length} colors
                    </div>
                  </div>
                </div>
              </div>

              {/* BUTTONS */}
              <div className="mt-4 flex w-full flex-wrap justify-end gap-3 md:mt-7">
                <button
                  type="submit"
                  disabled={
                    isFormSubmitting ||
                    (productionAndServices?.status == 'success' && results?.status != 'success')
                  }
                  className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 2xl:text-base dark:bg-white dark:text-black"
                >
                  {isFormSubmitting ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      Saving...
                    </div>
                  ) : (
                    'Save & Continue'
                  )}
                </button>
              </div>
            </Form>
          );
        }}
      </Formik>
    </motion.div>
  );
}
