import { useState, useCallback, useRef, useEffect } from 'react';

export function usePulseMetrics() {
  const [heartRate, setHeartRate] = useState(null);
  const [heartRateVariability, setHeartRateVariability] = useState(null);
  const [pulseWaveform, setPulseWaveform] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [metricsHistory, setMetricsHistory] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);

  const rPeakTimestampsRef = useRef([]);
  const lastHeartRateRef = useRef(null);
  const heartRateBufferRef = useRef([]);
  const maxHeartRateBufferRef = useRef(10);
  const signalBufferRef = useRef([]);
  const samplingRateRef = useRef(30);

  // Detect R-peaks in PPG signal
  const detectRPeaks = useCallback((signal, samplingRate) => {
    const peaks = [];
    const threshold = calculateAdaptiveThreshold(signal);

    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] > signal[i - 1] && 
          signal[i] > signal[i + 1] && 
          signal[i] > threshold) {
        peaks.push({ index: i, value: signal[i], timestamp: i / samplingRate });
      }
    }

    // Filter peaks based on physiological constraints
    const validPeaks = filterPeaksByPhysiology(peaks, samplingRate);

    rPeakTimestampsRef.current = validPeaks.map(p => p.timestamp);
    return validPeaks;
  }, []);

  // Calculate adaptive threshold
  const calculateAdaptiveThreshold = useCallback((signal) => {
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const stdDev = Math.sqrt(
      signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length
    );
    return mean + 0.5 * stdDev;
  }, []);

  // Filter peaks by physiological constraints
  const filterPeaksByPhysiology = useCallback((peaks, samplingRate) => {
    const minHeartRate = 0.5; // 30 BPM
    const maxHeartRate = 3.0; // 180 BPM
    const minInterval = 1 / maxHeartRate;
    const maxInterval = 1 / minHeartRate;

    const validPeaks = [];
    let lastPeakTime = -maxInterval;

    for (const peak of peaks) {
      const interval = peak.timestamp - lastPeakTime;

      if (interval >= minInterval && interval <= maxInterval) {
        validPeaks.push(peak);
        lastPeakTime = peak.timestamp;
      }
    }

    return validPeaks;
  }, []);

  // Calculate heart rate from R-peaks
  const calculateHeartRate = useCallback((peaks) => {
    if (peaks.length < 2) return null;

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i].timestamp - peaks[i - 1].timestamp);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const heartRateBPM = 60 / avgInterval;

    return heartRateBPM;
  }, []);

  // Calculate heart rate variability (RMSSD)
  const calculateHRV = useCallback((peaks) => {
    if (peaks.length < 3) return null;

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i].timestamp - peaks[i - 1].timestamp);
    }

    // Calculate differences between consecutive intervals
    const diff = [];
    for (let i = 1; i < intervals.length; i++) {
      diff.push(intervals[i] - intervals[i - 1]);
    }

    // Calculate RMSSD
    const squaredDiff = diff.map(d => d * d);
    const meanSquaredDiff = squaredDiff.reduce((a, b) => a + b, 0) / squaredDiff.length;
    const rmssd = Math.sqrt(meanSquaredDiff);

    return {
      rmssd,
      sdnn: calculateSDNN(intervals),
      pnn50: calculatePNN50(intervals),
    };
  }, []);

  // Calculate SDNN (standard deviation of NN intervals)
  const calculateSDNN = useCallback((intervals) => {
    if (intervals.length === 0) return 0;

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
    return Math.sqrt(variance);
  }, []);

  // Calculate pNN50 (percentage of adjacent intervals differing by more than 50ms)
  const calculatePNN50 = useCallback((intervals) => {
    if (intervals.length < 2) return 0;

    let count = 0;
    for (let i = 1; i < intervals.length; i++) {
      if (Math.abs(intervals[i] - intervals[i - 1]) > 0.05) {
        count++;
      }
    }

    return (count / (intervals.length - 1)) * 100;
  }, []);

  // Calculate pulse wave morphology features
  const calculatePulseMorphology = useCallback((signal, peaks, samplingRate) => {
    if (peaks.length < 2) return null;

    const morphology = {
      systolicPeakAmplitude: 0,
      diastolicPeakAmplitude: 0,
      pulseAmplitude: 0,
      riseTime: 0,
      decayTime: 0,
    };

    // Calculate average pulse waveform
    const pulseWidth = Math.floor(samplingRate * 0.8); // 800ms
    const pulseSum = new Array(pulseWidth).fill(0);
    const pulseCount = new Array(pulseWidth).fill(0);

    for (let i = 0; i < peaks.length - 1; i++) {
      const start = Math.max(0, peaks[i].index - Math.floor(pulseWidth / 2));
      const end = Math.min(signal.length, start + pulseWidth);

      for (let j = start; j < end; j++) {
        const relativeIndex = j - start;
        if (relativeIndex < pulseWidth) {
          pulseSum[relativeIndex] += signal[j];
          pulseCount[relativeIndex]++;
        }
      }
    }

    // Calculate average pulse
    const avgPulse = pulseSum.map((sum, i) => sum / Math.max(pulseCount[i], 1));

    // Find systolic and diastolic peaks in average pulse
    let maxAmplitude = 0;
    let systolicIndex = 0;
    let diastolicIndex = avgPulse.length - 1;

    for (let i = 0; i < avgPulse.length; i++) {
      if (avgPulse[i] > maxAmplitude) {
        maxAmplitude = avgPulse[i];
        systolicIndex = i;
      }
    }

    for (let i = systolicIndex; i < avgPulse.length; i++) {
      if (avgPulse[i] < maxAmplitude * 0.8) {
        diastolicIndex = i;
        break;
      }
    }

    morphology.systolicPeakAmplitude = avgPulse[systolicIndex];
    morphology.diastolicPeakAmplitude = avgPulse[diastolicIndex];
    morphology.pulseAmplitude = maxAmplitude - avgPulse[0];
    morphology.riseTime = systolicIndex / samplingRate;
    morphology.decayTime = (diastolicIndex - systolicIndex) / samplingRate;

    setPulseWaveform(avgPulse);

    return morphology;
  }, []);

  // Calculate confidence score
  const calculateConfidence = useCallback((heartRate, peaks, signalQuality) => {
    if (!heartRate || peaks.length < 3) return 0;

    let confidence = 0;

    // Heart rate plausibility (60-100 BPM is normal range)
    if (heartRate >= 60 && heartRate <= 100) {
      confidence += 0.4;
    } else if (heartRate >= 40 && heartRate <= 120) {
      confidence += 0.2;
    }

    // Peak consistency
    if (peaks.length >= 5) {
      confidence += 0.3;
    }

    // Signal quality
    if (signalQuality === 'excellent') {
      confidence += 0.3;
    } else if (signalQuality === 'good') {
      confidence += 0.2;
    } else if (signalQuality === 'fair') {
      confidence += 0.1;
    }

    return Math.min(1, confidence);
  }, []);

  // Update metrics history
  const updateMetricsHistory = useCallback((heartRate, hrv, confidence) => {
    const historyEntry = {
      timestamp: Date.now(),
      heartRate,
      hrv,
      confidence,
    };

    setMetricsHistory(prev => {
      const newHistory = [...prev, historyEntry];
      if (newHistory.length > 100) {
        return newHistory.slice(-100);
      }
      return newHistory;
    });
  }, []);

  // Process signal and calculate metrics
  const processSignal = useCallback(async (signal, samplingRate = 30, signalQuality = 'good') => {
    setIsCalculating(true);
    samplingRateRef.current = samplingRate;

    // Detect R-peaks
    const peaks = detectRPeaks(signal, samplingRate);

    if (peaks.length < 2) {
      setIsCalculating(false);
      return null;
    }

    // Calculate heart rate
    const heartRateBPM = calculateHeartRate(peaks);
    
    if (!heartRateBPM) {
      setIsCalculating(false);
      return null;
    }

    // Calculate HRV
    const hrv = calculateHRV(peaks);

    // Calculate pulse morphology
    const morphology = calculatePulseMorphology(signal, peaks, samplingRate);

    // Calculate confidence
    const confidenceScore = calculateConfidence(heartRateBPM, peaks, signalQuality);

    // Update heart rate buffer
    heartRateBufferRef.current.push(heartRateBPM);
    if (heartRateBufferRef.current.length > maxHeartRateBufferRef.current) {
      heartRateBufferRef.current.shift();
    }

    // Update state
    setHeartRate(heartRateBPM);
    setHeartRateVariability(hrv);
    setConfidence(confidenceScore);

    updateMetricsHistory(heartRateBPM, hrv, confidenceScore);

    setIsCalculating(false);

    return {
      heartRate: heartRateBPM,
      hrv,
      morphology,
      confidence: confidenceScore,
      peaks,
    };
  }, [detectRPeaks, calculateHeartRate, calculateHRV, calculatePulseMorphology, calculateConfidence, updateMetricsHistory]);

  // Get average heart rate
  const getAverageHeartRate = useCallback(() => {
    if (heartRateBufferRef.current.length === 0) return null;
    return heartRateBufferRef.current.reduce((a, b) => a + b, 0) / heartRateBufferRef.current.length;
  }, []);

  // Get recent heart rate trend
  const getHeartRateTrend = useCallback(() => {
    if (metricsHistory.length < 3) return 'stable';

    const recent = metricsHistory.slice(-5);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));

    const avgFirst = firstHalf.reduce((sum, m) => sum + m.heartRate, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, m) => sum + m.heartRate, 0) / secondHalf.length;

    const diff = avgSecond - avgFirst;

    if (Math.abs(diff) < 2) return 'stable';
    if (diff > 0) return 'increasing';
    return 'decreasing';
  }, [metricsHistory]);

  // Reset metrics
  const reset = useCallback(() => {
    setHeartRate(null);
    setHeartRateVariability(null);
    setPulseWaveform(null);
    setConfidence(0);
    setMetricsHistory([]);
    rPeakTimestampsRef.current = [];
    lastHeartRateRef.current = null;
    heartRateBufferRef.current = [];
    signalBufferRef.current = [];
  }, []);

  return {
    heartRate,
    heartRateVariability,
    pulseWaveform,
    confidence,
    metricsHistory,
    isCalculating,
    processSignal,
    getAverageHeartRate,
    getHeartRateTrend,
    reset,
  };
}
