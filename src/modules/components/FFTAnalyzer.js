import { useCallback, useRef } from 'react';

export function useFFTAnalyzer() {
  const fftBufferRef = useRef([]);
  const samplingRateRef = useRef(30); // Default 30 Hz
  const windowFunctionRef = useRef('hanning');

  // Generate Hanning window
  const generateHanningWindow = useCallback((size) => {
    const window = [];
    for (let i = 0; i < size; i++) {
      window.push(0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1))));
    }
    return window;
  }, []);

  // Generate Hamming window
  const generateHammingWindow = useCallback((size) => {
    const window = [];
    for (let i = 0; i < size; i++) {
      window.push(0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }, []);

  // Apply window function to signal
  const applyWindow = useCallback((signal, windowType = 'hanning') => {
    const windowSize = signal.length;
    let window;

    switch (windowType) {
      case 'hamming':
        window = generateHammingWindow(windowSize);
        break;
      case 'hanning':
      default:
        window = generateHanningWindow(windowSize);
        break;
    }

    return signal.map((value, i) => value * window[i]);
  }, [generateHammingWindow, generateHanningWindow]);

  // Cooley-Tukey FFT algorithm (radix-2)
  const fft = useCallback((signal) => {
    const n = signal.length;

    // Check if n is a power of 2
    if ((n & (n - 1)) !== 0) {
      // Pad to next power of 2
      const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(n)));
      const paddedSignal = [...signal, ...new Array(nextPowerOf2 - n).fill(0)];
      return fft(paddedSignal);
    }

    // Bit reversal permutation
    const result = bitReversalPermutation(signal);

    // Iterative Cooley-Tukey
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const angle = (-2 * Math.PI) / size;
      const wStep = Math.cos(angle) + Math.sin(angle) * 1j;

      for (let start = 0; start < n; start += size) {
        let w = 1 + 0j;

        for (let i = 0; i < halfSize; i++) {
          const even = result[start + i];
          const odd = result[start + i + halfSize];

          result[start + i] = even + w * odd;
          result[start + i + halfSize] = even - w * odd;

          w = w * wStep;
        }
      }
    }

    return result;
  }, []);

  // Bit reversal permutation
  const bitReversalPermutation = useCallback((signal) => {
    const n = signal.length;
    const result = new Array(n);

    for (let i = 0; i < n; i++) {
      let reversed = 0;
      for (let j = 0; j < Math.log2(n); j++) {
        if ((i >> j) & 1) {
          reversed |= 1 << (Math.log2(n) - 1 - j);
        }
      }
      result[reversed] = signal[i];
    }

    return result;
  }, []);

  // Calculate power spectrum
  const calculatePowerSpectrum = useCallback((fftResult) => {
    const n = fftResult.length;
    const powerSpectrum = [];

    for (let i = 0; i < n / 2; i++) {
      const real = fftResult[i].real || fftResult[i];
      const imag = fftResult[i].imag || 0;
      const power = real * real + imag * imag;
      powerSpectrum.push(power);
    }

    return powerSpectrum;
  }, []);

  // Find dominant frequency
  const findDominantFrequency = useCallback((powerSpectrum, samplingRate) => {
    let maxPower = 0;
    let dominantIndex = 0;

    for (let i = 0; i < powerSpectrum.length; i++) {
      if (powerSpectrum[i] > maxPower) {
        maxPower = powerSpectrum[i];
        dominantIndex = i;
      }
    }

    const frequencyResolution = samplingRate / (powerSpectrum.length * 2);
    const dominantFrequency = dominantIndex * frequencyResolution;

    return {
      frequency: dominantFrequency,
      power: maxPower,
      index: dominantIndex,
    };
  }, []);

  // Find peak frequencies in range
  const findPeaksInRange = useCallback((powerSpectrum, samplingRate, minFreq, maxFreq) => {
    const frequencyResolution = samplingRate / (powerSpectrum.length * 2);
    const peaks = [];

    for (let i = 0; i < powerSpectrum.length; i++) {
      const frequency = i * frequencyResolution;

      if (frequency >= minFreq && frequency <= maxFreq) {
        // Check if this is a local maximum
        if (i > 0 && i < powerSpectrum.length - 1) {
          if (powerSpectrum[i] > powerSpectrum[i - 1] && 
              powerSpectrum[i] > powerSpectrum[i + 1]) {
            peaks.push({
              frequency,
              power: powerSpectrum[i],
              index: i,
            });
          }
        }
      }
    }

    // Sort by power
    peaks.sort((a, b) => b.power - a.power);

    return peaks;
  }, []);

  // Analyze PPG signal
  const analyzePPGSignal = useCallback((signal, samplingRate = 30) => {
    samplingRateRef.current = samplingRate;

    // Apply window function
    const windowedSignal = applyWindow(signal);

    // Compute FFT
    const fftResult = fft(windowedSignal);

    // Calculate power spectrum
    const powerSpectrum = calculatePowerSpectrum(fftResult);

    // Find dominant frequency (heart rate range: 0.5-3 Hz)
    const dominantFrequency = findDominantFrequency(powerSpectrum, samplingRate);

    // Find all peaks in heart rate range
    const peaks = findPeaksInRange(powerSpectrum, samplingRate, 0.5, 3.0);

    // Calculate signal-to-noise ratio
    const signalPower = dominantFrequency.power;
    const noisePower = powerSpectrum.reduce((sum, p, i) => {
      if (i !== dominantFrequency.index) return sum + p;
      return sum;
    }, 0) / (powerSpectrum.length - 1);

    const snr = 10 * Math.log10(signalPower / noisePower);

    return {
      fft: fftResult,
      powerSpectrum,
      dominantFrequency,
      peaks,
      snr,
      frequencyResolution: samplingRate / (powerSpectrum.length * 2),
    };
  }, [applyWindow, fft, calculatePowerSpectrum, findDominantFrequency, findPeaksInRange]);

  // Reset analyzer
  const reset = useCallback(() => {
    fftBufferRef.current = [];
  }, []);

  return {
    fft,
    calculatePowerSpectrum,
    findDominantFrequency,
    findPeaksInRange,
    analyzePPGSignal,
    reset,
  };
}
