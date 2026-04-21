/**
 * Pulse Metrics Analyzer
 * 
 * Features:
 * - Systolic peak detection
 * - Diastolic trough detection
 * - Pulse Index (PI) calculation
 * - Heart rate (HR) and angular frequency (ω) computation
 * - Adaptive thresholding
 * - Peak rejection for artifacts
 * - Physiological plausibility constraints
 * 
 * Output:
 * - venous_PI: Pulse Index
 * - HR: Heart rate (BPM)
 * - ω: Angular frequency (rad/s)
 */

import { useCallback, useRef, useEffect } from 'react';

// Physiological constraints
const HR_MIN = 0.5;      // 0.5 Hz = 30 BPM (minimum plausible)
const HR_MAX = 4.0;      // 4.0 Hz = 240 BPM (maximum plausible)
const PI_MIN = 0.0;      // Minimum plausible PI
const PI_MAX = 2.0;      // Maximum plausible PI (venous = 0.5-1.5, arterial = 0.3-0.8)
const MIN_PEAKS = 3;     // Minimum peaks for valid measurement
const PEAK_INTERVAL_MIN = 0.25; // 0.25s = 240 BPM (minimum interval)
const PEAK_INTERVAL_MAX = 2.0;  // 2.0s = 30 BPM (maximum interval)

/**
 * Calculate Pulse Index (PI)
 * PI = (Imax - Imin) / Imean
 * 
 * @param {number[]} signal - Filtered PPG signal
 * @returns {Object} PI calculation results
 */
export function calculatePulseIndex(signal) {
  if (signal.length === 0) {
    return { venous_PI: 0, Imax: 0, Imin: 0, Imean: 0, valid: false };
  }
  
  const Imax = Math.max(...signal);
  const Imin = Math.min(...signal);
  const Imean = signal.reduce((a, b) => a + b, 0) / signal.length;
  
  // Avoid division by zero
  const safeImean = Math.abs(Imean) < 1e-10 ? 1e-10 : Imean;
  const venous_PI = (Imax - Imin) / safeImean;
  
  // Apply physiological constraints
  const clamped_PI = Math.max(PI_MIN, Math.min(PI_MAX, venous_PI));
  
  return {
    venous_PI: clamped_PI,
    Imax,
    Imin,
    Imean,
    valid: venous_PI >= PI_MIN && venous_PI <= PI_MAX
  };
}

/**
 * Detect systolic peaks in PPG signal
 * Uses adaptive thresholding and physiological constraints
 * 
 * @param {number[]} signal - Filtered PPG signal
 * @param {number} samplingRate - Sampling rate (Hz)
 * @returns {Object[]} Array of peak objects with index, value, timestamp
 */
export function detectSystolicPeaks(signal, samplingRate = 30) {
  if (signal.length < 10) return [];
  
  // Calculate adaptive threshold
  const threshold = calculateAdaptiveThreshold(signal);
  
  // Find candidate peaks
  const candidates = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > signal[i - 1] && 
        signal[i] > signal[i + 1] && 
        signal[i] > threshold) {
      candidates.push({
        index: i,
        value: signal[i],
        timestamp: i / samplingRate
      });
    }
  }
  
  // Filter peaks by physiological constraints
  const validPeaks = filterPeaksByPhysiology(candidates, samplingRate);
  
  // Reject outliers using inter-peak interval statistics
  const finalPeaks = rejectOutlierPeaks(validPeaks, samplingRate);
  
  return finalPeaks;
}

/**
 * Detect diastolic troughs between systolic peaks
 * 
 * @param {number[]} signal - Filtered PPG signal
 * @param {Object[]} systolicPeaks - Detected systolic peaks
 * @param {number} samplingRate - Sampling rate (Hz)
 * @returns {Object[]} Array of trough objects
 */
export function detectDiastolicTroughs(signal, systolicPeaks, samplingRate = 30) {
  if (systolicPeaks.length < 2) return [];
  
  const troughs = [];
  
  for (let i = 0; i < systolicPeaks.length - 1; i++) {
    const peak1 = systolicPeaks[i];
    const peak2 = systolicPeaks[i + 1];
    
    // Find minimum between peaks (diastolic trough)
    let minVal = Infinity;
    let minIndex = -1;
    
    for (let j = peak1.index + 1; j < peak2.index; j++) {
      if (signal[j] < minVal) {
        minVal = signal[j];
        minIndex = j;
      }
    }
    
    if (minIndex !== -1) {
      troughs.push({
        index: minIndex,
        value: minVal,
        timestamp: minIndex / samplingRate,
        prePeak: peak1,
        postPeak: peak2
      });
    }
  }
  
  return troughs;
}

