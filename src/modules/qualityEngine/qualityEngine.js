/**
 * Signal Quality Engine
 * 
 * Computes signal quality using multiple metrics:
 * - SNR (Signal-to-Noise Ratio)
 * - Motion score (movement artifacts)
 * - Blink ratio (occlusion detection)
 * - Spectral peak quality (cardiac signal clarity)
 * 
 * Output: qualityScore (0-100)
 * Classification: GOOD | POOR | INSUFFICIENT
 */

import { useCallback, useRef, useEffect } from 'react';

// Quality thresholds
const THRESHOLDS = {
  excellent: 80,
  good: 60,
  fair: 40,
  poor: 20
};

// Quality levels
const QUALITY_LEVELS = {
  INSUFFICIENT: 'INSUFFICIENT',
  POOR: 'POOR',
  GOOD: 'GOOD'
};

// Default weights for scoring components
const DEFAULT_WEIGHTS = {
  snr: 0.35,
  motion: 0.25,
  blink: 0.20,
  spectral: 0.20
};

/**
 * Calculate Signal-to-Noise Ratio (SNR) score
 * 
 * @param {number} snr - SNR in dB
 * @param {number} minSnr - Minimum acceptable SNR (dB)
 * @param {number} maxSnr - Maximum expected SNR (dB)
 * @returns {number} SNR score (0-1)
 */
export function calculateSnrScore(snr, minSnr = 0, maxSnr = 30) {
  if (snr <= minSnr) return 0;
  if (snr >= maxSnr) return 1;
  
  // Linear scaling with soft clipping
  return Math.min(1, Math.max(0, (snr - minSnr) / (maxSnr - minSnr)));
}

/**
 * Calculate motion score based on signal variance
 * Higher variance = more motion artifact = lower score
 * 
 * @param {number[]} signal - Input signal
 * @param {number} referenceVariance - Expected variance for stable signal
 * @returns {number} Motion score (0-1)
 */
export function calculateMotionScore(signal, referenceVariance = 10) {
  if (signal.length < 10) return 0.5;
  
  // Calculate signal variance
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
  
  // Score based on variance (lower variance = better)
  // Using exponential decay for non-linear scoring
  const score = Math.exp(-variance / (2 * referenceVariance));
  
  return Math.min(1, Math.max(0, score));
}

/**
 * Calculate blink ratio score
 * Detects blink artifacts in the signal
 * 
 * @param {number[]} signal - Input signal
 * @param {number} samplingRate - Sampling rate (Hz)
 * @param {number} blinkThreshold - Threshold for blink detection
 * @returns {number} Blink ratio score (0-1)
 */
export function calculateBlinkRatioScore(signal, samplingRate = 30, blinkThreshold = 0.3) {
  if (signal.length < 30) return 0.5;
  
  // Calculate signal statistics
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const stdDev = Math.sqrt(
    signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length
  );
  
  // Detect blink events (sudden drops in signal)
  let blinkCount = 0;
  const blinkDuration = Math.floor(samplingRate * 0.15); // 150ms blink duration
  
  for (let i = blinkDuration; i < signal.length - blinkDuration; i++) {
    const window = signal.slice(i - blinkDuration, i + blinkDuration);
    const windowMean = window.reduce((a, b) => a + b, 0) / window.length;
    
    // Detect blink as significant drop from local mean
    if (signal[i] < windowMean - blinkThreshold * stdDev) {
      blinkCount++;
      i += blinkDuration; // Skip next samples to avoid double counting
    }
  }
  
  // Calculate blink ratio (blinks per second)
  const signalDuration = signal.length / samplingRate;
  const blinkRatio = blinkCount / signalDuration;
  
  // Score based on blink ratio (lower is better)
  // Normal blink rate is ~15-20 per minute (0.25-0.33 per second)
  // Score decreases as blink rate increases
  const score = Math.max(0, 1 - blinkRatio / 1.0); // 1 blink/sec is max acceptable
  
  return Math.min(1, Math.max(0, score));
}

