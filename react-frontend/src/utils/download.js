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

  // Encode the URL — signed S3 links contain `?`, `&`, `://` etc. that otherwise
  // corrupt the proxy's `url` query param, making the download fail.
  const proxyUrl = `${HOST}/adsgpt/img/preview?url=${encodeURIComponent(fileUrl)}`;

  // Start toast loader
  const toastId = toast.loading(`Downloading ${fileType}...`);

  try {
    // The gateway proxy dodges CORS/hotlink blocks, but it must not be a single
    // point of failure — if it errors (auth, 404, gateway down) retry the file
    // URL directly before giving up.
    let response = await fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
      },
      mode: 'cors',
    });
    if (!response.ok) response = await fetch(fileUrl, { mode: 'cors' });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);

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

// Convert + download a (possibly .webp) image in the chosen format, client-side
// via a canvas. format: 'png' | 'jpg' | 'jpeg' | 'webp'.
const _FORMAT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const handleDownloadAs = async (fileUrl, format = 'png') => {
  if (!fileUrl) return console.error('No file URL provided.');

  const fmt = (format || 'png').toLowerCase();
  const mimeType = _FORMAT_MIME[fmt] || 'image/png';
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;
  // Encode the URL — signed S3 links contain `?`, `&`, `://` etc. that otherwise
  // corrupt the proxy's `url` query param, making the download fail.
  const proxyUrl = `${HOST}/adsgpt/img/preview?url=${encodeURIComponent(fileUrl)}`;
  const toastId = toast.loading(`Downloading ${ext.toUpperCase()}…`);

  try {
    // Same proxy-then-direct fallback as handleDownload — a proxy error must
    // not leave the user with a button that appears to do nothing.
    let response = await fetch(proxyUrl, {
      headers: { Authorization: `Bearer ${getCookies()}` },
      mode: 'cors',
    });
    if (!response.ok) response = await fetch(fileUrl, { mode: 'cors' });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d');

    // JPG has no alpha — flatten transparency onto white so it doesn't turn black.
    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(imageBitmap, 0, 0);

    canvas.toBlob(
      (convertedBlob) => {
        if (!convertedBlob) {
          toast.error('Download failed ❌', { id: toastId });
          return;
        }
        const blobUrl = URL.createObjectURL(convertedBlob);
        const urlWithoutQuery = fileUrl.split('?')[0];
        const baseName = urlWithoutQuery.split('/').pop().split('.')[0] || 'download';
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${baseName}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        toast.success(`Downloaded ${ext.toUpperCase()} 🎉`, { id: toastId });
      },
      mimeType,
      mimeType === 'image/jpeg' ? 0.92 : undefined,
    );
  } catch (error) {
    console.error(`Error downloading as ${fmt}:`, error);
    toast.error('Download failed ❌', { id: toastId });
  }
};
