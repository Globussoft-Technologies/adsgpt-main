import axios from 'axios';
import getCookies from './getCookies';
const GATEWAY_URL = import.meta.env.VITE_SOCKET_URL;

export const uploadToS3 = async (file, userId, isUser = false) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'IMAGE');
    formData.append('userId', userId);
    if (!isUser) formData.append('save', 'True');

    const response = await axios.post(`${GATEWAY_URL}/adsgpt/adCreative/upload-image`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${getCookies()}`,
      },
    });
    if (response.status === 200) {
      const url = response?.data?.data;
      if (url) return url;
    }
    return '';
  } catch (error) {
    console.error('Error uploading the image:', error);
  }
};

// Re-hosts an external image URL onto our S3 via the same /adCreative/upload-image
// endpoint (which now accepts `imageUrl` and fetches it server-side — browsers
// usually can't read cross-origin image bytes). Returns the S3 key, or '' on failure.
export const uploadUrlToS3 = async (imageUrl, userId) => {
  try {
    const formData = new FormData();
    formData.append('imageUrl', imageUrl);
    formData.append('userId', userId);

    const response = await axios.post(`${GATEWAY_URL}/adsgpt/adCreative/upload-image`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${getCookies()}`,
      },
    });
    if (response.status === 200) {
      const url = response?.data?.data;
      if (url) return url;
    }
    return '';
  } catch (error) {
    console.error('Error uploading image from URL:', error);
    return '';
  }
};

export const uploadToNAS = async (file, userId) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);

    const response = await axios.post(`${GATEWAY_URL}/adsgpt/adCreative/upload-logo`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${getCookies()}`,
      },
    });

    if (response.status !== 200) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
    return response?.data?.data;
  } catch (error) {
    console.error('Error uploading the image:', error);
  }
};
