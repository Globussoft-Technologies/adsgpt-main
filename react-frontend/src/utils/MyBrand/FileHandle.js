const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
export const urlToFile = async (url, filename) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    let fileWithUrl = new File([blob], filename, { type: blob.type });
    fileWithUrl.originalUrl = url;
    return fileWithUrl;
  } catch (error) {
    console.error('Error converting URL to file:', error);
    return null;
  }
};

export const checkImageTransparency = async (file) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let hasTransparency = false;
      let alphaValues = new Set();

      for (let i = 3; i < data.length; i += 4) {
        alphaValues.add(data[i]);

        // Check for ANY transparency (alpha < 255)
        if (data[i] <= 255) {
          hasTransparency = true;
        }
      }

      URL.revokeObjectURL(img.src);
      resolve(hasTransparency);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve(false);
    };
  });
};

export const validateUrl = (url, type) => {
  if (!url) return '';
  const urlRegex =
    /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*)$/;
  const domainChecks = {
    websiteUrl: /^https?:\/\/(www\.)?/,
    instagramUrl: /^https?:\/\/(www\.)?instagram\.com\/.+$/,
    facebookUrl: /^https?:\/\/(www\.)?(facebook|fb)\.com\/.+$/,
    linkedinUrl: /^https?:\/\/(www\.)?linkedin\.com\/.+$/,
  };

  if (!urlRegex.test(url)) {
    return type === 'websiteUrl'
      ? 'Please enter a valid website URL (e.g., https://example.com).'
      : `Please enter a valid ${type.replace('Url', '')} URL (e.g., https://www.${type.replace('Url', '')}.com/username).`;
  }

  if (type !== 'websiteUrl') {
    const domainRegex = domainChecks[type];
    if (domainRegex && !domainRegex.test(url)) {
      return `Please enter a valid ${type.replace('Url', '')} URL (e.g., https://www.${type.replace('Url', '')}.com/username).`;
    }
  }
  return '';
};

export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      let result = reader.result;
      if (result && result.startsWith('data:application/octet-stream')) {
        result = result.replace('data:application/octet-stream', 'data:image/png');
      }
      resolve(result);
    };
    reader.onerror = (err) => reject(err);
  });
};
async function convertSvgToPng(svgUrl) {
  try {
    // Fetch SVG content
    const response = await fetch(`${BACKEND_HOST}/adsgpt/img/preview?url=${svgUrl}`);
    const svgText = await response.text();

    return new Promise((resolve, reject) => {
      const img = new Image();
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const pngDataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(url);
        resolve(pngDataUrl);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG image'));
      };

      img.src = url;
    });
  } catch (error) {
    throw new Error(`Failed to convert SVG to PNG: ${error.message}`);
  }
}

export async function urlToBase64(url) {
  const isSvg = url?.toLowerCase().endsWith('.svg');

  // ✅ 1. ALWAYS try backend first (CORS-safe)
  try {
    const response = await fetch(
      `${BACKEND_HOST}/adsgpt/img/convert?url=${encodeURIComponent(url)}`
    );

    if (!response.ok) {
      throw new Error(`Backend fetch failed: ${response.status}`);
    }

    const blob = await response.blob();

    if (blob.type === 'image/svg+xml' || isSvg) {
      try {
        return await convertSvgToPng(url);
      } catch (err) {
        console.warn('SVG conversion failed (backend):', err);
      }
    }

    return await blobToBase64(blob);
  } catch (backendError) {
    console.warn('Backend failed, trying direct fetch:', backendError);
  }

  // ⚠️ 2. Fallback (may fail due to CORS)
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Direct fetch failed: ${response.status}`);
    }

    const blob = await response.blob();

    if (blob.type === 'image/svg+xml' || isSvg) {
      try {
        return await convertSvgToPng(url);
      } catch (err) {
        console.warn('SVG conversion failed (direct):', err);
      }
    }

    return await blobToBase64(blob);
  } catch (error) {
    console.error('Both backend and direct fetch failed:', error);
    throw error;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      let result = reader.result;
      if (result && result.startsWith('data:application/octet-stream')) {
        result = result.replace('data:application/octet-stream', 'data:image/png');
      }
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
export const tooltipDescriptions = {
  'Brand Logos*':
    'Upload up to 5 brand logos in PNG or ICO format, each with a transparent background and a maximum size of 2MB.',
  'Brand Icon':
    'Upload a brand icon in PNG or JPEG format with a transparent background, up to 200KB.',
  'Product Image': 'Upload a product image in JPEG, PNG, JPG, or WEBP format, up to 5MB.',
  'Product Image*': 'Upload a product image in PNG format, up to 5MB.',
};
