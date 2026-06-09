import { setField } from '@/store/reducers/adStudio/promptSlice';
import { Mic } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { ShadcnTooltip } from '../layout/ShadcnTooltip';

const SpeechToText = () => {
  const dispatch = useDispatch();
  const { transcript, listening, browserSupportsSpeechRecognition } = useSpeechRecognition();
  const silenceTimeoutRef = useRef(null);

  // Silence timeout
  const resetSilenceTimeout = useCallback(() => {
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    silenceTimeoutRef.current = setTimeout(() => {
      if (listening) {
        SpeechRecognition.stopListening().catch((err) =>
          console.error('SpeechRecognition error:', err)
        );
      }
    }, 5000); // 5 sec pause = considered silence
  }, [listening]);

  // Update Redux whenever transcript changes
  useEffect(() => {
    if (transcript && transcript.trim()) {
      dispatch(setField({ key: 'prompt', value: transcript }));
      resetSilenceTimeout();
    }
  }, [transcript, dispatch, resetSilenceTimeout]);

  // Reset silence timeout whenever listening starts
  useEffect(() => {
    if (listening) {
      resetSilenceTimeout();
    } else {
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    }
    dispatch(setField({ key: 'isListening', value: listening }));
  }, [listening, dispatch, resetSilenceTimeout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    };
  }, []);

  // Stop mic
  const stopListening = () => {
    if (listening)
      SpeechRecognition.stopListening().catch((err) =>
        console.error('SpeechRecognition error:', err)
      );
  };

  // Start mic
  const handleMicClick = () => {
    if (!browserSupportsSpeechRecognition) {
      alert('Your browser does not support speech recognition.');
      return;
    }
    SpeechRecognition.startListening({
      continuous: true,
      language: 'en-US',
    }).catch((err) => console.error('SpeechRecognition error:', err));
  };

  return (
    <ShadcnTooltip label="Use Microphone">
      <Mic
        className={`h-4 w-4 cursor-pointer text-current 2xl:h-5 2xl:w-5 ${listening ? 'mic-loader animate-pulse' : ''}`}
        onClick={listening ? stopListening : handleMicClick}
      />
    </ShadcnTooltip>
  );
};

export default SpeechToText;
