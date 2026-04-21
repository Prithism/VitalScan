/**
 * Real-time FFT Analyzer for Cardiac Frequency Detection
 * 
 * Features:
 * - Streaming FFT computation
 * - Dominant cardiac frequency detection (0.5-4 Hz)
 * - Spectral power calculation
 * - Real-time FFT plotting
 * - Heart rate estimation (BPM)
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { ButterworthFilter } from '../butterworth/butterworth';

// FFT buffer size (power of 2 for efficient Cooley-Tukey)
const FFT_SIZE = 512;
const DEFAULT_FS = 30; // 30 Hz sampling rate (typical for PPG/eye tracking)
const HR_MIN = 0.5;    // 0.5 Hz = 30 BPM
const HR_MAX = 4.0;    // 4.0 Hz = 240 BPM

/**
 * Compute FFT using Cooley-Tukey radix-2 algorithm
 * @param {number[]} signal - Input signal
 * @returns {Array} Complex FFT result [{real, imag}, ...]
 */
export function computeFFT(signal) {
  const n = signal.length;
  
  // Pad to next power of 2 if needed
  if ((n & (n - 1)) !== 0) {
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(n)));
    const padded = [...signal, ...new Array(nextPowerOf2 - n).fill(0)];
    return computeFFT(padded);
  }
  
  // Bit-reversal permutation
  const result = bitReversalPermutation(signal);
  
  // Iterative Cooley-Tukey
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const angle = (-2 * Math.PI) / size;
    const wStep = { real: Math.cos(angle), imag: Math.sin(angle) };
    
    for (let start = 0; start < n; start += size) {
      let w = { real: 1, imag: 0 };
      
      for (let i = 0; i < halfSize; i++) {
        const even = result[start + i];
        const odd = result[start + i + halfSize];
        
        // Complex multiplication: w * odd
        const wOddReal = w.real * odd.real - w.imag * odd.imag;
        const wOddImag = w.real * odd.imag + w.imag * odd.real;
        
        // Complex addition/subtraction
        result[start + i] = {
          real: even.real + wOddReal,
          imag: even.imag + wOddImag
        };
        result[start + i + halfSize] = {
          real: even.real - wOddReal,
          imag: even.imag - wOddImag
        };
        
        // Update twiddle factor
        const newWReal = w.real * wStep.real - w.imag * wStep.imag;
        const newWImag = w.real * wStep.imag + w.imag * wStep.real;
        w = { real: newWReal, imag: newWImag };
      }
    }
  }
  
  return result;
}

/**
 * Bit-reversal permutation for FFT
 */
function bitReversalPermutation(signal) {
  const n = signal.length;
  const result = new Array(n);
  
  for (let i = 0; i < n; i++) {
    let reversed = 0;
    for (let j = 0; j < Math.log2(n); j++) {
      if ((i >> j) & 1) {
        reversed |= 1 << (Math.log2(n) - 1 - j);
      }
    }
    result[reversed] = { real: signal[i], imag: 0 };
  }
  
  return result;
}

/**
 * Calculate power spectrum from FFT result
 */
export function calculatePowerSpectrum(fftResult) {
  const n = fftResult.length;
  const powerSpectrum = [];
  
  for (let i = 0; i < n / 2; i++) {
    const { real, imag } = fftResult[i];
    const power = real * real + imag * imag;
    powerSpectrum.push(power);
  }
  
  return powerSpectrum;
}

/**
 * Find dominant frequency in spectrum
 */
export function findDominantFrequency(powerSpectrum, samplingRate, minFreq = HR_MIN, maxFreq = HR_MAX) {
  const frequencyResolution = samplingRate / (powerSpectrum.length * 2);
  let maxPower = -Infinity;
  let dominantIndex = 0;
  
  // Search within heart rate range
  const minIndex = Math.floor(minFreq / frequencyResolution);
  const maxIndex = Math.ceil(maxFreq / frequencyResolution);
  
  for (let i = minIndex; i <= maxIndex && i < powerSpectrum.length; i++) {
    if (powerSpectrum[i] > maxPower) {
      maxPower = powerSpectrum[i];
      dominantIndex = i;
    }
  }
  
  const dominantFrequency = dominantIndex * frequencyResolution;
  
  return {
    frequency: dominantFrequency,
    frequencyBPM: dominantFrequency * 60,
    power: maxPower,
    index: dominantIndex,
    frequencyResolution
  };
}

