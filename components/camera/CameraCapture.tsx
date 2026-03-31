/**
 * Camera Capture Component
 * Version: 1.0.0
 * 
 * Handles live camera capture using getUserMedia API.
 * Supports both mobile (iOS Safari, Android Chrome) and desktop webcams.
 * 
 * Features:
 * - Camera permission handling
 * - Front/back camera selection on mobile
 * - Photo capture with preview
 * - Error handling and user feedback
 * - Responsive design for all devices
 * 
 * Browser Support:
 * - iOS Safari 11+
 * - Android Chrome 53+
 * - Desktop Chrome, Firefox, Safari, Edge
 */

'use client';

import { useState, useRef, useEffect } from 'react';

export interface CameraCaptureProps {
  onCapture: (blob: Blob, dataUrl: string) => void;
  onError?: (error: Error) => void;
  className?: string;
  frameOverlay?: string; // URL of frame image to overlay
  frameWidth?: number;   // Frame width in pixels (for aspect ratio)
  frameHeight?: number;  // Frame height in pixels (for aspect ratio)
  captureButtonColor?: string; // Hex color for capture button fill (default: #3B82F6)
  captureButtonBorderColor?: string; // Hex color for capture button border (default: #3B82F6)
  promptTitle?: string;  // Custom title for camera start prompt
  promptDescription?: string; // Custom description for camera start prompt
}

