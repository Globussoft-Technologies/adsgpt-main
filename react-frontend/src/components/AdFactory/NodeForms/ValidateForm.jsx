import React from 'react';
import { Formik, Form, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { PiFacebookLogoBold, PiSnapchatLogo } from 'react-icons/pi';
import { FaGoogle, FaMeta, FaPinterest, FaReddit, FaSnapchat, FaWhatsapp } from 'react-icons/fa6';
import { AiFillTikTok } from 'react-icons/ai';
import { RiTwitterXFill } from 'react-icons/ri';
import { AiOutlineYoutube } from 'react-icons/ai';
import { FaInstagram, FaLinkedin } from 'react-icons/fa';
import { RectangleVertical, Square, RectangleHorizontal, Trash2 } from 'lucide-react';

import { setActiveForm } from '@/store/reducers/AdFactory/AdFactorySlice';
import { fetchCampaignById, updateCampaign } from '@/store/actions/adFactoryNew/adFactoryActions';
import { updateDistribution } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  setCompletedNodes,
  setFormProgress,
  updateNodeEnabledStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';
import { useSearchParams } from 'react-router-dom';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { AD_PLATFORMS } from '@/components/AdFactory/adPlatforms';

const schema = Yup.object().shape({
  platforms: Yup.array()
    .of(
      Yup.object().shape({
        platformName: Yup.string().required('Platform is required'),
        creativeRatios: Yup.array()
          .of(Yup.string().required('Ratio is required'))
          .min(1, 'Select at least one ratio')
          .max(5, 'Maximum 5 ratios allowed')
          .required('Ratios are required'),
      })
    )
    .min(1, 'Select at least one platform')
    .max(10, 'Maximum 10 platforms allowed'),
});

// Icons and sizes are presentation and stay here; the platform list and each
// platform's valid ratios come from the shared matrix, so v1 and Quick setup
// cannot drift. Quick setup carried its own shorter copy that offered a ratio
// no platform accepts (1.91:1) and omitted one Pinterest needs (2:3).
const RATIO_ICONS = {
  '1:1': Square,
  '4:5': RectangleVertical,
  '2:3': RectangleVertical,
  '9:16': RectangleVertical,
  '16:9': RectangleHorizontal,
};

const PLATFORM_ICONS = {
  meta: { icon: FaMeta, iconSize: 'size-5.5 2xl:size-6' },
  google: { icon: FaGoogle, iconSize: 'size-5.5 2xl:size-6' },
  tiktok: { icon: AiFillTikTok, iconSize: 'size-7' },
  snapchat: { icon: FaSnapchat, iconSize: 'size-5.5 2xl:size-6' },
  linkedin: { icon: FaLinkedin, iconSize: 'size-5.5 2xl:size-6' },
  twitter: { icon: RiTwitterXFill, iconSize: 'size-5.5 2xl:size-6' },
  pinterest: { icon: FaPinterest, iconSize: 'size-5.5 2xl:size-6' },
  reddit: { icon: FaReddit, iconSize: 'size-5.5 2xl:size-6' },
  whatsapp: { icon: FaWhatsapp, iconSize: 'size-5.5 2xl:size-6' },
};

const availablePlatforms = AD_PLATFORMS.map((p) => ({
  id: p.id,
  name: p.id,
  isLaunchable: p.isLaunchable,
  ...PLATFORM_ICONS[p.id],
  availableRatios: p.ratios.map((value) => ({ value, label: value, icon: RATIO_ICONS[value] })),
}));

export default function ValidateForm({ onComplete }) {
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  const dispatch = useDispatch();
  const { loading, distribution, productionAndServices, results } = useSelector(
    (state) => state.adFactoryNew
  );
  const { userData } = useSelector((state) => state.socket);
  const isSubmitting = loading;

  const initialValues = React.useMemo(() => {
    if (
      distribution?.platforms &&
      Array.isArray(distribution.platforms) &&
      distribution.platforms.length > 0
    ) {
      return {
        platforms: distribution.platforms?.map((p) => ({
          platformName: p.platformName || '',
          creativeRatios: Array.isArray(p.creativeRatios) ? p.creativeRatios : [],
        })),
      };
    }
    // Default: Meta pre-selected with '' ratio
    return { platforms: [{ platformName: 'meta', creativeRatios: [] }] };
  }, [distribution]);

  const handleSubmit = async (values, { setSubmitting }) => {
    try {
      // Validate that each platform has at least one ratio
      const hasInvalidPlatform = values.platforms.some(
        (platform) => !platform.creativeRatios || platform.creativeRatios.length === 0
      );

      if (hasInvalidPlatform) {
        // toast.error('Please select at least one aspect ratio for each platform');
        return;
      }

      const payload = {
        campaignId: campaignId,
        nodeType: 'distribution',
        data: { platforms: values.platforms },
      };

      dispatch(updateDistribution(payload?.data));
      const result = await dispatch(updateCampaign(payload));
      const campaignPayload = {
        campaignId: campaignId,
        userId: userData?.user_id,
      };
      // dispatch(fetchCampaignById(campaignPayload));
      if (updateCampaign.fulfilled.match(result)) {
        // Update node completion status
        dispatch(setCompletedNodes('validate'));
        dispatch(setFormProgress({ nodeId: 'validate', progress: 100 }));

        // Update node enabled status to enable next nodes
        dispatch(updateNodeEnabledStatus());

        // Call onComplete if provided
        if (onComplete) {
          onComplete();
        }
      }
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 25, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="text-gray-900 dark:text-white"
    >
      <h2 className="mb-6 text-center text-xl font-semibold text-gray-900 dark:text-white 2xl:text-[23px]">
        Platforms & Ratios
      </h2>

      <Formik
        initialValues={initialValues}
        validationSchema={schema}
        validateOnChange={true}
        validateOnBlur={true}
        onSubmit={handleSubmit}
        enableReinitialize
      >
        {({
          values,
          setFieldValue,
          errors,
          touched,
          isValid,
          dirty,
          isSubmitting: formikSubmitting,
          validateForm,
        }) => {
          const submitting = formikSubmitting;

          const handlePlatformToggle = async (name) => {
            const currentPlatforms = [...values.platforms];
            const isSelected = currentPlatforms?.some((p) => p.platformName === name);

            if (isSelected) {
              const updatedPlatforms = currentPlatforms?.filter((p) => p.platformName !== name);
              await setFieldValue('platforms', updatedPlatforms);
            } else {
              if (currentPlatforms?.length < 10) {
                currentPlatforms.push({
                  platformName: name,
                  creativeRatios: [],
                });
                await setFieldValue('platforms', currentPlatforms, false);
              }
            }
          };

          const handleRatioToggle = async (pIdx, value) => {
            const currentRatios = [...values.platforms[pIdx].creativeRatios];
            const isSelected = currentRatios?.includes(value);

            if (isSelected) {
              const updatedRatios = currentRatios?.filter((r) => r !== value);
              await setFieldValue(`platforms.${pIdx}.creativeRatios`, updatedRatios);
            } else {
              if (currentRatios?.length < 5) {
                currentRatios.push(value);
                await setFieldValue(`platforms.${pIdx}.creativeRatios`, currentRatios);
              }
            }
          };

          return (
            <Form className="flex flex-col gap-0">
              <div className="max-h-[calc(100svh-320px)] space-y-6 overflow-y-auto p-2 pr-5">
                {/* Platform Selection */}
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="mb-1 text-sm text-gray-500 dark:text-[#AFAFAF] 2xl:mb-1.5 2xl:text-[18px]">
                      Platform
                    </label>
                    <div className="flex flex-wrap gap-2 2xl:gap-3">
                      {availablePlatforms.map(({ id, name, icon: Icon, iconSize }) => {
                        const isSelected = values.platforms.some((p) => p.platformName === name);

                        return (
                          <div
                            key={id}
                            className={`group rounded-lg transition-all ${
                              isSelected
                                ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-[1.5px] shadow-[0_0_12px_rgba(2,200,196,0.30)]'
                                : 'bg-black/10 p-[1px] dark:bg-white/10'
                            } w-fit`}
                          >
                            <button
                              type="button"
                              onClick={() => handlePlatformToggle(name)}
                              className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg transition-all 2xl:h-[52px] 2xl:w-[52px] ${
                                isSelected
                                  ? 'bg-[#02C8C4]/15 text-[#02C8C4] dark:bg-[#02C8C4]/25 dark:text-[#02C8C4]'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200/80 hover:text-black dark:bg-[#2d2d2d] dark:text-[#AFAFAF] dark:hover:bg-[#383838] dark:hover:text-white'
                              }`}
                              disabled={submitting}
                            >
                              <Icon className={iconSize} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {errors.platforms && typeof errors.platforms === 'string' && (
                      <div className="mt-1 text-xs text-red-400 2xl:text-sm">
                        {errors.platforms}
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected Platforms Configuration */}
                {values.platforms.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-base text-gray-900 dark:text-white 2xl:text-[21px]">
                      Configure Aspect Ratios
                    </h3>
                    <div className="space-y-6">
                      {values.platforms.map((platform, pIdx) => {
                        const platformConfig = availablePlatforms.find(
                          (p) => p.name === platform.platformName
                        );
                        const platformError = errors.platforms?.[pIdx];
                        const ratiosError = platformError?.creativeRatios;

                        return (
                          <div
                            key={pIdx}
                            className="rounded-lg border border-black/10 bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800/30 p-4"
                          >
                            {/* Platform Header */}
                            <div className="mb-4 flex items-center justify-between">
                              <div className="flex items-center gap-2 2xl:gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gray-100 dark:bg-zinc-700/50 2xl:h-11 2xl:w-11">
                                  {platformConfig &&
                                    React.createElement(platformConfig.icon, {
                                      className: platformConfig.iconSize,
                                    })}
                                </div>
                                <div className="flex flex-col">
                                  <h4 className="text-base font-medium text-gray-500 dark:text-[#AFAFAF] capitalize 2xl:text-lg">
                                    {platform.platformName}
                                  </h4>

                                  <span
                                    className={`mt-1 w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                      platformConfig?.isLaunchable
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : 'bg-yellow-500/20 text-yellow-400'
                                    }`}
                                  >
                                    {platformConfig?.isLaunchable
                                      ? 'Ad launching is supported on this platform.'
                                      : 'Ad launching is currently unavailable for this platform.'}
                                  </span>
                                </div>
                              </div>
                              <ShadcnTooltip label="Remove Platform">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedPlatforms = values.platforms.filter(
                                      (_, index) => index !== pIdx
                                    );
                                    setFieldValue('platforms', updatedPlatforms);
                                  }}
                                  className="h-10 w-10 rounded-full bg-red-500/20 px-3 py-2 text-sm text-red-400 hover:bg-red-500/30"
                                  disabled={submitting}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </ShadcnTooltip>
                            </div>

                            {/* Aspect Ratio Selection */}
                            <div className="flex flex-col gap-3">
                              <label className="text-xs text-gray-500 dark:text-[#AFAFAF] 2xl:text-sm">
                                Select Aspect Ratios *
                              </label>
                              <div className="flex flex-wrap gap-2.5">
                                {platformConfig?.availableRatios.map(
                                  ({ value, label, icon: Icon }) => {
                                    const isSelected = platform.creativeRatios.includes(value);

                                    return (
                                      <div
                                        key={value}
                                        className={`group cursor-pointer select-none rounded-full transition-all ${
                                          isSelected
                                            ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-[1.5px] shadow-[0_0_12px_rgba(2,200,196,0.20)] dark:from-[#02C8C4]/60 dark:to-[#5867EB]/60 dark:shadow-none'
                                            : 'bg-black/10 p-[1px] dark:bg-white/10'
                                        } w-fit`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => handleRatioToggle(pIdx, value)}
                                          className={`flex cursor-pointer select-none items-center justify-center gap-1.5 rounded-full px-5 py-1.5 text-xs transition-all ${
                                            isSelected
                                              ? 'bg-[#02C8C4]/15 text-gray-900 dark:bg-[#02C8C4]/25 dark:text-white'
                                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200/80 hover:text-black dark:bg-[#2d2d2d] dark:text-[#AFAFAF] dark:hover:bg-[#383838] dark:hover:text-white'
                                          }`}
                                          disabled={submitting}
                                        >
                                          <Icon className={`h-4 w-4 transition-colors ${isSelected ? 'text-[#02C8C4]' : 'text-gray-500 dark:text-[#AFAFAF]'}`} />
                                          <span className={`text-xs 2xl:text-sm ${isSelected ? 'font-bold' : 'font-medium'}`}>{label}</span>
                                        </button>
                                      </div>
                                    );
                                  }
                                )}
                              </div>

                              {/* Simple error display for ratios */}
                              {ratiosError && typeof ratiosError === 'string' && (
                                <div className="mt-1 text-sm text-red-400">{ratiosError}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS */}
              <div className="mt-8 flex flex-wrap justify-end gap-3 md:mt-12">
                <button
                  type="button"
                  onClick={() => dispatch(setActiveForm(null))}
                  className="rounded-lg border border-gray-300 bg-transparent px-10 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 dark:border-[#E3E3E3] dark:text-[#E3E3E3] dark:hover:bg-zinc-800 disabled:opacity-50 2xl:text-base"
                  disabled={submitting}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    (productionAndServices?.status == 'success' && results?.status != 'success')
                  }
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black shadow-lg shadow-emerald-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 2xl:text-base"
                >
                  {submitting ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white dark:border-black border-t-transparent dark:border-t-transparent"></div>
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
