import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import {
  setActivePage,
  setAIAdsStep,
  setAiAdsSceneData,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { getAiAdsSceneAction } from '@/store/actions/adVideoNew/Advideoactions';

// Steps
import SelectionStep from './steps/SelectionStep';
import AnalysisStep from './steps/AnalysisStep';
import DetailsFormStep from './steps/DetailsFormStep';
import ImplementationPlanStep from './steps/ImplementationPlanStep';

const AIAdsPage = ({ handleGenerate }) => {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const step = useSelector((state) => state.adVideoNew.currentAIAdsStep);
  const aiAdsSceneData = useSelector((state) => state.adVideoNew.aiAdsSceneData);
  const prefillInputs = useSelector((state) => state.adVideoNew.aiAdsPrefillInputs);

  const [formData, setFormData] = useState({
    baseType: '',
    analysisData: {},
    details: {},
  });

  // true only when generation step is reached via the details form (not resume/direct URL)
  const [canGoBack, setCanGoBack] = useState(false);

  // Snapshot of original inputs used by DetailsFormStep for hasFormChanged()
  const [originalInputs, setOriginalInputs] = useState(null);

  // When prefill is dispatched (recreate or back), set baseType so the form title is correct
  useEffect(() => {
    if (!prefillInputs) return;
    const aiAdsType = prefillInputs.aiAdsType || prefillInputs.baseType || 'brand';
    setFormData((prev) => ({ ...prev, baseType: aiAdsType }));
    setOriginalInputs(prefillInputs);
  }, [prefillInputs]);

  // On mount: if ?id= is in URL, fetch scene data and jump to generation step
  useEffect(() => {
    const sessionId = searchParams.get('id');
    if (sessionId) {
      dispatch(setAIAdsStep('generation'));
      dispatch(getAiAdsSceneAction(sessionId));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep ?id= in URL in sync with the generation step + scene data
  useEffect(() => {
    const sessionId = aiAdsSceneData?._id || aiAdsSceneData?.data?._id;
    if (step === 'generation' && sessionId) {
      setSearchParams({ id: sessionId }, { replace: true });
    } else if (step !== 'generation') {
      setSearchParams({}, { replace: true });
    }
  }, [step, aiAdsSceneData, setSearchParams]);

  const handleNext = (nextStep, data = {}) => {
    setFormData((prev) => ({ ...prev, ...data }));
    dispatch(setAIAdsStep(nextStep));
  };

  const handleBack = (prevStep) => {
    dispatch(setAIAdsStep(prevStep));
  };

  const handleClose = () => {
    setSearchParams({}, { replace: true });
    dispatch(setAiAdsSceneData(null));
    dispatch(setAIAdsStep('selection'));
    dispatch(setActivePage('home'));
    setCanGoBack(false);
  };

  const renderStep = () => {
    switch (step) {
      case 'selection':
        return (
          <SelectionStep
            onNext={(type) => handleNext('analysis', { baseType: type })}
            onBack={handleClose}
            onClose={handleClose}
          />
        );
      case 'analysis':
        return (
          <AnalysisStep
            type={formData.baseType}
            onBack={() => handleBack('selection')}
            onNext={(analysisData) => handleNext('details', { analysisData })}
            onClose={handleClose}
          />
        );
      case 'details':
        return (
          <DetailsFormStep
            type={formData.baseType}
            data={{ ...formData.analysisData, ...formData.details }}
            originalInputs={originalInputs}
            existingSceneData={aiAdsSceneData}
            onBack={() => handleBack('analysis')}
            onNext={(finalDetails) => {
              setCanGoBack(true);
              const saved = {
                details: finalDetails.formData,
                savedImages: finalDetails.urlImages,
                savedLogo: finalDetails.urlLogo,
                savedUploadedImages: finalDetails.uploadedImages,
                savedUploadedLogo: finalDetails.uploadedLogo,
              };
              // Snapshot the inputs so Back→Next with no changes skips the API
              setOriginalInputs({
                ...finalDetails.formData,
                _savedImages: finalDetails.urlImages,
                _savedLogo: finalDetails.urlLogo,
                _savedUploadedImages: finalDetails.uploadedImages,
                _savedUploadedLogo: finalDetails.uploadedLogo,
              });
              handleNext('generation', saved);
            }}
            onClose={handleClose}
          />
        );
      case 'generation': {
        const detailsInputs = {
          ...formData.analysisData,
          ...formData.details,
          _savedImages: formData.savedImages,
          _savedLogo: formData.savedLogo,
          _savedUploadedImages: formData.savedUploadedImages,
          _savedUploadedLogo: formData.savedUploadedLogo,
        };
        return (
          <ImplementationPlanStep
            detailsInputs={detailsInputs}
            canGoBack={canGoBack}
            onBack={() => handleBack('details')}
            onNext={handleClose}
            onClose={handleClose}
            handleGenerate={handleGenerate}
          />
        );
      }
      default:
        return null;
    }
  };

  return <div className="flex h-full flex-col text-white">{renderStep()}</div>;
};

export default AIAdsPage;
