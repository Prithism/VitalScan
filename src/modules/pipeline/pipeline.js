/**
 * End-to-End PPG Signal Processing Pipeline
 * 
 * Camera → EyeTracker → ScleraMask → SignalExtractor → 
 * Butterworth → FFTAnalyzer → PulseMetrics → QualityEngine → UIData
 * 
 * Real-time browser pipeline with automatic data flow
 * 
 * Output: { V(t), V_filtered, venous_PI, HR, qualityScore }
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { useWebcamManager } from '@/modules/webcamManager/webcamManager';
import { useEyeTracker } from '@/modules/eyeTracker/eyeTracker';
import { useScleraMask } from '@/modules/scleraMask/scleraMask';
import { useSignalExtractor } from '@/modules/signalExtractor/signalExtractor';
import { useButterworth } from '@/modules/butterworth/butterworth';
import { useFFTAnalyzer } from '@/modules/fftAnalyzer/fftAnalyzer';
import { usePulseMetrics } from '@/modules/pulseMetrics/pulseMetrics';
import { useQualityEngine } from '@/modules/qualityEngine/qualityEngine';
import { useBlinkDetection } from '@/modules/blinkDetection/blinkDetection';
import { useSyntheticSignal } from '@/modules/simulation/simulation';

// Pipeline states
const PIPELINE_STATE = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  ERROR: 'error',
  COMPLETE: 'complete'
};

// Pipeline configuration
const CONFIG = {
  samplingRate: 30,        // Target sampling rate (Hz)
  bufferSize: 30 * 10,     // 10 seconds buffer
  minSignalLength: 60,     // Minimum samples for valid analysis
  analysisInterval: 1000,  // Analysis update interval (ms)
};

/**
 * Main Pipeline Manager Hook
 */