export default function CameraCapture({ 
  onCapture, 
  onError, 
  className = '', 
  frameOverlay, 
  frameWidth, 
  frameHeight,
  captureButtonColor = '#3B82F6',
  captureButtonBorderColor = '#3B82F6',
  promptTitle = 'Ready to capture?',
  promptDescription = 'Click to start your camera and take a photo'
}: CameraCaptureProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [orientation, setOrientation] = useState<'portrait' | 'landscape-left' | 'landscape-right'>('portrait');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const getTargetAspectRatio = () => {
    if (frameWidth && frameHeight && frameWidth > 0 && frameHeight > 0) {
      return frameWidth / frameHeight;
    }

    if (frameImage && frameImage.width > 0 && frameImage.height > 0) {
      return frameImage.width / frameImage.height;
    }

    return 16 / 9;
  };

  /**
   * Load frame overlay image
   */
  useEffect(() => {
    if (frameOverlay) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setFrameImage(img);
      img.onerror = (err) => console.error('Failed to load frame overlay:', err);
      img.src = frameOverlay;
    }
  }, [frameOverlay]);

  /**
   * Detect device orientation angle for precise control positioning
   * v2.9.0: Distinguishes left rotation (90°) from right rotation (270°)
   */
  useEffect(() => {
    const handleOrientation = () => {
      // Try Screen Orientation API first (modern browsers)
      if (typeof window !== 'undefined' && window.screen?.orientation) {
        const angle = window.screen.orientation.angle;
        if (angle === 0 || angle === 180) {
          setOrientation('portrait');
        } else if (angle === 90) {
          setOrientation('landscape-right'); // Device rotated left, controls go right
        } else if (angle === 270) {
          setOrientation('landscape-left'); // Device rotated right, controls go left
        }
      } else {
        // Fallback: use window dimensions (portrait vs landscape only)
        const isLandscape = window.innerWidth > window.innerHeight;
        setOrientation(isLandscape ? 'landscape-right' : 'portrait');
      }
    };
    
    handleOrientation();
    
    // Listen for orientation changes
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', handleOrientation);
    }
    window.addEventListener('resize', handleOrientation);
    
    return () => {
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', handleOrientation);
      }
      window.removeEventListener('resize', handleOrientation);
    };
  }, []);

  /**
   * Check if device has multiple cameras
   * Used to show camera switch button
   */
  useEffect(() => {
    const checkCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        // Always show camera selector if more than 1 camera available
        setHasMultipleCameras(videoDevices.length > 1);
      } catch (err) {
        console.error('Error checking cameras:', err);
      }
    };

    checkCameras();
  }, []);

  /**
   * Re-check cameras when stream changes
   */
  useEffect(() => {
    if (stream) {
      const checkCameras = async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(device => device.kind === 'videoinput');
          setHasMultipleCameras(videoDevices.length > 1);
        } catch (err) {
          console.error('Error checking cameras:', err);
        }
      };
      checkCameras();
    }
  }, [stream]);

  /**
   * Start camera stream with specified constraints
   */
  const startCamera = async (facing: 'user' | 'environment' = facingMode) => {
    setIsLoading(true);
    setError(null);
    setCapturedImage(null);

    try {
      // Stop existing stream if any
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      // Request camera access with MAXIMUM resolution
      // v2.8.0: Request highest available resolution for maximum quality
      // For mobile: use facingMode to select front/back camera
      // For desktop: use default camera
      const targetAspect = getTargetAspectRatio();
      const isLandscapeTarget = targetAspect >= 1;

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          // Request stream dimensions that match the creative orientation,
          // so preview/capture stays consistent regardless of phone rotation.
          width: { ideal: isLandscapeTarget ? 3840 : 2160 },
          height: { ideal: isLandscapeTarget ? 2160 : 3840 },
          aspectRatio: { ideal: targetAspect },
        },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      setStream(mediaStream);
      setFacingMode(facing);

      // Attach stream to video element
      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = mediaStream;
        
        // Safari fix: Must wait for BOTH loadedmetadata AND canplay events
        // Safari needs the video to actually start playing before capture works
        await new Promise<void>((resolve) => {
          let metadataLoaded = false;
          let canPlay = false;
          
          const checkReady = () => {
            if (metadataLoaded && canPlay) {
              cleanup();
              resolve();
            }
          };
          
          const handleMetadata = () => {
            metadataLoaded = true;
            checkReady();
          };
          
          const handleCanPlay = () => {
            canPlay = true;
            checkReady();
          };
          
          const cleanup = () => {
            video.removeEventListener('loadedmetadata', handleMetadata);
            video.removeEventListener('canplay', handleCanPlay);
          };
          
          // Check if already ready
          if (video.readyState >= 2) {
            metadataLoaded = true;
          }
          if (video.readyState >= 3) {
            canPlay = true;
          }
          
          if (metadataLoaded && canPlay) {
            resolve();
            return;
          }
          
          // Listen for events
          video.addEventListener('loadedmetadata', handleMetadata);
          video.addEventListener('canplay', handleCanPlay);
          
          // Timeout fallback (3 seconds)
          setTimeout(() => {
            cleanup();
            resolve();
          }, 3000);
        });
        
        // Extra Safari fix: Small delay to ensure video is actually rendering
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      setIsLoading(false);
      
    } catch (err) {
      setIsLoading(false);
      
      const error = err as Error;
      let errorMessage = 'Failed to access camera';

      // Provide user-friendly error messages
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = 'Camera access denied. Please allow camera permission in your browser settings.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera found on this device.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = 'Camera is already in use by another application.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = 'Camera does not support the requested settings.';
      }

      setError(errorMessage);
      
      if (onError) {
        onError(new Error(errorMessage));
      }

      console.error('Camera error:', error);
    }
  };

  /**
   * Stop camera stream and release resources
   */
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  /**
   * Switch between front and back camera (mobile)
   */
  const switchCamera = () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    startCamera(newFacing);
  };

  /**
   * Capture photo from video stream
   * v2.8.0: Captures exactly what's visible in the live view
   * Crops to target aspect ratio from center of camera sensor
   */
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Safari fix: Comprehensive checks before capture
    // 1. Check if video has valid dimensions
    if (!video.videoWidth || !video.videoHeight) {
      console.warn('Video dimensions not ready, waiting...');
      setTimeout(() => capturePhoto(), 100);
      return;
    }
    
    // 2. Check if video is actually playing (Safari specific)
    if (video.paused || video.ended) {
      console.warn('Video not playing, attempting to play...');
      video.play().then(() => {
        setTimeout(() => capturePhoto(), 100);
      }).catch(err => {
        console.error('Failed to play video:', err);
        setError('Video playback failed. Please try again.');
      });
      return;
    }
    
    // 3. Check if video currentTime is progressing (actually rendering frames)
    if (video.currentTime === 0) {
      console.warn('Video not rendering frames yet, waiting...');
      setTimeout(() => capturePhoto(), 100);
      return;
    }

    // Safari fix: Use requestAnimationFrame to capture during actual frame render
    // This ensures Safari has actually painted the video frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Double RAF ensures we're definitely on a rendered frame
        
        // Calculate target aspect ratio from frame (or default 16:9)
        const targetAspect = getTargetAspectRatio();
        
        const videoAspect = video.videoWidth / video.videoHeight;
        
        // v2.8.0: Draw FULL sensor, scaled to frame size
        // This shows maximum visible area, matching what CSS object-cover displays
        // Example: 3000x4000 sensor → 1500x1000 frame (3:2)
        //   - Draw full 3000x4000 scaled to 1500x2000 (matches width)
        //   - Canvas clips to 1500x1000, showing all 3 people
        
        // Set canvas to frame dimensions
        const frameTargetWidth = frameWidth || (frameImage ? frameImage.width : 1920);
        const frameTargetHeight = frameHeight || (frameImage ? frameImage.height : 1080);
        
        canvas.width = frameTargetWidth;
        canvas.height = frameTargetHeight;
        
        // Calculate how to scale and position the FULL video to fill canvas (object-cover)
        const scaleX = canvas.width / video.videoWidth;
        const scaleY = canvas.height / video.videoHeight;
        const scale = Math.max(scaleX, scaleY); // Scale to fill (largest dimension)
        
        const scaledWidth = video.videoWidth * scale;
        const scaledHeight = video.videoHeight * scale;
        
        // Center the scaled video
        const offsetX = (canvas.width - scaledWidth) / 2;
        const offsetY = (canvas.height - scaledHeight) / 2;

        // Get canvas context
        const ctx = canvas.getContext('2d', { 
          willReadFrequently: false,
          alpha: false // Safari optimization: no alpha channel needed
        });
        
        if (!ctx) {
          setError('Failed to get canvas context');
          return;
        }

        // Safari fix: Fill with white background first
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        try {
          // Draw FULL video scaled to fill canvas (object-cover behavior)
          // If front camera, flip horizontally to match mirror view
          if (facingMode === 'user') {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(
              video,
              0, 0, video.videoWidth, video.videoHeight,
              -offsetX - scaledWidth, offsetY, scaledWidth, scaledHeight
            );
            ctx.restore();
          } else {
            ctx.drawImage(
              video,
              0, 0, video.videoWidth, video.videoHeight,
              offsetX, offsetY, scaledWidth, scaledHeight
            );
          }
          
          // Verify something was actually drawn (not black)
          const imageData = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1);
          const [r, g, b] = imageData.data;
          
          if (r === 0 && g === 0 && b === 0) {
            console.warn('Captured black frame, retrying...');
            setTimeout(() => capturePhoto(), 100);
            return;
          }

          // Convert canvas to blob and data URL
          canvas.toBlob((blob) => {
            if (!blob) {
              setError('Failed to capture photo');
              return;
            }

            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            setCapturedImage(dataUrl);
            
            // Pass captured image to parent
            onCapture(blob, dataUrl);
            
            // Stop camera after capture
            stopCamera();
          }, 'image/jpeg', 0.95);
          
        } catch (err) {
          console.error('Error drawing video to canvas:', err);
          setError('Failed to capture photo. Please try again.');
        }
      });
    });
  };

  /**
   * Retake photo (restart camera)
   */
  const retake = () => {
    setCapturedImage(null);
    startCamera(facingMode);
  };

  /**
   * Calculate container size to match target aspect ratio
   * v2.8.0: Show maximum view at target aspect ratio
   * What you see is what you capture - exact 1:1 correspondence
   */
  useEffect(() => {
    const calculateSize = () => {
      if (!containerRef.current) return;
      
      const parent = containerRef.current.parentElement;
      if (!parent) return;
      
      const availableWidth = parent.clientWidth;
      const availableHeight = parent.clientHeight;
      
      // Calculate target aspect ratio (frame or default 16:9)
      const targetAspect = getTargetAspectRatio();
      
      // Fit maximum size at target aspect ratio within available space
      const containerAspectRatio = availableWidth / availableHeight;
      
      let width, height;
      
      if (containerAspectRatio > targetAspect) {
        // Height is the constraint
        height = availableHeight;
        width = height * targetAspect;
      } else {
        // Width is the constraint
        width = availableWidth;
        height = width / targetAspect;
      }
      
      setContainerSize({ width, height });
    };
    
    calculateSize();
    window.addEventListener('resize', calculateSize);
    window.addEventListener('orientationchange', calculateSize);
    
    return () => {
      window.removeEventListener('resize', calculateSize);
      window.removeEventListener('orientationchange', calculateSize);
    };
  }, [frameWidth, frameHeight, frameImage]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative flex items-center justify-center w-full h-full ${className}`}>
      {/* Camera view with calculated dimensions to fit viewport */}
      <div 
        className="relative bg-gray-900 overflow-hidden"
        style={{
          width: containerSize.width > 0 ? `${containerSize.width}px` : '100%',
          height: containerSize.height > 0 ? `${containerSize.height}px` : '100%',
        }}
      >
        {!capturedImage ? (
          <>
            {/* Live Video Stream - Cover the frame area, mirror if front camera */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none'
              }}
            />

            {/* Frame Overlay - Always on top, exact size match */}
            {frameImage && (
              <div className="absolute inset-0 pointer-events-none z-10">
                <img
                  src={frameOverlay}
                  alt="Frame overlay"
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Loading Overlay */}
            {isLoading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-30">
                <div className="text-white text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                  <p className="text-sm">Starting camera...</p>
                </div>
              </div>
            )}

            {/* Error Overlay */}
            {error && !stream && (
              <div className="absolute inset-0 bg-red-900/90 flex items-center justify-center p-6 z-30">
                <div className="text-white text-center max-w-md">
                  <svg className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-base md:text-lg font-semibold mb-2">Camera Error</p>
                  <p className="text-xs md:text-sm mb-4">{error}</p>
                  <button
                    onClick={() => startCamera(facingMode)}
                    className="px-4 py-2 md:px-6 md:py-2 bg-white text-red-900 rounded-lg font-semibold hover:bg-gray-100 transition-colors text-sm"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}

            {/* Start Camera Prompt */}
            {!stream && !isLoading && !error && (
              <button
                onClick={() => startCamera(facingMode)}
                className="absolute inset-0 flex items-center justify-center p-3 md:p-4 w-full h-full cursor-pointer transition-all z-30"
                style={{
                  background: `linear-gradient(to bottom right, ${captureButtonColor}dd, ${captureButtonColor}aa)`,
                }}
              >
                <div className="text-white text-center max-w-xs md:max-w-md">
                  <svg className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="text-base md:text-lg font-semibold mb-2">{promptTitle}</p>
                  <p className="text-xs text-white/90">
                    {promptDescription}
                  </p>
                </div>
              </button>
            )}
          </>
        ) : (
          <>
            {/* Captured Image Preview */}
            <img
              src={capturedImage}
              alt="Captured photo"
              className="w-full h-full object-cover"
            />
          </>
        )}
      </div>

      {/* Camera Controls - Outside frame, positioned based on orientation */}
      {/* Portrait: bottom center | Landscape-right (rotated left): right side | Landscape-left (rotated right): left side */}
      {stream && !capturedImage && (
        <>
          {/* Capture Button */}
          <button
            onClick={capturePhoto}
            className={`fixed w-16 h-16 rounded-full bg-white transition-all shadow-lg z-50 ${
              orientation === 'portrait'
                ? 'bottom-4 left-1/2 -translate-x-1/2'
                : orientation === 'landscape-right'
                ? 'right-4 top-1/2 -translate-y-1/2'
                : 'left-4 top-1/2 -translate-y-1/2'
            }`}
            style={{
              borderWidth: '4px',
              borderStyle: 'solid',
              borderColor: captureButtonBorderColor
            }}
            aria-label="Capture photo"
          >
            <div 
              className="w-full h-full rounded-full"
              style={{ backgroundColor: captureButtonColor }}
            ></div>
          </button>

          {/* Switch Camera Button - Positioned near capture button */}
          {hasMultipleCameras && (
            <button
              onClick={switchCamera}
              className={`fixed w-12 h-12 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-lg z-50 ${
                orientation === 'portrait'
                  ? 'bottom-4 right-4'
                  : orientation === 'landscape-right'
                  ? 'right-4 bottom-4'
                  : 'left-4 bottom-4'
              }`}
              aria-label="Switch camera"
            >
              <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </>
      )}

      {/* Retake Button - Same position as capture button */}
      {capturedImage && (
        <button
          onClick={retake}
          className={`fixed px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-gray-100 transition-all shadow-lg z-50 ${
            orientation === 'portrait'
              ? 'bottom-4 left-1/2 -translate-x-1/2'
              : orientation === 'landscape-right'
              ? 'right-4 top-1/2 -translate-y-1/2'
              : 'left-4 top-1/2 -translate-y-1/2'
          }`}
        >
          Retake Photo
        </button>
      )}

      {/* Hidden Canvas for Image Capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
