import { useEffect, useState } from 'react';

// Images are downsampled to this square before any pixel scanning.
const SAMPLE_SIZE = 32;

export function useDynamicBackground(logos = [], darkColor = '#2a2a2a', lightColor = '#fff') {
  const [bgColors, setBgColors] = useState({});

  useEffect(() => {
    if (!Array.isArray(logos) || logos.length === 0) return;

    logos.forEach((logo) => {
      const logoUrl = logo?.url;
      if (!logoUrl) return;

      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = logoUrl;

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          // Downsample first: an average-brightness reading does not need full
          // resolution, and scanning the source at natural size ran on the main
          // thread once per card.
          canvas.width = SAMPLE_SIZE;
          canvas.height = SAMPLE_SIZE;
          ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const { data } = imageData;
          let total = 0;
          let sampled = 0;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            total += 0.299 * r + 0.587 * g + 0.114 * b;
            sampled += 1;
          }

          const avgBrightness = sampled > 0 ? total / sampled : 0;
          const bgColor = avgBrightness > 28 ? darkColor : lightColor;

          setBgColors((prev) => ({
            ...prev,
            [logo.id]: bgColor,
          }));
        } catch (err) {
          console.error(`Error processing image ${logoUrl}:`, err);
        }
      };
    });
  }, [logos]);

  return bgColors;
}