/**
 * Find all peaks in spectrum within range
 */
export function findPeaks(powerSpectrum, samplingRate, minFreq = HR_MIN, maxFreq = HR_MAX, minPeakHeight = 0) {
  const frequencyResolution = samplingRate / (powerSpectrum.length * 2);
  const peaks = [];
  
  const minIndex = Math.floor(minFreq / frequencyResolution);
  const maxIndex = Math.ceil(maxFreq / frequencyResolution);
  
  for (let i = minIndex + 1; i < Math.min(maxIndex, powerSpectrum.length - 1); i++) {
    // Check if local maximum
    if (powerSpectrum[i] > powerSpectrum[i - 1] && 
        powerSpectrum[i] > powerSpectrum[i + 1] &&
        powerSpectrum[i] > minPeakHeight) {
      
      // Parabolic interpolation for finer frequency estimate
      const freq = interpolatePeakFrequency(powerSpectrum, i, frequencyResolution);
      
      peaks.push({
        frequency: freq,
        frequencyBPM: freq * 60,
        power: powerSpectrum[i],
        index: i
      });
    }
  }
  
  // Sort by power (descending)
  return peaks.sort((a, b) => b.power - a.power);
}

/**
 * Parabolic interpolation for peak frequency refinement
 */
function interpolatePeakFrequency(powerSpectrum, peakIndex, freqResolution) {
  if (peakIndex === 0 || peakIndex >= powerSpectrum.length - 1) {
    return peakIndex * freqResolution;
  }
  
  const y0 = powerSpectrum[peakIndex - 1];
  const y1 = powerSpectrum[peakIndex];
  const y2 = powerSpectrum[peakIndex + 1];
  
  // Parabolic fit: x = 0.5 * (y0 - y2) / (y0 - 2*y1 + y2)
  const denominator = y0 - 2 * y1 + y2;
  if (denominator === 0) return peakIndex * freqResolution;
  
  const delta = 0.5 * (y0 - y2) / denominator;
  return (peakIndex + delta) * freqResolution;
}

/**
 * Calculate spectral power in band
 */
export function calculateSpectralPower(powerSpectrum, samplingRate, minFreq, maxFreq) {
  const frequencyResolution = samplingRate / (powerSpectrum.length * 2);
  let totalPower = 0;
  
  const minIndex = Math.floor(minFreq / frequencyResolution);
  const maxIndex = Math.ceil(maxFreq / frequencyResolution);
  
  for (let i = minIndex; i <= maxIndex && i < powerSpectrum.length; i++) {
    totalPower += powerSpectrum[i];
  }
  
  return totalPower;
}

/**
 * Calculate Signal-to-Noise Ratio
 */
export function calculateSNR(powerSpectrum, dominantIndex) {
  const signalPower = powerSpectrum[dominantIndex];
  
  // Estimate noise from surrounding bins
  let noiseSum = 0;
  let noiseCount = 0;
  
  for (let i = 0; i < powerSpectrum.length; i++) {
    if (Math.abs(i - dominantIndex) > 5) { // Exclude nearby bins
      noiseSum += powerSpectrum[i];
      noiseCount++;
    }
  }
  
  const noisePower = noiseSum / noiseCount;
  return 10 * Math.log10(signalPower / noisePower);
}

/**
 * Real-time FFT Analyzer class
 */
