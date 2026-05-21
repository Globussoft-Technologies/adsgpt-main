import React, { useState, useEffect, useRef } from 'react';
import { Volume2, Pause } from 'lucide-react';

// Utility function to strip markdown and emojis
const stripMarkdownAndEmojis = (text) => {
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{1FB00}-\u{1FBFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{2B55}]+/gu;

  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/#+\s?(.*)/g, '$1')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/`(.*?)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n+/g, ' ')
    .replace(/[*•-]+\s/g, '')
    .replace(emojiRegex, '');
};

const ReadAloud = ({ isImageCreative, text }) => {
  const [isPaused, setIsPaused] = useState(true);
  const [hasStarted, setHasStarted] = useState(false); // Flag to check if speech has started
  const utteranceRef = useRef(null);
  const [voice, setVoice] = useState();

  useEffect(() => {
    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const availableVoices = synth.getVoices();
      setVoice(availableVoices[8]);
      // console.log("Available voices:", availableVoices);
    };

    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);

    return () => {
      synth.cancel();
      synth.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  useEffect(() => {
    const synth = window.speechSynthesis;
    const strippedText = stripMarkdownAndEmojis(text);

    // Create and configure the utterance
    const utterance = new SpeechSynthesisUtterance(strippedText);
    utterance.onend = () => {
      setIsPaused(true);
      setHasStarted(false); // Reset flag when speech ends
    };
    if (voice) utterance.voice = voice;
    utteranceRef.current = utterance;

    return () => {
      synth.cancel(); // Clean up
    };
  }, [text, voice]);

  const handlePlay = () => {
    const synth = window.speechSynthesis;

    if (!hasStarted) {
      // Start speech for the first time
      synth.speak(utteranceRef.current);
      setHasStarted(true);
    } else if (isPaused) {
      // Resume if paused
      synth.resume();
    }

    setIsPaused(false);
  };

  const handlePause = () => {
    const synth = window.speechSynthesis;

    synth.pause();
    setIsPaused(true);
  };

  return (
    <div>
      <div>
        {isPaused ? (
          <Volume2
            className={`z-[5555] cursor-pointer shadow-none focus:outline-none ${!isImageCreative ? 'text-black/80' : 'text-[#9b98ff]'} h-4 w-4 dark:text-white`}
            onClick={handlePlay}
          />
        ) : (
          <Pause
            className={`z-[5555] cursor-pointer shadow-none focus:outline-none ${!isImageCreative ? 'text-black/80' : 'text-[#9b98ff]'} h-4 w-4 dark:text-white`}
            onClick={handlePause}
          />
        )}
      </div>
    </div>
  );
};

export default ReadAloud;
