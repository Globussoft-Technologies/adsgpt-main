import React, { useState } from 'react';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Square,
  FileType,
  Image as ImageIcon,
  Video as VideoIcon,
  RectangleHorizontal,
  RectangleVertical,
} from 'lucide-react';
import InputCommonDropdown from './InputCommonDropdown';
import { PiFacebookLogoBold, PiSnapchatLogo } from 'react-icons/pi';
import { RiTwitterXFill } from 'react-icons/ri';
import { AiOutlineYoutube } from 'react-icons/ai';
import { FaInstagram, FaLinkedin, FaPlay } from 'react-icons/fa';
import { fetchCampaignById, updateCampaign } from '@/store/actions/adFactoryNew/adFactoryActions';
import {
  initializeResults,
  updateProductionAndServices,
} from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  setCompletedNodes,
  setFormProgress,
  setSelectedServices,
  updateNodeEnabledStatus,
  updateNodeStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';
import { setActiveForm } from '@/store/reducers/AdFactory/AdFactorySlice';
import { useSearchParams } from 'react-router-dom';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const schema = Yup.object({
  servicesSelected: Yup.object({
    text: Yup.number()
      .min(0, 'Must be 0 or greater')
      .max(50, 'Cannot exceed 50')
      .required('Text quantity is required'),
    image: Yup.number()
      .min(0, 'Must be 0 or greater')
      .max(50, 'Cannot exceed 50')
      .required('Image quantity is required'),
    // video: Yup.number()
    //   .min(0, 'Must be 0 or greater')
    //   .max(20, 'Cannot exceed 20')
    //   .required('Video quantity is required'),
  }).test(
    'at-least-one-service',
    'Please select at least one service with quantity greater than 0',
    function (value) {
      const { text, image } = value;
      return text > 0 || image > 0;
    }
  ),

  imageModelProvider: Yup.string().oneOf(
    ['auto', 'openai','openai2', 'google'],
    'Invalid image model provider'
  ),
  // videoModelProvider: Yup.string().oneOf(
  //   ['auto', 'openai', 'google'],
  //   'Invalid video model provider'
  // ),
});