export class FFTAnalyzer {
  constructor(samplingRate = DEFAULT_FS, fftSize = FFT_SIZE, hrMin = HR_MIN, hrMax = HR_MAX) {
    this.samplingRate = samplingRate;
    this.fftSize = fftSize;
    this.hrMin = hrMin;
    this.hrMax = hrMax;
    
    // Signal buffer
    this.buffer = new Array(fftSize).fill(0);
    this.bufferIndex = 0;
    this.bufferFilled = false;
    
    // Filter for preprocessing
    this.filter = new ButterworthFilter(hrMin, hrMax, samplingRate, 4);
    
    // Results cache
    this.lastResult = null;
    this.spectrumHistory = [];
    this.heartRateHistory = [];
    this.heartRateHistoryMax = 30; // Keep last 30 BPM readings
  }
  
  /**
   * Add new sample and process
   */
  processSample(sample) {
    // Add to buffer (circular)
    this.buffer[this.bufferIndex] = sample;
    this.bufferIndex = (this.bufferIndex + 1) % this.fftSize;
    
    if (this.bufferIndex === 0) {
      this.bufferFilled = true;
    }
    
    // Process when buffer is filled
    if (this.bufferFilled) {
      this.lastResult = this.analyze();
      
      // Update heart rate history
      if (this.lastResult && this.lastResult.heartRateBPM) {
        this.heartRateHistory.push(this.lastResult.heartRateBPM);
        if (this.heartRateHistory.length > this.heartRateHistoryMax) {
          this.heartRateHistory.shift();
        }
      }
    }
    
    return this.lastResult;
  }
  
  /**
   * Analyze current buffer
   */
  analyze() {
    // Get buffer in correct order
    const signal = this.getBufferedSignal();
    
    // Apply Hanning window
    const windowed = this.applyHanningWindow(signal);
    
    // Compute FFT
    const fftResult = computeFFT(windowed);
    
    // Calculate power spectrum
    const powerSpectrum = calculatePowerSpectrum(fftResult);
    
    // Find dominant frequency
    const dominant = findDominantFrequency(powerSpectrum, this.samplingRate, this.hrMin, this.hrMax);
    
    // Find all peaks
    const peaks = findPeaks(powerSpectrum, this.samplingRate, this.hrMin, this.hrMax);
    
    // Calculate spectral power
    const spectralPower = calculateSpectralPower(powerSpectrum, this.samplingRate, this.hrMin, this.hrMax);
    
    // Calculate SNR
    const snr = calculateSNR(powerSpectrum, dominant.index);
    
    // Store spectrum for plotting
    this.spectrumHistory.push([...powerSpectrum]);
    if (this.spectrumHistory.length > 10) {
      this.spectrumHistory.shift();
    }
    
    return {
      fft: fftResult,
      powerSpectrum,
      dominantFrequency: dominant.frequency,
      dominantFrequencyBPM: dominant.frequency * 60,
      spectralPower,
      snr,
      peaks,
      heartRateBPM: dominant.frequency * 60,
      frequencyResolution: dominant.frequencyResolution,
      confidence: this.calculateConfidence(dominant, peaks)
    };
  }
  
  /**
   * Get buffered signal in correct order
   */
  getBufferedSignal() {
    if (!this.bufferFilled) {
      return this.buffer.slice(0, this.bufferIndex);
    }
    
    // Reorder circular buffer
    const result = [];
    for (let i = this.bufferIndex; i < this.fftSize; i++) {
      result.push(this.buffer[i]);
    }
    for (let i = 0; i < this.bufferIndex; i++) {
      result.push(this.buffer[i]);
    }
    
    return result;
  }
  
  /**
   * Apply Hanning window
   */
  applyHanningWindow(signal) {
    const n = signal.length;
    return signal.map((x, i) => {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
      return x * window;
    });
  }
  
  /**
   * Calculate confidence score
   */
  calculateConfidence(dominant, peaks) {
    if (peaks.length === 0) return 0;
    
    // Check if dominant is also the strongest peak
    const dominantIsStrongest = peaks[0].index === dominant.index;
    
    // Check harmonic ratio
    const secondPeakRatio = peaks.length > 1 
      ? peaks[1].power / peaks[0].power 
      : 0;
    
    // Confidence based on:
    // 1. Dominant is strongest peak
    // 2. Low harmonic content
    // 3. High SNR
    let confidence = 0;
    if (dominantIsStrongest) confidence += 0.4;
    if (secondPeakRatio < 0.3) confidence += 0.3;
    if (dominant.power > 1e-6) confidence += 0.3;
    
    return Math.min(1, confidence);
  }
  
