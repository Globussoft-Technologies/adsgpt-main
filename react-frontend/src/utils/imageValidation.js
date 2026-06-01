// Shared image-upload validation. Used by every place that accepts user
// image uploads (AiCreativesCustom, RecreateAdModal, AdSetupStep's
// FileUploadField, etc.) so the allow-list lives in exactly one place.
//
// Restricted to JPG / JPEG / PNG / WebP per product decision — everything
// else (GIF, SVG, BMP, HEIC, AVIF, …) is rejected at the picker, drop, and
// paste paths.

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Comma-joined string for <input type="file" accept="…"> attributes.
export const ALLOWED_IMAGE_ACCEPT = ALLOWED_IMAGE_MIME.join(',');

// User-facing message when one or more files were rejected for type.
export const IMAGE_TYPE_ERROR = 'Only JPG, JPEG, PNG, or WebP images are allowed.';

export const isAllowedImageFile = (file) =>
  !!file && ALLOWED_IMAGE_MIME.includes(file.type);

// Filters a FileList / array of Files to only the allowed image types and
// reports how many were rejected so callers can surface a type error.
export const filterAllowedImageFiles = (files) => {
  const arr = files ? Array.from(files) : [];
  const valid = arr.filter(isAllowedImageFile);
  return { valid, rejectedCount: arr.length - valid.length };
};