export default function ServicesForm({ onComplete, setShowGeneratingLoader }) {
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  const dispatch = useDispatch();
  const { loading, productionAndServices, results, distribution } = useSelector(
    (state) => state.adFactoryNew
  );
  const { credits, userData } = useSelector((state) => state.socket);
  const isSubmitting = loading;

  // Credit calculations
  const creativeCreditsLeft =
    userData?.featureObject['Ad Creative'] - credits?.ChatCountAdsCreative > 0
      ? userData?.featureObject['Ad Creative'] - credits?.ChatCountAdsCreative
      : 0;
  const textCreditsLeft =
    userData?.featureObject['Ad copy'] - credits?.chatCountAdsCopy > 0
      ? userData?.featureObject['Ad copy'] - credits?.chatCountAdsCopy
      : 0;
  // const videoCreditsLeft =
  //   userData?.featureObject['Ad Creative Video'] - credits?.ChatCountAdsVideo > 0
  //     ? userData?.featureObject['Ad Creative Video'] - credits?.ChatCountAdsVideo
  //     : 0;

  const initialValues = {
    servicesSelected: {
      text: 0,
      image: 0,
      video: 0,
    },
    imageModelProvider: 'google',
    videoModelProvider: 'auto',
  };
  productionAndServices?.servicesSelected?.forEach((item) => {
    const { serviceName, serviceParams } = item;
    initialValues.servicesSelected[serviceName] = serviceParams?.quantity;

    if (serviceName === 'image' && serviceParams?.model) {
      const validModels = ['google', 'openai'];
      initialValues.imageModelProvider = validModels.includes(serviceParams.model)
        ? serviceParams.model
        : 'google';
    }
    // if (serviceName === 'video') {
    //   initialValues.videoModelProvider = serviceParams?.model;
    // }
  });

  // const calculateCreditCost = (values) => {
  //   const { text, image, video } = values.servicesSelected;
  //   const imageProvider = values.imageModelProvider;

  //   let imageCost = 0;
  //   if (image > 0) {
  //     const costMap = {
  //       // auto: creativeCreditsLeft >= image * 7 ? 7 : 1,
  //       openai: 7,
  //       google: 7,
  //     };
  //     imageCost = image * costMap[imageProvider];
  //   }

  //   const textCost = text * 1 * distribution?.platforms?.length;
  //   // const videoCost = video * 3;

  //   return {
  //     total: textCost + imageCost,
  //     text: textCost,
  //     image: imageCost,
  //     // video: videoCost,
  //   };
  // };

  //   const validateCredits = (values) => {
  //     const costs = calculateCreditCost(values);
  //     const errors = {};

  //     if (costs.text > textCreditsLeft) {
  //       errors.serviceError = `Insufficient text credits. Required: ${costs.text}, Available: ${textCreditsLeft}`;
  //     }

  //     if (costs.image > creativeCreditsLeft) {
  //       errors.imageProviderError = `Insufficient image credits. Required: ${costs.image}, Available: ${creativeCreditsLeft}`;
  //     }

  //     // if (costs.video > videoCreditsLeft) {
  //     //   errors.serviceError = `Insufficient video credits. Required: ${costs.video}, Available: ${videoCreditsLeft}`;
  //     // }
  // const availableCredits = credits?.totalCredits - credits?.creditsUsed;
  //     if  (costs.total > availableCredits) {
  //       errors.serviceError = 'Total credits required exceed available credits';
  //     }

  //     return errors;
  //   };
  const calculateCreditCost = (values) => {
    const imageQty = values.servicesSelected.image || 0;
    const imageCostPerUnit = 7;

    const imageCost = imageQty * imageCostPerUnit;

    return {
      total: imageCost,
      text: 0,
      image: imageCost,
    };
  };

  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);

  const validateCredits = (values) => {
    const errors = {};

    const imageQty = values.servicesSelected.image || 0;
    const imageCostPerUnit = 7;
    const totalImageCost = imageQty * imageCostPerUnit;

    // If no credits left at all
    if (availableCredits <= 0 && imageQty > 0) {
      errors.serviceError = 'No credits available to generate images.';
      return errors;
    }

    // If requested images exceed available credits
    if (totalImageCost > availableCredits) {
      errors.serviceError = `Insufficient credits. Required: ${totalImageCost}, Available: ${availableCredits}`;
    }

    return errors;
  };

  const handleSubmit = async (values, { setSubmitting }) => {
    dispatch(setFormProgress({ nodeId: 'text-generation', progress: 0 }));
    dispatch(setFormProgress({ nodeId: 'image-generation', progress: 0 }));
    try {
      const { text, image, video } = values.servicesSelected;

      // Final validation
      if (text === 0 && image === 0) {
        // toast.error('Please select at least one service.');
        return;
      }

      // Dispatch initializeResults
      dispatch(initializeResults({ type: 'text', quantity: text }));
      dispatch(initializeResults({ type: 'image', quantity: image }));
      // dispatch(initializeResults({ type: 'video', quantity: video }));

      // Convert to backend-required structure
      const servicesArrayPayload = [
        {
          serviceName: 'text',
          serviceParams: {
            quantity: text,
            model: 'auto',
          },
        },
        {
          serviceName: 'image',
          serviceParams: {
            quantity: image,
            model: values.imageModelProvider,
          },
        },
        {
          serviceName: 'video',
          serviceParams: {
            quantity: 0,
            model: 'auto',
          },
        },
      ];

      const payload = {
        campaignId: campaignId,
        nodeType: 'services',
        data: {
          servicesSelected: servicesArrayPayload,
        },
      };
      dispatch(updateProductionAndServices(payload));

      // Get selected services for enabling generation nodes
      const selectedServices = {
        text: text > 0,
        image: image > 0,
        // video: video > 0,
      };

      // Dispatch action to update selected services in Redux
      dispatch(setSelectedServices(selectedServices));

      const result = await dispatch(updateCampaign(payload));
      const campaignPayload = {
        campaignId: campaignId,
        userId: userData?.user_id,
      };
      // dispatch(fetchCampaignById(campaignPayload));
      if (updateCampaign.fulfilled.match(result)) {
        // Update node status and enable generation nodes
        dispatch(setCompletedNodes('services'));
        dispatch(setFormProgress({ nodeId: 'services', progress: 100 }));
        dispatch(updateNodeEnabledStatus());

        // DO NOT mark text-generation or image-generation as completed here
        // They will be marked as completed only AFTER successful generation produces results
        // Just reset their progress to 0 for the next generation cycle
        if (text > 0) {
          dispatch(setFormProgress({ nodeId: 'text-generation', progress: 0 }));
          dispatch(
            updateNodeStatus({
              nodeId: 'text-generation',
              status: 'idle',
              progress: 0,
            })
          );
        }

        if (image > 0) {
          dispatch(setFormProgress({ nodeId: 'image-generation', progress: 0 }));
          dispatch(
            updateNodeStatus({
              nodeId: 'image-generation',
              status: 'idle',
              progress: 0,
            })
          );
        }
        // if (video > 0) {
        //   dispatch(setFormProgress({ nodeId: 'video-generation', progress: 0 }));
        //   dispatch(
        //     updateNodeStatus({
        //       nodeId: 'video-generation',
        //       status: 'idle',
        //       progress: 0,
        //     })
        //   );
        // }

        dispatch(updateNodeEnabledStatus());

        // Show success summary
        const costs = calculateCreditCost(values);
        // toast.success(`Services submitted successfully! Total credits used: ${costs.total}`);

        if (onComplete) {
          onComplete();
        }
      }
    } catch (error) {
      console.error('Form submission error:', error);
      // toast.error('Failed to submit services');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 25, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="text-white"
    >
      <h2 className="mb-5 text-center text-xl font-semibold text-white 2xl:text-[23px]">
        Services Selection
      </h2>

      <Formik
        initialValues={initialValues}
        validationSchema={schema}
        validate={validateCredits}
        validateOnChange={true}
        validateOnBlur={true}
        onSubmit={handleSubmit}
        enableReinitialize={true}
      >
        {({ values, setFieldValue, errors, touched, isSubmitting, isValid, dirty }) => {
          const costs = calculateCreditCost(values);

          return (
            <Form className="">
              <div className="max-h-[calc(100svh-290px)] space-y-6 overflow-y-auto sm:pr-5">
                {/* SERVICE QUANTITY INPUTS */}
                <div className="space-y-5">
                  <h3 className="relative top-1.5 flex items-center gap-2 text-base text-white 2xl:text-lg">
                    Service Quantities
                    <span className="rounded-full border border-green-500/30 bg-green-600/20 px-3 py-1 text-sm font-semibold text-green-400">
                      Credits Available: {availableCredits}
                    </span>
                  </h3>

                  {/* Text Service */}
                  <div className="rounded-xl border border-white/10 bg-transparent p-5">
                    <div className="mb-4 flex items-center gap-1.5 2xl:gap-2">
                      <FileType className="size-4.5 text-[#AFAFAF] 2xl:size-5" />
                      <h3 className="text-base font-semibold text-[#AFAFAF] 2xl:text-lg">
                        Text Ads
                      </h3>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      <label className="text-sm text-[#AFAFAF] 2xl:text-base">
                        Quantity (Max: 50)
                      </label>
                      <div className="input-gradient-border">
                        <input
                          type="number"
                          min="0"
                          max="50"
                          value={Number(values.servicesSelected.text) || ''}
                          onChange={(e) =>
                            setFieldValue('servicesSelected.text', parseInt(e.target.value) || 0)
                          }
                          className="h-10.5 w-full rounded-full bg-[#383838]/50 px-5 py-2.5 pl-6 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:h-[49px] 2xl:text-base 2xl:placeholder:text-base"
                          placeholder="Enter quantity"
                          disabled={isSubmitting}
                        />
                      </div>
                      {errors.servicesSelected?.text && touched.servicesSelected?.text && (
                        <div className="text-xs text-red-400">{errors.servicesSelected.text}</div>
                      )}
                      <div className="flex items-center justify-between pr-3">
                        <div className="mt-1 text-xs text-zinc-400 2xl:text-sm">
                          {/* Available credits: {textCreditsLeft}
                           */}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400 2xl:text-sm">
                          Cost per text : 0 credit
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Image Service */}
                  <div className="rounded-xl border border-white/10 bg-transparent p-5">
                    <div className="mb-4 flex items-center gap-1.5 2xl:gap-2">
                      <ImageIcon className="size-4.5 text-[#AFAFAF] 2xl:size-5" />
                      <h3 className="text-base font-semibold text-[#AFAFAF] 2xl:text-lg">
                        Image Ads
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-x-7 gap-y-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2.5">
                        <label className="text-sm text-[#AFAFAF] 2xl:text-base">
                          Quantity (Max: 50)
                        </label>
                        <div className="input-gradient-border">
                          <input
                            type="number"
                            min="0"
                            max="50"
                            value={Number(values.servicesSelected.image) || ''}
                            onChange={(e) =>
                              setFieldValue('servicesSelected.image', parseInt(e.target.value) || 0)
                            }
                            className="h-10.5 w-full rounded-full bg-[#383838]/50 px-5 py-2.5 pl-6 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:h-[49px] 2xl:text-base 2xl:placeholder:text-base"
                            placeholder="Enter quantity"
                            disabled={isSubmitting}
                          />
                        </div>
                        {errors.servicesSelected?.image && touched.servicesSelected?.image && (
                          <div className="text-xs text-red-400">
                            {errors.servicesSelected.image}
                          </div>
                        )}
                        <div className="mt-1 text-xs text-zinc-400 2xl:text-sm">
                          {/* Available credits: {creativeCreditsLeft} */}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2.5">
                        <label className="text-sm text-[#AFAFAF] 2xl:text-base">
                          Model Provider
                        </label>
                        <div className="input-gradient-border">
                          <InputCommonDropdown
                            value={values.imageModelProvider}
                            onChange={(value) => setFieldValue('imageModelProvider', value)}
                            placeholder="Select model"
                            options={[
                              { value: 'google', label: 'Nano Banana Pro (Best for Lifestyle & People)' },
                              { value: 'openai', label: 'OpenAI 1.5 (Balanced, Fast)' },
                              // { value: 'openai2', label: 'OpenAI 2.0 (Photorealistic, Best Quality)' },
                            ]}
                            disabled={isSubmitting}
                          />
                        </div>
                        {errors.imageModelProvider && touched.imageModelProvider && (
                          <div className="text-xs text-red-400">{errors.imageModelProvider}</div>
                        )}
                        {/* <div className="mt-1 pr-4 text-right text-sm text-zinc-400">
                          Cost per image {values.imageModelProvider === 'auto'&&"A deduction of 1 or 7 credits may be applied per image. Given your selection of auto mode, the precise credit deduction will be displayed post-image generation, with a consistent maximum of 7 credits"}
                          {values.imageModelProvider !== 'auto'&&(values.imageModelProvider === 'google' ? ' : 1 credit' : ': 7 credits')}
                          
                        </div> */}
                        <div className="mt-1 pr-4 text-xs text-zinc-400 2xl:text-sm">
                          {/* {values.imageModelProvider === 'auto' ? (
                            <div className="text-justify leading-relaxed">
                              A deduction of 1 or 7 credits may be applied per image. Given your
                              selection of auto mode, the precise credit deduction will be displayed
                              post-image generation, with a consistent maximum of 7 credits.
                            </div>
                          ) : ( */}
                          <div className="text-right">
                            Cost per image: 7 credits
                            {/* {values.imageModelProvider === 'google' ? '1 credit' : '7 credits'} */}
                          </div>
                          {/* )} */}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Video Service */}
                  {false && (
                    <div className="rounded-xl border border-white/10 bg-transparent p-5">
                      <div className="mb-4 flex items-center gap-1 2xl:gap-2">
                        <VideoIcon className="size-4.5 text-[#AFAFAF] 2xl:size-5" />
                        <h3 className="text-base font-semibold text-[#AFAFAF] 2xl:text-lg">
                          Video Ads
                        </h3>
                      </div>
                      <div className="grid grid-cols-1 gap-x-7 gap-y-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2.5">
                          <label className="text-sm text-[#AFAFAF] 2xl:text-base">
                            Quantity (Max: 20)
                          </label>
                          <div className="input-gradient-border">
                            <input
                              type="number"
                              min="0"
                              max="20"
                              value={Number(values.servicesSelected.video) || ''}
                              onChange={(e) =>
                                setFieldValue(
                                  'servicesSelected.video',
                                  parseInt(e.target.value) || 0
                                )
                              }
                              className="h-10.5 w-full rounded-full bg-[#383838]/50 px-5 py-2.5 pl-6 text-sm text-white backdrop-blur-md transition outline-none placeholder:text-sm placeholder:text-[#AFAFAF] 2xl:h-[49px] 2xl:text-base 2xl:placeholder:text-base"
                              placeholder="Enter quantity"
                              disabled={isSubmitting}
                            />
                          </div>
                          {errors.servicesSelected?.video && touched.servicesSelected?.video && (
                            <div className="text-xs text-red-400">
                              {errors.servicesSelected.video}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-zinc-400 2xl:text-sm">
                            Available credits: {videoCreditsLeft}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2.5">
                          <label className="text-base text-[#AFAFAF]">Model Provider</label>
                          <div className="input-gradient-border">
                            <InputCommonDropdown
                              value={values.videoModelProvider}
                              onChange={(value) => setFieldValue('videoModelProvider', value)}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'openai', label: 'OpenAI' },
                                { value: 'google', label: 'Nano Banana' },
                              ]}
                              disabled={isSubmitting}
                            />
                          </div>
                          {errors.videoModelProvider && touched.videoModelProvider && (
                            <div className="text-xs text-red-400">{errors.videoModelProvider}</div>
                          )}
                          <div className="mt-1 text-sm text-zinc-400">
                            Cost per video: 3 credits
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Service Error */}
                {errors.serviceError && (
                  <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3">
                    <div className="flex items-center gap-2 text-red-400">
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="text-sm">{errors.serviceError}</span>
                    </div>
                  </div>
                )}

                {/* Image Provider Error */}
                {errors.imageProviderError && (
                  <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                    <div className="flex items-center gap-2 text-amber-400">
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="text-sm">{errors.imageProviderError}</span>
                    </div>
                  </div>
                )}

                {/* Total Cost Summary */}
                {(costs.text > 0 || costs.image > 0) && (
                  <div className="rounded-lg border border-gray-500/30 bg-gray-500/10 p-4">
                    <h4 className="mb-2 text-sm font-medium text-gray-100 2xl:text-base">
                      Credit Summary
                    </h4>
                    <div className="space-y-1 text-sm">
                      {costs.text > 0 && (
                        <div className="flex justify-between">
                          <span className="text-sm text-blue-300 2xl:text-base">
                            Text Ads*Platforms selected({distribution?.platforms?.length}) :
                          </span>
                          <span className="text-sm text-white 2xl:text-base">
                            {/* {costs.text} credits */}0 credits
                          </span>
                        </div>
                      )}
                      {costs.image > 0 && (
                        <div className="flex justify-between">
                          <span className="text-sm text-emerald-300 2xl:text-base">
                            Images ({values.imageModelProvider}):
                          </span>
                          <span className="text-sm text-white 2xl:text-base">
                            {costs.image} credits
                          </span>
                        </div>
                      )}
                      {/* {costs.video > 0 && (
                        <div className="flex justify-between">
                          <span className="text-purple-300">
                            Videos ({values.videoModelProvider}):
                          </span>
                          <span className="text-white">{costs.video} credits</span>
                        </div>
                      )} */}
                      <div className="flex justify-between border-t border-gray-500/30 pt-2">
                        <span className="text-sm font-medium text-[#AFAFAF] 2xl:text-base">
                          Total:
                        </span>
                        <span className="text-sm font-bold text-white 2xl:text-base">
                          {costs.image} credits
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-[#AFAFAF] 2xl:text-base">
                        {/* Total available credits: {textCreditsLeft + creativeCreditsLeft}
                         */}
                        Total available credits: {credits?.totalCredits - credits?.creditsUsed}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS */}
              <div className="mt-8 flex flex-wrap justify-end gap-3 md:mt-10">
                <button
                  type="button"
                  onClick={() => dispatch(setActiveForm(null))}
                  className="rounded-lg border border-[#E3E3E3] bg-transparent px-10 py-1.5 text-sm text-[#E3E3E3] transition hover:bg-zinc-800 disabled:opacity-50 2xl:text-base"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    (productionAndServices?.status == 'success' && results?.status != 'success') ||
                    (values.servicesSelected.text === 0 &&
                      values.servicesSelected.image === 0 &&
                      values.servicesSelected.video === 0)
                  }
                  className="min-w-32 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-emerald-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 2xl:text-base"
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      Generating...
                    </div>
                  ) : (
                    `Generate Ads (${costs.total} credits)`
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

export const ServicesFormLayout = ({ setShowGeneratingLoader, onComplete }) => {
  return <ServicesForm setShowGeneratingLoader={setShowGeneratingLoader} onComplete={onComplete} />;
};