  /**
   * Get recent heart rate readings
   */
  getHeartRateHistory() {
    return this.heartRateHistory;
  }
  
  /**
   * Get recent spectrum history for plotting
   */
  getSpectrumHistory() {
    return this.spectrumHistory;
  }
  
  /**
   * Reset analyzer
   */
  reset() {
    this.buffer.fill(0);
    this.bufferIndex = 0;
    this.bufferFilled = false;
    this.lastResult = null;
    this.spectrumHistory = [];
    this.heartRateHistory = [];
  }
}

/**
 * React hook for FFT analysis
 */
export function useFFTAnalyzer(samplingRate = DEFAULT_FS, fftSize = FFT_SIZE) {
  const analyzerRef = useRef(null);
  
  // Initialize analyzer
  if (!analyzerRef.current) {
    analyzerRef.current = new FFTAnalyzer(samplingRate, fftSize);
  }
  
  // Process sample
  const processSample = useCallback((sample) => {
    return analyzerRef.current.processSample(sample);
  }, []);
  
  // Analyze buffer
  const analyzeBuffer = useCallback((signal) => {
    const tempAnalyzer = new FFTAnalyzer(samplingRate, fftSize);
    signal.forEach(sample => tempAnalyzer.processSample(sample));
    return tempAnalyzer.lastResult;
  }, [samplingRate, fftSize]);
  
  // Get FFT result
  const getFFT = useCallback((signal) => {
    return computeFFT(signal);
  }, []);
  
  // Get power spectrum
  const getPowerSpectrum = useCallback((fftResult) => {
    return calculatePowerSpectrum(fftResult);
  }, []);
  
  // Find peaks
  const findPeaks = useCallback((powerSpectrum) => {
    return findPeaks(powerSpectrum, samplingRate);
  }, [samplingRate]);
  
  // Get heart rate history
  const getHeartRateHistory = useCallback(() => {
    return analyzerRef.current.getHeartRateHistory();
  }, []);
  
  // Get spectrum history
  const getSpectrumHistory = useCallback(() => {
    return analyzerRef.current.getSpectrumHistory();
  }, []);
  
  // Reset
  const reset = useCallback(() => {
    analyzerRef.current.reset();
  }, []);
  
  return {
    processSample,
    analyzeBuffer,
    getFFT,
    getPowerSpectrum,
    findPeaks,
    getHeartRateHistory,
    getSpectrumHistory,
    reset
  };
}

/**
 * Real-time FFT Plot Component
 * Displays power spectrum with dominant frequency indicator
 */
import { useEffect, useRef, useCallback } from 'react';

