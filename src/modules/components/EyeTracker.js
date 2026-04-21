import { useState, useCallback, useRef, useEffect } from 'react';

// MediaPipe Iris eye tracker for real-time scleral PPG
// Optimized for browser performance with frame-to-frame tracking

export function useEyeTracker() {
  const [isTracking, setIsTracking] = useState(false);
  const [eyeData, setEyeData] = useState(null);
  const [landmarks, setLandmarks] = useState(null);
  const [irisMesh, setIrisMesh] = useState(null);
  const [quality, setQuality] = useState('none');
  const [error, setError] = useState(null);

  // MediaPipe Iris instance
  const mediaPipeRef = useRef(null);
  
  // Tracking state
  const lastFrameResultsRef = useRef(null);
  const frameCountRef = useRef(0);
  const lastValidIrisCenterRef = useRef(null);
  
  // Motion tracking
  const motionHistoryRef = useRef([]);
  const maxMotionHistoryRef = useRef(30);
  const motionThresholdRef = useRef(15); // pixels
  
  // Performance monitoring
  const frameTimeHistoryRef = useRef([]);
  const lastFrameTimeRef = useRef(0);

  // Initialize MediaPipe Iris
  const initializeMediaPipe = useCallback(async () => {
    try {
      // MediaPipe Iris is not available as npm package
      // This would require loading from CDN or using a different approach
      console.warn('MediaPipe Iris is not available as npm package');
      setError('MediaPipe Iris is not available as npm package. Please use a different eye tracking approach.');
      return false;
    } catch (err) {
      console.error('MediaPipe initialization error:', err);
      setError('Failed to initialize MediaPipe Iris: ' + err.message);
      return false;
    }
  }, []);

  // Process video frame with MediaPipe Iris
  const processFrame = useCallback(async (imageData) => {
    if (!mediaPipeRef.current || !imageData) return null;

    const startTime = performance.now();
    frameCountRef.current++;

    try {
      const results = await mediaPipeRef.current.send({
        image: imageData,
      });

      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const faceLandmarks = results.faceLandmarks[0];
        const irisLandmarks = results.irisLandmarks ? results.irisLandmarks[0] : null;

        // Extract comprehensive eye data
        const eyeData = extractEyeData(faceLandmarks, irisLandmarks);
        
        // Calculate motion score
        const motionScore = calculateMotionScore(eyeData);
        
        // Reject frames with excessive movement
        if (motionScore > motionThresholdRef.current) {
          return null;
        }

        // Update tracking state
        lastFrameResultsRef.current = eyeData;
        lastValidIrisCenterRef.current = eyeData.irisCenter;

        // Update performance metrics
        const frameTime = performance.now() - startTime;
        updateFrameTimeMetrics(frameTime);

        setEyeData(eyeData);
        setLandmarks(faceLandmarks);
        setIrisMesh(irisLandmarks);
        setQuality(getQualityScore(eyeData));

        return eyeData;
      }

      return null;
    } catch (err) {
      console.error('Eye tracking error:', err);
      setError(err.message);
      return null;
    }
  }, []);

  // Extract comprehensive eye data from MediaPipe results
  const extractEyeData = useCallback((faceLandmarks, irisLandmarks) => {
    if (!faceLandmarks) return null;

    // MediaPipe Iris landmark indices for left eye
    const leftEyeIndices = [
      253, 466, 388, 384, 385, 386, 387, 388, 398, // Outer
      246, 161, 160, 159, 158, 157, 173, 172, 171, 170, 169, 168, 144, 145, 153, 154, 155, // Inner
    ];

    // MediaPipe Iris landmark indices for right eye
    const rightEyeIndices = [
      130, 243, 160, 159, 158, 157, 156, 172, 173, // Outer
      247, 253, 466, 388, 387, 386, 385, 384, 398, 397, 396, 395, 394, 380, 381, 382, 363, 364, // Inner
    ];

    // MediaPipe Iris iris landmark indices
    const irisIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

    // Calculate eye regions
    const eyeRegions = {
      left: {
        center: calculateLandmarkCentroid(faceLandmarks, leftEyeIndices),
        boundingBox: calculateBoundingBox(faceLandmarks, leftEyeIndices),
        landmarks: extractLandmarkSubset(faceLandmarks, leftEyeIndices),
      },
      right: {
        center: calculateLandmarkCentroid(faceLandmarks, rightEyeIndices),
        boundingBox: calculateBoundingBox(faceLandmarks, rightEyeIndices),
        landmarks: extractLandmarkSubset(faceLandmarks, rightEyeIndices),
      },
    };

    // Calculate iris center (weighted average of iris landmarks)
    const irisCenter = calculateIrisCenter(irisLandmarks, irisIndices);

    // Calculate eyelid landmarks (upper and lower eyelid)
    const eyelidLandmarks = {
      left: {
        upper: calculateLandmarkCentroid(faceLandmarks, [160, 159, 158, 173, 172, 171, 140, 175]),
        lower: calculateLandmarkCentroid(faceLandmarks, [144, 145, 153, 154, 155, 152, 148, 149]),
      },
      right: {
        upper: calculateLandmarkCentroid(faceLandmarks, [386, 385, 384, 398, 397, 396, 380, 381]),
        lower: calculateLandmarkCentroid(faceLandmarks, [387, 388, 398, 394, 395, 393, 382, 383]),
      },
    };

    // Calculate eye openness (distance between upper and lower eyelid)
    const leftOpenness = calculateEyeOpenness(eyelidLandmarks.left.upper, eyelidLandmarks.left.lower);
    const rightOpenness = calculateEyeOpenness(eyelidLandmarks.right.upper, eyelidLandmarks.right.lower);

    // Calculate gaze direction relative to eye center
    const gazeDirection = calculateGazeDirection(eyeRegions, irisCenter);

    return {
      eyeRegions,
      irisCenter,
      eyelidLandmarks,
      leftOpenness,
      rightOpenness,
      averageOpenness: (leftOpenness + rightOpenness) / 2,
      gazeDirection,
      timestamp: Date.now(),
    };
  }, []);

  // Calculate centroid of landmarks
  const calculateLandmarkCentroid = useCallback((landmarks, indices) => {
    if (!landmarks || indices.length === 0) return { x: 0, y: 0 };

    let sumX = 0, sumY = 0;
    let count = 0;

    indices.forEach(index => {
      if (landmarks[index]) {
        sumX += landmarks[index].x;
        sumY += landmarks[index].y;
        count++;
      }
    });

    if (count === 0) return { x: 0, y: 0 };

    return {
      x: sumX / count,
      y: sumY / count,
    };
  }, []);

  // Calculate bounding box of landmarks
  const calculateBoundingBox = useCallback((landmarks, indices) => {
    if (!landmarks || indices.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    let found = false;

    indices.forEach(index => {
      if (landmarks[index]) {
        minX = Math.min(minX, landmarks[index].x);
        minY = Math.min(minY, landmarks[index].y);
        maxX = Math.max(maxX, landmarks[index].x);
        maxY = Math.max(maxY, landmarks[index].y);
        found = true;
      }
    });

    if (!found) return { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, []);

  // Extract subset of landmarks
  const extractLandmarkSubset = useCallback((landmarks, indices) => {
    if (!landmarks) return [];
    return indices.map(i => landmarks[i]).filter(l => l !== undefined);
  }, []);

  // Calculate iris center with smoothing
  const calculateIrisCenter = useCallback((irisLandmarks, indices) => {
    if (!irisLandmarks || indices.length === 0) return { x: 0, y: 0 };

    let sumX = 0, sumY = 0;
    let count = 0;

    indices.forEach(index => {
      if (irisLandmarks[index]) {
        sumX += irisLandmarks[index].x;
        sumY += irisLandmarks[index].y;
        count++;
      }
    });

    if (count === 0) return { x: 0, y: 0 };

    return {
      x: sumX / count,
      y: sumY / count,
    };
  }, []);

  // Calculate eye openness
  const calculateEyeOpenness = useCallback((upper, lower) => {
    if (!upper || !lower) return 1;
    
    // Distance between upper and lower eyelid
    const distance = Math.sqrt(
      Math.pow(lower.x - upper.x, 2) + Math.pow(lower.y - upper.y, 2)
    );
    
    // Normalize to 0-1 range (typical range is 0.01-0.05)
    return Math.min(1, Math.max(0, distance * 20));
  }, []);

  // Calculate gaze direction
  const calculateGazeDirection = useCallback((eyeRegions, irisCenter) => {
    if (!eyeRegions || !irisCenter) return { x: 0, y: 0 };

    // Use left eye for scleral PPG
    const leftEye = eyeRegions.left;
    
    // Calculate offset from eye center to iris center
    const gazeOffset = {
      x: irisCenter.x - leftEye.center.x,
      y: irisCenter.y - leftEye.center.y,
    };

    // Normalize by eye width/height
    const normalizedGaze = {
      x: gazeOffset.x / Math.max(leftEye.boundingBox.width, 0.01),
      y: gazeOffset.y / Math.max(leftEye.boundingBox.height, 0.01),
    };

    return normalizedGaze;
  }, []);

  // Calculate motion score (frame-to-frame eye movement)
  const calculateMotionScore = useCallback((currentEyeData) => {
    if (!currentEyeData || !lastFrameResultsRef.current) return 0;

    const currentIris = currentEyeData.irisCenter;
    const lastIris = lastFrameResultsRef.current.irisCenter;

    if (!currentIris || !lastIris) return 0;

    // Calculate Euclidean distance in normalized coordinates
    const distance = Math.sqrt(
      Math.pow(currentIris.x - lastIris.x, 2) + Math.pow(currentIris.y - lastIris.y, 2)
    );

    // Convert to pixel equivalent (assuming 1280x720 frame)
    const pixelDistance = distance * 1280;

    // Update motion history
    motionHistoryRef.current.push({
      timestamp: Date.now(),
      distance: pixelDistance,
    });

    // Keep only recent history
    if (motionHistoryRef.current.length > maxMotionHistoryRef.current) {
      motionHistoryRef.current.shift();
    }

    return pixelDistance;
  }, []);

  // Update frame time metrics
  const updateFrameTimeMetrics = useCallback((frameTime) => {
    frameTimeHistoryRef.current.push(frameTime);
    
    if (frameTimeHistoryRef.current.length > 100) {
      frameTimeHistoryRef.current.shift();
    }
  }, []);

  // Get eye ROI for scleral PPG
  const getEyeROI = useCallback(() => {
    if (!eyeData || !eyeData.eyeRegions) return null;

    // Use left eye for scleral PPG (less movement artifact)
    const leftEye = eyeData.eyeRegions.left;
    
    // Add padding for robust tracking
    const paddingX = leftEye.boundingBox.width * 0.2;
    const paddingY = leftEye.boundingBox.height * 0.2;

    return {
      x: Math.max(0, leftEye.boundingBox.x - paddingX),
      y: Math.max(0, leftEye.boundingBox.y - paddingY),
      width: Math.min(1 - leftEye.boundingBox.x, leftEye.boundingBox.width + paddingX * 2),
      height: Math.min(1 - leftEye.boundingBox.y, leftEye.boundingBox.height + paddingY * 2),
    };
  }, [eyeData]);

  // Get quality score based on tracking metrics
  const getQualityScore = useCallback((data) => {
    if (!data) return 'none';

    const { averageOpenness, gazeDirection, irisCenter } = data;

    // Check if eyes are open enough
    if (averageOpenness < 0.2) return 'poor';

    // Check if gaze is stable
    const gazeMagnitude = Math.sqrt(gazeDirection.x ** 2 + gazeDirection.y ** 2);
    if (gazeMagnitude > 0.3) return 'fair';

    // Check if iris center is valid
    if (!irisCenter || irisCenter.x === 0 || irisCenter.y === 0) return 'poor';

    return 'good';
  }, []);

  // Draw eye landmark overlay on canvas
  const drawEyeOverlay = useCallback((ctx, eyeData, canvasWidth, canvasHeight) => {
    if (!ctx || !eyeData) return;

    const { eyeRegions, irisCenter, eyelidLandmarks } = eyeData;

    // Convert normalized coordinates to pixel coordinates
    const toPixels = (point) => ({
      x: Math.floor(point.x * canvasWidth),
      y: Math.floor(point.y * canvasHeight),
    });

    // Draw left eye bounding box
    if (eyeRegions.left.boundingBox) {
      const box = eyeRegions.left.boundingBox;
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.floor(box.x * canvasWidth),
        Math.floor(box.y * canvasHeight),
        Math.floor(box.width * canvasWidth),
        Math.floor(box.height * canvasHeight)
      );
    }

    // Draw right eye bounding box
    if (eyeRegions.right.boundingBox) {
      const box = eyeRegions.right.boundingBox;
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        Math.floor(box.x * canvasWidth),
        Math.floor(box.y * canvasHeight),
        Math.floor(box.width * canvasWidth),
        Math.floor(box.height * canvasHeight)
      );
      ctx.setLineDash([]);
    }

    // Draw iris center
    if (irisCenter) {
      const center = toPixels(irisCenter);
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw eyelid landmarks
    if (eyelidLandmarks) {
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 1;
      
      // Left eye upper eyelid
      if (eyelidLandmarks.left.upper) {
        const upper = toPixels(eyelidLandmarks.left.upper);
        ctx.beginPath();
        ctx.arc(upper.x, upper.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Left eye lower eyelid
      if (eyelidLandmarks.left.lower) {
        const lower = toPixels(eyelidLandmarks.left.lower);
        ctx.beginPath();
        ctx.arc(lower.x, lower.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  // Get motion statistics
  const getMotionStats = useCallback(() => {
    const history = motionHistoryRef.current;
    if (history.length === 0) return null;

    const distances = history.map(m => m.distance);
    const sum = distances.reduce((a, b) => a + b, 0);
    const mean = sum / distances.length;
    const variance = distances.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / distances.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean: mean,
      min: Math.min(...distances),
      max: Math.max(...distances),
      stdDev: stdDev,
      threshold: motionThresholdRef.current,
    };
  }, []);

  // Get frame time statistics
  const getFrameTimeStats = useCallback(() => {
    const history = frameTimeHistoryRef.current;
    if (history.length === 0) return null;

    const sum = history.reduce((a, b) => a + b, 0);
    const mean = sum / history.length;
    const variance = history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean: mean,
      min: Math.min(...history),
      max: Math.max(...history),
      stdDev: stdDev,
      fps: 1000 / mean,
    };
  }, []);

  // Reset eye tracker
  const reset = useCallback(() => {
    setIsTracking(false);
    setEyeData(null);
    setLandmarks(null);
    setIrisMesh(null);
    setQuality('none');
    setError(null);
    
    lastFrameResultsRef.current = null;
    frameCountRef.current = 0;
    lastValidIrisCenterRef.current = null;
    
    motionHistoryRef.current = [];
    frameTimeHistoryRef.current = [];
    lastFrameTimeRef.current = 0;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaPipeRef.current) {
        mediaPipeRef.current.close();
        mediaPipeRef.current = null;
      }
    };
  }, []);

  return {
    // State
    isTracking,
    eyeData,
    landmarks,
    irisMesh,
    quality,
    error,
    
    // Methods
    startTracking: useCallback(() => setIsTracking(true), []),
    stopTracking: useCallback(() => setIsTracking(false), []),
    processFrame,
    getEyeROI,
    reset,
    
    // Getters
    getEyeLandmarks: useCallback(() => eyeData?.eyeRegions, [eyeData]),
    getIrisCenter: useCallback(() => eyeData?.irisCenter, [eyeData]),
    motionScore: useCallback(() => {
      if (!eyeData || !lastFrameResultsRef.current) return 0;
      const currentIris = eyeData.irisCenter;
      const lastIris = lastFrameResultsRef.current.irisCenter;
      if (!currentIris || !lastIris) return 0;
      const distance = Math.sqrt(
        Math.pow(currentIris.x - lastIris.x, 2) + Math.pow(currentIris.y - lastIris.y, 2)
      );
      return distance * 1280; // Convert to pixel equivalent
    }, [eyeData]),
    
    // Drawing
    drawEyeOverlay,
    
    // Statistics
    getMotionStats,
    getFrameTimeStats,
  };
}