/**
 * Calculate spectral peak quality score
 * Measures clarity of cardiac spectral peak
 * 
 * @param {number[]} powerSpectrum - Power spectrum array
 * @param {number} samplingRate - Sampling rate (Hz)
 * @param {number} hrMin - Minimum heart rate (Hz)
 * @param {number} hrMax - Maximum heart rate (Hz)
 * @returns {number} Spectral peak quality score (0-1)
 */
export function calculateSpectralPeakQuality(powerSpectrum, samplingRate, hrMin = 0.5, hrMax = 4.0) {
  if (powerSpectrum.length < 10) return 0;
  
  const frequencyResolution = samplingRate / (powerSpectrum.length * 2);
  
  // Find frequency indices in HR range
  const minIndex = Math.floor(hrMin / frequencyResolution);
  const maxIndex = Math.ceil(hrMax / frequencyResolution);
  
  if (minIndex >= powerSpectrum.length || maxIndex >= powerSpectrum.length) {
    return 0;
  }
  
  // Find dominant frequency and power
  let maxPower = 0;
  let dominantIndex = minIndex;
  
  for (let i = minIndex; i <= maxIndex && i < powerSpectrum.length; i++) {
    if (powerSpectrum[i] > maxPower) {
      maxPower = powerSpectrum[i];
      dominantIndex = i;
    }
  }
  
  // Calculate background noise power (median of surrounding bins)
  const noiseIndices = [];
  for (let i = 0; i < powerSpectrum.length; i++) {
    if (i < minIndex - 10 || i > maxIndex + 10) {
      noiseIndices.push(powerSpectrum[i]);
    }
  }
  
  if (noiseIndices.length === 0) return 0;
  
  noiseIndices.sort((a, b) => a - b);
  const medianNoise = noiseIndices[Math.floor(noiseIndices.length / 2)];
  
  // Calculate spectral SNR
  const spectralSnr = maxPower / (medianNoise + 1e-10);
  
  // Calculate peak sharpness (narrower peak = better)
  const peakWidth = calculatePeakWidth(powerSpectrum, dominantIndex, frequencyResolution);
  const expectedWidth = frequencyResolution * 2; // Expected 2-bin width
  const sharpnessScore = Math.min(1, expectedWidth / peakWidth);
  
  // Calculate peak symmetry
  const symmetryScore = calculatePeakSymmetry(powerSpectrum, dominantIndex);
  
  // Combine scores
  const snrScore = Math.min(1, spectralSnr / 10); // 10 dB is good
  const qualityScore = (snrScore * 0.4 + sharpnessScore * 0.3 + symmetryScore * 0.3);
  
  return Math.min(1, Math.max(0, qualityScore));
}

/**
 * Calculate peak width at half maximum
 */
function calculatePeakWidth(powerSpectrum, peakIndex, frequencyResolution) {
  const peakPower = powerSpectrum[peakIndex];
  const halfPower = peakPower / 2;
  
  // Find left half-power point
  let leftIndex = peakIndex;
  for (let i = peakIndex; i >= 0; i--) {
    if (powerSpectrum[i] < halfPower) {
      leftIndex = i;
      break;
    }
  }
  
  // Find right half-power point
  let rightIndex = peakIndex;
  for (let i = peakIndex; i < powerSpectrum.length; i++) {
    if (powerSpectrum[i] < halfPower) {
      rightIndex = i;
      break;
    }
  }
  
  return (rightIndex - leftIndex) * frequencyResolution;
}

/**
 * Calculate peak symmetry score
 */
function calculatePeakSymmetry(powerSpectrum, peakIndex) {
  if (peakIndex < 2 || peakIndex >= powerSpectrum.length - 2) return 0.5;
  
  // Compare left and right sides of peak
  const leftPower = powerSpectrum[peakIndex - 1] + powerSpectrum[peakIndex - 2];
  const rightPower = powerSpectrum[peakIndex + 1] + powerSpectrum[peakIndex + 2];
  
  const totalPower = leftPower + rightPower;
  if (totalPower === 0) return 0.5;
  
  const symmetry = Math.min(leftPower, rightPower) / Math.max(leftPower, rightPower);
  
  return symmetry;
}

