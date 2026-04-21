'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import { useSignalStore } from '@/modules/signalExtractor/signalExtractor';
import { useEyeTracker } from '@/modules/eyeTracker/eyeTracker';
import { useWebcamManager } from '@/modules/webcamManager/webcamManager';
import { usePulseMetrics } from '@/modules/pulseMetrics/pulseMetrics';
import { useQualityEngine } from '@/modules/qualityEngine/qualityEngine';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [appState, setAppState] = useState({
    currentScreen: 'landing',
    isScanning: false,
    isProcessing: false,
    lastScanData: null,
  });

  const webcamManager = useWebcamManager();
  const eyeTracker = useEyeTracker();
  const signalStore = useSignalStore();
  const pulseMetrics = usePulseMetrics();
  const qualityEngine = useQualityEngine();

  const startScan = useCallback(async () => {
    setAppState(prev => ({ ...prev, currentScreen: 'scan', isScanning: true }));
    await webcamManager.startCamera();
  }, [webcamManager]);

  const stopScan = useCallback(async () => {
    setAppState(prev => ({ ...prev, isScanning: false }));
    await webcamManager.stopCamera();
  }, [webcamManager]);

  const startProcessing = useCallback(async () => {
    setAppState(prev => ({ ...prev, currentScreen: 'processing', isProcessing: true }));
    await signalStore.processSignal();
  }, [signalStore]);

  const resetApp = useCallback(() => {
    setAppState({
      currentScreen: 'landing',
      isScanning: false,
      isProcessing: false,
      lastScanData: null,
    });
    signalStore.reset();
    eyeTracker.reset();
    qualityEngine.reset();
  }, [signalStore, eyeTracker, qualityEngine]);

  const value = {
    appState,
    setAppState,
    webcamManager,
    eyeTracker,
    signalStore,
    pulseMetrics,
    qualityEngine,
    startScan,
    stopScan,
    startProcessing,
    resetApp,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