export function usePPGPipeline() {
  // Module hooks
  const webcam = useWebcamManager();
  const eyeTracker = useEyeTracker();
  const scleraMask = useScleraMask();
  const signalExtractor = useSignalExtractor();
  const butterworth = useButterworth();
  const fftAnalyzer = useFFTAnalyzer();
  const pulseMetrics = usePulseMetrics();
  const qualityEngine = useQualityEngine();
  const blinkDetection = useBlinkDetection();
  const syntheticSignal = useSyntheticSignal();

  // Pipeline state
  const [pipelineState, setPipelineState] = useState(PIPELINE_STATE.IDLE);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [lastOutput, setLastOutput] = useState(null);
  const [processingLog, setProcessingLog] = useState([]);
  const [error, setError] = useState(null);
  const [isSimulationMode, setIsSimulationMode] = useState(false);

  // Refs for pipeline data
  const frameCountRef = useRef(0);
  const lastAnalysisTimeRef = useRef(0);
  const pipelineBufferRef = useRef([]);
  const eyeDataBufferRef = useRef([]);
  const isSimulationRef = useRef(false);

  // Add log entry
  const addLog = useCallback((message, level = 'info') => {
    setProcessingLog(prev => {
      const newLog = [...prev, { 
        timestamp: Date.now(), 
        message, 
        level,
        frame: frameCountRef.current 
      }];
      return newLog.slice(-50); // Keep last 50 entries
    });
  }, []);

  // Initialize pipeline
  const initialize = useCallback(async (simulation = false) => {
    try {
      addLog('Initializing pipeline...');
      isSimulationRef.current = simulation;
      setIsSimulationMode(simulation);

      if (simulation) {
        // Start synthetic signal generator
        syntheticSignal.start();
        addLog('Simulation mode: synthetic signal generator started');
        setPipelineState(PIPELINE_STATE.RUNNING);
        setPipelineProgress(10);
        return true;
      }

      // Start camera
      const cameraStarted = await webcam.startCamera();
      if (!cameraStarted) {
        throw new Error('Failed to start camera');
      }
      addLog('Camera started');

      // Initialize eye tracker
      const eyeInitialized = await eyeTracker.initializeMediaPipe();
      if (!eyeInitialized) {
        throw new Error('Failed to initialize eye tracker');
      }
      addLog('Eye tracker initialized');

      // Set pipeline state
      setPipelineState(PIPELINE_STATE.RUNNING);
      setPipelineProgress(10);
      addLog('Pipeline running');

      return true;
    } catch (err) {
      setError(err.message);
      setPipelineState(PIPELINE_STATE.ERROR);
      addLog(`Error: ${err.message}`, 'error');
      return false;
    }
  }, [webcam, eyeTracker, syntheticSignal, addLog]);

  // Process single frame through pipeline
  const processFrame = useCallback(async () => {
    if (pipelineState !== PIPELINE_STATE.RUNNING) return null;

    try {
      frameCountRef.current++;

      let frameData, eyeData, signalData;

      if (isSimulationRef.current) {
        // Simulation mode: use synthetic signal
        const syntheticSample = syntheticSignal.nextSample();
        const syntheticBuffer = syntheticSignal.getSignal();
        
        // Create fake frame data for compatibility
        frameData = {
          width: 1280,
          height: 720,
          data: new Uint8ClampedArray(1280 * 720 * 4).fill(0),
          timestamp: Date.now(),
          actualFPS: 30,
        };
        
        // Create fake eye data
        eyeData = {
          eyeRegions: {
            left: {
              center: { x: 0.5, y: 0.5 },
              boundingBox: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
              landmarks: [],
            },
            right: {
              center: { x: 0.5, y: 0.5 },
              boundingBox: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
              landmarks: [],
            },
          },
          irisCenter: { x: 0.5, y: 0.5 },
          eyelidLandmarks: {
            left: {
              upper: { x: 0.5, y: 0.45 },
              lower: { x: 0.5, y: 0.55 },
            },
            right: {
              upper: { x: 0.5, y: 0.45 },
              lower: { x: 0.5, y: 0.55 },
            },
          },
          leftOpenness: 0.8,
          rightOpenness: 0.8,
          averageOpenness: 0.8,
          gazeDirection: { x: 0, y: 0 },
          timestamp: Date.now(),
        };

        // Create fake signal data
        signalData = {
          timestamp: Date.now(),
          greenSignal: syntheticSample,
          acComponent: syntheticSample - 128,
          dcComponent: 128,
          buffer: syntheticBuffer,
          stats: syntheticSignal.getStats(),
          frameTime: 33,
        };
      } else {
        // Real camera mode
        frameData = webcam.captureFrame();
        if (!frameData) {
          addLog('No frame data', 'warning');
          return null;
        }

        eyeData = await eyeTracker.processFrame(frameData);
        if (!eyeData) {
          addLog('Eye tracking failed', 'warning');
          return null;
        }

        const eyeROI = eyeTracker.getEyeROI();
        if (!eyeROI) {
          addLog('No eye ROI', 'warning');
          return null;
        }

        if (frameCountRef.current === 1) {
          scleraMask.createMask(frameData, eyeData);
        } else {
          scleraMask.updateMask(frameData, eyeData);
        }

        const maskValid = scleraMask.validateMask(frameData);
        if (!maskValid) {
          addLog('Mask validation failed', 'warning');
          return null;
        }

        signalData = signalExtractor.extractSignal(frameData, {
          nasal: {
            x: Math.floor(eyeROI.x * frameData.width),
            y: Math.floor(eyeROI.y * frameData.height),
            width: Math.floor(eyeROI.width * frameData.width / 2),
            height: Math.floor(eyeROI.height * frameData.height),
          },
          temporal: {
            x: Math.floor((eyeROI.x + eyeROI.width / 2) * frameData.width),
            y: Math.floor(eyeROI.y * frameData.height),
            width: Math.floor(eyeROI.width * frameData.width / 2),
            height: Math.floor(eyeROI.height * frameData.height),
          },
        });

        if (!signalData) {
          addLog('Signal extraction failed', 'warning');
          return null;
        }
      }

      // Step 5: Butterworth filtering
      const filteredSignal = butterworth.processSample(signalData.greenSignal);
      if (filteredSignal === null) {
        addLog('Filter initialization failed', 'warning');
        return null;
      }

      // Step 6: FFT analysis
      const fftResult = fftAnalyzer.processSample(filteredSignal);

      // Step 7: Pulse metrics
      const pulseResult = pulseMetrics.processSample(filteredSignal);

      // Step 8: Quality assessment
      const qualityResult = qualityEngine.calculateQuality({
        snr: fftResult?.snr || 0,
        signal: [filteredSignal],
        powerSpectrum: fftResult?.powerSpectrum || [],
        samplingRate: CONFIG.samplingRate,
        intervals: pulseResult?.intervals || []
      });

      // Step 9: Blink detection
      const blinkResult = blinkDetection.processEyeData(eyeData, [filteredSignal], CONFIG.samplingRate);

      // Update progress
      setPipelineProgress(Math.min(100, 10 + (frameCountRef.current % 90)));

      // Store output
      const output = {
        V_t: signalData.greenSignal,
        V_filtered: filteredSignal,
        venous_PI: blinkResult?.venous_PI || 0,
        HR: pulseResult?.heartRateBPM || 0,
        qualityScore: qualityResult?.qualityScore || 0,
        fft: fftResult,
        pulse: pulseResult,
        quality: qualityResult,
        blink: blinkResult,
        eyeData,
        timestamp: Date.now(),
        frame: frameCountRef.current,
      };

      setLastOutput(output);
      pipelineBufferRef.current.push(output);
      eyeDataBufferRef.current.push(eyeData);

      // Keep buffers bounded
      if (pipelineBufferRef.current.length > CONFIG.bufferSize) {
        pipelineBufferRef.current.shift();
      }
      if (eyeDataBufferRef.current.length > CONFIG.bufferSize) {
        eyeDataBufferRef.current.shift();
      }

      // Periodic analysis log
      if (frameCountRef.current % 30 === 0) {
        addLog(`Frame ${frameCountRef.current}: HR=${output.HR.toFixed(0)} BPM, PI=${output.venous_PI.toFixed(2)}, Q=${output.qualityScore.toFixed(0)}%`);
      }

      return output;
    } catch (err) {
      setError(err.message);
      addLog(`Processing error: ${err.message}`, 'error');
      return null;
    }
  }, [
    pipelineState,
    webcam, eyeTracker, scleraMask, signalExtractor,
    butterworth, fftAnalyzer, pulseMetrics, qualityEngine, blinkDetection, syntheticSignal,
    addLog
  ]);

  // Pipeline loop
  useEffect(() => {
    let animationFrameId;

    const pipelineLoop = async () => {
      if (pipelineState === PIPELINE_STATE.RUNNING) {
        await processFrame();
      }
      animationFrameId = requestAnimationFrame(pipelineLoop);
    };

    if (pipelineState === PIPELINE_STATE.RUNNING) {
      animationFrameId = requestAnimationFrame(pipelineLoop);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [pipelineState, processFrame]);

  // Get current pipeline output
  const getOutput = useCallback(() => {
    if (!lastOutput) {
      return {
        V_t: 0,
        V_filtered: 0,
        venous_PI: 0,
        HR: 0,
        qualityScore: 0,
        status: 'no_data'
      };
    }

    return {
      V_t: lastOutput.V_t,
      V_filtered: lastOutput.V_filtered,
      venous_PI: lastOutput.venous_PI,
      HR: lastOutput.HR,
      qualityScore: lastOutput.qualityScore,
      status: pipelineState,
      confidence: lastOutput.quality?.confidence || 0,
      snr: lastOutput.fft?.snr || 0,
      heartRateBPM: lastOutput.HR,
      frequency: lastOutput.fft?.dominantFrequency?.frequency || 0,
      powerSpectrum: lastOutput.fft?.powerSpectrum || [],
      cleanSegments: lastOutput.blink?.cleanSegments || [],
      blinkRatio: lastOutput.blink?.blinkRatio || 0,
    };
  }, [lastOutput, pipelineState]);

  // Get pipeline history
  const getHistory = useCallback(() => {
    return pipelineBufferRef.current;
  }, []);

  // Get average metrics
  const getAverageMetrics = useCallback(() => {
    if (pipelineBufferRef.current.length === 0) return null;

    const avgHR = pipelineBufferRef.current.reduce((sum, p) => sum + (p.HR || 0), 0) / pipelineBufferRef.current.length;
    const avgPI = pipelineBufferRef.current.reduce((sum, p) => sum + (p.venous_PI || 0), 0) / pipelineBufferRef.current.length;
    const avgQuality = pipelineBufferRef.current.reduce((sum, p) => sum + (p.qualityScore || 0), 0) / pipelineBufferRef.current.length;

    return {
      HR: avgHR,
      venous_PI: avgPI,
      qualityScore: avgQuality,
      count: pipelineBufferRef.current.length,
    };
  }, []);

  // Pause pipeline
  const pause = useCallback(() => {
    setPipelineState(PIPELINE_STATE.PAUSED);
    addLog('Pipeline paused');
  }, [addLog]);

  // Resume pipeline
  const resume = useCallback(() => {
    setPipelineState(PIPELINE_STATE.RUNNING);
    addLog('Pipeline resumed');
  }, [addLog]);

  // Stop pipeline
  const stop = useCallback(() => {
    setPipelineState(PIPELINE_STATE.IDLE);
    if (isSimulationRef.current) {
      syntheticSignal.stop();
    } else {
      webcam.stopCamera();
    }
    addLog('Pipeline stopped');
  }, [webcam, syntheticSignal, addLog]);

  // Reset pipeline
  const reset = useCallback(() => {
    setPipelineState(PIPELINE_STATE.IDLE);
    setPipelineProgress(0);
    setLastOutput(null);
    setProcessingLog([]);
    setError(null);
    setIsSimulationMode(false);
    frameCountRef.current = 0;
    pipelineBufferRef.current = [];
    eyeDataBufferRef.current = [];
    
    if (isSimulationRef.current) {
      syntheticSignal.reset();
    } else {
      webcam.stopCamera();
    }
    signalExtractor.reset();
    butterworth.reset();
    fftAnalyzer.reset();
    pulseMetrics.reset();
    qualityEngine.reset();
    blinkDetection.reset();
    
    addLog('Pipeline reset');
  }, [webcam, syntheticSignal, signalExtractor, butterworth, fftAnalyzer, pulseMetrics, qualityEngine, blinkDetection, addLog]);

  return {
    // State
    pipelineState,
    pipelineProgress,
    lastOutput,
    processingLog,
    error,
    isSimulationMode,
    
    // Methods
    initialize,
    processFrame,
    getOutput,
    getHistory,
    getAverageMetrics,
    pause,
    resume,
    stop,
    reset,
    
    // Module access
    webcam,
    eyeTracker,
    scleraMask,
    signalExtractor,
    butterworth,
    fftAnalyzer,
    pulseMetrics,
    qualityEngine,
    blinkDetection,
    syntheticSignal,
  };
}

/**
 * React hook wrapper for pipeline
 */
export function usePPGPipelineHook() {
  const pipeline = usePPGPipeline();
  const [output, setOutput] = useState(null);

  // Update output when pipeline changes
  useEffect(() => {
    const intervalId = setInterval(() => {
      setOutput(pipeline.getOutput());
    }, CONFIG.analysisInterval);

    return () => clearInterval(intervalId);
  }, [pipeline]);

  return {
    ...pipeline,
    output,
  };
}

// Export utility functions
export {
  PIPELINE_STATE,
  CONFIG,
};
