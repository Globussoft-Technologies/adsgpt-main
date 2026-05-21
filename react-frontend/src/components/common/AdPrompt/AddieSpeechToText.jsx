import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { setAddieField } from '@/store/reducers/adInsights/Addie/addiePromptSlice';
import { Mic } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';

const SpeechToText = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const currentRoute = location?.pathname;
  const { transcript, listening, browserSupportsSpeechRecognition } = useSpeechRecognition();
  const silenceTimeoutRef = useRef(null);

  // Silence timeout
  const resetSilenceTimeout = useCallback(() => {
    if (silenceTimeoutRef?.current) clearTimeout(silenceTimeoutRef.current);
    silenceTimeoutRef.current = setTimeout(() => {
      if (listening) {
        SpeechRecognition.stopListening?.().catch((err) =>
          console.error('SpeechRecognition error:', err)
        );
      }
    }, 5000); // 5 sec pause = considered silence
  }, [listening]);

  // Update Redux whenever transcript changes
  useEffect(() => {
    if (transcript?.trim()) {
      if (currentRoute === '/adinsights') {
        dispatch(setAddieField?.({ key: 'prompt', value: transcript }));
      }
      resetSilenceTimeout();
    }
  }, [transcript, dispatch, resetSilenceTimeout, currentRoute]);

  // Reset silence timeout whenever listening starts
  useEffect(() => {
    if (listening) {
      resetSilenceTimeout();
    } else {
      if (silenceTimeoutRef?.current) clearTimeout(silenceTimeoutRef.current);
    }

    if (currentRoute === '/adinsights') {
      dispatch(setAddieField?.({ key: 'isListening', value: listening }));
    }
  }, [listening, dispatch, resetSilenceTimeout, currentRoute]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef?.current) clearTimeout(silenceTimeoutRef.current);
    };
  }, []);

  // Stop mic
  const stopListening = () => {
    if (listening) {
      SpeechRecognition.stopListening?.().catch((err) =>
        console.error('SpeechRecognition error:', err)
      );
    }
  };

  // Start mic
  const handleMicClick = () => {
    if (!browserSupportsSpeechRecognition) {
      alert('Your browser does not support speech recognition.');
      return;
    }

    if (listening) {
      stopListening();
    } else {
      SpeechRecognition.startListening?.({
        continuous: true,
        language: 'en-US',
      }).catch((err) => console.error('SpeechRecognition error:', err));
    }
  };

  return (
    <ShadcnTooltip label="Use Microphone">
      <Mic
        className={`h-5 w-5 cursor-pointer text-black ${listening ? 'mic-loader animate-pulse' : ''}`}
        onClick={handleMicClick}
      />
    </ShadcnTooltip>
  );
};

export default SpeechToText;
