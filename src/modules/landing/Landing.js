'use client';

import { useApp } from '@/app/providers/AppProvider';
import { useWebcamManager } from '@/modules/webcamManager/webcamManager';
import { useEyeTracker } from '@/modules/eyeTracker/eyeTracker';
import { useScleraMask } from '@/modules/scleraMask/scleraMask';
import { useSignalExtractor } from '@/modules/signalExtractor/signalExtractor';
import { usePulseMetrics } from '@/modules/pulseMetrics/pulseMetrics';
import { useQualityEngine } from '@/modules/qualityEngine/qualityEngine';

export default function Landing() {
  const { startScan } = useApp();
  const { error } = useWebcamManager();
  const { quality } = useEyeTracker();
  const { maskQuality } = useScleraMask();
  const { signalQuality } = useSignalExtractor();
  const { heartRate } = usePulseMetrics();
  const { qualityLevel } = useQualityEngine();

  const handleStartScan = async () => {
    await startScan();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            Scleral PPG
          </h1>
          <p className="text-xl text-ppg-300">
            Non-contact heart rate monitoring using scleral photoplethysmography
          </p>
        </div>

        <div className="bg-ppg-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4">System Status</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-ppg-900 rounded p-4">
              <p className="text-sm text-ppg-400">Camera</p>
              <p className={`text-lg font-medium ${error ? 'text-red-500' : 'text-green-500'}`}>
                {error ? 'Error' : 'Ready'}
              </p>
            </div>
            
            <div className="bg-ppg-900 rounded p-4">
              <p className="text-sm text-ppg-400">Eye Tracking</p>
              <p className={`text-lg font-medium ${
                quality === 'none' ? 'text-yellow-500' :
                quality === 'poor' ? 'text-red-500' :
                quality === 'fair' ? 'text-yellow-500' : 'text-green-500'
              }`}>
                {quality.charAt(0).toUpperCase() + quality.slice(1)}
              </p>
            </div>
            
            <div className="bg-ppg-900 rounded p-4">
              <p className="text-sm text-ppg-400">Mask Quality</p>
              <p className={`text-lg font-medium ${
                maskQuality === 'none' ? 'text-yellow-500' :
                maskQuality === 'valid' ? 'text-green-500' : 'text-red-500'
              }`}>
                {maskQuality.charAt(0).toUpperCase() + maskQuality.slice(1)}
              </p>
            </div>
            
            <div className="bg-ppg-900 rounded p-4">
              <p className="text-sm text-ppg-400">Signal Quality</p>
              <p className={`text-lg font-medium ${
                signalQuality === 'none' ? 'text-yellow-500' :
                signalQuality === 'processed' ? 'text-green-500' : 'text-red-500'
              }`}>
                {signalQuality.charAt(0).toUpperCase() + signalQuality.slice(1)}
              </p>
            </div>
          </div>
        </div>

        {heartRate && (
          <div className="bg-ppg-800 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold text-white mb-4">Last Measurement</h2>
            <div className="text-center">
              <p className="text-sm text-ppg-400">Heart Rate</p>
              <p className="text-5xl font-bold text-blue-400">
                {heartRate.toFixed(1)} <span className="text-lg">BPM</span>
              </p>
            </div>
          </div>
        )}

        <div className="bg-ppg-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4">Quality Assessment</h2>
          <div className="text-center">
            <p className="text-sm text-ppg-400 mb-2">Overall Quality</p>
            <p className={`text-3xl font-bold ${
              qualityLevel === 'excellent' ? 'text-green-500' :
              qualityLevel === 'good' ? 'text-blue-400' :
              qualityLevel === 'fair' ? 'text-yellow-500' : 'text-red-500'
            }`}>
              {qualityLevel.charAt(0).toUpperCase() + qualityLevel.slice(1)}
            </p>
          </div>
        </div>

        <button
          onClick={handleStartScan}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 text-lg"
        >
          Start Scan
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-900/30 border border-red-500 rounded-lg">
            <p className="text-red-500 text-center">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