/**
 * Calculate adaptive threshold based on signal statistics
 * Uses sliding window approach for real-time adaptation
 * 
 * @param {number[]} signal - Input signal
 * @param {number} windowSize - Sliding window size (samples)
 * @returns {number} Adaptive threshold value
 */
export function calculateAdaptiveThreshold(signal, windowSize = 30) {
  if (signal.length < windowSize) {
    // Use full signal if too short
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const stdDev = Math.sqrt(
      signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length
    );
    return mean + 0.5 * stdDev;
  }
  
  // Sliding window approach
  const thresholds = [];
  for (let i = 0; i <= signal.length - windowSize; i++) {
    const window = signal.slice(i, i + windowSize);
    const mean = window.reduce((a, b) => a + b, 0) / windowSize;
    const stdDev = Math.sqrt(
      window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / windowSize
    );
    thresholds.push(mean + 0.5 * stdDev);
  }
  
  // Return median threshold
  thresholds.sort((a, b) => a - b);
  return thresholds[Math.floor(thresholds.length / 2)];
}

/**
 * Filter peaks by physiological constraints
 * 
 * @param {Object[]} peaks - Candidate peaks
 * @param {number} samplingRate - Sampling rate (Hz)
 * @returns {Object[]} Valid peaks
 */
export function filterPeaksByPhysiology(peaks, samplingRate) {
  if (peaks.length < 2) return peaks;
  
  const validPeaks = [];
  let lastPeakTime = -PEAK_INTERVAL_MAX;
  
  for (const peak of peaks) {
    const interval = peak.timestamp - lastPeakTime;
    
    // Check if interval is within physiological range
    if (interval >= PEAK_INTERVAL_MIN && interval <= PEAK_INTERVAL_MAX) {
      validPeaks.push(peak);
      lastPeakTime = peak.timestamp;
    }
  }
  
  return validPeaks;
}

/**
 * Reject outlier peaks using inter-peak interval statistics
 * Removes peaks that deviate significantly from the mean interval
 * 
 * @param {Object[]} peaks - Valid peaks
 * @param {number} samplingRate - Sampling rate (Hz)
 * @param {number} thresholdStdDev - Number of standard deviations for rejection
 * @returns {Object[]} Cleaned peaks
 */
export function rejectOutlierPeaks(peaks, samplingRate, thresholdStdDev = 2.0) {
  if (peaks.length < 3) return peaks;
  
  // Calculate inter-peak intervals
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push(peaks[i].timestamp - peaks[i - 1].timestamp);
  }
  
  // Calculate statistics
  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + Math.pow(b - meanInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  
  // Calculate valid interval range
  const minInterval = meanInterval - thresholdStdDev * stdDev;
  const maxInterval = meanInterval + thresholdStdDev * stdDev;
  
  // Filter peaks
  const validPeaks = [peaks[0]]; // Always keep first peak
  
  for (let i = 1; i < peaks.length; i++) {
    const interval = peaks[i].timestamp - peaks[i - 1].timestamp;
    
    if (interval >= minInterval && interval <= maxInterval) {
      validPeaks.push(peaks[i]);
    }
  }
  
  return validPeaks;
}

/**
 * Calculate heart rate from peak intervals
 * 
 * @param {Object[]} peaks - Detected peaks
 * @returns {Object} Heart rate information
 */
export function calculateHeartRate(peaks) {
  if (peaks.length < 2) {
    return { HR: 0, ω: 0, valid: false, intervals: [] };
  }
  
  // Calculate inter-peak intervals
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push(peaks[i].timestamp - peaks[i - 1].timestamp);
  }
  
  // Calculate mean interval
  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  
  // Calculate heart rate (BPM)
  const HR = 60 / meanInterval;
  
  // Calculate angular frequency (rad/s)
  const ω = (HR / 60) * 2 * Math.PI;
  
  // Check physiological plausibility
  const valid = HR >= HR_MIN * 60 && HR <= HR_MAX * 60;
  
  return {
    HR,
    ω,
    valid,
    intervals,
    meanInterval,
    stdInterval: calculateStdDeviation(intervals),
    HRV: calculateHRV(intervals)
  };
}

/**
 * Calculate standard deviation
 */
function calculateStdDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
}

/**
 * Calculate Heart Rate Variability (RMSSD)
 */
function calculateHRV(intervals) {
  if (intervals.length < 2) return 0;
  
  // Calculate differences between consecutive intervals
  const diffs = [];
  for (let i = 1; i < intervals.length; i++) {
    diffs.push(intervals[i] - intervals[i - 1]);
  }
  
  // Calculate RMSSD
  const squaredDiffs = diffs.map(d => d * d);
  const meanSquared = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
  return Math.sqrt(meanSquared);
}

