import { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import * as faceapi from 'face-api.js';
import { ArrowLeft, ChevronRight, RotateCcw, Check, CameraOff } from 'lucide-react';
import './FaceCaptureGuide.css';
import avatarFront from '@/assets/layouts/adVideoNew/avatar_front.png';
import avatarLeft from '@/assets/layouts/adVideoNew/avatar_left.png';
import avatarRight from '@/assets/layouts/adVideoNew/avatar_right.png';

const ANGLES = [
  {
    key: 'front',
    label: 'Front View of Your Face',
    instruction: 'Look straight at the camera',
    yawRange: [-8, 8],
    placeholder: avatarFront,
    rotationClass: 'rotate-0',
  },
  {
    key: 'left',
    label: ' Left View of Your Face',
    instruction: 'Turn your face to the right',
    yawRange: [20, 60],
    placeholder: avatarLeft,
    rotationClass: '-rotate-12',
  },
  {
    key: 'right',
    label: 'Right View of Your Face',
    instruction: 'Turn your face to the left',
    yawRange: [-60, -20],
    placeholder: avatarRight,
    rotationClass: 'rotate-12',
  },
];

const YAW_SCALE = 60;
const STABLE_FRAMES_NEEDED = 8;
const COUNTDOWN_SECONDS = 3;

const videoConstraints = {
  width: 640,
  height: 640,
  facingMode: 'user',
};

function estimateYaw(landmarks) {
  const pts = landmarks.positions;
  // Use jaw endpoints (pts[0]=left jaw, pts[16]=right jaw) and nose tip (pts[30])
  // In a mirrored webcam feed, "left" in camera coords is user's right
  const noseTip = pts[30];
  const leftJaw = pts[0]; // camera-left = user's right side
  const rightJaw = pts[16]; // camera-right = user's left side

  const dLeft = Math.hypot(noseTip.x - leftJaw.x, noseTip.y - leftJaw.y);
  const dRight = Math.hypot(noseTip.x - rightJaw.x, noseTip.y - rightJaw.y);

  // ratio > 0 means nose is closer to right jaw → user turned right (camera-left)
  const ratio = (dLeft - dRight) / (dLeft + dRight);
  // Negate the ratio so that turning right results in a positive yaw,
  // which matches the user's perception in a mirrored feed.
  return -ratio * 80;
}

export default function FaceCaptureGuide({ onBack, onSubmit }) {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const stableCountRef = useRef(0);
  const lastAngleMatchRef = useRef(null);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [captures, setCaptures] = useState({ left: null, front: null, right: null });
  const [currentYaw, setCurrentYaw] = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [flash, setFlash] = useState(false);
  const [stability, setStability] = useState(0);
  const [webcamError, setWebcamError] = useState(false);

  const countdownRef = useRef(null);
  const capturesRef = useRef(captures);

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  const allCaptured = ANGLES.every((a) => captures[a.key]);

  useEffect(() => {
    async function loadModels() {
      try {
        const MODEL_URL = '/models';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        setModelsLoaded(true);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    }
    loadModels();
  }, []);

  const liveYawRef = useRef(null);

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(null);
    }
  }, []);

  const captureForAngle = useCallback((angleKey) => {
    if (countdownRef.current) return;
    const angle = ANGLES.find((a) => a.key === angleKey);
    let remaining = COUNTDOWN_SECONDS;
    setCountdown(remaining);

    countdownRef.current = setInterval(() => {
      remaining -= 1;

      // If face drifted out of range during countdown, abort
      const yaw = liveYawRef.current;
      if (yaw === null || yaw < angle.yawRange[0] || yaw > angle.yawRange[1]) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);
        stableCountRef.current = 0;
        lastAngleMatchRef.current = null;
        setStability(0);
        return;
      }

      if (remaining <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);

        stableCountRef.current = 0;
        lastAngleMatchRef.current = null;
        setStability(0);

        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) {
          // Manually flip the image to ensure non-mirrored output as requested
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0);
            const resultImage = canvas.toDataURL('image/jpeg', 0.92);
            setCaptures((prev) => ({ ...prev, [angleKey]: resultImage }));
          };
          img.src = imageSrc;

          setFlash(true);
          setTimeout(() => setFlash(false), 250);
        }
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, []);

  useEffect(() => {
    if (!modelsLoaded || allCaptured) {
      setFaceDetected(false);
      setCurrentYaw(null);
      stableCountRef.current = 0;
      lastAngleMatchRef.current = null;
      cancelCountdown();
      return;
    }

    let running = true;
    let detectionInProgress = false;

    async function detect() {
      if (!running) return;
      const video = webcamRef.current?.video;
      if (video && video.readyState === 4 && video.videoWidth > 0 && !detectionInProgress) {
        try {
          detectionInProgress = true;
          const detection = await faceapi
            .detectSingleFace(
              video,
              new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
            )
            .withFaceLandmarks();

          if (!running) return;

          if (detection) {
            setFaceDetected(true);
            const yaw = estimateYaw(detection.landmarks);

            // Smoothing filter for more fluid response
            let smoothedYaw = yaw;
            if (liveYawRef.current !== null) {
              // Mix: 60% new value, 40% old value for high responsiveness with stability
              smoothedYaw = liveYawRef.current * 0.4 + yaw * 0.6;
            }

            liveYawRef.current = smoothedYaw;
            setCurrentYaw(smoothedYaw);

            const targetAngle = ANGLES.find((a) => !capturesRef.current[a.key]);

            if (targetAngle && yaw >= targetAngle.yawRange[0] && yaw <= targetAngle.yawRange[1]) {
              if (lastAngleMatchRef.current === targetAngle.key) {
                stableCountRef.current += 1;
              } else {
                stableCountRef.current = 1;
                lastAngleMatchRef.current = targetAngle.key;
              }

              setStability(Math.min(stableCountRef.current / STABLE_FRAMES_NEEDED, 1));

              if (stableCountRef.current >= STABLE_FRAMES_NEEDED && !countdownRef.current) {
                captureForAngle(targetAngle.key);
              }
            } else {
              stableCountRef.current = 0;
              lastAngleMatchRef.current = null;
              setStability(0);
              cancelCountdown();
            }
          } else {
            liveYawRef.current = null;
            setFaceDetected(false);
            setCurrentYaw(null);
            stableCountRef.current = 0;
            lastAngleMatchRef.current = null;
            setStability(0);
            cancelCountdown();
          }
        } catch (err) {
          console.error('Detection error:', err);
        } finally {
          detectionInProgress = false;
        }
      }

      if (running) {
        animFrameRef.current = setTimeout(() => detect(), 20);
      }
    }

    detect();

    return () => {
      running = false;
      if (animFrameRef.current) clearTimeout(animFrameRef.current);
      cancelCountdown();
    };
  }, [modelsLoaded, allCaptured, captureForAngle, cancelCountdown]);

  const resetAll = () => {
    setCaptures({ left: null, front: null, right: null });
    stableCountRef.current = 0;
    lastAngleMatchRef.current = null;
    cancelCountdown();
  };

  const targetAngle = ANGLES.find((a) => !captures[a.key]) || ANGLES.find((a) => a.key === 'front');

  let yawPercent = 50;
  if (currentYaw != null) {
    yawPercent = Math.max(0, Math.min(100, ((currentYaw + YAW_SCALE) / (YAW_SCALE * 2)) * 100));
  } else if (!faceDetected && targetAngle) {
    yawPercent =
      (((targetAngle.yawRange[0] + targetAngle.yawRange[1]) / 2 + YAW_SCALE) / (YAW_SCALE * 2)) *
      100;
  }

  const inRange =
    currentYaw != null &&
    currentYaw >= targetAngle.yawRange[0] &&
    currentYaw <= targetAngle.yawRange[1];

  return (
    <div className="face-capture custom-scrollbar h-full overflow-x-hidden overflow-y-auto p-8 2xl:p-12">
      {/* Header */}
      <div className="mb-8 flex shrink-0 flex-col gap-2 sm:mb-4 lg:mb-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="group rounded-full bg-gray-100 p-2 transition-colors hover:bg-black/5 sm:p-2.5 dark:bg-[#1c1c1c] dark:hover:bg-neutral-800"
            >
              <ArrowLeft className="text-gray-900 dark:text-white" size={20} strokeWidth={2.5} />
            </button>
          )}
          <h1 className="text-[17px] font-semibold text-gray-900 sm:text-lg 2xl:text-2xl dark:text-white">
            Move your face from left to right
          </h1>
        </div>
        <p className="2xl:text-15 -mt-3 ml-0 text-sm text-gray-500 sm:ml-12 2xl:-mt-2 dark:text-[#AFAFAF]">
          Add three photos: left, center, and right for Avatar Generation
        </p>

        {/* Capture Steps Indicator */}
        <div className="mt-6 flex flex-wrap items-center gap-4 sm:mt-4 sm:ml-12 sm:gap-8">
          {ANGLES.map((angle, idx) => {
            const isCaptured = !!captures[angle.key];
            const isCurrent = targetAngle?.key === angle.key && !allCaptured;

            return (
              <div key={angle.key} className="flex items-center gap-3">
                <div
                  className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-500 sm:h-9 sm:w-9 ${
                    isCaptured
                      ? 'border-green-500/50 bg-green-500/10 text-green-400'
                      : isCurrent
                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                        : 'border-black/10 bg-black/5 text-neutral-400 dark:border-white/5 dark:bg-white/5 dark:text-neutral-600'
                  }`}
                >
                  {isCaptured ? (
                    <Check size={18} strokeWidth={3} />
                  ) : (
                    <span className="text-xs font-bold sm:text-sm">{idx + 1}</span>
                  )}
                  {isCurrent && <div className="face-capture__step-glow" />}
                </div>
                <div className="flex flex-col">
                  <span
                    className={`text-[9px] font-bold tracking-[0.1em] uppercase sm:text-[10px] ${
                      isCurrent
                        ? 'text-blue-400'
                        : isCaptured
                          ? 'text-green-500/70'
                          : 'text-neutral-400 dark:text-neutral-600'
                    }`}
                  >
                    Step 0{idx + 1}
                  </span>
                  <span
                    className={`text-xs font-semibold whitespace-nowrap sm:text-sm ${
                      isCurrent
                        ? 'text-gray-900 dark:text-white'
                        : isCaptured
                          ? 'text-neutral-600 dark:text-neutral-300'
                          : 'text-neutral-500 dark:text-neutral-500'
                    }`}
                  >
                    {angle.label}
                  </span>
                </div>
                {idx < ANGLES.length - 1 && (
                  <div className="mx-1 h-px w-4 bg-black/10 sm:mx-2 sm:w-6 dark:bg-white/10" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col items-start gap-6 pt-6 sm:flex-row xl:flex-nowrap">
        {/* Left Area: Camera */}
        <div className="relative mx-auto flex w-full max-w-sm flex-[1.1] shrink-0 flex-col items-center bg-transparent lg:max-w-sm 2xl:max-w-md">
          {!modelsLoaded ? (
            <div className="flex aspect-square w-full flex-col items-center justify-center rounded-3xl bg-black/20 backdrop-blur-sm">
              <div className="face-capture__spinner mb-4" />
              <p className="text-sm font-medium text-neutral-400">
                Loading face detection models...
              </p>
            </div>
          ) : (
            <div className="face-capture__camera-area relative aspect-square w-full">
              <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={videoConstraints}
                onUserMediaError={() => setWebcamError(true)}
                onUserMedia={() => setWebcamError(false)}
                className="face-capture__webcam"
              />
              <canvas ref={canvasRef} className="face-capture__canvas" />

              {webcamError && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-3xl bg-black/80 backdrop-blur-md">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                    <CameraOff size={32} />
                  </div>
                  <span className="mb-2 text-lg font-semibold text-white">No camera found</span>
                  <p className="max-w-[80%] text-center text-sm leading-relaxed text-neutral-400">
                    Please ensure your camera is connected and you have granted permission to use it
                    in your browser settings.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-6 rounded-full bg-white px-6 py-2 text-sm font-semibold text-black transition-all hover:bg-neutral-200 active:scale-95"
                  >
                    Retry Connection
                  </button>
                </div>
              )}

              <div className="face-capture__overlay">
                <div
                  className={`face-capture__oval ${inRange ? 'face-capture__oval--matched' : ''}`}
                />
              </div>

              {countdown != null && (
                <div className="face-capture__countdown">
                  <span>{countdown}</span>
                </div>
              )}

              {flash && <div className="face-capture__flash" />}

              {!allCaptured && (
                <div className="absolute bottom-4 left-1/2 z-30 flex min-w-[200px] -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-black/60 p-2.5 backdrop-blur-md transition-all duration-300">
                  {!faceDetected ? (
                    <span className="text-10 font-bold tracking-widest text-red-400 uppercase">
                      Face Not Detected
                    </span>
                  ) : inRange ? (
                    <>
                      <span className="text-10 font-bold tracking-widest text-green-400 uppercase">
                        {countdown != null ? 'Capturing...' : 'Hold Still...'}
                      </span>
                      {countdown == null && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                          <div
                            className="h-full bg-blue-500 transition-all duration-200"
                            style={{ width: `${stability * 100}%` }}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-10 animate-pulse font-bold tracking-widest text-white uppercase">
                      {targetAngle.instruction}
                    </span>
                  )}
                </div>
              )}

              {allCaptured && (
                <div className="face-capture__complete">
                  <div className="face-capture__complete-content">
                    <div className="face-capture__complete-badge border border-green-500/30">
                      <svg
                        viewBox="0 0 24 24"
                        width="40"
                        height="40"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <span className="text-xl font-semibold text-white">All Angles Captured!</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Area: Cards and Slider */}
        <div className="relative flex min-w-0 flex-1 flex-col items-center">
          <div className="relative flex w-full flex-col items-center">
            {/* Avatar Cards Wrapper */}
            <div className="relative w-full overflow-hidden">
              {/* Avatar Cards */}
              <div className="relative z-10 flex w-full max-w-2xl translate-y-4 items-end justify-center -space-x-12 px-4 pb-10 2xl:max-w-3xl 2xl:translate-y-2">
                {['left', 'front', 'right'].map((key, index) => {
                  const angle = ANGLES.find((a) => a.key === key);
                  const isFront = key === 'front';
                  return (
                    <div
                      key={key}
                      className={`group/card relative flex aspect-1/2 w-full flex-1 justify-center transition-all duration-500 ease-out ${
                        angle.rotationClass
                      } ${isFront ? 'z-20 scale-105' : 'z-10'}`}
                    >
                      <div
                        className={`relative h-full w-full overflow-hidden rounded-3xl bg-[#111] transition-all duration-300 ${!isFront ? 'translate-y-12 opacity-80' : 'translate-y-6'}`}
                      >
                        <img
                          src={captures[angle.key] || angle.placeholder}
                          alt={angle.label}
                          className={`h-full w-full object-cover transition-all duration-300 ${
                            key === 'left'
                              ? 'object-[80%_center]'
                              : key === 'right'
                                ? 'object-[20%_center]'
                                : 'object-center'
                          } ${captures[angle.key] ? 'scale-105' : 'opacity-80'}`}
                        />
                        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1/3 bg-linear-to-b from-black/80 via-black/20 to-transparent" />
                        <div className="text-10 absolute top-4 left-1/2 z-20 w-[90%] -translate-x-1/2 text-center leading-tight font-medium text-white/90 drop-shadow-md 2xl:top-6 2xl:text-xs">
                          {angle.instruction}
                        </div>
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/2 bg-linear-to-t from-black via-black/40 to-transparent" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Card Area Overlay - Localized to slider width */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto h-10 w-full max-w-[350px] bg-linear-to-t from-[#1c1c1c]/60 via-[#1c1c1c]/40 to-transparent 2xl:h-15 2xl:max-w-[400px]" />

              {/* Yaw Tracker / Slider - Positioned on top of overlay and bottom of images */}
              <div className="absolute inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-[450px] items-center gap-4 px-8 text-xs font-semibold text-white/90 2xl:max-w-[500px]">
                <span>Left</span>
                <div className="face-capture__slider-container relative mt-2.25 h-3 flex-1 2xl:mt-2">
                  {targetAngle && !allCaptured && (
                    <div
                      className={`face-capture__slider-zone absolute h-full rounded-full ${inRange ? 'matched' : ''}`}
                      style={{
                        left: `${((targetAngle.yawRange[0] + YAW_SCALE) / (YAW_SCALE * 2)) * 100}%`,
                        width: `${((targetAngle.yawRange[1] - targetAngle.yawRange[0]) / (YAW_SCALE * 2)) * 100}%`,
                      }}
                    />
                  )}
                  <div
                    className={`face-capture__slider-thumb absolute top-1/2 h-2 translate-y-0 ${inRange ? 'matched' : 'bg-blue-500'}`}
                    style={{ left: `${yawPercent}%` }}
                  />
                </div>
                <span>Right</span>
              </div>
            </div>
          </div>

          {/* Submit & Start Over */}
          <div className="mt-10 mr-4 mb-5 flex w-full items-center justify-end gap-3 2xl:mt-12 2xl:mr-0 2xl:mb-0">
            {allCaptured && (
              <button
                onClick={resetAll}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-gray-100 px-5 py-3 text-sm font-medium text-gray-900 transition-all hover:bg-black/5 2xl:px-8 2xl:py-3.5 dark:border-white/10 dark:bg-[#1c1c1c] dark:text-white dark:hover:bg-neutral-800"
              >
                <RotateCcw className="size-3.5" strokeWidth={2.5} />
                <span>Start Over</span>
              </button>
            )}
            <button
              disabled={!allCaptured}
              className={`flex items-center justify-center rounded-full p-2 transition-all duration-300 ${
                allCaptured
                  ? 'bg-gray-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:shadow-[0_0_20px_rgba(255,255,255,0.3)] dark:hover:bg-neutral-200'
                  : 'cursor-not-allowed bg-gray-100 text-neutral-400 opacity-50 dark:bg-[#1c1c1c] dark:text-neutral-600'
              }`}
              onClick={() => onSubmit && onSubmit(captures)}
            >
              <ChevronRight className="size-5 2xl:size-6" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
