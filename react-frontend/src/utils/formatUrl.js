const NAS_PREFIX = import.meta.env.VITE_NAS_BASE_URL;

export const formatUrl = (mediaUrl) => {
  if (!mediaUrl) return '';
  const formattedUrl = mediaUrl.startsWith('https') ? mediaUrl : `${NAS_PREFIX}${mediaUrl}`;
  return formattedUrl;
};

export const formMediaUrl = (url) => {
  if (!url) return '';
  if (url?.startsWith('/')) {
    return `${NAS_PREFIX}${url}`;
  } else {
    return `${NAS_PREFIX}/${url}`;
  }
};
