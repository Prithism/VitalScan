/**
 * Blink Detection Module
 * 
 * Uses eyelid landmarks to detect:
 * - Eyelid closure ratio
 * - Blink events
 * - Suspicious frames
 * - Corrupted segments
 * 
 * Output:
 * - blinkRatio: Overall blink rate
 * - cleanSegments: Valid signal segments
 * - confidenceAdjustment: Quality-based confidence modifier
 * 
 * NO naive interpolation - uses robust segment rejection
 */

import { useCallback, useRef, useEffect } from 'react';

// Blink detection thresholds
const THRESHOLDS = {
  closureRatio: 0.15,        // Below this = closed eye
  blinkDurationMin: 0.1,     // Minimum blink duration (seconds)
  blinkDurationMax: 0.6,     // Maximum blink duration (seconds)
  suspiciousThreshold: 0.3,  // Above this = suspicious frame
  minCleanSegments: 3,       // Minimum segments for valid data
  segmentGapMax: 0.5,        // Maximum gap between segments (seconds)
};

// Quality weights
const QUALITY_WEIGHTS = {
  blinkRate: 0.3,
  segmentLength: 0.3,
  frameConsistency: 0.2,
  eyelidStability: 0.2,
};

/**
 * Calculate eyelid closure ratio
 * 
 * @param {Object} eyeData - Eye tracking data with eyelid landmarks
 * @returns {number} Closure ratio (0=open, 1=closed)
 */
export function calculateClosureRatio(eyeData) {
  if (!eyeData || !eyeData.eyelidLandmarks) return 1;
  
  // Use left eye for scleral PPG
  const leftEye = eyeData.eyelidLandmarks.left;
  
  if (!leftEye || !leftEye.upper || !leftEye.lower) return 1;
  
  // Calculate distance between upper and lower eyelid
  const distance = Math.sqrt(
    Math.pow(leftEye.lower.x - leftEye.upper.x, 2) +
    Math.pow(leftEye.lower.y - leftEye.upper.y, 2)
  );
  
  // Normalize: typical open eye distance is ~0.03-0.05
  // Closed eye distance is ~0.005-0.01
  const closureRatio = Math.min(1, Math.max(0, distance / 0.05));
  
  return closureRatio;
}

/**
 * Detect blink events from closure ratio time series
 * 
 * @param {number[]} closureRatios - Array of closure ratios
 * @param {number} samplingRate - Sampling rate (Hz)
 * @param {Object} thresholds - Detection thresholds
 * @returns {Object[]} Array of blink events
 */
export function detectBlinkEvents(closureRatios, samplingRate = 30, thresholds = THRESHOLDS) {
  if (closureRatios.length < 10) return [];
  
  const minFrames = Math.floor(thresholds.blinkDurationMin * samplingRate);
  const maxFrames = Math.ceil(thresholds.blinkDurationMax * samplingRate);
  const closureThreshold = thresholds.closureRatio;
  
  const blinks = [];
  let inBlink = false;
  let blinkStart = 0;
  
  for (let i = 0; i < closureRatios.length; i++) {
    const isClosed = closureRatios[i] < closureThreshold;
    
    if (isClosed && !inBlink) {
      // Start of potential blink
      inBlink = true;
      blinkStart = i;
    } else if (!isClosed && inBlink) {
      // End of potential blink
      const blinkDuration = i - blinkStart;
      
      if (blinkDuration >= minFrames && blinkDuration <= maxFrames) {
        // Valid blink
        blinks.push({
          startIndex: blinkStart,
          endIndex: i - 1,
          duration: blinkDuration / samplingRate,
          closureRatio: Math.min(...closureRatios.slice(blinkStart, i)),
          timestamp: blinkStart / samplingRate
        });
      }
      
      inBlink = false;
    }
  }
  
  // Handle blink at end of signal
  if (inBlink) {
    const blinkDuration = closureRatios.length - blinkStart;
    if (blinkDuration >= minFrames && blinkDuration <= maxFrames) {
      blinks.push({
        startIndex: blinkStart,
        endIndex: closureRatios.length - 1,
        duration: blinkDuration / samplingRate,
        closureRatio: Math.min(...closureRatios.slice(blinkStart)),
        timestamp: blinkStart / samplingRate
      });
    }
  }
  
  return blinks;
}

