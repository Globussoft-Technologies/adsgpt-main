import React, { useRef, useState } from 'react';
import { Formik, Form, Field, FieldArray, ErrorMessage, useFormikContext } from 'formik';
import * as Yup from 'yup';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';

import { setActiveForm } from '@/store/reducers/AdFactory/AdFactorySlice';
import { fetchCampaignById, updateCampaign } from '@/store/actions/adFactoryNew/adFactoryActions';
import { updateObjectives } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  setCompletedNodes,
  setFormProgress,
  updateNodeEnabledStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

const promotionalTags = ['30% off', '$50.00', 'Free shipping', 'Limited time offer'];
const ctaTags = ['Shop Now', 'Learn More', 'Sign Up', 'Buy Now'];
const audienceTags = ['Students', 'Techies'];

// Enhanced Validation Schema
const schema = Yup.object({
  primaryObjective: Yup.string()
    .required('Primary objective is required')
    .min(2, 'Primary objective must be at least 10 characters')
    .max(200, 'Primary objective must be less than 200 characters'),
  promotionalInfo: Yup.array().of(Yup.string().optional()),
  coreIdea: Yup.string().optional(),
  // .required('Core idea is required')
  // .min(2, 'Core idea must be at least 10 characters')
  // .max(500, 'Core idea must be less than 500 characters'),
  additionalGuidelines: Yup.string().optional(),
  // .required('Additional guidelines are required')
  // .min(2, 'Additional guidelines must be at least 10 characters')
  // .max(1000, 'Additional guidelines must be less than 1000 characters'),
  callToAction: Yup.array().of(
    Yup.string().optional()
    // .min(2, 'Call to action must be at least 2 characters')
    // .max(50, 'Call to action must be less than 50 characters')
  ),
  // .min(1, 'At least one call to action is required')
  // .max(5, 'Maximum 5 call to actions allowed'),
  targetAudience: Yup.array()
    .of(
      Yup.string()
        .required('Target audience is required')
        .max(100, 'Target audience must be less than 100 characters')
    )
    .min(1, 'At least one target audience is required'),
});

