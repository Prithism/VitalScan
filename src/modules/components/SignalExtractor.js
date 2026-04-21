import { useState, useCallback, useRef, useEffect } from 'react';

// Production-grade signal extractor for scleral PPG
// Optimized for 60fps with rolling ring buffer and AC/DC decomposition
// Uses Python backend for advanced signal processing (bandpass, motion artifact removal, Savitzky-Golay)

const API_URL = 'http://localhost:8000';

export function useSignalExtractor() {
  const [signalData, setSignalData] = useState(null);
  const [rawSignal, setRawSignal] = useState([]);
  const [filteredSignal, setFilteredSignal] = useState([]);
  const [comparisonPlot, setComparisonPlot] = useState(null);
  const [detrendedSignal, setDetrendedSignal] = useState([]);
  const [acComponent, setAcComponent] = useState([]);
  const [dcComponent, setDcComponent] = useState([]);
  const [signalQuality, setSignalQuality] = useState('none');
  const [signalStats, setSignalStats] = useState(null);
  const [processingState, setProcessingState] = useState('idle');
  const [backendError, setBackendError] = useState(null);

  // Ring buffer configuration
  const samplingRateRef = useRef(60); // 60fps target
  const bufferCapacityRef = useRef(60 * 60); // 60 seconds at 60fps = 3600 samples
  const signalBufferRef = useRef(new Float32Array(bufferCapacityRef.current));
  const bufferHeadRef = useRef(0);
  const bufferCountRef = useRef(0);
  
  // DC component tracking (rolling mean)
  const dcWindowRef = useRef(30); // 0.5 second window for DC tracking
  const dcBufferRef = useRef(new Float32Array(dcWindowRef.current));
  const dcHeadRef = useRef(0);
  const dcSumRef = useRef(0);
  
  // Signal statistics
  const lastSignalValueRef = useRef(null);
  const signalVarianceRef = useRef(0);
  const minSignalRef = useRef(Infinity);
  const maxSignalRef = useRef(-Infinity);
  
  // Performance monitoring
  const frameTimeHistoryRef = useRef([]);
  const lastFrameTimeRef = useRef(0);

  // Extract green signal from frame using Canvas 2D
  const extractSignal = useCallback((frameData, scleralROI) => {
    if (!frameData || !scleralROI) return null;

    const startTime = performance.now();
    const { width, height, data } = frameData;

    // Extract green pixels from nasal and temporal scleral regions
    let sumG = 0;
    let pixelCount = 0;

    // Process nasal region
    if (scleralROI.nasal) {
      const { x, y, width: w, height: h } = scleralROI.nasal;
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          const idx = (py * width + px) * 4;
          if (idx + 1 < data.length) {
            sumG += data[idx + 1]; // Green channel
            pixelCount++;
          }
        }
      }
    }

    // Process temporal region
    if (scleralROI.temporal) {
      const { x, y, width: w, height: h } = scleralROI.temporal;
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          const idx = (py * width + px) * 4;
          if (idx + 1 < data.length) {
            sumG += data[idx + 1]; // Green channel
            pixelCount++;
          }
        }
      }
    }

    if (pixelCount === 0) return null;

    // Compute mean green intensity
    const meanGreen = sumG / pixelCount;

    // Update performance metrics
    const frameTime = performance.now() - startTime;
    updateFrameTimeMetrics(frameTime);

    // Update ring buffer
    updateRingBuffer(meanGreen);

    // Update DC component tracking
    updateDCComponent(meanGreen);

    // Calculate AC component
    const dcValue = getDCComponent();
    const acValue = meanGreen - dcValue;

    // Update statistics
    updateSignalStats(meanGreen);

    // Create signal data object
    const extractedSignal = {
      timestamp: Date.now(),
      greenSignal: meanGreen,
      acComponent: acValue,
      dcComponent: dcValue,
      buffer: getBufferSnapshot(),
      stats: getSignalStats(),
      frameTime: frameTime,
    };

    setSignalData(extractedSignal);
    setSignalQuality(extractedSignal.stats.quality);

    lastSignalValueRef.current = meanGreen;

    return extractedSignal;
  }, []);

  // Update ring buffer with new sample
  const updateRingBuffer = useCallback((value) => {
    const buffer = signalBufferRef.current;
    const head = bufferHeadRef.current;
    const count = bufferCountRef.current;
    const capacity = bufferCapacityRef.current;

    // Write new value
    buffer[head] = value;

    // Update head and count
    bufferHeadRef.current = (head + 1) % capacity;
    bufferCountRef.current = Math.min(count + 1, capacity);

    // Update raw signal array (for React state)
    setRawSignal(prev => {
      const newSignal = [...prev, value];
      // Keep only last 3600 samples (60 seconds)
      if (newSignal.length > capacity) {
        return newSignal.slice(-capacity);
      }
      return newSignal;
    });
  }, []);

  // Update DC component (rolling mean)
  const updateDCComponent = useCallback((value) => {
    const windowSize = dcWindowRef.current;
    const buffer = dcBufferRef.current;
    const head = dcHeadRef.current;
    let sum = dcSumRef.current;

    // Remove oldest value from sum
    sum -= buffer[head];
    
    // Add new value
    buffer[head] = value;
    sum += value;
    
    // Update head
    dcHeadRef.current = (head + 1) % windowSize;
    dcSumRef.current = sum;

    // Update DC component state
    setDcComponent(prev => {
      const newDC = [...prev, sum / windowSize];
      if (newDC.length > 3600) {
        return newDC.slice(-3600);
      }
      return newDC;
    });
  }, []);

  // Get DC component
  const getDCComponent = useCallback(() => {
    const windowSize = dcWindowRef.current;
    const buffer = dcBufferRef.current;
    const count = Math.min(bufferCountRef.current, windowSize);
    
    if (count === 0) return 0;
    
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += buffer[i];
    }
    
    return sum / count;
  }, []);

  // Get AC component
  const getACComponent = useCallback(() => {
    if (lastSignalValueRef.current === null || dcComponent.length === 0) return 0;
    return lastSignalValueRef.current - dcComponent[dcComponent.length - 1];
  }, [dcComponent]);

  // Get buffer snapshot
  const getBufferSnapshot = useCallback(() => {
    const buffer = signalBufferRef.current;
    const count = bufferCountRef.current;
    const head = bufferHeadRef.current;
    const capacity = bufferCapacityRef.current;

    if (count === 0) return [];

    // Return samples in chronological order
    if (count < capacity) {
      return Array.from(buffer.slice(0, count));
    } else {
      // Circular buffer: head points to oldest, so read from head to end, then 0 to head
      const result = new Float32Array(count);
      const firstPart = capacity - head;
      
      if (firstPart > 0) {
        result.set(buffer.slice(head), 0);
      }
      if (head > 0) {
        result.set(buffer.slice(0, head), firstPart);
      }
      
      return Array.from(result);
    }
  }, []);

  // Update signal statistics
  const updateSignalStats = useCallback((value) => {
    // Update min/max
    minSignalRef.current = Math.min(minSignalRef.current, value);
    maxSignalRef.current = Math.max(maxSignalRef.current, value);

    // Update variance
    if (lastSignalValueRef.current !== null) {
      const diff = value - lastSignalValueRef.current;
      signalVarianceRef.current = 0.95 * signalVarianceRef.current + 0.05 * diff * diff;
    }

    // Update quality
    const range = maxSignalRef.current - minSignalRef.current;
    const variance = signalVarianceRef.current;
    
    let quality = 'poor';
    if (range > 5 && variance > 10) quality = 'good';
    if (range > 10 && variance > 25) quality = 'excellent';
    
    setSignalQuality(quality);
  }, []);

  // Get signal statistics
  const getSignalStats = useCallback(() => {
    const buffer = signalBufferRef.current;
    const count = bufferCountRef.current;
    
    if (count === 0) {
      return {
        mean: 0,
        variance: 0,
        min: 0,
        max: 0,
        range: 0,
        quality: 'none',
      };
    }

    // Calculate statistics from buffer
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < count; i++) {
      const value = buffer[i];
      sum += value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    const mean = sum / count;
    let variance = 0;
    for (let i = 0; i < count; i++) {
      variance += Math.pow(buffer[i] - mean, 2);
    }
    variance /= count;

    const range = max - min;

    // Quality assessment
    let quality = 'poor';
    if (range > 5 && variance > 10) quality = 'good';
    if (range > 10 && variance > 25) quality = 'excellent';

    return {
      mean,
      variance,
      min,
      max,
      range,
      quality,
      count,
    };
  }, []);

  // Detrend signal using moving average subtraction
  const detrendSignal = useCallback((signalBuffer, windowSize = 30) => {
    if (!signalBuffer || signalBuffer.length === 0) return [];

    const detrended = [];
    const window = Math.min(windowSize, signalBuffer.length);

    for (let i = 0; i < signalBuffer.length; i++) {
      // Calculate local mean (DC component)
      const start = Math.max(0, i - window + 1);
      const localWindow = signalBuffer.slice(start, i + 1);
      const localMean = localWindow.reduce((a, b) => a + b, 0) / localWindow.length;

      // Detrended = raw - DC
      detrended.push(signalBuffer[i] - localMean);
    }

    setDetrendedSignal(detrended);
    return detrended;
  }, []);

  // AC/DC decomposition
  const decomposeSignal = useCallback((signalBuffer) => {
    if (!signalBuffer || signalBuffer.length === 0) return null;

    // DC component: low-pass filtered signal (moving average)
    const dcWindow = 30; // ~0.5 seconds at 60fps
    const dc = [];
    
    for (let i = 0; i < signalBuffer.length; i++) {
      const start = Math.max(0, i - dcWindow + 1);
      const window = signalBuffer.slice(start, i + 1);
      dc.push(window.reduce((a, b) => a + b, 0) / window.length);
    }

    // AC component: raw - DC
    const ac = signalBuffer.map((v, i) => v - dc[i]);

    setDcComponent(dc);
    setAcComponent(ac);

    return { ac, dc };
  }, []);

  // Process signal using Python backend for advanced filtering
  const processSignalWithBackend = useCallback(async (signalBuffer) => {
    try {
      setProcessingState('processing');
      setBackendError(null);

      const response = await fetch(`${API_URL}/process-signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw_signal: signalBuffer,
          sample_rate: samplingRateRef.current,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }

      const data = await response.json();
      setFilteredSignal(data.filtered_signal);
      setComparisonPlot(data.raw_vs_filtered_b64);
      
      setProcessingState('idle');
      return data;
    } catch (error) {
      console.error('Signal processing backend error:', error);
      setBackendError(error.message);
      setProcessingState('idle');
      return null;
    }
  }, []);

  // Process signal for analysis
  const processSignal = useCallback(async () => {
    setProcessingState('processing');

    // Wait for signal buffer to fill
    await new Promise(resolve => setTimeout(resolve, 500));

    const buffer = getBufferSnapshot();
    
    if (buffer.length < 60) { // Minimum 1 second of data
      setSignalQuality('insufficient_data');
      setProcessingState('idle');
      return false;
    }

    // Detrend signal
    const detrended = detrendSignal(buffer, 30);

    // AC/DC decomposition
    const decomposition = decomposeSignal(buffer);

    // Calculate FFT for frequency analysis
    const fftResult = performFFT(detrended);

    // Send to Python backend for advanced filtering
    const backendResult = await processSignalWithBackend(buffer);

    setSignalStats({
      bufferLength: buffer.length,
      samplingRate: samplingRateRef.current,
      detrendedSignal: detrended,
      acComponent: decomposition?.ac,
      dcComponent: decomposition?.dc,
      fft: fftResult,
      backendResult: backendResult,
    });

    setSignalQuality('processed');
    setProcessingState('idle');

    return true;
  }, [getBufferSnapshot, detrendSignal, decomposeSignal, processSignalWithBackend]);

  // Perform FFT analysis
  const performFFT = useCallback((signal) => {
    const n = signal.length;
    if (n < 2) return null;

    // Pad to power of 2
    const paddedSize = Math.pow(2, Math.ceil(Math.log2(n)));
    const paddedSignal = new Float32Array(paddedSize);
    paddedSignal.set(signal);
    
    // Compute FFT (simplified magnitude spectrum)
    const result = {
      magnitude: [],
      frequency: [],
      powerSpectrum: [],
      dominantFrequency: 0,
      totalPower: 0,
    };

    // Calculate power spectrum (DFT for key frequencies)
    const samplingRate = samplingRateRef.current;
    const frequencyResolution = samplingRate / paddedSize;

    // Focus on PPG-relevant frequencies (0.5-3 Hz)
    const minFreq = 0.5;
    const maxFreq = 3.0;
    const minIndex = Math.floor(minFreq / frequencyResolution);
    const maxIndex = Math.floor(maxFreq / frequencyResolution);

    let maxPower = 0;
    let dominantIndex = 0;

    for (let i = 0; i < paddedSize / 2; i++) {
      const freq = i * frequencyResolution;
      
      // Calculate magnitude (simplified)
      let magnitude = 0;
      for (let j = 0; j < paddedSize; j++) {
        const angle = (2 * Math.PI * i * j) / paddedSize;
        magnitude += paddedSignal[j] * Math.cos(angle);
      }
      magnitude = Math.abs(magnitude) / paddedSize;

      result.magnitude.push(magnitude);
      result.frequency.push(freq);
      result.powerSpectrum.push(magnitude * magnitude);
      result.totalPower += magnitude * magnitude;

      if (i >= minIndex && i <= maxIndex && magnitude > maxPower) {
        maxPower = magnitude;
        dominantIndex = i;
      }
    }

    result.dominantFrequency = result.frequency[dominantIndex];

    return result;
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

  // Update frame time metrics
  const updateFrameTimeMetrics = useCallback((frameTime) => {
    frameTimeHistoryRef.current.push(frameTime);
    
    if (frameTimeHistoryRef.current.length > 100) {
      frameTimeHistoryRef.current.shift();
    }
  }, []);

  // Reset signal extractor
  const reset = useCallback(() => {
    setSignalData(null);
    setRawSignal([]);
    setDetrendedSignal([]);
    setAcComponent([]);
    setDcComponent([]);
    setSignalQuality('none');
    setSignalStats(null);
    setProcessingState('idle');

    // Reset ring buffer
    signalBufferRef.current.fill(0);
    bufferHeadRef.current = 0;
    bufferCountRef.current = 0;

    // Reset DC buffer
    dcBufferRef.current.fill(0);
    dcHeadRef.current = 0;
    dcSumRef.current = 0;

    // Reset statistics
    lastSignalValueRef.current = null;
    signalVarianceRef.current = 0;
    minSignalRef.current = Infinity;
    maxSignalRef.current = -Infinity;

    // Reset frame time history
    frameTimeHistoryRef.current = [];
    lastFrameTimeRef.current = 0;
  }, []);

  // Get signal for analysis
  const getSignalForAnalysis = useCallback(() => {
    return {
      raw: rawSignal,
      filtered: filteredSignal,
      comparisonPlot: comparisonPlot,
      detrended: detrendedSignal,
      ac: acComponent,
      dc: dcComponent,
      stats: signalStats,
      quality: signalQuality,
      backendError: backendError,
    };
  }, [rawSignal, filteredSignal, comparisonPlot, detrendedSignal, acComponent, dcComponent, signalStats, signalQuality, backendError]);

  // Get buffer statistics
  const getBufferStats = useCallback(() => {
    return {
      capacity: bufferCapacityRef.current,
      count: bufferCountRef.current,
      head: bufferHeadRef.current,
      samplingRate: samplingRateRef.current,
      duration: bufferCountRef.current / samplingRateRef.current,
    };
  }, []);

  // Get current signal value
  const getCurrentSignal = useCallback(() => {
    return lastSignalValueRef.current;
  }, []);

  // Get AC/DC components
  const getACDCComponents = useCallback(() => {
    return {
      ac: acComponent,
      dc: dcComponent,
    };
  }, [acComponent, dcComponent]);

  return {
    // State
    signalData,
    rawSignal,
    filteredSignal,
    comparisonPlot,
    detrendedSignal,
    acComponent,
    dcComponent,
    signalQuality,
    signalStats,
    processingState,
    backendError,
    
    // Methods
    extractSignal,
    detrendSignal,
    decomposeSignal,
    processSignal,
    reset,
    getSignalForAnalysis,
    
    // Getters
    getBufferSnapshot,
    getSignalStats,
    getFrameTimeStats,
    getBufferStats,
    getCurrentSignal,
    getACDCComponents,
  };
}
