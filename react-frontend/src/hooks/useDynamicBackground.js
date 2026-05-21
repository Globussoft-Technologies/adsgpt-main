import { useEffect, useState } from 'react';

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
          const ctx = canvas.getContext('2d');
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let total = 0;

          // Sample every 4th pixel (performance optimization)
          for (let i = 0; i < imageData.data.length; i += 16) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            total += brightness;
          }

          const avgBrightness = total / (imageData.data.length / 16);
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
