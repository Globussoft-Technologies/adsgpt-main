import getCookies from './getCookies';
import toast from 'react-hot-toast';

const HOST = import.meta.env.VITE_SOCKET_URL;

export const handleDownload = async (fileUrl) => {
  if (!fileUrl) return console.error('No file URL provided.');

  const videoExtensions = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv', 'wmv'];
  const urlWithoutQuery = fileUrl.split('?')[0];
  const urlParts = urlWithoutQuery.split('/');
  const filename = urlParts.pop() || 'file';
  const ext = filename.split('.').pop().toLowerCase();
  const isVideo = videoExtensions.includes(ext);
  const fileType = isVideo ? 'video' : 'image';

  const proxyUrl = `${HOST}/adsgpt/img/preview?url=${fileUrl}`;

  // Start toast loader
  const toastId = toast.loading(`Downloading ${fileType}...`);

  try {
    const response = await fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
      },
      mode: 'cors',
    });

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename || `download.${ext || 'bin'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(blobUrl);
    toast.success('Download completed 🎉', { id: toastId });
  } catch (error) {
    console.error(`Error downloading the ${fileType}:`, error);
    toast.error('Download failed ❌', { id: toastId });
  }
};

// format: 'webp' | 'jpeg'
export const handleDownloadAs = async (fileUrl, format = 'webp') => {
  if (!fileUrl) return console.error('No file URL provided.');

  const proxyUrl = `${HOST}/adsgpt/img/preview?url=${fileUrl}`;
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const toastId = toast.loading(`Downloading Image`);

  try {
    const response = await fetch(proxyUrl, {
      headers: { Authorization: `Bearer ${getCookies()}` },
      mode: 'cors',
    });

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d');

    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(imageBitmap, 0, 0);

    canvas.toBlob(
      (convertedBlob) => {
        const blobUrl = URL.createObjectURL(convertedBlob);
        const urlWithoutQuery = fileUrl.split('?')[0];
        const baseName = urlWithoutQuery.split('/').pop().split('.')[0] || 'download';
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${baseName}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        toast.success(`Image downloaded successfully`, { id: toastId });
      },
      mimeType,
      format === 'jpeg' ? 0.92 : undefined,
    );
  } catch (error) {
    console.error(`Error downloading as ${format}:`, error);
    toast.error('Download failed ❌', { id: toastId });
  }
};
