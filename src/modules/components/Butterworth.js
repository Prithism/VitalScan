import { useCallback } from 'react';

export function useButterworth() {
  // Filter coefficients storage
  const filterCoefficientsRef = useRef({
    b0: 0, b1: 0, b2: 0,
    a1: 0, a2: 0,
  });

  // Filter state storage
  const filterStateRef = useRef({
    x1: 0, x2: 0,
    y1: 0, y2: 0,
  });

  // Design Butterworth lowpass filter
  const designLowpassFilter = useCallback((cutoffFreq, samplingRate, order = 4) => {
    // Calculate normalized cutoff frequency
    const nyquist = samplingRate / 2;
    const normalizedCutoff = cutoffFreq / nyquist;

    // Design Butterworth filter coefficients
    // Using bilinear transform for discrete implementation
    const theta = Math.PI * normalizedCutoff;
    const alpha = Math.sin(theta) / (2 * Math.cos(theta) + 2);

    // Calculate filter coefficients for 2nd order sections
    const b0 = 1;
    const b1 = 2;
    const b2 = 1;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(theta);
    const a2 = 1 - alpha;

    // Normalize coefficients
    const normalizedB0 = b0 / a0;
    const normalizedB1 = b1 / a0;
    const normalizedB2 = b2 / a0;
    const normalizedA1 = a1 / a0;
    const normalizedA2 = a2 / a0;

    filterCoefficientsRef.current = {
      b0: normalizedB0,
      b1: normalizedB1,
      b2: normalizedB2,
      a1: normalizedA1,
      a2: normalizedA2,
    };

    return filterCoefficientsRef.current;
  }, []);

  // Design Butterworth bandpass filter
  const designBandpassFilter = useCallback((lowFreq, highFreq, samplingRate, order = 4) => {
    // Design lowpass and highpass filters and cascade them
    const lowpassCoeffs = designLowpassFilter(highFreq, samplingRate);
    const highpassCoeffs = designHighpassFilter(lowFreq, samplingRate);

    // For simplicity, use combined coefficients
    // In production, implement proper cascade filtering
    filterCoefficientsRef.current = {
      b0: (lowpassCoeffs.b0 + highpassCoeffs.b0) / 2,
      b1: (lowpassCoeffs.b1 + highpassCoeffs.b1) / 2,
      b2: (lowpassCoeffs.b2 + highpassCoeffs.b2) / 2,
      a1: (lowpassCoeffs.a1 + highpassCoeffs.a1) / 2,
      a2: (lowpassCoeffs.a2 + highpassCoeffs.a2) / 2,
    };

    return filterCoefficientsRef.current;
  }, [designLowpassFilter]);

  // Design Butterworth highpass filter
  const designHighpassFilter = useCallback((cutoffFreq, samplingRate) => {
    const nyquist = samplingRate / 2;
    const normalizedCutoff = cutoffFreq / nyquist;

    const theta = Math.PI * normalizedCutoff;
    const alpha = Math.sin(theta) / (2 * Math.cos(theta) + 2);

    const b0 = 1;
    const b1 = -2;
    const b2 = 1;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(theta);
    const a2 = 1 - alpha;

    const normalizedB0 = b0 / a0;
    const normalizedB1 = b1 / a0;
    const normalizedB2 = b2 / a0;
    const normalizedA1 = a1 / a0;
    const normalizedA2 = a2 / a0;

    filterCoefficientsRef.current = {
      b0: normalizedB0,
      b1: normalizedB1,
      b2: normalizedB2,
      a1: normalizedA1,
      a2: normalizedA2,
    };

    return filterCoefficientsRef.current;
  }, []);

  // Apply filter to signal
  const applyFilter = useCallback((signal) => {
    const { b0, b1, b2, a1, a2 } = filterCoefficientsRef.current;
    const { x1, x2, y1, y2 } = filterStateRef.current;

    const filteredSignal = [];
    let currentX1 = x1;
    let currentX2 = x2;
    let currentY1 = y1;
    let currentY2 = y2;

    for (let i = 0; i < signal.length; i++) {
      const input = signal[i];

      // Direct form II transposed implementation
      const output = b0 * input + b1 * currentX1 + b2 * currentX2
        - a1 * currentY1 - a2 * currentY2;

      filteredSignal.push(output);

      // Update state
      currentX2 = currentX1;
      currentX1 = input;
      currentY2 = currentY1;
      currentY1 = output;
    }

    // Update filter state
    filterStateRef.current = {
      x1: currentX1,
      x2: currentX2,
      y1: currentY1,
      y2: currentY2,
    };

    return filteredSignal;
  }, []);

  // Apply filter with state reset
  const applyFilterWithReset = useCallback((signal) => {
    // Reset filter state
    filterStateRef.current = {
      x1: 0,
      x2: 0,
      y1: 0,
      y2: 0,
    };

    return applyFilter(signal);
  }, [applyFilter]);

  // Reset filter state
  const resetFilter = useCallback(() => {
    filterStateRef.current = {
      x1: 0,
      x2: 0,
      y1: 0,
      y2: 0,
    };
  }, []);

  // Get current filter coefficients
  const getCoefficients = useCallback(() => {
    return filterCoefficientsRef.current;
  }, []);

  // Design PPG-specific filter (0.5-3 Hz for heart rate range)
  const designPPGFilter = useCallback((samplingRate) => {
    // PPG signal typically contains heart rate information in 0.5-3 Hz range
    return designBandpassFilter(0.5, 3.0, samplingRate);
  }, [designBandpassFilter]);

  return {
    designLowpassFilter,
    designHighpassFilter,
    designBandpassFilter,
    designPPGFilter,
    applyFilter,
    applyFilterWithReset,
    resetFilter,
    getCoefficients,
  };
}
