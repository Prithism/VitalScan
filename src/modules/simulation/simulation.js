/**
 * Synthetic PPG Signal Generator for Simulation Mode
 * 
 * Generates realistic synthetic signals with:
 * - Cardiac sinusoid (heart rate)
 * - Respiratory modulation
 * - Noise (baseline wander, high-frequency)
 * - Blink artifacts
 * - Motion artifacts
 * 
 * Can be used as demo fallback when webcam fails
 */

import { useCallback, useRef, useEffect, useState } from 'react';

// Default configuration
const DEFAULT_CONFIG = {
  samplingRate: 30,        // Hz
  heartRate: 72,           // BPM
  respiratoryRate: 16,     // BPM
  signalAmplitude: 100,    // Base amplitude
  noiseLevel: 0.15,        // Noise fraction
  blinkProbability: 0.02,  // Per-frame blink probability
  motionProbability: 0.01, // Per-frame motion probability
};

/**
 * Generate synthetic PPG signal
 * 
 * @param {number} duration - Duration in seconds
 * @param {Object} config - Signal configuration
 * @returns {number[]} Synthetic signal array
 */
export function generateSyntheticSignal(duration, config = {}) {
  const {
    samplingRate = DEFAULT_CONFIG.samplingRate,
    heartRate = DEFAULT_CONFIG.heartRate,
    respiratoryRate = DEFAULT_CONFIG.respiratoryRate,
    signalAmplitude = DEFAULT_CONFIG.signalAmplitude,
    noiseLevel = DEFAULT_CONFIG.noiseLevel,
    blinkProbability = DEFAULT_CONFIG.blinkProbability,
    motionProbability = DEFAULT_CONFIG.motionProbability,
  } = config;

  const numSamples = Math.floor(duration * samplingRate);
  const signal = new Float32Array(numSamples);

  // Pre-compute constants
  const heartPeriod = 60 / heartRate; // seconds per beat
  const respiratoryPeriod = 60 / respiratoryRate; // seconds per breath
  const heartFreq = 1 / heartPeriod; // Hz
  const respiratoryFreq = 1 / respiratoryPeriod; // Hz

  // Random seed for reproducibility
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff);
  };

  // Generate signal
  for (let i = 0; i < numSamples; i++) {
    const t = i / samplingRate;

    // 1. Cardiac component (sinusoidal with slight variation)
    const heartPhase = (t % heartPeriod) / heartPeriod;
    const heartBeat = Math.sin(2 * Math.PI * heartPhase);
    
    // Add slight beat-to-beat variation
    const beatVariation = 0.9 + 0.2 * random();
    const cardiacComponent = heartBeat * beatVariation;

    // 2. Respiratory modulation (amplitude modulation)
    const respiratoryModulation = 1 + 0.1 * Math.sin(2 * Math.PI * t / respiratoryPeriod);
    const modulatedCardiac = cardiacComponent * respiratoryModulation;

    // 3. DC component (baseline)
    const dcComponent = 128 + 10 * Math.sin(2 * Math.PI * t * 0.1); // Slow baseline drift

    // 4. Baseline wander (low frequency)
    const baselineWander = 5 * Math.sin(2 * Math.PI * t * 0.5);

    // 5. High frequency noise
    const noise = (random() - 0.5) * 2 * noiseLevel * signalAmplitude;

    // 6. Blink artifact (sudden drop)
    let blinkArtifact = 0;
    if (random() < blinkProbability) {
      const blinkDuration = Math.floor(samplingRate * (0.1 + 0.2 * random()));
      const blinkStart = i;
      const blinkEnd = Math.min(blinkStart + blinkDuration, numSamples);
      
      for (let j = blinkStart; j < blinkEnd; j++) {
        const progress = (j - blinkStart) / blinkDuration;
        // Smooth blink: drop then recover
        const blinkShape = Math.sin(Math.PI * progress);
        signal[j] -= signalAmplitude * 0.3 * blinkShape;
      }
    }

    // 7. Motion artifact (sudden shift)
    let motionArtifact = 0;
    if (random() < motionProbability) {
      const motionDuration = Math.floor(samplingRate * (0.05 + 0.1 * random()));
      const motionStart = i;
      const motionEnd = Math.min(motionStart + motionDuration, numSamples);
      
      for (let j = motionStart; j < motionEnd; j++) {
        const progress = (j - motionStart) / motionDuration;
        // Smooth motion: shift then return
        const motionShape = Math.sin(Math.PI * progress);
        signal[j] += signalAmplitude * 0.2 * motionShape;
      }
    }

    // Combine all components
    signal[i] = dcComponent + 
                signalAmplitude * 0.3 * modulatedCardiac + 
                baselineWander + 
                noise;

    // Apply blink and motion artifacts (separate pass to avoid interference)
    if (i < numSamples) {
      // Check if this sample was affected by blink
      let blinkOffset = 0;
      if (blinkProbability > 0 && random() < blinkProbability) {
        const blinkDuration = Math.floor(samplingRate * (0.1 + 0.2 * random()));
        const blinkStart = i;
        const blinkEnd = Math.min(blinkStart + blinkDuration, numSamples);
        
        for (let j = blinkStart; j < blinkEnd; j++) {
          const progress = (j - blinkStart) / blinkDuration;
          const blinkShape = Math.sin(Math.PI * progress);
          signal[j] -= signalAmplitude * 0.3 * blinkShape;
        }
        i = blinkEnd - 1; // Skip ahead
        continue;
      }

      // Check if this sample was affected by motion
      if (motionProbability > 0 && random() < motionProbability) {
        const motionDuration = Math.floor(samplingRate * (0.05 + 0.1 * random()));
        const motionStart = i;
        const motionEnd = Math.min(motionStart + motionDuration, numSamples);
        
        for (let j = motionStart; j < motionEnd; j++) {
          const progress = (j - motionStart) / motionDuration;
          const motionShape = Math.sin(Math.PI * progress);
          signal[j] += signalAmplitude * 0.2 * motionShape;
        }
        i = motionEnd - 1; // Skip ahead
        continue;
      }
    }
  }

  // Convert to array and add offset for 8-bit range
  const result = Array.from(signal).map(v => Math.max(0, Math.min(255, v + 128)));

  return result;
}