/**
 * Calculate pulse morphology features
 * 
 * @param {number[]} signal - Filtered PPG signal
 * @param {Object[]} systolicPeaks - Detected systolic peaks
 * @param {Object[]} diastolicTroughs - Detected diastolic troughs
 * @param {number} samplingRate - Sampling rate (Hz)
 * @returns {Object} Morphology features
 */
export function calculatePulseMorphology(signal, systolicPeaks, diastolicTroughs, samplingRate) {
  if (systolicPeaks.length < 2 || diastolicTroughs.length < 1) {
    return {
      systolicAmplitude: 0,
      diastolicAmplitude: 0,
      pulseAmplitude: 0,
      riseTime: 0,
      decayTime: 0,
      dPdtMax: 0,
      valid: false
    };
  }
  
  // Calculate average pulse waveform
  const pulseWidth = Math.floor(samplingRate * 0.8); // 800ms
  const pulseSum = new Array(pulseWidth).fill(0);
  const pulseCount = new Array(pulseWidth).fill(0);
  
  for (let i = 0; i < systolicPeaks.length - 1; i++) {
    const start = systolicPeaks[i].index;
    const end = systolicPeaks[i + 1].index;
    const segmentLength = end - start;
    
    if (segmentLength > 0 && segmentLength <= pulseWidth * 2) {
      for (let j = start; j < end; j++) {
        const relativeIndex = Math.min(Math.floor((j - start) * pulseWidth / segmentLength), pulseWidth - 1);
        pulseSum[relativeIndex] += signal[j];
        pulseCount[relativeIndex]++;
      }
    }
  }
  
  // Calculate average pulse
  const avgPulse = pulseSum.map((sum, i) => sum / Math.max(pulseCount[i], 1));
  
  // Find systolic peak in average pulse
  let maxVal = -Infinity;
  let systolicIndex = 0;
  for (let i = 0; i < avgPulse.length; i++) {
    if (avgPulse[i] > maxVal) {
      maxVal = avgPulse[i];
      systolicIndex = i;
    }
  }
  
  // Find diastolic trough after systolic peak
  let minVal = Infinity;
  let diastolicIndex = systolicIndex;
  for (let i = systolicIndex; i < avgPulse.length; i++) {
    if (avgPulse[i] < minVal) {
      minVal = avgPulse[i];
      diastolicIndex = i;
    }
  }
  
  // Calculate morphology features
  const riseTime = (systolicIndex / pulseWidth) * 0.8; // seconds
  const decayTime = ((diastolicIndex - systolicIndex) / pulseWidth) * 0.8; // seconds
  const pulseAmplitude = maxVal - avgPulse[0];
  
  // Calculate dP/dt max (maximum rate of change)
  let dPdtMax = 0;
  for (let i = 1; i < avgPulse.length; i++) {
    const dPdt = (avgPulse[i] - avgPulse[i - 1]) * samplingRate;
    if (dPdt > dPdtMax) {
      dPdtMax = dPdt;
    }
  }
  
  return {
    systolicAmplitude: maxVal,
    diastolicAmplitude: minVal,
    pulseAmplitude,
    riseTime,
    decayTime,
    dPdtMax,
    valid: true
  };
}

/**
 * Main pulse metrics analyzer class
 */
export class PulseMetricsAnalyzer {
  constructor(samplingRate = 30, hrMin = HR_MIN, hrMax = HR_MAX) {
    this.samplingRate = samplingRate;
    this.hrMin = hrMin;
    this.hrMax = hrMax;
    
    // Signal buffer for continuous processing
    this.signalBuffer = [];
    this.bufferSize = 30 * 5; // 5 seconds at 30 Hz
    
    // Results cache
    this.lastResult = null;
    this.metricsHistory = [];
    this.metricsHistoryMax = 100;
  }
  
  /**
   * Process new signal sample
   */
  processSample(sample) {
    // Add to buffer
    this.signalBuffer.push(sample);
    
    // Keep buffer size limited
    if (this.signalBuffer.length > this.bufferSize) {
      this.signalBuffer.shift();
    }
    
    // Process when we have enough data
    if (this.signalBuffer.length >= 30) { // Minimum 1 second at 30 Hz
      this.lastResult = this.analyze(this.signalBuffer);
      
      // Update history
      if (this.lastResult && this.lastResult.HR > 0) {
        this.metricsHistory.push({
          timestamp: Date.now(),
          HR: this.lastResult.HR,
          venous_PI: this.lastResult.venous_PI,
          ω: this.lastResult.ω,
          confidence: this.lastResult.confidence
        });
        
        if (this.metricsHistory.length > this.metricsHistoryMax) {
          this.metricsHistory.shift();
        }
      }
    }
    
    return this.lastResult;
  }
  
