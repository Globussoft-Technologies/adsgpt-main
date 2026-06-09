import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StartForm from './NodeForms/StartForm';
import BrandForm from './NodeForms/BrandForm';
import InputsForm from './NodeForms/InputsForm';
import AssetForm from './NodeForms/AssetsForm';
import ValidateForm from './NodeForms/ValidateForm';
import ServicesForm, { ServicesFormLayout } from './NodeForms/ServicesForm';
import { useDispatch, useSelector } from 'react-redux';
import CreativeGenerationLayout from './CreativeGeneration/CreativeGenerationLayout';
import GeneratingLoader from './Loader/GeneratingLoader ';
import AdFactoryBgEffect from './NodeForms/AdFactoryBgEffect';
import { setActiveForm } from '@/store/reducers/AdFactory/AdFactorySlice';
import { X } from 'lucide-react';
import { fetchCampaignById } from '@/store/actions/adFactoryNew/adFactoryActions';
import { useSearchParams } from 'react-router-dom';

export default function NodeModal({ open, nodeId, onClose, onProgressUpdate }) {
  const dispatch = useDispatch();
  const [showGenerator, setShowGenerator] = useState(false);
  const [showGeneratingLoader, setShowGeneratingLoader] = useState(false);
  const { nodeStatus } = useSelector((state) => state.adFactory);
  const [searchParams] = useSearchParams();
  const { userData } = useSelector((state) => state.socket);
  if (!open) return null;

  const handleGenerateCreatives = () => {
    setShowGenerator(true);
  };

  const handleCloseGenerateCreative = () => {
    setShowGenerator(false);
    dispatch(setActiveForm(null));
  };

  // Handle form completion
  const handleFormComplete = (nodeId, progress = 100) => {
    if (onProgressUpdate) {
      onProgressUpdate(nodeId, progress);
    }

    // Close modal after successful submission
    setTimeout(() => {
      dispatch(setActiveForm(null));
    }, 500);
  };

  const forms = {
    // Legacy mappings
    start: <StartForm onComplete={() => handleFormComplete('start')} />,
    brand: <BrandForm onComplete={() => handleFormComplete('brand-info')} />,
    input: <InputsForm onComplete={() => handleFormComplete('objectives')} />,
    creative: (
      <AssetForm
        handleGenerateCreatives={handleGenerateCreatives}
        onComplete={() => handleFormComplete('assets')}
      />
    ),
    validate: <ValidateForm onComplete={() => handleFormComplete('validate')} />,
    generate: (
      <ServicesFormLayout
        setShowGeneratingLoader={setShowGeneratingLoader}
        onComplete={() => handleFormComplete('services')}
      />
    ),

    // New Flow mappings
    'brand-info': <BrandForm onComplete={() => handleFormComplete('brand-info')} />,
    objectives: <InputsForm onComplete={() => handleFormComplete('objectives')} />,
    assets: (
      <AssetForm
        handleGenerateCreatives={handleGenerateCreatives}
        onComplete={() => handleFormComplete('assets')}
      />
    ),
    services: (
      <ServicesFormLayout
        setShowGeneratingLoader={setShowGeneratingLoader}
        onComplete={() => handleFormComplete('services')}
      />
    ),
    'image-generation': (
      <ServicesFormLayout
        setShowGeneratingLoader={setShowGeneratingLoader}
        onComplete={() => handleFormComplete('image-generation')}
      />
    ),
    'text-generation': (
      <ServicesFormLayout
        setShowGeneratingLoader={setShowGeneratingLoader}
        onComplete={() => handleFormComplete('text-generation')}
      />
    ),
    'video-generation': (
      <ServicesFormLayout
        setShowGeneratingLoader={setShowGeneratingLoader}
        onComplete={() => handleFormComplete('video-generation')}
      />
    ),
  };

  const currentNodeStatus = nodeStatus?.[nodeId] || {};
  const isError = currentNodeStatus.status === 'failed';
  const campaignId = searchParams.get('campaignId');
  const payload = {
    campaignId: campaignId,
    userId: userData?.user_id,
  };

  return (
    <AnimatePresence>
      <motion.div
        className={`fixed inset-0 z-[999] flex items-center justify-center bg-black/20 p-3 backdrop-blur-[50px] md:p-0 dark:bg-[#0D0D0D]/50 ${showGenerator ? 'hidden' : 'block'} `}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => {
          // dispatch(fetchCampaignById(payload));
          // onClose();
        }}
      >
        <AdFactoryBgEffect />

        <motion.div
          className="relative max-h-[95vh] w-[95%] max-w-[600px] scale-100 rounded-[30px] border border-black/10 bg-white px-3 pt-8 pb-6 shadow-xl sm:px-6 lg:w-full 2xl:max-h-[92vh] 2xl:max-w-[800px] 2xl:p-8 2xl:px-10 2xl:pt-10 dark:border-white/10 dark:bg-[#303030]/50 dark:shadow-none"
          initial={{ scale: 0.8, opacity: 0, y: 40 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => dispatch(setActiveForm(null))}
            className="close_icon absolute top-5 right-5"
          >
            <X className="size-5" />
          </button>
          {/* Status Indicator */}
          {/* {currentNodeStatus.status && (
            <div
              className={`absolute top-8 flex items-center gap-2 text-sm font-medium ${
                currentNodeStatus.status === 'pending'
                  ? 'text-blue-400'
                  : currentNodeStatus.status === 'success'
                    ? 'text-emerald-400'
                    : currentNodeStatus.status === 'failed'
                      ? 'text-red-400'
                      : 'text-zinc-400'
              }`}
            >
              <div
                className={`h-2 w-2 rounded-full ${
                  currentNodeStatus.status === 'pending'
                    ? 'animate-pulse bg-blue-400'
                    : currentNodeStatus.status === 'success'
                      ? 'bg-emerald-400'
                      : currentNodeStatus.status === 'failed'
                        ? 'bg-red-400'
                        : 'bg-zinc-400'
                }`}
              ></div>
              Status:{' '}
              {currentNodeStatus.status.charAt(0).toUpperCase() + currentNodeStatus.status.slice(1)}
              {currentNodeStatus.progress > 0 && ` (${currentNodeStatus.progress}%)`}
            </div>
          )} */}

          {forms[nodeId] || <div className="text-gray-900 dark:text-white">Form not found.</div>}
        </motion.div>
      </motion.div>
      {showGeneratingLoader && <GeneratingLoader />}
      {showGenerator && <CreativeGenerationLayout onClose={handleCloseGenerateCreative} />}
    </AnimatePresence>
  );
}
