import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import {
  setActivePage,
  setAIAdsStep,
  setAiAdsSceneData,
  setAiAdsPrefillInputs,
  setAiAdsSceneLoading,
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

  // true only when generation step was reached via the details form.
  // Persisted in sessionStorage so a page refresh doesn't lose the Back button
  // for recreate/form flows, while plain URL resumes (never written) stay false.
  const [canGoBack, setCanGoBack] = useState(() => {
    const sessionId = new URLSearchParams(window.location.search).get('id');
    return sessionId ? sessionStorage.getItem(`aiads_canGoBack_${sessionId}`) === '1' : false;
  });

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
      dispatch(setAiAdsSceneLoading(true)); // prevent blank panel before thunk sets loading
      dispatch(getAiAdsSceneAction(sessionId));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist canGoBack in sessionStorage so refresh preserves the Back button
  // for form/recreate flows. Also keep prefillInputs in sync for the resume case.
  useEffect(() => {
    const sessionId = aiAdsSceneData?._id || aiAdsSceneData?.data?._id;
    if (step !== 'generation') return;
    if (canGoBack) {
      if (sessionId) sessionStorage.setItem(`aiads_canGoBack_${sessionId}`, '1');
      return;
    }
    const inputs = aiAdsSceneData?.inputs || aiAdsSceneData?.data?.inputs;
    if (inputs) dispatch(setAiAdsPrefillInputs(inputs));
  }, [aiAdsSceneData, step, canGoBack, dispatch]);

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
    const sessionId = aiAdsSceneData?._id || aiAdsSceneData?.data?._id;
    if (sessionId) sessionStorage.removeItem(`aiads_canGoBack_${sessionId}`);
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
          ...( aiAdsSceneData?.inputs || aiAdsSceneData?.data?.inputs || {}),
          ...formData.analysisData,
          ...formData.details,
          _savedImages: formData.savedImages,
          _savedLogo: formData.savedLogo,
          _savedUploadedImages: formData.savedUploadedImages,
          _savedUploadedLogo: formData.savedUploadedLogo,
        };
        return (
          <ImplementationPlanStep
            canGoBack={canGoBack}
            onBack={() => {
              dispatch(setAiAdsPrefillInputs(detailsInputs));
              handleBack('details');
            }}
            onRetryToForm={() => {
              // Try Again after a failure → same as Back: repopulate the form
              // with the failed run's inputs and land on the Details step so the
              // user can review/tweak and re-run (a fresh Next mints a new id).
              dispatch(setAiAdsPrefillInputs(detailsInputs));
              dispatch(setAIAdsStep('details'));
            }}
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

  return <div className="flex h-full flex-col text-gray-900 dark:text-white">{renderStep()}</div>;
};

export default AIAdsPage;