/**
 * Generate continuous synthetic signal stream
 */
export class SyntheticSignalGenerator {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.samplingRate = this.config.samplingRate;
    this.signalBuffer = [];
    this.bufferSize = this.samplingRate * 10; // 10 seconds buffer
    this.currentIndex = 0;
    this.lastTime = performance.now();
    this.blinkTimer = 0;
    this.motionTimer = 0;
  }

  /**
   * Generate next sample
   */
  nextSample() {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Update timers
    this.blinkTimer -= dt;
    this.motionTimer -= dt;

    // Calculate phase
    const heartPeriod = 60 / this.config.heartRate;
    const respiratoryPeriod = 60 / this.config.respiratoryRate;
    const t = this.currentIndex / this.samplingRate;

    // Cardiac component
    const heartPhase = (t % heartPeriod) / heartPeriod;
    const heartBeat = Math.sin(2 * Math.PI * heartPhase);
    const beatVariation = 0.9 + 0.2 * Math.sin(t * 0.5); // Slow variation
    const cardiacComponent = heartBeat * beatVariation;

    // Respiratory modulation
    const respiratoryModulation = 1 + 0.1 * Math.sin(2 * Math.PI * t / respiratoryPeriod);
    const modulatedCardiac = cardiacComponent * respiratoryModulation;

    // DC component
    const dcComponent = 128 + 10 * Math.sin(2 * Math.PI * t * 0.1);

    // Baseline wander
    const baselineWander = 5 * Math.sin(2 * Math.PI * t * 0.5);

    // Noise
    const noise = (Math.random() - 0.5) * 2 * this.config.noiseLevel * this.config.signalAmplitude;

    // Blink artifact
    let blinkArtifact = 0;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = this.config.blinkProbability > 0 ? 
        Math.random() / this.config.blinkProbability : 1000;
      
      const blinkDuration = Math.floor(this.samplingRate * (0.1 + 0.2 * Math.random()));
      this.blinkBuffer = new Array(blinkDuration).fill(0).map((_, i) => {
        const progress = i / blinkDuration;
        return -this.config.signalAmplitude * 0.3 * Math.sin(Math.PI * progress);
      });
      this.blinkIndex = 0;
    }

    if (this.blinkBuffer && this.blinkIndex < this.blinkBuffer.length) {
      blinkArtifact = this.blinkBuffer[this.blinkIndex++];
    }

    // Motion artifact
    let motionArtifact = 0;
    if (this.motionTimer <= 0) {
      this.motionTimer = this.config.motionProbability > 0 ? 
        Math.random() / this.config.motionProbability : 1000;
      
      const motionDuration = Math.floor(this.samplingRate * (0.05 + 0.1 * Math.random()));
      this.motionBuffer = new Array(motionDuration).fill(0).map((_, i) => {
        const progress = i / motionDuration;
        return this.config.signalAmplitude * 0.2 * Math.sin(Math.PI * progress);
      });
      this.motionIndex = 0;
    }

    if (this.motionBuffer && this.motionIndex < this.motionBuffer.length) {
      motionArtifact = this.motionBuffer[this.motionIndex++];
    }

    // Combine components
    let sample = dcComponent + 
                 this.config.signalAmplitude * 0.3 * modulatedCardiac + 
                 baselineWander + 
                 noise + 
                 blinkArtifact + 
                 motionArtifact;

    // Clamp to valid range
    sample = Math.max(0, Math.min(255, sample));

    // Update buffer
    this.signalBuffer.push(sample);
    if (this.signalBuffer.length > this.bufferSize) {
      this.signalBuffer.shift();
    }

    this.currentIndex++;

    return sample;
  }

  /**
   * Get current buffer
   */
  getBuffer() {
    return [...this.signalBuffer];
  }

  /**
   * Get current signal stats
   */
  getStats() {
    if (this.signalBuffer.length === 0) return null;

    const min = Math.min(...this.signalBuffer);
    const max = Math.max(...this.signalBuffer);
    const mean = this.signalBuffer.reduce((a, b) => a + b, 0) / this.signalBuffer.length;
    const variance = this.signalBuffer.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.signalBuffer.length;

    return {
      min,
      max,
      mean,
      variance,
      range: max - min,
      quality: this.calculateQuality(mean, variance),
    };
  }

  /**
   * Calculate signal quality
   */
  calculateQuality(mean, variance) {
    const range = Math.sqrt(variance);
    
    if (range > 5 && variance > 10) return 'good';
    if (range > 10 && variance > 25) return 'excellent';
    return 'poor';
  }

  /**
   * Reset generator
   */
  reset() {
    this.signalBuffer = [];
    this.currentIndex = 0;
    this.lastTime = performance.now();
    this.blinkTimer = 0;
    this.motionTimer = 0;
    this.blinkBuffer = null;
    this.motionBuffer = null;
  }
}

