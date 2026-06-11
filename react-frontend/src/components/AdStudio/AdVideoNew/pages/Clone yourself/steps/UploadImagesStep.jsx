import { useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { ChevronLeft, ChevronRight, CloudUpload, Loader2, X } from 'lucide-react';
import avatarFront from '@/assets/layouts/adVideoNew/avatar_front.png';
import avatarLeft from '@/assets/layouts/adVideoNew/avatar_left.png';
import avatarRight from '@/assets/layouts/adVideoNew/avatar_right.png';
import { uploadToS3 } from '@/utils/imageUpload';
import getCookies from '@/utils/getCookies';
import { globalToast } from '@/utils/globalToast';

const PYTHON_API_CLONE_YOURSELF_FACE_VALIDATE_URL = import.meta.env.VITE_PYTHON_API_CLONE_YOURSELF_FACE_VALIDATE_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL || '';

const FACE_ANGLES = ['Left', 'Center', 'Right'];
const FACE_ANGLE_IMAGES = [avatarLeft, avatarFront, avatarRight];
const FACE_ANGLE_TEXTS = [
  'Left\nSide View',
  'Front\nFacing',
  'Right\nSide View',
];

const UploadImagesStep = ({ onBack, onComplete }) => {
  const { userData } = useSelector((state) => state.socket);
  const [images, setImages] = useState([null, null, null]);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState(null);

  const handleFileChange = (index, e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImages((prev) => {
      const updated = [...prev];
      updated[index] = { file, preview: URL.createObjectURL(file) };
      return updated;
    });
  };

  const removeImage = (index) => {
    setImages((prev) => {
      const updated = [...prev];
      if (updated[index]?.preview) URL.revokeObjectURL(updated[index].preview);
      updated[index] = null;
      return updated;
    });
  };

  const allUploaded = images.every(Boolean);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden p-6 pb-0">
      {/* Header */}
      <div className="relative z-50 mb-4 flex shrink-0 items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-full p-1 text-gray-500 transition hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div className="flex flex-1 flex-col items-center text-center">
          <h2 className="text-lg font-semibold text-gray-900 2xl:text-2xl dark:text-white">
            Upload Your Face Angles
          </h2>
          <p className="mt-1 text-[11px] font-light text-gray-500 2xl:text-sm dark:text-white/70">
            Add three photos: left, center, and right for Clone Generation
          </p>
        </div>

        {/* spacer to balance the back button */}
        <div className="w-8" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-end">
        {/* Cards Wrapper */}
        <div className="group relative flex w-full max-w-152 translate-y-8 items-end justify-center -space-x-8 px-4 sm:-space-x-12 2xl:max-w-3xl 2xl:translate-y-12">
          {FACE_ANGLES.map((angle, index) => {
            const wrapperHoverTransforms = [
              'group-hover:-translate-x-3 group-hover:translate-y-1',
              'group-hover:-translate-y-3',
              'group-hover:translate-x-3 group-hover:-translate-y-1',
            ];
            const layoutMods = ['', 'scale-102', 'mr-3'];
            const cardRotation = [
              '-rotate-12 transition-transform duration-500 group-hover:-rotate-[14deg]',
              'rotate-0 transition-transform duration-500',
              'rotate-12 transition-transform duration-500 group-hover:rotate-[14deg]',
            ];

            return (
              <div
                key={angle}
                className={`group/card relative flex max-h-[400px] w-full flex-1 justify-center transition-all duration-500 ease-out 2xl:max-h-[500px] ${index === 1 ? 'z-20' : 'z-10'} ${wrapperHoverTransforms[index]} ${layoutMods[index]}`}
              >
                {images[index] ? (
                  <div
                    className={`${index === 1 ? 'mt-0' : 'mt-10 2xl:mt-6'} relative aspect-[1/2] w-full overflow-hidden rounded-[2rem] border-2 bg-[#1c1c1c] shadow-2xl transition-all duration-300 group-hover/card:border-blue-500 group-hover/card:brightness-110 ${cardRotation[index]}`}
                  >
                    <img
                      src={images[index].preview}
                      alt={`${angle} angle`}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute top-3 right-3 rounded-full bg-black/50 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/card:opacity-100 hover:bg-red-500/80"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <div className="absolute top-4 left-1/2 z-50 -translate-x-1/2">
                      <span className="text-[10px] font-medium text-white/80 drop-shadow-md 2xl:text-xs">
                        {angle}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`relative aspect-[1/2] ${index === 1 ? 'mt-0' : 'mt-10 2xl:mt-6'} w-full cursor-pointer overflow-hidden rounded-[2.5rem] border border-transparent bg-[#1c1c1c] shadow-2xl transition-all duration-300 group-hover/card:border-white group-hover/card:brightness-110 ${cardRotation[index]}`}
                    >
                      <img
                        src={FACE_ANGLE_IMAGES[index]}
                        alt={`${angle} placeholder`}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0f0f0f]/90 via-[#0f0f0f]/40 to-transparent" />
                      <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[#0f0f0f]/80 via-[#0f0f0f]/10 to-transparent" />
                      <div className="absolute top-8 left-1/2 w-[85%] -translate-x-1/2 text-center text-[10px] font-medium leading-[1.3] whitespace-pre-line text-white 2xl:top-10 2xl:text-[13px]">
                        {FACE_ANGLE_TEXTS[index]}
                      </div>
                    </div>
                    <label
                      htmlFor={`clone-upload-${index}`}
                      className="pointer-events-auto absolute bottom-12 left-1/2 z-50 flex w-max -translate-x-1/2 cursor-pointer items-center justify-center gap-1 rounded-full border border-white/60 bg-white/10 px-2 py-2.5 text-[10px] font-medium whitespace-nowrap text-white shadow-lg backdrop-blur-md transition-all hover:bg-white/30 sm:bottom-14 sm:gap-2 sm:px-6 sm:text-xs 2xl:bottom-20 2xl:px-8 2xl:py-3.5 2xl:text-[15px]"
                    >
                      <CloudUpload className="h-3 w-3 sm:h-4 sm:w-4 2xl:h-5 2xl:w-5" />
                      Upload image
                    </label>
                    <input
                      id={`clone-upload-${index}`}
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={(e) => handleFileChange(index, e)}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        {allUploaded && (
          <div className="absolute -right-3 bottom-3 z-20 flex flex-col items-end gap-1 2xl:-right-1">
            <button
              disabled={isValidating}
              onClick={async () => {
                setValidationError(null);
                setIsValidating(true);
                try {
                  const userId = userData?.user_id;
                  // Upload all 3 images to S3 in parallel
                  const [leftPath, frontPath, rightPath] = await Promise.all(
                    images.map((img) => uploadToS3(img.file, userId, true))
                  );
                  if (!leftPath || !frontPath || !rightPath) {
                    const errMsg = 'Image upload failed. Please try again.';
                    globalToast.error(errMsg);
                    setValidationError(errMsg);
                    return;
                  }
                  const leftUrl = `${S3_BASE_URL}${leftPath}`;
                  const frontUrl = `${S3_BASE_URL}${frontPath}`;
                  const rightUrl = `${S3_BASE_URL}${rightPath}`;

                  // Validate faces
                  const res = await axios.post(
                    `${PYTHON_API_CLONE_YOURSELF_FACE_VALIDATE_URL}/api/v1/face-validate/validate`,
                    { front: frontUrl, left: leftUrl, right: rightUrl },
                    { headers: { Authorization: `Bearer ${getCookies()}`, 'Content-Type': 'application/json' } }
                  );

                  if (res.data?.success === false || res.data?.valid === false) {
                    const errMsg = res.data?.error || res.data?.message || 'Face validation failed. Please upload clear face photos.';
                    globalToast.error(errMsg);
                    setValidationError(errMsg);
                    return;
                  }

                  globalToast.success(res.data?.message || 'Validation passed!');

                  // Validation passed — pass images with updated S3 previews
                  onComplete([
                    { file: images[0].file, preview: leftUrl },
                    { file: images[1].file, preview: frontUrl },
                    { file: images[2].file, preview: rightUrl },
                  ]);
                } catch (err) {
                  const msg = err.response?.data?.error || err.response?.data?.message || 'Validation failed. Please try again.';
                  globalToast.error(msg);
                  setValidationError(msg);
                } finally {
                  setIsValidating(false);
                }
              }}
              className="rounded-full p-2 text-gray-900 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white dark:hover:bg-white/20"
            >
              {isValidating
                ? <Loader2 className="h-8 w-8 animate-spin 2xl:h-9 2xl:w-9" />
                : <ChevronRight className="h-8 w-8 2xl:h-9 2xl:w-9" />
              }
            </button>
          </div>
        )}
      </div>

      {/* Bottom fade overlay */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-40 h-10 w-full bg-gradient-to-t from-white/80 via-white/30 to-transparent 2xl:h-14 dark:from-[#1c1c1c]/80 dark:via-[#1c1c1c]/30" />
    </div>
  );
};

export default UploadImagesStep;