/**
 * Identify suspicious frames based on eyelid movement
 * 
 * @param {number[]} closureRatios - Closure ratio time series
 * @param {number} samplingRate - Sampling rate (Hz)
 * @param {number} threshold - Suspicious threshold
 * @returns {number[]} Indices of suspicious frames
 */
export function identifySuspiciousFrames(closureRatios, samplingRate = 30, threshold = THRESHOLDS.suspiciousThreshold) {
  if (closureRatios.length < 3) return [];
  
  const suspiciousIndices = [];
  
  for (let i = 1; i < closureRatios.length - 1; i++) {
    // Calculate local statistics
    const window = closureRatios.slice(Math.max(0, i - 5), Math.min(closureRatios.length, i + 6));
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const stdDev = Math.sqrt(
      window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length
    );
    
    // Flag as suspicious if:
    // 1. High closure ratio (eye closed or nearly closed)
    // 2. Rapid change in closure (fast eyelid movement)
    const currentRatio = closureRatios[i];
    const prevRatio = closureRatios[i - 1];
    const change = Math.abs(currentRatio - prevRatio) * samplingRate; // Rate of change
    
    const isSuspicious = 
      currentRatio < threshold ||  // Eye closed
      change > 0.5;                 // Rapid movement
    
    if (isSuspicious) {
      suspiciousIndices.push(i);
    }
  }
  
  return suspiciousIndices;
}

/**
 * Identify corrupted segments (blinks + suspicious frames)
 * 
 * @param {number[]} closureRatios - Closure ratio time series
 * @param {Object[]} blinks - Detected blink events
 * @param {number[]} suspiciousIndices - Indices of suspicious frames
 * @param {number} samplingRate - Sampling rate (Hz)
 * @returns {Object[]} Array of corrupted segments
 */
export function identifyCorruptedSegments(closureRatios, blinks, suspiciousIndices, samplingRate = 30) {
  const corruptedSegments = [];
  
  // Add blink segments
  blinks.forEach(blink => {
    corruptedSegments.push({
      start: blink.startIndex,
      end: blink.endIndex,
      type: 'blink',
      duration: blink.duration,
      confidence: 1 - blink.closureRatio
    });
  });
  
  // Add suspicious frame segments
  if (suspiciousIndices.length > 0) {
    let segmentStart = suspiciousIndices[0];
    let segmentEnd = suspiciousIndices[0];
    
    for (let i = 1; i < suspiciousIndices.length; i++) {
      if (suspiciousIndices[i] === segmentEnd + 1) {
        // Continuous segment
        segmentEnd = suspiciousIndices[i];
      } else {
        // End current segment, start new one
        corruptedSegments.push({
          start: segmentStart,
          end: segmentEnd,
          type: 'suspicious',
          duration: (segmentEnd - segmentStart + 1) / samplingRate,
          confidence: 0.5
        });
        segmentStart = suspiciousIndices[i];
        segmentEnd = suspiciousIndices[i];
      }
    }
    
    // Add final segment
    corruptedSegments.push({
      start: segmentStart,
      end: segmentEnd,
      type: 'suspicious',
      duration: (segmentEnd - segmentStart + 1) / samplingRate,
      confidence: 0.5
    });
  }
  
  // Sort by start index
  corruptedSegments.sort((a, b) => a.start - b.start);
  
  return corruptedSegments;
}

/**
 * Extract clean segments by rejecting corrupted ones
 * 
 * @param {number[]} signal - Original signal
 * @param {Object[]} corruptedSegments - Corrupted segment definitions
 * @param {number} samplingRate - Sampling rate (Hz)
 * @param {number} minSegmentLength - Minimum clean segment length (seconds)
 * @returns {Object[]} Array of clean segments with signal data
 */