export function FFTPlot({
  width = 600,
  height = 250,
  powerSpectrum = [],
  dominantFrequency = 0,
  samplingRate = DEFAULT_FS,
  hrMin = HR_MIN,
  hrMax = HR_MAX,
  color = '#00ff00',
  dominantColor = '#ff0000',
  gridColor = '#003300',
  backgroundColor = '#000000'
}) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  
  // Draw FFT plot
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid
    drawGrid(ctx, width, height, gridColor);
    
    if (powerSpectrum.length < 2) {
      // Draw placeholder text
      ctx.fillStyle = '#666';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for signal...', width / 2, height / 2);
      return;
    }
    
    // Calculate frequency axis
    const frequencyResolution = samplingRate / (powerSpectrum.length * 2);
    const minFreqIndex = Math.floor(hrMin / frequencyResolution);
    const maxFreqIndex = Math.ceil(hrMax / frequencyResolution);
    
    // Extract spectrum in HR range
    const displaySpectrum = powerSpectrum.slice(minFreqIndex, maxFreqIndex);
    
    // Find max power for scaling
    const maxPower = Math.max(...displaySpectrum, 1e-10);
    
    // Draw spectrum
    drawSpectrum(ctx, displaySpectrum, maxPower, width, height, color);
    
    // Draw dominant frequency marker
    if (dominantFrequency > 0) {
      drawDominantMarker(ctx, dominantFrequency, maxPower, width, height, 
        frequencyResolution, minFreqIndex, dominantColor);
    }
    
    // Draw labels
    drawLabels(ctx, width, height, frequencyResolution, minFreqIndex, maxPower);
    
  }, [powerSpectrum, dominantFrequency, samplingRate, hrMin, hrMax, color, dominantColor, gridColor, backgroundColor]);
  
  // Draw grid
  const drawGrid = useCallback((ctx, w, h, gridColor) => {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.font = '10px monospace';
    ctx.fillStyle = gridColor;
    
    // Vertical lines (frequency)
    const numFreqLines = 8;
    for (let i = 0; i <= numFreqLines; i++) {
      const x = (i / numFreqLines) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      
      // Frequency label
      const freq = hrMin + (i / numFreqLines) * (hrMax - hrMin);
      ctx.fillText(`${freq.toFixed(1)} Hz`, x + 2, h - 2);
    }
    
    // Horizontal lines (power)
    const numPowerLines = 6;
    for (let i = 0; i <= numPowerLines; i++) {
      const y = (i / numPowerLines) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }, [hrMin, hrMax]);
  
  // Draw spectrum curve
  const drawSpectrum = useCallback((ctx, spectrum, maxPower, w, h, color) => {
    if (spectrum.length < 2) return;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Log scale for better visibility
    const logMax = Math.log10(maxPower);
    
    ctx.beginPath();
    
    for (let i = 0; i < spectrum.length; i++) {
      const x = (i / (spectrum.length - 1)) * w;
      const logPower = Math.log10(Math.max(spectrum[i], 1e-10));
      const y = h - (logPower / logMax) * h;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
    
    // Fill under curve
    ctx.lineTo(spectrum.length - 1, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
    ctx.fill();
  }, []);
  
  // Draw dominant frequency marker
  const drawDominantMarker = useCallback((ctx, dominantFreq, maxPower, w, h, 
      freqResolution, minFreqIndex, color) => {
    const freqIndex = Math.round((dominantFreq - freqResolution * minFreqIndex) / freqResolution);
    const x = (freqIndex / (w / freqResolution)) * w;
    
    // Vertical line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Label
    ctx.fillStyle = color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`HR: ${(dominantFreq * 60).toFixed(0)} BPM`, x + 5, 15);
  }, []);
  
  // Draw axis labels
  const drawLabels = useCallback((ctx, w, h, freqResolution, minFreqIndex, maxPower) => {
    ctx.fillStyle = '#00ff00';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    
    // Frequency range
    ctx.fillText(`Range: ${hrMin}-${hrMax} Hz`, 5, 12);
    
    // Max power (log scale)
    ctx.fillText(`Power: ${Math.pow(10, Math.log10(maxPower)).toFixed(2)}`, 5, 25);
    
    // BPM conversion
    const bpmRange = [hrMin * 60, hrMax * 60];
    ctx.fillText(`BPM: ${bpmRange[0].toFixed(0)}-${bpmRange[1].toFixed(0)}`, w - 120, 12);
  }, [hrMin, hrMax]);
  
  // Animation loop
  useEffect(() => {
    draw();
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);
  
  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          display: 'block',
          border: `1px solid ${gridColor}`,
          borderRadius: '4px',
        }}
      />
      
      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          fontSize: '10px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ 
            width: '12px', 
            height: '2px', 
            backgroundColor: color 
          }}></span>
          <span>Spectrum</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ 
            width: '12px', 
            height: '2px', 
            backgroundColor: dominantColor,
            border: '1px dashed white'
          }}></span>
          <span>Peak</span>
        </div>
      </div>
    </div>
  );
}

// Export utility functions
export {
  computeFFT,
  calculatePowerSpectrum,
  findDominantFrequency,
  findPeaks,
  calculateSpectralPower,
  calculateSNR,
  interpolatePeakFrequency
};
