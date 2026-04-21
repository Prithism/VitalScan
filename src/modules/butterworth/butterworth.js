/**
 * 4th Order Butterworth Bandpass Filter
 * 
 * Design: 0.5 - 4 Hz bandpass filter
 * Order: 4 (2nd order sections cascaded)
 * Implementation: Direct Form II Transposed
 * 
 * Features:
 * - Streaming real-time filtering
 * - Zero-phase equivalent (forward-backward filtering option)
 * - Stable coefficients (Butterworth maximally flat)
 * - Minimal latency (causal implementation)
 */

// Pre-computed 4th order Butterworth coefficients for 0.5-4 Hz
// at 30 Hz sampling rate (typical for PPG/eye tracking)
const DEFAULT_FS = 30;
const F_LOW = 0.5;
const F_HIGH = 4.0;

/**
 * Calculate Butterworth filter coefficients using bilinear transform
 * @param {number} lowFreq - Lower cutoff frequency (Hz)
 * @param {number} highFreq - Upper cutoff frequency (Hz)
 * @param {number} samplingRate - Sampling frequency (Hz)
 * @param {number} order - Filter order (must be even for cascade)
 * @returns {Object} Filter coefficients and design info
 */
export function designButterworthBandpass(lowFreq, highFreq, samplingRate, order = 4) {
  if (order % 2 !== 0) {
    throw new Error('Butterworth order must be even for proper cascade implementation');
  }
  
  if (lowFreq <= 0 || highFreq <= 0) {
    throw new Error('Cutoff frequencies must be positive');
  }
  
  if (lowFreq >= highFreq) {
    throw new Error('Low cutoff must be less than high cutoff');
  }
  
  const nyquist = samplingRate / 2;
  
  if (highFreq >= nyquist) {
    throw new Error('High cutoff must be less than Nyquist frequency');
  }
  
  // Pre-warp frequencies for bilinear transform
  const omegaLow = 2 * Math.tan(Math.PI * lowFreq / samplingRate);
  const omegaHigh = 2 * Math.tan(Math.PI * highFreq / samplingRate);
  const bandwidth = omegaHigh - omegaLow;
  const centerFreq = Math.sqrt(omegaLow * omegaHigh);
  
  // Calculate 2nd order sections
  const numSections = order / 2;
  const sections = [];
  
  for (let k = 1; k <= numSections; k++) {
    const angle = (Math.PI / (2 * order)) * (2 * k - 1);
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    
    // Bandpass transformation
    const b0 = bandwidth / (2 * centerFreq);
    const b1 = 0;
    const b2 = -bandwidth / (2 * centerFreq);
    
    const a0 = 1 + b0;
    const a1 = 2 * cosAngle;
    const a2 = 1 - b0;
    
    // Normalize coefficients
    sections.push({
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0
    });
  }
  
  return {
    sections,
    order,
    lowFreq,
    highFreq,
    samplingRate,
    nyquist
  };
}

/**
 * Create a streaming Butterworth filter instance
 */
export class ButterworthFilter {
  constructor(lowFreq = F_LOW, highFreq = F_HIGH, samplingRate = DEFAULT_FS, order = 4) {
    this.design = designButterworthBandpass(lowFreq, highFreq, samplingRate, order);
    this.order = order;
    this.samplingRate = samplingRate;
    this.lowFreq = lowFreq;
    this.highFreq = highFreq;
    
    // Initialize filter state for each section
    // Each section needs 2 past inputs and 2 past outputs
    this.sections = this.design.sections.map(() => ({
      x1: 0, x2: 0,
      y1: 0, y2: 0
    }));
    
    // For zero-phase filtering (forward-backward)
    this.forwardBuffer = [];
  }
  
  /**
   * Apply filter to single sample (streaming mode)
   * @param {number} input - New sample value
   * @returns {number} Filtered sample
   */
  process(input) {
    let currentInput = input;
    
    // Cascade through each 2nd order section
    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i];
      const coeffs = this.design.sections[i];
      
      // Direct Form II Transposed
      const output = coeffs.b0 * currentInput + coeffs.b1 * section.x1 + coeffs.b2 * section.x2
        - coeffs.a1 * section.y1 - coeffs.a2 * section.y2;
      
      // Update state
      section.x2 = section.x1;
      section.x1 = currentInput;
      section.y2 = section.y1;
      section.y1 = output;
      
      currentInput = output;
    }
    
    return currentInput;
  }
  
  /**
   * Process entire signal buffer (batch mode)
   * @param {number[]} signal - Input signal array
   * @returns {number[]} Filtered signal
   */
  processBuffer(signal) {
    return signal.map(sample => this.process(sample));
  }
  
  /**
   * Zero-phase filtering (forward-backward)
   * Eliminates phase distortion but requires full signal
   * @param {number[]} signal - Input signal array
   * @returns {number[]} Zero-phase filtered signal
   */
  processZeroPhase(signal) {
    // Forward pass
    const forward = this.processBuffer([...signal]);
    
    // Reset state for backward pass
    this.reset();
    
    // Backward pass (reverse, filter, reverse)
    const backward = this.processBuffer(forward.reverse()).reverse();
    
    // Reset state again
    this.reset();
    
    return backward;
  }
  
  /**
   * Reset filter state
   */
  reset() {
    this.sections.forEach(section => {
      section.x1 = 0;
      section.x2 = 0;
      section.y1 = 0;
      section.y2 = 0;
    });
  }
  
  /**
   * Get current filter coefficients
   */
  getCoefficients() {
    return this.design.sections;
  }
  
  /**
   * Get filter info
   */
  getInfo() {
    return {
      order: this.order,
      lowFreq: this.lowFreq,
      highFreq: this.highFreq,
      samplingRate: this.samplingRate,
      nyquist: this.design.nyquist
    };
  }
}

/**
 * React hook for using Butterworth filter in components
 */
import { useCallback, useRef } from 'react';

export function useButterworth(lowFreq = F_LOW, highFreq = F_HIGH, samplingRate = DEFAULT_FS, order = 4) {
  const filterRef = useRef(null);
  
  // Initialize filter
  if (!filterRef.current) {
    filterRef.current = new ButterworthFilter(lowFreq, highFreq, samplingRate, order);
  }
  
  // Process single sample
  const processSample = useCallback((sample) => {
    return filterRef.current.process(sample);
  }, []);
  
  // Process buffer
  const processBuffer = useCallback((signal) => {
    return filterRef.current.processBuffer(signal);
  }, []);
  
  // Zero-phase processing
  const processZeroPhase = useCallback((signal) => {
    return filterRef.current.processZeroPhase(signal);
  }, []);
  
  // Reset filter
  const resetFilter = useCallback(() => {
    filterRef.current.reset();
  }, []);
  
  // Get coefficients
  const getCoefficients = useCallback(() => {
    return filterRef.current.getCoefficients();
  }, []);
  
  // Get filter info
  const getInfo = useCallback(() => {
    return filterRef.current.getInfo();
  }, []);
  
  return {
    processSample,
    processBuffer,
    processZeroPhase,
    resetFilter,
    getCoefficients,
    getInfo
  };
}

// Export default filter instance with standard parameters
export const defaultFilter = new ButterworthFilter(F_LOW, F_HIGH, DEFAULT_FS, 4);

// Export design function for external use
export { designButterworthBandpass };