export function extractCleanSegments(signal, corruptedSegments, samplingRate = 30, minSegmentLength = 1.0) {
  if (corruptedSegments.length === 0) {
    // No corruption - entire signal is clean
    const duration = signal.length / samplingRate;
    if (duration >= minSegmentLength) {
      return [{
        startIndex: 0,
        endIndex: signal.length - 1,
        signal: [...signal],
        duration,
        confidence: 1
      }];
    }
    return [];
  }
  
  const cleanSegments = [];
  let currentStart = 0;
  
  for (const corrupted of corruptedSegments) {
    // Check if there's a clean segment before this corruption
    if (corrupted.start > currentStart) {
      const cleanSignal = signal.slice(currentStart, corrupted.start);
      const duration = cleanSignal.length / samplingRate;
      
      if (duration >= minSegmentLength) {
        cleanSegments.push({
          startIndex: currentStart,
          endIndex: corrupted.start - 1,
          signal: cleanSignal,
          duration,
          confidence: 0.85 // High confidence for clean segments
        });
      }
    }
    
    // Move start past this corruption
    currentStart = corrupted.end + 1;
  }
  
  // Check for clean segment after last corruption
  if (currentStart < signal.length) {
    const cleanSignal = signal.slice(currentStart);
    const duration = cleanSignal.length / samplingRate;
    
    if (duration >= minSegmentLength) {
      cleanSegments.push({
        startIndex: currentStart,
        endIndex: signal.length - 1,
        signal: cleanSignal,
        duration,
        confidence: 0.85
      });
    }
  }
  
  return cleanSegments;
}

/**
 * Calculate blink ratio (blinks per minute)
 * 
 * @param {Object[]} blinks - Detected blink events
 * @param {number} totalDuration - Total signal duration (seconds)
 * @returns {number} Blink rate (blinks/minute)
 */
export function calculateBlinkRatio(blinks, totalDuration) {
  if (totalDuration <= 0) return 0;
  
  // Convert to minutes
  const durationMinutes = totalDuration / 60;
  
  // Calculate blink rate
  const blinkRate = blinks.length / durationMinutes;
  
  // Normal blink rate is 15-20 per minute
  // Cap at reasonable values
  return Math.min(60, Math.max(0, blinkRate));
}

/**
 * Calculate confidence adjustment based on blink analysis
 * 
 * @param {Object} analysis - Blink analysis results
 * @returns {number} Confidence adjustment (0-1)
 */
export function calculateConfidenceAdjustment(analysis) {
  const {
    blinkRatio = 0,
    cleanSegments = [],
    totalDuration = 0,
    blinkCount = 0
  } = analysis;
  
  if (totalDuration <= 0) return 0;
  
  // Factor 1: Blink rate (optimal is 15-20 per minute)
  let blinkScore = 1;
  if (blinkRatio < 5) {
    blinkScore = 0.5; // Too few blinks - possible eye tracking issue
  } else if (blinkRatio > 40) {
    blinkScore = 0.7; // Too many blinks - signal may be corrupted
  } else if (blinkRatio > 25) {
    blinkScore = 0.85; // Slightly elevated but acceptable
  }
  
  // Factor 2: Clean segment coverage
  const totalCleanDuration = cleanSegments.reduce((sum, s) => sum + s.duration, 0);
  const coverageRatio = totalCleanDuration / totalDuration;
  const coverageScore = Math.min(1, coverageRatio * 2); // 50% coverage = 1.0
  
  // Factor 3: Number of clean segments
  const segmentScore = Math.min(1, cleanSegments.length / 3); // 3+ segments = 1.0
  
  // Combined score
  const confidence = (
    blinkScore * QUALITY_WEIGHTS.blinkRate +
    coverageScore * QUALITY_WEIGHTS.segmentLength +
    segmentScore * QUALITY_WEIGHTS.frameConsistency
  );
  
  return Math.min(1, Math.max(0, confidence));
}

/**
 * Main Blink Detection class
 */
export class BlinkDetector {
  constructor(thresholds = THRESHOLDS) {
    this.thresholds = thresholds;
    
    // History for smoothing
    this.closureHistory = [];
    this.maxHistory = 100;
    
    // Results cache
    this.lastAnalysis = null;
  }
  
