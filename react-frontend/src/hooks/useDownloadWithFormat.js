// hooks/useDownloadWithFormat.js
import { useState } from 'react';

export const useDownloadWithFormat = () => {
  const [formatDialog, setFormatDialog] = useState({
    isOpen: false,
    imageUrl: null,
  });

  const handleDownloadWithFormat = (fileUrl) => {
    if (!fileUrl) {
      console.error('No file URL provided.');
      return;
    }

    setFormatDialog({
      isOpen: true,
      imageUrl: fileUrl,
    });
  };

  return {
    handleDownloadWithFormat,
    formatDialog,
    setFormatDialog,
  };
};
