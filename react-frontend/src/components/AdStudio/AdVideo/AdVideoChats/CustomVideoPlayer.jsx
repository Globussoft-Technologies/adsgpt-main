import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  ChevronLeft,
  CircleGauge,
  PictureInPicture2,
  Download,
  Volume2,
  VolumeX,
  EllipsisVertical,
  Maximize,
  Minimize,
} from 'lucide-react';
import { handleDownload } from '@/utils/download';

const CustomVideoPlayer = ({ src, aspect }) => {
  const videoRef = useRef(null);
  const dropdownRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState('main');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(1);

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) video.pause();
    else video.play();
    setIsPlaying(!isPlaying);
  };

  const handleSpeedChange = (rate) => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    setPlaybackRate(rate);
    setIsDropdownOpen(false);
    setActiveMenu('main');
  };

  const handlePip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
      setIsDropdownOpen(false);
    } catch (error) {
      console.error('PiP not supported:', error);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      videoRef.current.parentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const toggleMute = () => {
    if (isMuted || volume === 0) {
      // Unmute → restore last non-zero volume
      setIsMuted(false);
      setVolume(lastVolume);
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = lastVolume;
      }
    } else {
      // Mute → set volume to 0
      setIsMuted(true);
      setLastVolume(volume);
      setVolume(0);
      if (videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
      }
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
      setProgress((video.currentTime / video.duration) * 100);
    }
  };

  const handleSeek = (e) => {
    const video = videoRef.current;
    const value = parseFloat(e.target.value);
    if (video) {
      video.currentTime = (value / 100) * video.duration;
      setProgress(value);
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) setDuration(video.duration);
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);

    if (newVolume === 0) {
      setIsMuted(true);
    } else {
      setIsMuted(false);
      setLastVolume(newVolume);
    }

    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
    }
  };

  useEffect(() => {
    if (!isPlaying) return;
    let hideTimeout;
    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => setShowControls(false), 3000);
    };
    window.addEventListener('mousemove', handleMouseMove);
    hideTimeout = setTimeout(() => setShowControls(false), 3000);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(hideTimeout);
    };
  }, [isPlaying]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
        setActiveMenu('main');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const aspectClasses = {
    ASPECT_16_9: {
      container: 'group relative w-full max-w-[1200px] bg-black rounded-2xl overflow-hidden',
      videoClass: 'aspect-[16/9] w-full rounded-2xl object-contain',
    },
    ASPECT_9_16: {
      container:
        'group relative w-full h-full max-h-[350px] max-w-[540px] bg-black rounded-2xl overflow-hidden',
      videoClass:
        'max-w-full w-full h-full max-h-[80vh] lg:max-h-screen 2xl:max-h-[80vh] object-contain',
    },
    default: {
      container: 'group relative w-full max-w-[800px] bg-black rounded-2xl overflow-hidden',
      videoClass: 'w-full rounded-2xl object-contain',
    },
  };

  const { container, videoClass } = aspectClasses[aspect] || aspectClasses.default;
  return (
    <div className={container}>
      {/* Video */}
      <video
        ref={videoRef}
        src={src}
        className={videoClass}
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        controls={false}
      />

      {
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-full w-full rounded-2xl bg-gradient-to-b from-black/10 via-transparent to-black to-90%" />
      }

      {
        <div className="absolute inset-x-0 bottom-2 z-20 flex flex-col px-2 text-white transition-opacity duration-300">
          {/* Controls */}
          <div className="mb-1 flex items-center justify-between text-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="rounded-full p-2 transition hover:bg-black/50"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <span className="hidden text-xs text-white sm:inline-block">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {/* Volume */}
              <div className="group/volume relative flex items-center">
                {/* Volume Button */}
                <button
                  onClick={toggleMute}
                  className="rounded-full p-2 transition hover:bg-black/50"
                >
                  {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>

                {/* Hover-visible Slider with animation */}
                <div
                  className="absolute right-8 hidden translate-x-2 items-center opacity-0 transition-all duration-300 ease-in-out group-hover/volume:flex group-hover/volume:translate-x-0 group-hover/volume:opacity-100 hover:flex"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(e)}
                    className="mr-2 w-15 cursor-pointer appearance-none accent-white"
                    style={{
                      WebkitAppearance: 'none',
                      height: '4px',
                      background: isMuted
                        ? '#ffffff60'
                        : `linear-gradient(to right, #fff 0%, #fff ${
                            volume * 100
                          }%, #ffffff60 ${volume * 100}%, #ffffff60 100%)`,
                      borderRadius: '2px',
                    }}
                  />
                </div>
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="rounded-full p-2 transition hover:bg-black/50"
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>

              {/* Settings Dropdown */}
              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => {
                    setIsDropdownOpen((prev) => !prev);
                    setActiveMenu('main');
                  }}
                  className="rounded-full p-2 transition hover:bg-black/50"
                >
                  <EllipsisVertical size={19} />
                </button>

                {isDropdownOpen && (
                  <div className="animate-in fade-in slide-in-from-bottom-2 absolute right-0 bottom-10 z-30 max-h-50 w-45 overflow-auto rounded-lg border border-gray-700 bg-[#222] text-sm shadow-xl 2xl:w-50">
                    {activeMenu === 'main' && (
                      <div>
                        <button
                          onClick={() => setActiveMenu('speed')}
                          className="flex w-full items-center justify-between px-3 py-2 text-gray-200 hover:bg-white/10"
                        >
                          <div className="flex gap-2">
                            <CircleGauge size={16} />
                            <span className="text-xs 2xl:text-sm">Playback Speed</span>
                          </div>
                          <span className="text-xs text-[#afafaf] 2xl:text-sm">
                            {playbackRate}x
                          </span>
                        </button>

                        <button
                          onClick={handlePip}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/10 2xl:text-sm"
                        >
                          <PictureInPicture2 size={16} />
                          Picture-in-Picture
                        </button>

                        <button
                          onClick={() => handleDownload(src)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-200 transition hover:bg-white/10 2xl:text-sm"
                        >
                          <Download size={16} /> Download
                        </button>
                      </div>
                    )}

                    {activeMenu === 'speed' && (
                      <div className="text-gray-200">
                        <button
                          onClick={() => setActiveMenu('main')}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/10 2xl:text-sm"
                        >
                          <ChevronLeft size={16} /> Playback Speed
                        </button>
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => handleSpeedChange(rate)}
                            className={`flex w-full justify-between px-4 py-2 text-left text-xs transition 2xl:text-sm ${
                              playbackRate === rate ? 'text-white' : 'hover:bg-white/10'
                            }`}
                          >
                            {rate}x{playbackRate === rate && <span className="text-xs">✔</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="w-full px-2">
            {/* Progress Bar */}
            <div
              className="group/progress relative mb-2.5 h-1.5 w-full cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = ((e.clientX - rect.left) / rect.width) * 100;
                handleSeek({ target: { value: percent } });
              }}
            >
              {/* Track background */}
              <div className="absolute top-1/2 left-0 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/50" />

              {/* Watched progress (white) */}
              <div
                className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-white transition-[width] duration-10"
                style={{ width: `${progress}%` }}
              />

              {/* Hidden input for thumb behavior */}
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={progress}
                onChange={handleSeek}
                className="absolute top-0 left-0 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:translate-y-[-2px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white hover:[&::-webkit-slider-thumb]:scale-110"
              />
            </div>
          </div>
        </div>
      }
    </div>
  );
};

export default CustomVideoPlayer;