  /**
   * Process eye data and detect blinks
   * 
   * @param {Object} eyeData - Eye tracking data
   * @param {number[]} signal - Original signal
   * @param {number} samplingRate - Sampling rate (Hz)
   * @returns {Object} Blink analysis results
   */
  processEyeData(eyeData, signal, samplingRate = 30) {
    // Calculate closure ratio
    const closureRatio = calculateClosureRatio(eyeData);
    
    // Update history
    this.closureHistory.push(closureRatio);
    if (this.closureHistory.length > this.maxHistory) {
      this.closureHistory.shift();
    }
    
    // Detect blinks
    const blinks = detectBlinkEvents(this.closureHistory, samplingRate, this.thresholds);
    
    // Identify suspicious frames
    const suspiciousIndices = identifySuspiciousFrames(this.closureHistory, samplingRate);
    
    // Identify corrupted segments
    const corruptedSegments = identifyCorruptedSegments(
      this.closureHistory, 
      blinks, 
      suspiciousIndices,
      samplingRate
    );
    
    // Extract clean segments
    const cleanSegments = extractCleanSegments(
      signal, 
      corruptedSegments, 
      samplingRate,
      this.thresholds.blinkDurationMin
    );
    
    // Calculate blink ratio
    const totalDuration = this.closureHistory.length / samplingRate;
    const blinkRatio = calculateBlinkRatio(blinks, totalDuration);
    
    // Calculate confidence adjustment
    const confidenceAdjustment = calculateConfidenceAdjustment({
      blinkRatio,
      cleanSegments,
      totalDuration,
      blinkCount: blinks.length
    });
    
    // Store analysis
    this.lastAnalysis = {
      closureRatio,
      blinkRatio,
      blinkCount: blinks.length,
      blinks,
      suspiciousFrames: suspiciousIndices.length,
      corruptedSegments,
      cleanSegments,
      confidenceAdjustment,
      totalDuration,
      samplingRate
    };
    
    return this.lastAnalysis;
  }
  
  /**
   * Get last analysis results
   */
  getLastAnalysis() {
    return this.lastAnalysis;
  }
  
  /**
   * Get clean signal segments
   */
  getCleanSegments() {
    if (!this.lastAnalysis) return [];
    return this.lastAnalysis.cleanSegments;
  }
  
  /**
   * Get confidence adjustment
   */
  getConfidenceAdjustment() {
    if (!this.lastAnalysis) return 1;
    return this.lastAnalysis.confidenceAdjustment;
  }
  
  /**
   * Reset detector
   */
  reset() {
    this.closureHistory = [];
    this.lastAnalysis = null;
  }
}

/**
 * React hook for blink detection
 */
export function useBlinkDetection() {
  const detectorRef = useRef(null);
  
  // Initialize detector
  if (!detectorRef.current) {
    detectorRef.current = new BlinkDetector();
  }
  
  // Process eye data
  const processEyeData = useCallback((eyeData, signal, samplingRate = 30) => {
    return detectorRef.current.processEyeData(eyeData, signal, samplingRate);
  }, []);
  
  // Get clean segments
  const getCleanSegments = useCallback(() => {
    return detectorRef.current.getCleanSegments();
  }, []);
  
  // Get confidence adjustment
  const getConfidenceAdjustment = useCallback(() => {
    return detectorRef.current.getConfidenceAdjustment();
  }, []);
  
  // Reset
  const reset = useCallback(() => {
    detectorRef.current.reset();
  }, []);
  
  return {
    processEyeData,
    getCleanSegments,
    getConfidenceAdjustment,
    reset
  };
}

// Export utility functions
export {
  calculateClosureRatio,
  detectBlinkEvents,
  identifySuspiciousFrames,
  identifyCorruptedSegments,
  extractCleanSegments,
  calculateBlinkRatio,
  calculateConfidenceAdjustment,
  THRESHOLDS,
  QUALITY_WEIGHTS
};
