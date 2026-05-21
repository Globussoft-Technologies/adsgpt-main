import { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import * as faceapi from 'face-api.js';
import { ArrowLeft } from 'lucide-react';
import './FaceCaptureGuide.css';

const ANGLES = [
  {
    key: 'front',
    label: 'Front',
    instruction: 'Look straight at the camera',
    yawRange: [-8, 8],
  },
  {
    key: 'left',
    label: 'Left',
    instruction: 'Turn your head to the right',
    yawRange: [-55, -20],
  },
  {
    key: 'right',
    label: 'Right',
    instruction: 'Turn your head to the left',
    yawRange: [20, 55],
  },
];

// The yaw meter maps -60..60 degrees to 0..100% so the
// left/right target zones appear at the far ends of the bar.
const YAW_SCALE = 60;

const videoConstraints = {
  width: 640,
  height: 640,
  facingMode: 'user',
};

// Estimate yaw from 68 face landmarks using nose-to-ear ratios.
// Webcam is mirrored, so left/right are visually swapped.
function estimateYaw(landmarks) {
  const pts = landmarks.positions;
  const noseTip = pts[30];
  const leftEar = pts[0]; // leftmost jaw point
  const rightEar = pts[16]; // rightmost jaw point

  const dLeft = Math.hypot(noseTip.x - leftEar.x, noseTip.y - leftEar.y);
  const dRight = Math.hypot(noseTip.x - rightEar.x, noseTip.y - rightEar.y);

  const ratio = (dRight - dLeft) / (dRight + dLeft);
  // Map ratio to approximate degrees. Mirrored webcam: negate.
  return -(ratio * 90);
}

const STABLE_FRAMES_NEEDED = 8; // ~0.8s at ~10fps detection
const COUNTDOWN_SECONDS = 3;

export default function FaceCaptureGuide({ onBack, onSubmit }) {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const stableCountRef = useRef(0);
  const lastAngleMatchRef = useRef(null);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [captures, setCaptures] = useState({ front: null, left: null, right: null });
  const [, setActiveStep] = useState(0);
  const [currentYaw, setCurrentYaw] = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [flash, setFlash] = useState(false);
  const [stability, setStability] = useState(0);

  const countdownRef = useRef(null);
  const capturesRef = useRef(captures);

  // Sync ref in an effect instead of during render
  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  const allCaptured = ANGLES.every((a) => captures[a.key]);

  // Load face-api models
  useEffect(() => {
    async function loadModels() {
      try {
        const MODEL_URL = '/models';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        setModelsLoaded(true);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    }
    loadModels();
  }, []);

  // Advance to next uncaptured step
  const advanceStep = useCallback(() => {
    setActiveStep((prev) => {
      for (let i = 1; i <= ANGLES.length; i++) {
        const idx = (prev + i) % ANGLES.length;
        if (!capturesRef.current[ANGLES[idx].key]) return idx;
      }
      return prev;
    });
  }, []);

  // Cancel countdown if face moves away
  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(null);
    }
  }, []);

  // Capture for specific angle (used by auto-capture)
  const captureForAngle = useCallback(
    (angleKey) => {
      if (countdownRef.current) return;
      let remaining = COUNTDOWN_SECONDS;
      setCountdown(remaining);

      countdownRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          setCountdown(null);

          // Reset stability counters immediately to prevent double triggering
          stableCountRef.current = 0;
          lastAngleMatchRef.current = null;
          setStability(0);

          const imageSrc = webcamRef.current?.getScreenshot();
          if (imageSrc) {
            setFlash(true);
            setTimeout(() => setFlash(false), 250);
            setCaptures((prev) => ({ ...prev, [angleKey]: imageSrc }));
            setTimeout(() => advanceStep(), 300);
          }
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    },
    [advanceStep]
  );

  // Face detection loop
  useEffect(() => {
    if (!modelsLoaded || allCaptured) {
      // Clear state when not detecting
      setFaceDetected(false);
      setCurrentYaw(null);
      setStability(0);
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
      // Ensure video is ready and has dimensions
      if (video && video.readyState === 4 && video.videoWidth > 0 && !detectionInProgress) {
        try {
          detectionInProgress = true;
          const detection = await faceapi
            .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }))
            .withFaceLandmarks();

          if (!running) return;

          if (detection) {
            setFaceDetected(true);
            const yaw = estimateYaw(detection.landmarks);
            setCurrentYaw(yaw);

            // Draw landmarks on canvas
            const canvas = canvasRef.current;
            if (canvas) {
              const displaySize = { width: video.videoWidth, height: video.videoHeight };
              faceapi.matchDimensions(canvas, displaySize);
              // const resized = faceapi.resizeResults(detection, displaySize);
              canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
              // faceapi.draw.drawFaceLandmarks(canvas, resized);
            }

            // Check if current yaw matches the next uncaptured angle
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
            setFaceDetected(false);
            setCurrentYaw(null);
            stableCountRef.current = 0;
            lastAngleMatchRef.current = null;
            setStability(0);
            cancelCountdown();

            const canvas = canvasRef.current;
            if (canvas) {
              canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            }
          }
        } catch (err) {
          console.error('Detection error:', err);
        } finally {
          detectionInProgress = false;
        }
      }

      if (running) {
        animFrameRef.current = setTimeout(() => detect(), 70);
      }
    }

    detect();

    return () => {
      running = false;
      if (animFrameRef.current) clearTimeout(animFrameRef.current);
      cancelCountdown();
    };
  }, [modelsLoaded, allCaptured, captureForAngle, cancelCountdown]);

  const deleteCapture = (key) => {
    setCaptures((prev) => ({ ...prev, [key]: null }));
    const idx = ANGLES.findIndex((a) => a.key === key);
    setActiveStep(idx);
    stableCountRef.current = 0;
    lastAngleMatchRef.current = null;
    setStability(0);
    cancelCountdown();
  };

  const resetAll = () => {
    setCaptures({ front: null, left: null, right: null });
    setActiveStep(0);
    stableCountRef.current = 0;
    lastAngleMatchRef.current = null;
    setStability(0);
    cancelCountdown();
  };

  // Determine the current target angle for display
  const targetAngle = ANGLES.find((a) => !captures[a.key]) || ANGLES[0];

  // Yaw indicator position (map yaw -YAW_SCALE..+YAW_SCALE to 0..100%)
  const yawPercent =
    currentYaw != null
      ? Math.max(0, Math.min(100, ((currentYaw + YAW_SCALE) / (YAW_SCALE * 2)) * 100))
      : 50;

  // Check if yaw is in target range
  const inRange =
    currentYaw != null &&
    currentYaw >= targetAngle.yawRange[0] &&
    currentYaw <= targetAngle.yawRange[1];

  return (
    <div className="face-capture">
      <div className="face-capture__header">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-4 flex items-center gap-2 text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
        )}
        {/* <h1>Face Shape Guide</h1> */}
        {/* <p>We'll automatically capture your face from three angles</p> */}
      </div>

      {!modelsLoaded && (
        <div className="face-capture__loading">
          <div className="face-capture__spinner" />
          <p>Loading face detection models...</p>
        </div>
      )}

      {modelsLoaded && (
        <>
          {/* Step indicators */}
          {/* <div className="face-capture__steps">
            {ANGLES.map((angle, i) => (
              <div
                key={angle.key}
                className={`face-capture__step ${captures[angle.key] ? 'done' : ''} ${targetAngle.key === angle.key && !allCaptured ? 'active' : ''}`}
              >
                <div className="face-capture__step-number">
                  {captures[angle.key] ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="3">
                      <polyline points="4 12 10 18 20 6" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className="face-capture__step-label">{angle.label}</span>
              </div>
            ))}
          </div> */}

          {!allCaptured && (
            <div className="face-capture__camera-area">
              {/* Instruction banner */}
              <div className={`face-capture__guide-banner ${inRange ? 'in-range' : ''}`}>
                <div className="face-capture__guide-text">
                  <span className="face-capture__guide-step">
                    Step {ANGLES.indexOf(targetAngle) + 1}:
                  </span>
                  {targetAngle.instruction}
                </div>
                {!faceDetected && (
                  <div className="face-capture__guide-warning">
                    No face detected — position yourself in frame
                  </div>
                )}
              </div>

              {/* Webcam */}
              <div className="face-capture__webcam-wrapper">
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  screenshotFormat="image/jpeg"
                  videoConstraints={videoConstraints}
                  mirrored
                  className="face-capture__webcam"
                />
                <canvas ref={canvasRef} className="face-capture__canvas" />

                {/* Oval guide */}
                <div className="face-capture__overlay">
                  <div
                    className={`face-capture__oval ${inRange ? 'face-capture__oval--matched' : ''}`}
                    style={{
                      transform: `translateX(${targetAngle.key === 'left' ? '-12%' : targetAngle.key === 'right' ? '12%' : '0'})`,
                    }}
                  />
                </div>

                {/* Countdown overlay */}
                {countdown != null && (
                  <div className="face-capture__countdown">
                    <span>{countdown}</span>
                  </div>
                )}

                {flash && <div className="face-capture__flash" />}
              </div>

              {/* Yaw meter */}
              <div className="face-capture__yaw-meter">
                <span className="face-capture__yaw-label">L</span>
                <div className="face-capture__yaw-track">
                  {/* Target zone highlight */}
                  <div
                    className="face-capture__yaw-zone"
                    style={{
                      left: `${((targetAngle.yawRange[0] + YAW_SCALE) / (YAW_SCALE * 2)) * 100}%`,
                      width: `${((targetAngle.yawRange[1] - targetAngle.yawRange[0]) / (YAW_SCALE * 2)) * 100}%`,
                    }}
                  />
                  {/* Current yaw indicator */}
                  {faceDetected && (
                    <div
                      className={`face-capture__yaw-indicator ${inRange ? 'in-range' : ''}`}
                      style={{ left: `${yawPercent}%` }}
                    />
                  )}
                  {/* Center line */}
                  <div className="face-capture__yaw-center" />
                </div>
                <span className="face-capture__yaw-label">R</span>
              </div>

              {/* Stability bar */}
              {faceDetected && inRange && countdown == null && (
                <div className="face-capture__stability">
                  <span>Hold still...</span>
                  <div className="face-capture__stability-bar">
                    <div
                      className="face-capture__stability-fill"
                      style={{ width: `${stability * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Status text */}
              {/* <div className="face-capture__status">
                {!faceDetected
                  ? 'Position your face in the oval'
                  : inRange
                    ? countdown != null
                      ? `Capturing in ${countdown}...`
                      : 'Hold steady — aligning...'
                    : `Turn your head: ${targetAngle.instruction.toLowerCase()}`}
              </div> */}
            </div>
          )}

          {/* Preview section */}
          <div className="face-capture__previews">
            {ANGLES.map((angle) => (
              <div
                key={angle.key}
                className={`face-capture__preview-card ${captures[angle.key] ? 'has-image' : ''}`}
              >
                <div className="face-capture__preview-header">
                  <span>{angle.label}</span>
                </div>
                {captures[angle.key] ? (
                  <div className="face-capture__preview-image-wrap">
                    <img src={captures[angle.key]} alt={`${angle.label} capture`} />
                    <button
                      className="face-capture__delete-btn"
                      onClick={() => deleteCapture(angle.key)}
                      title={`Delete ${angle.label} capture`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                      Retake
                    </button>
                  </div>
                ) : (
                  <div className="face-capture__preview-placeholder">
                    <div className="face-capture__placeholder-icon">
                      {angle.key === 'front' ? '😐' : angle.key === 'left' ? '👉' : '👈'}
                    </div>
                    <span>Waiting...</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {allCaptured && (
            <div className="face-capture__complete">
              <div className="face-capture__complete-badge">All 3 angles captured!</div>
              <div className="face-capture__actions">
                <button
                  className="face-capture__submit-btn"
                  onClick={() => onSubmit && onSubmit(captures)}
                >
                  Continue
                </button>
                <button className="face-capture__reset-btn" onClick={resetAll}>
                  Start Over
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