/**
 * Calculate motion score from peak intervals
 * Detects motion artifacts from irregular heart rate patterns
 * 
 * @param {number[]} intervals - Inter-peak intervals (seconds)
 * @returns {number} Motion score (0-1)
 */
export function calculateMotionFromIntervals(intervals) {
  if (intervals.length < 3) return 0.5;
  
  // Calculate interval statistics
  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + Math.pow(b - meanInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  
  // Calculate coefficient of variation (normalized std dev)
  const cv = stdDev / meanInterval;
  
  // Score based on CV (lower = more stable = better)
  // Normal HRV CV is ~0.1-0.15 for steady state
  const score = Math.max(0, 1 - cv / 0.5); // 0.5 CV is max acceptable
  
  return Math.min(1, Math.max(0, score));
}

/**
 * Main Quality Engine class
 */
export class QualityEngine {
  constructor(weights = DEFAULT_WEIGHTS, thresholds = THRESHOLDS) {
    this.weights = weights;
    this.thresholds = thresholds;
    
    // History for smoothing
    this.qualityHistory = [];
    this.historyMax = 30;
    
    // Component scores history
    this.snrHistory = [];
    this.motionHistory = [];
    this.blinkHistory = [];
    this.spectralHistory = [];
  }
  
  /**
   * Calculate overall quality score
   * 
   * @param {Object} params - Quality metrics
   * @param {number} params.snr - SNR in dB
   * @param {number[]} params.signal - Raw signal for motion/blink analysis
   * @param {number[]} params.powerSpectrum - Power spectrum for spectral analysis
   * @param {number} params.samplingRate - Sampling rate (Hz)
   * @param {number[]} params.intervals - Inter-peak intervals for motion detection
   * @returns {Object} Quality results
   */
  calculateQuality(params) {
    const {
      snr = 0,
      signal = [],
      powerSpectrum = [],
      samplingRate = 30,
      intervals = []
    } = params;
    
    // Calculate individual component scores
    const snrScore = calculateSnrScore(snr);
    const motionScore = signal.length > 0 
      ? calculateMotionScore(signal) 
      : calculateMotionFromIntervals(intervals);
    const blinkScore = calculateBlinkRatioScore(signal, samplingRate);
    const spectralScore = powerSpectrum.length > 0
      ? calculateSpectralPeakQuality(powerSpectrum, samplingRate)
      : 0;
    
    // Weighted combination
    const qualityScore = (
      snrScore * this.weights.snr +
      motionScore * this.weights.motion +
      blinkScore * this.weights.blink +
      spectralScore * this.weights.spectral
    ) * 100; // Convert to 0-100 scale
    
    // Classify quality level
    const qualityLevel = this.classifyQuality(qualityScore);
    
    // Update history
    this.updateHistory(qualityScore, snrScore, motionScore, blinkScore, spectralScore);
    
    // Calculate confidence
    const confidence = this.calculateConfidence();
    
    return {
      qualityScore: Math.round(qualityScore * 10) / 10, // Round to 1 decimal
      qualityLevel,
      components: {
        snr: Math.round(snrScore * 100),
        motion: Math.round(motionScore * 100),
        blink: Math.round(blinkScore * 100),
        spectral: Math.round(spectralScore * 100)
      },
      confidence,
      snr,
      samplingRate
    };
  }
  
  /**
   * Classify quality level
   */
  classifyQuality(score) {
    if (score >= this.thresholds.excellent) return QUALITY_LEVELS.GOOD;
    if (score >= this.thresholds.good) return QUALITY_LEVELS.GOOD;
    if (score >= this.thresholds.fair) return QUALITY_LEVELS.GOOD;
    if (score >= this.thresholds.poor) return QUALITY_LEVELS.POOR;
    return QUALITY_LEVELS.INSUFFICIENT;
  }
  
  /**
   * Update history for smoothing
   */
  updateHistory(score, snrScore, motionScore, blinkScore, spectralScore) {
    this.qualityHistory.push(score);
    this.snrHistory.push(snrScore);
    this.motionHistory.push(motionScore);
    this.blinkHistory.push(blinkScore);
    this.spectralHistory.push(spectralScore);
    
    // Trim history
    if (this.qualityHistory.length > this.historyMax) {
      this.qualityHistory.shift();
      this.snrHistory.shift();
      this.motionHistory.shift();
      this.blinkHistory.shift();
      this.spectralHistory.shift();
    }
  }
  
  /**
   * Calculate confidence based on history
   */
  calculateConfidence() {
    if (this.qualityHistory.length < 5) return 0.5;
    
    // Higher confidence with more samples and lower variance
    const mean = this.qualityHistory.reduce((a, b) => a + b, 0) / this.qualityHistory.length;
    const variance = this.qualityHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.qualityHistory.length;
    
    const confidence = Math.max(0.5, 1 - Math.sqrt(variance) / 20);
    return Math.min(1, confidence);
  }
  
  /**
   * Get smoothed quality score
   */
  getSmoothedScore() {
    if (this.qualityHistory.length === 0) return 0;
    return this.qualityHistory.reduce((a, b) => a + b, 0) / this.qualityHistory.length;
  }
  
  /**
   * Get component averages
   */
  getComponentAverages() {
    return {
      snr: this.snrHistory.length > 0 
        ? this.snrHistory.reduce((a, b) => a + b, 0) / this.snrHistory.length 
        : 0,
      motion: this.motionHistory.length > 0 
        ? this.motionHistory.reduce((a, b) => a + b, 0) / this.motionHistory.length 
        : 0,
      blink: this.blinkHistory.length > 0 
        ? this.blinkHistory.reduce((a, b) => a + b, 0) / this.blinkHistory.length 
        : 0,
      spectral: this.spectralHistory.length > 0 
        ? this.spectralHistory.reduce((a, b) => a + b, 0) / this.spectralHistory.length 
        : 0
    };
  }
  
  /**
   * Get quality history
   */
  getHistory() {
    return this.qualityHistory;
  }
  
  /**
   * Reset engine
   */
  reset() {
    this.qualityHistory = [];
    this.snrHistory = [];
    this.motionHistory = [];
    this.blinkHistory = [];
    this.spectralHistory = [];
  }
}

/**
 * React hook for quality engine
 */
export function useQualityEngine() {
  const engineRef = useRef(null);
  
  // Initialize engine
  if (!engineRef.current) {
    engineRef.current = new QualityEngine();
  }
  
  // Calculate quality
  const calculateQuality = useCallback((params) => {
    return engineRef.current.calculateQuality(params);
  }, []);
  
  // Get smoothed score
  const getSmoothedScore = useCallback(() => {
    return engineRef.current.getSmoothedScore();
  }, []);
  
  // Get component averages
  const getComponentAverages = useCallback(() => {
    return engineRef.current.getComponentAverages();
  }, []);
  
  // Get history
  const getHistory = useCallback(() => {
    return engineRef.current.getHistory();
  }, []);
  
  // Reset
  const reset = useCallback(() => {
    engineRef.current.reset();
  }, []);
  
  return {
    calculateQuality,
    getSmoothedScore,
    getComponentAverages,
    getHistory,
    reset
  };
}

// Export utility functions
export {
  calculateSnrScore,
  calculateMotionScore,
  calculateBlinkRatioScore,
  calculateSpectralPeakQuality,
  calculateMotionFromIntervals,
  THRESHOLDS,
  QUALITY_LEVELS,
  DEFAULT_WEIGHTS
};