// Tags Input Component for Promotional Info
const PromotionalInfoTags = ({ disabled }) => {
  const { setFieldValue, values, errors, touched } = useFormikContext();
  const inputRef = useRef(null);
  const [showLimitError, setShowLimitError] = useState(false);

  const tags = Array.isArray(values.promotionalInfo) ? values.promotionalInfo : [];

  const addTag = (tagText) => {
    if (tags.length >= 5) {
      setShowLimitError(true);
      return false;
    }
    const trimmedTag = tagText.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      const newTags = [...tags, trimmedTag];
      setFieldValue('promotionalInfo', newTags);
      setShowLimitError(false);
      return true;
    }
    return false;
  };

  const removeTag = (indexToRemove) => {
    const newTags = tags.filter((_, index) => index !== indexToRemove);
    setFieldValue('promotionalInfo', newTags);
    setShowLimitError(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (addTag(e.target.value)) {
        e.target.value = '';
      }
    }
  };

  const handleBlur = (e) => {
    if (e.target.value.trim()) {
      addTag(e.target.value);
      e.target.value = '';
    }
    setShowLimitError(false);
  };

  const handleTagClick = (tag) => {
    if (!disabled && !tags.includes(tag)) {
      if (tags.length >= 5) {
        setShowLimitError(true);
      } else {
        addTag(tag);
      }
    }
  };

  const hasError = errors.promotionalInfo && touched.promotionalInfo;

  return (
    <div className="flex flex-col">
      <div
        className={`flex min-h-18 w-full flex-wrap items-start gap-2 rounded-[20px] border border-white/10 bg-[#383838]/50 px-4 py-2.5 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:min-h-[80px] ${
          hasError ? 'border-red-500 bg-red-500/10' : ''
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Display tags */}
        {tags.map((tag, index) => (
          <div
            key={index}
            className="flex items-center gap-1 rounded-full border border-blue-400/30 bg-white/20 px-3 py-1 text-sm 2xl:text-base"
          >
            <span className="break-all">{tag}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(index);
              }}
              className="ml-1 text-lg leading-none text-white hover:bg-black/10 hover:text-white"
              disabled={disabled}
            >
              ×
            </button>
          </div>
        ))}

        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          className="min-w-[120px] flex-1 border-none bg-transparent py-1 pl-1 text-sm outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:text-base 2xl:placeholder:text-base"
          placeholder={
            tags.length === 0
              ? 'Enter your promotional details (press Enter or comma to add tags)'
              : ''
          }
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={disabled}
        />
      </div>
      {tags.length < 5 && (
        <div className="no-scrollbar mt-3 w-full overflow-x-auto pb-1 sm:pb-0">
          <div className="flex w-max gap-2 px-1 2xl:gap-3">
            {promotionalTags?.map((item, idx) => (
              <div
                key={idx}
                className={`cursor-pointer rounded-[47px] bg-[#373637] px-5 py-1.5 text-sm whitespace-nowrap text-white hover:bg-gray-400/30 2xl:text-base ${
                  tags.includes(item) ? 'cursor-not-allowed opacity-50' : ''
                }`}
                onClick={() => handleTagClick(item)}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
      <ErrorMessage name="promotionalInfo" component="div" className="error !2xl:text-sm !text-xs">
        {(msg) => {
          let displayError = '';
          if (Array.isArray(msg)) {
            displayError = msg.find((e) => typeof e === 'string' && e.length > 0) || '';
          } else if (typeof msg === 'string') {
            displayError = msg;
          }
          return displayError ? <span className="error">{displayError}</span> : null;
        }}
      </ErrorMessage>
      {showLimitError && (
        <div className="mt-2 text-xs text-red-400">
          Maximum of 5 tags reached. Remove some tags to add more.
        </div>
      )}
    </div>
  );
};

// Tags Input Component for Call To Action
const CallToActionTags = ({ disabled }) => {
  const { setFieldValue, values, errors, touched } = useFormikContext();
  const inputRef = useRef(null);
  const [showLimitError, setShowLimitError] = useState(false);

  const tags = Array.isArray(values.callToAction) ? values.callToAction : [];

  const addTag = (tagText) => {
    if (tags.length >= 5) {
      setShowLimitError(true);
      return false;
    }

    const trimmedTag = tagText.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      const newTags = [...tags, trimmedTag];
      setFieldValue('callToAction', newTags);
      setShowLimitError(false);
      return true;
    }
    return false;
  };

  const removeTag = (indexToRemove) => {
    const newTags = tags.filter((_, index) => index !== indexToRemove);
    setFieldValue('callToAction', newTags);
    setShowLimitError(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (addTag(e.target.value)) {
        e.target.value = '';
      }
    }
  };

  const handleBlur = (e) => {
    if (e.target.value.trim()) {
      addTag(e.target.value);
      e.target.value = '';
    }
    setShowLimitError(false);
  };

  const handleTagClick = (tag) => {
    if (!disabled && !tags.includes(tag)) {
      if (tags.length >= 5) {
        setShowLimitError(true);
      } else {
        addTag(tag);
      }
    }
  };

  const hasError = errors.callToAction && touched.callToAction;

  return (
    <div className="flex flex-col">
      <div
        className={`mt-1.5 flex min-h-18 w-full flex-wrap items-start gap-2 rounded-[20px] border border-white/10 bg-[#383838]/50 px-4 py-2.5 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:min-h-[60px] ${
          hasError ? 'border-red-500 bg-red-500/10' : ''
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Display tags */}
        {tags.map((tag, index) => (
          <div
            key={index}
            className="flex items-center gap-1 rounded-4xl border border-blue-400/30 bg-white/20 px-3 py-1 text-sm 2xl:text-base"
          >
            <span className="px-1 break-all">{tag}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(index);
              }}
              className="ml-1 text-lg leading-none hover:text-white"
              disabled={disabled}
            >
              ×
            </button>
          </div>
        ))}

        {/* Input field */}
        <textarea
          ref={inputRef}
          type="text"
          className="h-[65px] max-h-[65px] min-h-[65px] min-w-[120px] flex-1 border-none bg-transparent py-1 pl-1 text-sm outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:text-base 2xl:placeholder:text-base"
          placeholder={
            tags.length === 0 ? 'Enter call to action (press Enter or comma to add tags)' : ''
          }
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={disabled}
        />
      </div>
      {tags.length < 5 && (
        <div className="no-scrollbar mt-3 w-full overflow-x-auto pb-1 sm:pb-0">
          <div className="flex w-max gap-2 px-1 2xl:gap-3">
            {ctaTags?.map((item, idx) => (
              <div
                key={idx}
                className={`cursor-pointer rounded-[47px] bg-[#373637] px-5 py-1.5 text-sm whitespace-nowrap text-white hover:bg-gray-400/30 2xl:text-base ${
                  tags.includes(item) ? 'cursor-not-allowed opacity-50' : ''
                }`}
                onClick={() => handleTagClick(item)}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
      <ErrorMessage name="callToAction" component="div" className="error !2xl:text-sm !text-xs">
        {(msg) => {
          let displayError = '';
          if (Array.isArray(msg)) {
            displayError = msg.find((e) => typeof e === 'string' && e.length > 0) || '';
          } else if (typeof msg === 'string') {
            displayError = msg;
          }
          return displayError ? <span className="error">{displayError}</span> : null;
        }}
      </ErrorMessage>
      {showLimitError && (
        <div className="mt-2 text-xs text-red-400">
          Maximum of 5 tags reached. Remove some tags to add more.
        </div>
      )}
    </div>
  );
};

// Tags Input Component for Target Audience
const TargetAudienceTags = ({ disabled }) => {
  const { setFieldValue, values, errors, touched } = useFormikContext();
  const inputRef = useRef(null);
  const [showLimitError, setShowLimitError] = useState(false);

  const tags = Array.isArray(values.targetAudience) ? values.targetAudience : [];
  const { setFieldTouched, validateField } = useFormikContext();

  const addTag = async (tagText) => {
    const trimmedTag = tagText.trim();

    if (!trimmedTag) return false;
    if (tags.includes(trimmedTag)) return false;

    const newTags = [...tags, trimmedTag];
    await setFieldValue('targetAudience', newTags, true);
    await setFieldTouched('targetAudience', true, true);
    await validateField('targetAudience');
    return true;
  };

  const removeTag = (indexToRemove) => {
    const newTags = tags.filter((_, index) => index !== indexToRemove);
    setFieldValue('targetAudience', newTags);
    setShowLimitError(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (addTag(e.target.value)) {
        e.target.value = '';
      }
    }
  };

  const handleBlur = (e) => {
    if (e.target.value.trim()) {
      addTag(e.target.value);
      e.target.value = '';
    }
    setShowLimitError(false);
  };

  const handleTagClick = (tag) => {
    if (!disabled && !tags.includes(tag)) {
      if (tags.length >= 5) {
        setShowLimitError(true);
      } else {
        addTag(tag);
      }
    }
  };

  const hasError = errors.targetAudience && touched.targetAudience;

  return (
    <div className="flex flex-col">
      <div
        className={`flex min-h-11 w-full flex-wrap items-start gap-2 rounded-4xl border border-white/10 bg-[#383838]/50 px-4 py-2 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:min-h-[49px] 2xl:text-base 2xl:placeholder:text-base ${
          hasError ? 'border-red-500 bg-red-500/10' : ''
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Display tags */}
        {tags.map((tag, index) => (
          <div
            key={index}
            className="flex items-center gap-1 rounded-4xl border border-blue-400/30 bg-white/20 px-3 py-1 text-sm 2xl:text-base"
          >
            <span className="px-1 break-all">{tag}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(index);
              }}
              className="ml-1 text-lg leading-none hover:text-white"
              disabled={disabled}
            >
              ×
            </button>
          </div>
        ))}

        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          className="min-w-[120px] flex-1 border-none bg-transparent py-1 pl-1.5 text-sm outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:text-base 2xl:placeholder:text-base"
          placeholder={tags.length === 0 ? 'Enter target audience' : ''}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={disabled}
        />
      </div>

      <div className="no-scrollbar mt-3 w-full overflow-x-auto pb-1 sm:pb-0">
        <div className="flex w-max gap-2 px-1 2xl:gap-3">
          {audienceTags?.map((item, idx) => (
            <div
              key={idx}
              className={`cursor-pointer rounded-[47px] bg-[#373637] px-5 py-1.5 text-sm whitespace-nowrap text-white hover:bg-gray-400/30 2xl:text-base ${
                tags.includes(item) ? 'cursor-not-allowed opacity-50' : ''
              }`}
              onClick={() => handleTagClick(item)}
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      <ErrorMessage name="targetAudience" component="div" className="error !2xl:text-sm !text-xs">
        {(msg) => {
          let displayError = '';
          if (Array.isArray(msg)) {
            displayError = msg.find((e) => typeof e === 'string' && e.length > 0) || '';
          } else if (typeof msg === 'string') {
            displayError = msg;
          }
          return displayError ? <span className="error">{displayError}</span> : null;
        }}
      </ErrorMessage>
      {/* {showLimitError && (
        <div className="mt-2 text-xs text-red-400">
          Maximum of 5 tags reached. Remove some tags to add more.
        </div>
      )} */}
    </div>
  );
};

export default function InputsForm({ onComplete }) {
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  const dispatch = useDispatch();
  const { loading, objectives, productionAndServices, results } = useSelector(
    (state) => state.adFactoryNew
  );
  const { userData } = useSelector((state) => state.socket);
  const isSubmitting = loading;
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const initialValues = {
    primaryObjective: objectives?.primaryObjective || '',
    promotionalInfo: objectives?.promotionalInfo || [],
    coreIdea: objectives?.coreIdea || '',
    callToAction: objectives?.callToAction || [],
    additionalGuidelines: objectives?.additionalGuidelines || '',
    targetAudience: objectives?.targetAudience || [],
  };

  // Helper function to check if form has any values filled
  const hasFormValues = (values) => {
    // Check primary objective
    if (values.primaryObjective?.trim()) return true;

    // Check promotional info
    if (values.promotionalInfo?.length > 0) return true;

    // Check core idea
    if (values.coreIdea?.trim()) return true;

    // Check call to action
    if (values.callToAction?.length > 0) return true;

    // Check additional guidelines
    if (values.additionalGuidelines?.trim()) return true;

    // Check target audience
    if (values.targetAudience?.length > 0) return true;

    return false;
  };

  const handleSubmit = async (values, { setSubmitting }) => {
    try {
      const payload = {
        campaignId: campaignId,
        nodeType: 'objectives',
        data: values,
      };

      dispatch(updateObjectives(payload));
      const result = await dispatch(updateCampaign(payload));
      const campaignPayload = {
        campaignId: campaignId,
        userId: userData?.user_id,
      };
      // dispatch(fetchCampaignById(campaignPayload));
      if (updateCampaign.fulfilled.match(result)) {
        // Update node completion status
        dispatch(setCompletedNodes('objectives'));
        dispatch(setFormProgress({ nodeId: 'objectives', progress: 100 }));

        // Update node enabled status to enable next nodes
        dispatch(updateNodeEnabledStatus());

        // toast.success('Objectives saved successfully');

        // Call onComplete if provided
        if (onComplete) {
          onComplete();
        }
      }
    } catch (error) {
      console.error('Form submission error:', error);
      // toast.error('Failed to save campaign objectives');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle reset form with confirmation
  const handleReset = (formik) => {
    setIsResetting(true);
    try {
      // Reset Redux state
      dispatch(updateObjectives({}));

      // Reset Formik form
      formik.resetForm({
        values: {
          primaryObjective: '',
          promotionalInfo: [],
          coreIdea: '',
          callToAction: [],
          additionalGuidelines: '',
          targetAudience: [],
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
          className={`group mb-1.5 flex items-center gap-1 rounded-full px-4 py-2.5 text-sm font-medium backdrop-blur-md transition-all duration-300 hover:shadow-lg 2xl:gap-2 ${
            isResetDisabled
              ? 'cursor-not-allowed bg-transparent text-gray-500 opacity-50'
              : 'text-gray-300 hover:bg-[#1A1A1A] hover:text-white'
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
          <DialogContent className="z-[9999] flex w-full !max-w-[380px] flex-col overflow-x-hidden rounded-[24px] border-none !bg-gradient-to-b from-[#222222] to-[#222222] p-6 shadow-2xl shadow-orange-500/10 !backdrop-blur-[100px] sm:p-8">
            <div className="mb-4 flex flex-col items-center justify-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/20 to-orange-600/20">
                <AlertTriangle className="h-7 w-7 text-red-500" />
              </div>
              <DialogTitle className="text-center text-xl font-semibold text-white">
                Reset Form?
              </DialogTitle>
            </div>

            <DialogDescription className="text-center text-[#CCCCCC]">
              <p>Are you sure you want to reset all fields?</p>
              {/* <ul className="mt-3 space-y-1 text-sm">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Primary objective</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>All promotional details</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Core idea</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Call to action tags</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Additional guidelines</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
                  <span>Target audience tags</span>
                </li>
              </ul> */}
              <p className="mt-4 text-sm font-medium text-orange-300">
                This action cannot be undone.
              </p>
            </DialogDescription>

            <div className="flex w-full flex-col items-center justify-center space-y-4 pt-6">
              <div className="flex w-full items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setResetDialogOpen(false);
                  }}
                  className="flex-1 rounded-xl bg-[#2A2A2A] px-6 py-2.5 text-sm font-medium text-gray-300 transition-all hover:bg-[#3A3A3A] hover:text-white"
                  disabled={isResetting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReset(formik)}
                  className="flex-1 rounded-xl bg-gradient-to-r from-red-500 to-red-500 px-6 py-2.5 text-sm font-medium text-white transition-all hover:from-red-500 hover:to-red-600 hover:shadow-lg hover:shadow-orange-500/20 disabled:opacity-50"
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
      className="relative z-10 text-white"
    >
      <h2 className="mb-4 text-center text-xl font-semibold text-white 2xl:text-2xl">
        Campaign Objectives
      </h2>

      <Formik
        initialValues={initialValues}
        validationSchema={schema}
        validateOnChange={true}
        validateOnBlur={true}
        onSubmit={handleSubmit}
      >
        {({ values, errors, touched, isValid, dirty, isSubmitting: formikSubmitting }) => {
          const isFormSubmitting = isSubmitting || formikSubmitting;

          // Check if form has any values
          const hasValues = hasFormValues(values);

          return (
            <Form className="relative z-10">
              <div className="max-h-[calc(100svh-280px)] space-y-5 overflow-y-auto p-2 py-1.5 sm:pr-5">
                {/* PRIMARY OBJECTIVE */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-[#AFAFAF] 2xl:mb-1.5 2xl:text-[18px]">
                      Primary Objective *
                    </label>
                    <ResetButton disabled={isFormSubmitting} hasValues={hasValues} />
                  </div>
                  <div className="input-gradient-border 2xl:my-2">
                    <Field
                      name="primaryObjective"
                      className={`h-11 w-full rounded-full bg-[#383838]/50 px-5 py-2.5 pl-6 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:h-[49px] 2xl:text-base 2xl:placeholder:text-base ${errors.primaryObjective && touched.primaryObjective ? 'border-red-500 bg-red-500/10' : ''}`}
                      placeholder="Briefly describe your brand primary object"
                      disabled={isFormSubmitting}
                    />
                  </div>
                  <span className="text-sm">
                    <ErrorMessage
                      name="primaryObjective"
                      component="div"
                      className="error !2xl:text-sm !text-xs"
                    />
                  </span>
                  <div className="mt-1 hidden text-sm text-zinc-500">
                    {values.primaryObjective.length}/200 characters
                  </div>
                </div>

                {/* PROMOTIONAL INFO - Updated to Tags Input */}
                <div className="flex flex-col">
                  <label className="mb-2 text-sm text-[#AFAFAF] 2xl:text-[18px]">
                    Promotional Details
                  </label>
                  <PromotionalInfoTags disabled={isFormSubmitting} />
                </div>

                {/* CTA TAGS */}
                <div className="flex flex-col">
                  <label className="mb-1 text-sm text-[#AFAFAF] 2xl:text-[18px]">
                    Call To Action
                  </label>
                  <CallToActionTags disabled={isFormSubmitting} />
                </div>

                <div className="col-span-6 grid grid-cols-6 gap-x-7 gap-y-2.5">
                  {/* ADDITIONAL GUIDELINES */}
                  <div className="col-span-6 flex flex-col sm:col-span-3">
                    <label className="mb-1 text-sm text-[#AFAFAF] 2xl:text-[18px]">
                      Additional Guidelines
                    </label>
                    <Field
                      name="additionalGuidelines"
                      rows={2}
                      className={`mt-1.5 h-11 w-full rounded-full border border-white/10 bg-[#383838]/50 px-4 py-2.5 pl-6 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:h-[49px] 2xl:text-base 2xl:placeholder:text-base ${errors.additionalGuidelines && touched.additionalGuidelines ? 'border-red-500 bg-red-500/10' : ''}`}
                      placeholder="Enter additional Guidelines"
                      disabled={isFormSubmitting}
                    />
                    <ErrorMessage
                      name="additionalGuidelines"
                      component="div"
                      className="error !2xl:text-sm !text-xs"
                    />
                    <div className="mt-1 hidden text-xs text-zinc-500 2xl:text-sm">
                      {values.additionalGuidelines.length}/1000 characters
                    </div>
                  </div>

                  {/* CORE IDEA */}
                  <div className="relative col-span-6 flex flex-col sm:col-span-3">
                    <label className="mb-1 text-sm text-[#AFAFAF] 2xl:text-[18px]">Core Idea</label>
                    <div className="input-gradient-border my-1 w-full">
                      <Field
                        name="coreIdea"
                        rows={2}
                        className={`flex h-11 w-full flex-1 items-center rounded-full bg-[#383838]/50 px-4! py-2.5 pl-6! text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:h-[49px] 2xl:text-base 2xl:placeholder:text-base ${errors.coreIdea && touched.coreIdea ? 'border-red-500 bg-red-500/10' : ''}`}
                        placeholder="Enter your brand core idea"
                        disabled={isFormSubmitting}
                      />
                    </div>
                    <ErrorMessage
                      name="coreIdea"
                      component="div"
                      className="error !2xl:text-sm !text-xs"
                    />
                    <div className="mt-1 hidden text-sm text-zinc-500">
                      {values.coreIdea.length}/500 characters
                    </div>
                  </div>
                  {/* TARGET AUDIENCE TAGS */}
                  <div className="col-span-6 flex w-full flex-col">
                    <label className="mt-1 mb-2 text-sm text-[#AFAFAF] 2xl:text-[18px]">
                      Target Audience*
                    </label>
                    <TargetAudienceTags disabled={isFormSubmitting} />
                  </div>
                </div>
              </div>
              <div className="col-span-3 flex flex-wrap items-center justify-end gap-3 pt-6 2xl:pt-9">
                <button
                  type="submit"
                  disabled={
                    isFormSubmitting ||
                    (productionAndServices?.status == 'success' && results?.status != 'success')
                  }
                  className="h-10 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-emerald-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 2xl:text-base"
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
