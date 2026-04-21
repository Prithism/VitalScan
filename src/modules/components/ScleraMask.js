import { useState, useCallback, useRef, useEffect } from 'react';

// Scleral ROI mask construction using eye landmarks
// Generates nasal and temporal scleral masks with robust masking

export function useScleraMask() {
  const [maskData, setMaskData] = useState(null);
  const [maskCanvasRef, setMaskCanvasRef] = useState(null);
  const [isMaskActive, setIsMaskActive] = useState(false);
  const [maskQuality, setMaskQuality] = useState('none');
  const [maskRegions, setMaskRegions] = useState(null);

  const maskContextRef = useRef(null);
  const nasalMaskRef = useRef(null);
  const temporalMaskRef = useRef(null);
  const lastValidMaskRef = useRef(null);

  // Create comprehensive scleral ROI mask
  const createMask = useCallback((frameData, eyeData) => {
    if (!frameData || !eyeData || !maskCanvasRef) return null;

    const canvas = maskCanvasRef;
    const ctx = canvas.getContext('2d');

    // Set canvas size to match frame
    canvas.width = frameData.width;
    canvas.height = frameData.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get left eye data (used for scleral PPG)
    const leftEye = eyeData.eyeRegions?.left;
    const irisCenter = eyeData.irisCenter;
    const eyelidLandmarks = eyeData.elidLandmarks?.left;

    if (!leftEye || !irisCenter) {
      setMaskQuality('no_data');
      return null;
    }

    // Calculate scleral ROI
    const scleralROI = calculateScleralROI(leftEye, irisCenter, eyelidLandmarks, frameData);

    if (!scleralROI || scleralROI.valid === false) {
      setMaskQuality('invalid');
      return null;
    }

    // Draw mask overlay
    drawMaskOverlay(ctx, scleralROI, frameData.width, frameData.height);

    // Store mask data
    const maskData = {
      frameData,
      scleralROI,
      timestamp: Date.now(),
    };

    setMaskData(maskData);
    setIsMaskActive(true);
    setMaskQuality('valid');
    setMaskRegions(scleralROI);

    lastValidMaskRef.current = scleralROI;

    return scleralROI;
  }, []);

  // Update mask with new eye data
  const updateMask = useCallback((frameData, eyeData) => {
    if (!frameData || !eyeData) return null;

    const canvas = maskCanvasRef;
    const ctx = canvas.getContext('2d');

    // Clear previous mask
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get left eye data
    const leftEye = eyeData.eyeRegions?.left;
    const irisCenter = eyeData.irisCenter;
    const eyelidLandmarks = eyeData.elidLandmarks?.left;

    if (!leftEye || !irisCenter) {
      setMaskQuality('no_data');
      return null;
    }

    // Calculate scleral ROI
    const scleralROI = calculateScleralROI(leftEye, irisCenter, eyelidLandmarks, frameData);

    if (!scleralROI || scleralROI.valid === false) {
      setMaskQuality('invalid');
      return null;
    }

    // Draw mask overlay
    drawMaskOverlay(ctx, scleralROI, frameData.width, frameData.height);

    // Store mask data
    const maskData = {
      frameData,
      scleralROI,
      timestamp: Date.now(),
    };

    setMaskData(maskData);
    setMaskQuality('valid');
    setMaskRegions(scleralROI);

    lastValidMaskRef.current = scleralROI;

    return scleralROI;
  }, []);

  // Calculate scleral ROI from eye landmarks
  const calculateScleralROI = useCallback((eye, irisCenter, eyelidLandmarks, frameData) => {
    if (!eye || !irisCenter) return null;

    const { boundingBox, landmarks } = eye;
    const { width: frameWidth, height: frameHeight } = frameData;

    // Convert normalized coordinates to pixels
    const box = {
      x: Math.floor(boundingBox.x * frameWidth),
      y: Math.floor(boundingBox.y * frameHeight),
      width: Math.floor(boundingBox.width * frameWidth),
      height: Math.floor(boundingBox.height * frameHeight),
    };

    const iris = {
      x: Math.floor(irisCenter.x * frameWidth),
      y: Math.floor(irisCenter.y * frameHeight),
    };

    // Calculate iris radius (approximate from eye height)
    const irisRadius = Math.floor(box.height * 0.25);

    // Calculate eyelid positions
    const upperEyelidY = eyelidLandmarks?.upper 
      ? Math.floor(eyelidLandmarks.upper.y * frameHeight)
      : box.y;

    const lowerEyelidY = eyelidLandmarks?.lower
      ? Math.floor(eyelidLandmarks.lower.y * frameHeight)
      : box.y + box.height;

    // Define scleral regions (nasal and temporal)
    // Nasal: closer to nose (left side of left eye)
    // Temporal: closer to temple (right side of left eye)
    const centerX = box.x + box.width / 2;
    const nasalEnd = centerX - box.width * 0.2;
    const temporalStart = centerX + box.width * 0.2;

    // Create scleral ROI (eye box minus iris circle minus eyelids)
    const scleralROI = {
      // Full scleral region
      full: {
        x: box.x,
        y: Math.max(0, upperEyelidY),
        width: box.width,
        height: Math.max(0, lowerEyelidY - Math.max(0, upperEyelidY)),
      },

      // Nasal scleral mask (left portion)
      nasal: {
        x: box.x,
        y: Math.max(0, upperEyelidY),
        width: Math.floor(nasalEnd - box.x),
        height: Math.max(0, lowerEyelidY - Math.max(0, upperEyelidY)),
      },

      // Temporal scleral mask (right portion)
      temporal: {
        x: Math.floor(temporalStart),
        y: Math.max(0, upperEyelidY),
        width: Math.floor(box.x + box.width - temporalStart),
        height: Math.max(0, lowerEyelidY - Math.max(0, upperEyelidY)),
      },

      // Iris position (for exclusion)
      iris: {
        x: iris.x,
        y: iris.y,
        radius: irisRadius,
      },

      // Validity check
      valid: true,
      quality: 'good',
    };

    // Validate ROI dimensions
    if (scleralROI.nasal.width < 10 || scleralROI.nasal.height < 10) {
      scleralROI.valid = false;
      scleralROI.quality = 'too_small';
      return scleralROI;
    }

    if (scleralROI.temporal.width < 10 || scleralROI.temporal.height < 10) {
      scleralROI.valid = false;
      scleralROI.quality = 'too_small';
      return scleralROI;
    }

    // Check bounds
    if (scleralROI.nasal.x < 0 || 
        scleralROI.nasal.y < 0 || 
        scleralROI.nasal.x + scleralROI.nasal.width > frameWidth ||
        scleralROI.nasal.y + scleralROI.nasal.height > frameHeight) {
      scleralROI.valid = false;
      scleralROI.quality = 'out_of_bounds';
      return scleralROI;
    }

    return scleralROI;
  }, []);

  // Draw mask overlay on canvas
  const drawMaskOverlay = useCallback((ctx, scleralROI, frameWidth, frameHeight) => {
    if (!ctx || !scleralROI) return;

    // Draw full scleral region (semi-transparent green)
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.fillRect(
      scleralROI.full.x,
      scleralROI.full.y,
      scleralROI.full.width,
      scleralROI.full.height
    );

    // Draw border
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      scleralROI.full.x,
      scleralROI.full.y,
      scleralROI.full.width,
      scleralROI.full.height
    );

    // Draw nasal region indicator
    if (scleralROI.nasal) {
      ctx.strokeStyle = '#00cc00';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        scleralROI.nasal.x,
        scleralROI.nasal.y,
        scleralROI.nasal.width,
        scleralROI.nasal.height
      );
      ctx.setLineDash([]);

      // Label nasal region
      ctx.fillStyle = '#00ff00';
      ctx.font = '12px sans-serif';
      ctx.fillText('Nasal', scleralROI.nasal.x + 5, scleralROI.nasal.y + 15);
    }

    // Draw temporal region indicator
    if (scleralROI.temporal) {
      ctx.strokeStyle = '#00cc00';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        scleralROI.temporal.x,
        scleralROI.temporal.y,
        scleralROI.temporal.width,
        scleralROI.temporal.height
      );
      ctx.setLineDash([]);

      // Label temporal region
      ctx.fillStyle = '#00ff00';
      ctx.font = '12px sans-serif';
      ctx.fillText('Temporal', scleralROI.temporal.x + 5, scleralROI.temporal.y + 15);
    }

    // Draw iris exclusion zone
    if (scleralROI.iris) {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(
        scleralROI.iris.x,
        scleralROI.iris.y,
        scleralROI.iris.radius,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // Label iris
      ctx.fillStyle = '#ff0000';
      ctx.font = '12px sans-serif';
      ctx.fillText('Iris', scleralROI.iris.x - 10, scleralROI.iris.y - 5);
    }
  }, []);

  // Get pixel coordinates of valid ROI
  const getValidROI = useCallback(() => {
    if (!maskRegions || !maskRegions.valid) return null;

    return {
      nasal: {
        x: maskRegions.nasal.x,
        y: maskRegions.nasal.y,
        width: maskRegions.nasal.width,
        height: maskRegions.nasal.height,
      },
      temporal: {
        x: maskRegions.temporal.x,
        y: maskRegions.temporal.y,
        width: maskRegions.temporal.width,
        height: maskRegions.temporal.height,
      },
    };
  }, [maskRegions]);

  // Validate mask against frame
  const validateMask = useCallback((frameData) => {
    if (!frameData || !lastValidMaskRef.current) return false;

    const mask = lastValidMaskRef.current;

    // Check bounds
    if (mask.nasal.x < 0 || mask.nasal.y < 0 ||
        mask.nasal.x + mask.nasal.width > frameData.width ||
        mask.nasal.y + mask.nasal.height > frameData.height) {
      setMaskQuality('out_of_bounds');
      return false;
    }

    if (mask.temporal.x < 0 || mask.temporal.y < 0 ||
        mask.temporal.x + mask.temporal.width > frameData.width ||
        mask.temporal.y + mask.temporal.height > frameData.height) {
      setMaskQuality('out_of_bounds');
      return false;
    }

    // Check minimum size
    const minArea = frameData.width * frameData.height * 0.001; // 0.1% of frame
    if (mask.nasal.width * mask.nasal.height < minArea ||
        mask.temporal.width * mask.temporal.height < minArea) {
      setMaskQuality('too_small');
      return false;
    }

    setMaskQuality('valid');
    return true;
  }, []);

  // Get mask canvas context
  const getMaskContext = useCallback(() => {
    if (!maskCanvasRef) return null;
    return maskCanvasRef.getContext('2d');
  }, [maskCanvasRef]);

  // Reset mask
  const reset = useCallback(() => {
    setMaskData(null);
    setIsMaskActive(false);
    setMaskQuality('none');
    setMaskRegions(null);
    
    if (maskCanvasRef) {
      const ctx = maskCanvasRef.getContext('2d');
      ctx.clearRect(0, 0, maskCanvasRef.width, maskCanvasRef.height);
    }

    lastValidMaskRef.current = null;
  }, [maskCanvasRef]);

  // Get mask statistics
  const getMaskStats = useCallback(() => {
    if (!maskRegions) return null;

    return {
      nasalArea: maskRegions.nasal.width * maskRegions.nasal.height,
      temporalArea: maskRegions.temporal.width * maskRegions.temporal.height,
      totalArea: (maskRegions.nasal.width * maskRegions.nasal.height) +
                 (maskRegions.temporal.width * maskRegions.temporal.height),
      quality: maskRegions.quality,
      valid: maskRegions.valid,
    };
  }, [maskRegions]);

  return {
    maskCanvasRef,
    setMaskCanvasRef,
    maskData,
    isMaskActive,
    maskQuality,
    maskRegions,
    
    createMask,
    updateMask,
    getValidROI,
    validateMask,
    getMaskContext,
    reset,
    getMaskStats,
  };
}