/**
 * React hook for synthetic signal generation
 */
export function useSyntheticSignal(config = {}) {
  const [signal, setSignal] = useState([]);
  const [stats, setStats] = useState(null);
  const generatorRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Initialize generator
  useEffect(() => {
    generatorRef.current = new SyntheticSignalGenerator(config);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [config]);

  // Start generating
  const start = useCallback(() => {
    const generate = () => {
      const sample = generatorRef.current.nextSample();
      
      setSignal(prev => {
        const newSignal = [...prev, sample];
        if (newSignal.length > 300) {
          return newSignal.slice(-300);
        }
        return newSignal;
      });

      setStats(generatorRef.current.getStats());

      animationFrameRef.current = requestAnimationFrame(generate);
    };

    generate();
  }, []);

  // Stop generating
  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Get current signal
  const getSignal = useCallback(() => {
    return generatorRef.current ? generatorRef.current.getBuffer() : [];
  }, []);

  // Get stats
  const getStats = useCallback(() => {
    return generatorRef.current ? generatorRef.current.getStats() : null;
  }, []);

  // Reset
  const reset = useCallback(() => {
    if (generatorRef.current) {
      generatorRef.current.reset();
    }
    setSignal([]);
    setStats(null);
    stop();
  }, [stop]);

  return {
    signal,
    stats,
    start,
    stop,
    getSignal,
    getStats,
    reset,
  };
}

// Export utility functions
export {
  generateSyntheticSignal,
  SyntheticSignalGenerator,
  DEFAULT_CONFIG,
};
