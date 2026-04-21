'use client';

import { useEffect, useRef } from 'react';
import { useApp } from '@/app/providers/AppProvider';
import { usePPGPipelineHook } from '@/modules/pipeline/pipeline';

export default function Scan() {
  const { stopScan, startProcessing } = useApp();
  const pipeline = usePPGPipelineHook();
  const { videoRef, canvasRef, maskCanvasRef, isCameraActive, error } = pipeline.webcam;
  
  const scanIntervalRef = useRef(null);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    if (!isCameraActive) return;

    // Start scanning loop
    scanIntervalRef.current = setInterval(async () => {
      try {
        await pipeline.processFrame();
      } catch (err) {
        console.error('Scan error:', err);
      }
    }, 1000 / 30); // 30 FPS

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, [isCameraActive, pipeline]);

  const handleStopScan = async () => {
    await pipeline.stop();
    await startProcessing();
  };

  // Toggle simulation mode
  const toggleSimulation = async () => {
    if (pipeline.isSimulationMode) {
      // Switch to real mode
      await pipeline.reset();
      await pipeline.initialize(false);
    } else {
      // Switch to simulation mode
      await pipeline.reset();
      await pipeline.initialize(true);
    }
  };

  // Get current output
  const output = pipeline.getOutput();
  const frameCount = pipeline.isSimulationMode ? pipeline.webcam.frameCountRef?.current || 0 : 0;
  const syntheticSignal = pipeline.syntheticSignal;
  const syntheticStats = syntheticSignal?.getStats();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-6xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-white">Scanning...</h2>
          <div className="flex items-center space-x-4">
            <div className="bg-slate-800 px-4 py-2 rounded-lg">
              <span className="text-sm text-slate-400">FPS:</span>
              <span className="ml-2 text-white font-mono">
                {pipeline.isSimulationMode ? '30' : pipeline.webcam.actualFPS.toFixed(0)}
              </span>
            </div>
            <div className="bg-slate-800 px-4 py-2 rounded-lg">
              <span className="text-sm text-slate-400">Progress:</span>
              <span className="ml-2 text-white font-mono">{pipeline.pipelineProgress}%</span>
            </div>
            <button
              onClick={toggleSimulation}
              className={`px-4 py-2 rounded-lg transition-colors ${
                pipeline.isSimulationMode 
                  ? 'bg-amber-600 hover:bg-amber-700 text-white' 
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {pipeline.isSimulationMode ? 'Switch to Real' : 'Switch to Sim'}
            </button>
            <button
              onClick={handleStopScan}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Stop Scan
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Video Feed */}
          <div className="lg:col-span-2 bg-slate-800 rounded-lg p-4">
            <div className="relative">
              <video
                ref={videoRef}
                className="w-full rounded-lg"
                playsInline
                muted
                autoPlay
              />
              
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
              />
              
              <canvas
                ref={maskCanvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-500">
              <span>Raw Video</span>
              <span>Green Channel Scleral ROI</span>
            </div>
          </div>

          {/* Live Metrics */}
          <div className="bg-slate-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Live Metrics</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 uppercase">Heart Rate</p>
                <p className="text-2xl font-bold text-sky-400">
                  {output.HR.toFixed(0)} <span className="text-sm">BPM</span>
                </p>
              </div>
              
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 uppercase">Venous PI</p>
                <p className="text-2xl font-bold text-amber-400">
                  {output.venous_PI.toFixed(2)}
                </p>
              </div>
              
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 uppercase">Quality</p>
                <p className={`text-2xl font-bold ${
                  output.qualityScore >= 80 ? 'text-emerald-400' :
                  output.qualityScore >= 60 ? 'text-sky-400' :
                  output.qualityScore >= 40 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {output.qualityScore.toFixed(0)}%
                </p>
              </div>
              
              <div className="bg-slate-900 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 uppercase">SNR</p>
                <p className="text-2xl font-bold text-purple-400">
                  {output.snr.toFixed(1)} dB
                </p>
              </div>
            </div>

            {/* Signal Stats (Simulation Mode) */}
            {pipeline.isSimulationMode && syntheticStats && (
              <div className="bg-slate-900 rounded-lg p-3 mb-4">
                <p className="text-xs text-slate-400 uppercase mb-2">Synthetic Signal Stats</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Range:</span>
                    <span className="ml-1 text-slate-300">{syntheticStats.range.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Mean:</span>
                    <span className="ml-1 text-slate-300">{syntheticStats.mean.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Quality:</span>
                    <span className={`ml-1 ${
                      syntheticStats.quality === 'excellent' ? 'text-emerald-400' :
                      syntheticStats.quality === 'good' ? 'text-sky-400' : 'text-amber-400'
                    }`}>
                      {syntheticStats.quality.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-slate-400">Pipeline Progress</span>
                <span className="text-sm text-white">{pipeline.pipelineProgress}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-sky-500 to-emerald-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${pipeline.pipelineProgress}%` }}
                />
              </div>
            </div>

            {/* Status */}
            <div className="text-sm text-slate-400">
              <p>Status: <span className={pipeline.pipelineState === 'running' ? 'text-emerald-400' : 'text-amber-400'}>
                {pipeline.pipelineState.toUpperCase()}
              </span></p>
              <p>Mode: <span className={pipeline.isSimulationMode ? 'text-amber-400' : 'text-sky-400'}>
                {pipeline.isSimulationMode ? 'SIMULATION' : 'REAL'}
              </span></p>
              <p>Frames: {frameCount}</p>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-500 rounded-lg mb-4">
            <p className="text-red-500 text-center">{error}</p>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-slate-800 rounded-lg p-4 text-center">
          <p className="text-slate-400">
            {pipeline.isSimulationMode 
              ? 'Simulation mode: Synthetic PPG signal with cardiac, respiratory, noise, and blink artifacts.'
              : 'Keep your eye steady. The pipeline is extracting PPG signals from the scleral region.'}
          </p>
        </div>
      </div>
    </div>
  );
}
