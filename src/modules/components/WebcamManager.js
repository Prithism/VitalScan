import { useState, useCallback, useRef, useEffect } from 'react';

// Browser compatibility check
const isMediaDevicesSupported = () => {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
};

// Get actual supported frame rates
const getSupportedFrameRates = async (deviceId) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    });
    
    const track = stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    
    track.stop();
    stream.getTracks().forEach(t => t.stop());
    
    return capabilities.frameRate || { min: 15, max: 30, ideal: 30 };
  } catch {
    return { min: 15, max: 30, ideal: 30 };
  }
};

export function useWebcamManager() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [error, setError] = useState(null);
  const [frameData, setFrameData] = useState(null);
  const [actualFPS, setActualFPS] = useState(0);
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const expectedFrameIntervalRef = useRef(0);
  const frameHistoryRef = useRef([]);

  // Browser compatibility check
  const checkBrowserCompatibility = useCallback(() => {
    const supported = isMediaDevicesSupported();
    
    if (!supported) {
      setError('Browser does not support media devices API');
      return false;
    }
    
    // Check for HTTPS requirement (required for camera access)
    const isSecureContext = window.isSecureContext || window.location.protocol === 'https:';
    if (!isSecureContext && window.location.hostname !== 'localhost') {
      console.warn('Camera access requires HTTPS or localhost');
    }
    
    return true;
  }, []);

  // Get available camera devices
  const getCameraDevices = useCallback(async () => {
    if (!isMediaDevicesSupported()) return [];
    
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'videoinput');
    } catch (err) {
      console.error('Error getting camera devices:', err);
      return [];
    }
  }, []);

  // Request camera with optimal settings
  const startCamera = useCallback(async () => {
    try {
      setError(null);
      frameCountRef.current = 0;
      lastFrameTimeRef.current = 0;
      frameHistoryRef.current = [];
      setDroppedFrames(0);
      setActualFPS(0);

      // Check browser compatibility first
      if (!checkBrowserCompatibility()) {
        return false;
      }

      // Get camera devices to find front camera
      const devices = await getCameraDevices();
      const frontCamera = devices.find(d => d.label.toLowerCase().includes('front')) || devices[0];

      // Request video stream with optimal settings
      const constraints = {
        video: {
          deviceId: frontCamera ? { exact: frontCamera.deviceId } : undefined,
          facingMode: 'user',
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: {
            ideal: 60,
            max: 60,
            min: 30,
          },
        },
      };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // If 60fps fails, fallback to 30fps
        if (err.name === 'OverconstrainedError') {
          console.warn('60fps not supported, falling back to 30fps');
          constraints.video.frameRate = {
            ideal: 30,
            max: 30,
            min: 15,
          };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } else {
          throw err;
        }
      }

      streamRef.current = stream;

      // Get device info
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      const capabilities = videoTrack.getCapabilities();

      setDeviceInfo({
        deviceId: videoTrack.deviceId,
        label: videoTrack.label,
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        capabilities,
      });

      // Set expected frame interval for FPS calculation
      const targetFPS = settings.frameRate || 30;
      expectedFrameIntervalRef.current = 1000 / targetFPS;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Start FPS monitoring
      startFPSMonitoring();

      setIsCameraActive(true);
      return true;
    } catch (err) {
      console.error('Camera error:', err);
      
      if (err.name === 'NotAllowedError') {
        setError('Camera access denied. Please allow camera permissions.');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found. Please connect a camera and try again.');
      } else if (err.name === 'NotReadableError') {
        setError('Camera is in use by another application.');
      } else if (err.name === 'OverconstrainedError') {
        setError('Camera does not support the required resolution or frame rate.');
      } else {
        setError(`Camera error: ${err.message}`);
      }
      
      return false;
    }
  }, [checkBrowserCompatibility, getCameraDevices]);

  // Start FPS monitoring
  const startFPSMonitoring = useCallback(() => {
    const monitorFPS = () => {
      const now = performance.now();
      const frameInterval = now - lastFrameTimeRef.current;
      
      if (lastFrameTimeRef.current > 0) {
        // Calculate actual FPS
        const actualFPSValue = 1000 / frameInterval;
        setActualFPS(actualFPSValue);

        // Detect dropped frames (interval significantly longer than expected)
        const expectedInterval = expectedFrameIntervalRef.current;
        if (frameInterval > expectedInterval * 1.5) {
          setDroppedFrames(prev => prev + 1);
        }

        // Maintain frame history for statistics
        frameHistoryRef.current.push({
          timestamp: now,
          interval: frameInterval,
          fps: actualFPSValue,
        });

        // Keep only last 100 frames
        if (frameHistoryRef.current.length > 100) {
          frameHistoryRef.current.shift();
        }
      }

      lastFrameTimeRef.current = now;
      frameCountRef.current++;

      animationFrameRef.current = requestAnimationFrame(monitorFPS);
    };

    animationFrameRef.current = requestAnimationFrame(monitorFPS);
  }, []);

  // Stop camera and cleanup
  const stopCamera = useCallback(async () => {
    // Cancel FPS monitoring
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop all video tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load();
    }

    setIsCameraActive(false);
    setFrameData(null);
    setActualFPS(0);
    setDroppedFrames(0);
    setDeviceInfo(null);
    frameCountRef.current = 0;
    lastFrameTimeRef.current = 0;
    frameHistoryRef.current = [];
  }, []);

  // Capture current frame
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Handle video not ready yet
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const frameData = {
      width: canvas.width,
      height: canvas.height,
      data: imageData.data,
      timestamp: Date.now(),
      actualFPS,
    };

    setFrameData(frameData);
    return frameData;
  }, [actualFPS]);

  // Get video dimensions
  const getVideoDimensions = useCallback(() => {
    if (!videoRef.current) return { width: 0, height: 0 };
    return {
      width: videoRef.current.videoWidth,
      height: videoRef.current.videoHeight,
    };
  }, []);

  // Get FPS statistics
  const getFPSStats = useCallback(() => {
    const history = frameHistoryRef.current;
    if (history.length === 0) return null;

    const fpsValues = history.map(f => f.fps);
    const sum = fpsValues.reduce((a, b) => a + b, 0);
    const mean = sum / fpsValues.length;
    const variance = fpsValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / fpsValues.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean: mean,
      min: Math.min(...fpsValues),
      max: Math.max(...fpsValues),
      stdDev: stdDev,
      totalFrames: frameCountRef.current,
      droppedFrames: droppedFrames,
    };
  }, [droppedFrames]);

  // Draw ROI on canvas
  const drawROI = useCallback((ctx, roi) => {
    if (!ctx || !roi) return;
    
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
    ctx.setLineDash([]);
  }, []);

  // Get stream reference
  const getStream = useCallback(() => {
    return streamRef.current;
  }, []);

  // Check if camera is running at target FPS
  const isAtTargetFPS = useCallback(() => {
    return actualFPS >= 50; // Consider 50+ FPS as meeting 60fps target
  }, [actualFPS]);

  // Permission handling
  const requestPermission = useCallback(async () => {
    if (!isMediaDevicesSupported()) {
      return { granted: false, error: 'Media devices not supported' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      return { granted: true };
    } catch (err) {
      return { granted: false, error: err.message };
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isCameraActive) {
        stopCamera();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isCameraActive, stopCamera]);

  return {
    // State
    videoRef,
    canvasRef,
    isCameraActive,
    error,
    frameData,
    actualFPS,
    droppedFrames,
    deviceInfo,
    
    // Methods
    checkBrowserCompatibility,
    getCameraDevices,
    startCamera,
    stopCamera,
    captureFrame,
    getVideoDimensions,
    drawROI,
    getStream,
    getFPSStats,
    isAtTargetFPS,
    requestPermission,
  };
}
