'use client';
import React from 'react';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { Dialog, DialogContent } from '@/components/ui/dialog';

import { Analyzingsweburl, createCampaign } from '@/store/actions/adFactoryNew/adFactoryActions';
import { updateMetaData } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import AdFactoryBgEffect from './AdFactoryBgEffect';
import { useNavigate } from 'react-router-dom';

const schema = Yup.object({
  campaignName: Yup.string()
    .required('Campaign Name is required')
    .min(3, 'Campaign Name must be at least 3 characters')
    .max(50, 'Campaign Name must be less than 50 characters'),
  // website_url: Yup.string()
  //   .nullable()
  //   .optional()
  //   .test('is-valid-url', 'Please enter a valid URL (e.g., https://example.com)', (value) => {
  //     // If no value is provided, it's valid (optional field)
  //     if (!value || value.trim() === '') {
  //       return true;
  //     }

  //     // Validate URL format if provided
  //     const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
  //     return urlPattern.test(value);
  //   }),
});

export default function StartFormDialog({ open, onOpenChange }) {
  const { userData } = useSelector((state) => state.socket);
  const { loading, metadata } = useSelector((state) => state.adFactoryNew);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="backdrop-blur-100 w-[96%] max-w-3xl! scale-100! rounded-[30px] border border-white/10 bg-[#303030]/50 p-10 text-white md:w-full">
          {/* Headings */}
          <div className="headings flex flex-col gap-0.5">
            <p className="mb-0 bg-gradient-to-b from-[#5E66F5] to-[#15DCFF] bg-clip-text text-center text-[26px] font-semibold text-transparent">
              Start — Create Campaign
            </p>
            <p className="mb-2 text-center text-[16px] font-medium text-[#AFAFAF]">
              Give your campaign a name to get started.
            </p>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {/* FORM */}
            <Formik
              validateOnBlur={false}
              validateOnChange={true}
              initialValues={{
                campaignName: metadata?.campaignName || '',
                website_url: metadata?.website_url || '',
              }}
              validationSchema={schema}
              onSubmit={async (values, { setSubmitting }) => {
                try {
                  const payload = {
                    campaignName: values.campaignName,
                    userId: userData?.user_id,
                  };
                  const payloadUrl = {
                    website_url: values.website_url && values.website_url,
                  };

                  dispatch(updateMetaData(values));
                  const result = await dispatch(createCampaign(payload));
                  if (createCampaign.fulfilled.match(result) && values.website_url !== '') {
                    const urlresult = await dispatch(Analyzingsweburl(payloadUrl));
                  }

                  if (
                    createCampaign.fulfilled.match(result) ||
                    Analyzingsweburl?.fulfilled.match(urlresult)
                  ) {
                    navigate(`/adfactory?campaignId=${result.payload}`);
                  } else {
                    console.error(result.payload);
                  }
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {({ errors, touched, isValid, dirty, isSubmitting }) => (
                <Form className="space-y-5">
                  {/* Campaign Name */}
                  <div>
                    <label className="text-[18px] font-medium text-white">Campaign Name*</label>
                    <div className="mt-2">
                      <Field
                        name="campaignName"
                        className={`rounded-10 h-[52px] w-full bg-[#909294]/20 px-5 py-2.5 text-white backdrop-blur-md outline-none placeholder:text-[16px] placeholder:font-medium placeholder:text-[#AFAFAF] ${
                          errors.campaignName && touched.campaignName
                            ? 'border border-red-500'
                            : 'border border-transparent'
                        }`}
                        placeholder="Enter your creative campaign name"
                        disabled={isSubmitting || loading}
                      />
                    </div>
                    <ErrorMessage
                      name="campaignName"
                      component="div"
                      className="mt-1 text-xs text-red-400"
                    />
                  </div>
                  <div>
                    <label className="text-[18px] font-medium text-white">Website URL</label>
                    <div className="mt-2">
                      {/* <Field
                        name="website_url"
                        className={`rounded-10 h-[52px] w-full bg-[#909294]/20 px-5 py-2.5 text-white backdrop-blur-md outline-none placeholder:text-[16px] placeholder:font-medium placeholder:text-[#AFAFAF] ${
                          errors.website_url && touched.website_url
                            ? 'border border-red-500'
                            : 'border border-transparent'
                        }`}
                        placeholder="https://example.com (optional)"
                        disabled={isSubmitting || loading}
                      /> */}

                      <Field
                        name="website_url"
                        className="rounded-10 h-[52px] w-full border border-transparent bg-[#909294]/20 px-5 py-2.5 text-white backdrop-blur-md outline-none placeholder:text-[16px] placeholder:font-medium placeholder:text-[#AFAFAF]"
                        placeholder="https://example.com (optional)"
                        disabled={isSubmitting || loading}
                      />
                    </div>
                    {/* <ErrorMessage
                      name="website_url"
                      component="div"
                      className="mt-1 text-xs text-red-400"
                    /> */}
                  </div>
                  {/* Action Buttons */}
                  <div className="mt-8 flex flex-wrap justify-center gap-3 md:justify-end">
                    <button
                      type="button"
                      className="rounded-lg border border-[#E3E3E3] bg-transparent px-10 py-1.5 text-[#E3E3E3] hover:bg-zinc-800 disabled:opacity-50"
                      disabled={isSubmitting}
                      onClick={handleClose}
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={!isValid || !dirty || isSubmitting || loading}
                      className="rounded-lg bg-white px-4 py-2 font-semibold text-black shadow-lg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSubmitting || loading ? (
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent"></div>
                          Creating...
                        </div>
                      ) : (
                        'Start Campaign'
                      )}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </motion.div>
        </DialogContent>
      </Dialog>
      <AdFactoryBgEffect />
    </>
  );
}