  /**
   * Analyze full signal buffer
   */
  analyze(signal) {
    // Detect systolic peaks
    const systolicPeaks = detectSystolicPeaks(signal, this.samplingRate);
    
    // Check minimum peaks requirement
    if (systolicPeaks.length < MIN_PEAKS) {
      return {
        venous_PI: 0,
        HR: 0,
        ω: 0,
        valid: false,
        message: 'Insufficient peaks detected'
      };
    }
    
    // Detect diastolic troughs
    const diastolicTroughs = detectDiastolicTroughs(signal, systolicPeaks, this.samplingRate);
    
    // Calculate Pulse Index
    const piResult = calculatePulseIndex(signal);
    
    // Calculate heart rate
    const hrResult = calculateHeartRate(systolicPeaks);
    
    // Calculate pulse morphology
    const morphology = calculatePulseMorphology(
      signal, 
      systolicPeaks, 
      diastolicTroughs, 
      this.samplingRate
    );
    
    // Calculate confidence score
    const confidence = this.calculateConfidence(hrResult, piResult, morphology);
    
    // Apply physiological constraints
    const valid = hrResult.valid && piResult.valid && morphology.valid;
    
    return {
      venous_PI: piResult.venous_PI,
      HR: hrResult.HR,
      ω: hrResult.ω,
      HRV: hrResult.HRV,
      systolicPeaks,
      diastolicTroughs,
      morphology,
      confidence: confidence,
      valid: valid,
      intervals: hrResult.intervals,
      meanInterval: hrResult.meanInterval,
      stdInterval: hrResult.stdInterval
    };
  }
  
  /**
   * Calculate confidence score
   */
  calculateConfidence(hrResult, piResult, morphology) {
    let confidence = 0;
    
    // Heart rate plausibility (0-0.4)
    if (hrResult.valid) {
      confidence += 0.4;
    } else if (hrResult.HR >= 40 && hrResult.HR <= 120) {
      confidence += 0.2;
    }
    
    // Peak consistency (0-0.3)
    if (hrResult.intervals.length >= 5) {
      confidence += 0.2;
    }
    if (hrResult.stdInterval < 0.1) { // Low HRV is good for steady signal
      confidence += 0.1;
    }
    
    // Signal quality indicators (0-0.3)
    if (piResult.valid) {
      confidence += 0.15;
    }
    if (morphology.valid) {
      confidence += 0.15;
    }
    
    return Math.min(1, confidence);
  }
  
  /**
   * Get recent metrics history
   */
  getMetricsHistory() {
    return this.metricsHistory;
  }
  
  /**
   * Get average heart rate from history
   */
  getAverageHR() {
    if (this.metricsHistory.length === 0) return 0;
    const sum = this.metricsHistory.reduce((acc, m) => acc + m.HR, 0);
    return sum / this.metricsHistory.length;
  }
  
  /**
   * Reset analyzer
   */
  reset() {
    this.signalBuffer = [];
    this.lastResult = null;
    this.metricsHistory = [];
  }
}

/**
 * React hook for pulse metrics
 */
export function usePulseMetrics(samplingRate = 30) {
  const analyzerRef = useRef(null);
  
  // Initialize analyzer
  if (!analyzerRef.current) {
    analyzerRef.current = new PulseMetricsAnalyzer(samplingRate);
  }
  
  // Process sample
  const processSample = useCallback((sample) => {
    return analyzerRef.current.processSample(sample);
  }, []);
  
  // Analyze buffer
  const analyzeBuffer = useCallback((signal) => {
    const tempAnalyzer = new PulseMetricsAnalyzer(samplingRate);
    signal.forEach(sample => tempAnalyzer.processSample(sample));
    return tempAnalyzer.lastResult;
  }, [samplingRate]);
  
  // Get metrics history
  const getMetricsHistory = useCallback(() => {
    return analyzerRef.current.getMetricsHistory();
  }, []);
  
  // Get average HR
  const getAverageHR = useCallback(() => {
    return analyzerRef.current.getAverageHR();
  }, []);
  
  // Reset
  const reset = useCallback(() => {
    analyzerRef.current.reset();
  }, []);
  
  return {
    processSample,
    analyzeBuffer,
    getMetricsHistory,
    getAverageHR,
    reset
  };
}

// Export utility functions
export {
  calculatePulseIndex,
  detectSystolicPeaks,
  detectDiastolicTroughs,
  calculateAdaptiveThreshold,
  filterPeaksByPhysiology,
  rejectOutlierPeaks,
  calculateHeartRate,
  calculatePulseMorphology,
  HR_MIN,
  HR_MAX,
  PI_MIN,
  PI_MAX
};
