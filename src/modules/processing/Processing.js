'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useApp } from '@/app/providers/AppProvider';
import { usePPGPipelineHook } from '@/modules/pipeline/pipeline';
import SignalPlot from '@/modules/components/SignalPlot';
import { FFTPlot } from '@/modules/fftAnalyzer/fftAnalyzer';

// Medical color palette
const COLORS = {
  primary: '#0ea5e9',
  secondary: '#10b981',
  accent: '#f59e0b',
  danger: '#ef4444',
  warning: '#f97316',
  success: '#22c55e',
  background: '#0f172a',
  surface: '#1e293b',
  text: '#f1f5f9',
  textMuted: '#94a3b8',
  grid: '#334155',
};

// Card component
function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 overflow-hidden ${className}`}>
      {title && (
        <div className="px-4 py-3 bg-slate-800/50 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

// Metric display component
function MetricDisplay({ label, value, unit, subtext, color = 'primary' }) {
  const colorClasses = {
    primary: 'text-sky-400',
    secondary: 'text-emerald-400',
    accent: 'text-amber-400',
    danger: 'text-red-400',
    warning: 'text-orange-400',
    success: 'text-green-400',
  };

  return (
    <div className="flex flex-col items-center justify-center p-3">
      <span className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</span>
      <div className="flex items-baseline">
        <span className={`text-3xl font-bold ${colorClasses[color] || colorClasses.primary}`}>
          {value}
        </span>
        {unit && <span className="text-sm text-slate-500 ml-1">{unit}</span>}
      </div>
      {subtext && <span className="text-xs text-slate-500 mt-1">{subtext}</span>}
    </div>
  );
}

// Quality indicator component
function QualityIndicator({ score, label = 'Signal Quality' }) {
  const getQualityColor = (s) => {
    if (s >= 80) return 'text-emerald-400';
    if (s >= 60) return 'text-sky-400';
    if (s >= 40) return 'text-amber-400';
    return 'text-red-400';
  };

  const getQualityLabel = (s) => {
    if (s >= 80) return 'EXCELLENT';
    if (s >= 60) return 'GOOD';
    if (s >= 40) return 'FAIR';
    return 'POOR';
  };

  return (
    <div className="flex flex-col items-center justify-center p-3">
      <span className="text-xs text-slate-400 uppercase tracking-wider mb-2">{label}</span>
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="48"
            cy="48"
            r="40"
            fill="none"
            stroke="#334155"
            strokeWidth="8"
          />
          <circle
            cx="48"
            cy="48"
            r="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            className={`${getQualityColor(score)} transition-all duration-500`}
            strokeDasharray={251.2}
            strokeDashoffset={251.2 - (251.2 * score) / 100}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className={`text-2xl font-bold ${getQualityColor(score)}`}>{score}%</span>
          <span className="text-[10px] text-slate-500 uppercase">{getQualityLabel(score)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Processing() {
  const { resetApp } = useApp();
  const pipeline = usePPGPipelineHook();
  const [output, setOutput] = useState(null);
  const [history, setHistory] = useState([]);

  // Update output from pipeline
  useEffect(() => {
    if (pipeline.output) {
      setOutput(pipeline.output);
      setHistory(prev => [...prev.slice(-50), pipeline.output]);
    }
  }, [pipeline.output]);

  const handleReset = () => {
    pipeline.reset();
    resetApp();
  };

  // Get average metrics
  const avgMetrics = pipeline.getAverageMetrics();

  // Get clean segments
  const cleanSegments = output?.cleanSegments || [];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">PPG Signal Processing</h1>
            <p className="text-sm text-slate-400">Real-time analysis pipeline</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${
              pipeline.isSimulationMode 
                ? 'bg-amber-900/50 text-amber-400' 
                : 'bg-emerald-900/50 text-emerald-400'
            }`}>
              {pipeline.isSimulationMode ? 'SIMULATION MODE' : 'REAL MODE'}
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${
              pipeline.pipelineState === 'running' ? 'bg-emerald-900/50 text-emerald-400' :
              pipeline.pipelineState === 'paused' ? 'bg-amber-900/50 text-amber-400' :
              'bg-slate-700 text-slate-400'
            }`}>
              {pipeline.pipelineState.toUpperCase()}
            </div>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
            >
              Return to Home
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        {/* Metrics Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="col-span-1">
            <MetricDisplay
              label="Heart Rate"
              value={output?.HR?.toFixed(0) || avgMetrics?.HR?.toFixed(0) || 0}
              unit="BPM"
              color="primary"
              subtext={output?.status === 'running' ? 'Live' : 'Calculating...'}
            />
          </Card>

          <Card className="col-span-1">
            <MetricDisplay
              label="Venous PI"
              value={output?.venous_PI?.toFixed(2) || avgMetrics?.venous_PI?.toFixed(2) || 0}
              unit=""
              color="accent"
              subtext={output?.blinkRatio ? `${output.blinkRatio.toFixed(1)} /min` : 'Calculating...'}
            />
          </Card>

          <Card className="col-span-1">
            <QualityIndicator
              score={output?.qualityScore || avgMetrics?.qualityScore || 0}
            />
          </Card>

          <Card className="col-span-1">
            <div className="flex flex-col items-center justify-center p-3">
              <span className="text-xs text-slate-400 uppercase tracking-wider mb-2">Clean Data</span>
              <div className="text-3xl font-bold text-emerald-400">
                {cleanSegments.length}
              </div>
              <span className="text-xs text-slate-500 mt-1">Segments</span>
              <div className="text-xs text-slate-500 mt-1">
                {cleanSegments.reduce((sum, s) => sum + s.duration, 0).toFixed(1)}s total
              </div>
            </div>
          </Card>
        </div>

        {/* Visualization Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Waveform Display */}
          <Card title="PPG Waveform" className="lg:col-span-2">
            <div className="h-64">
              <SignalPlot
                width={800}
                height={250}
                rawSignal={output?.V_t ? [output.V_t] : []}
                filteredSignal={output?.V_filtered ? [output.V_filtered] : []}
                showFiltered={true}
                showGrid={true}
                color={COLORS.primary}
                filteredColor={COLORS.secondary}
                gridColor={COLORS.grid}
                backgroundColor={COLORS.background}
                yRange={{ min: 0, max: 255 }}
                xSamples={300}
              />
              <div className="flex justify-between mt-2 text-xs text-slate-500">
                <span>Raw (Blue)</span>
                <span>Filtered (Green)</span>
              </div>
            </div>
          </Card>

          {/* FFT Spectrum */}
          <Card title="Frequency Spectrum">
            <div className="h-64">
              {output?.powerSpectrum ? (
                <FFTPlot
                  width={600}
                  height={250}
                  powerSpectrum={output.powerSpectrum}
                  dominantFrequency={output.frequency || 0}
                  samplingRate={30}
                  hrMin={0.5}
                  hrMax={4.0}
                  color={COLORS.primary}
                  dominantColor={COLORS.danger}
                  gridColor={COLORS.grid}
                  backgroundColor={COLORS.background}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">
                  Waiting for FFT data...
                </div>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-500 flex justify-between">
              <span>Frequency (Hz)</span>
              <span>Power Spectrum</span>
            </div>
          </Card>

          {/* Quality Components */}
          <Card title="Quality Metrics">
            <div className="space-y-3">
              {output?.quality?.components && (
                <>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">SNR</span>
                      <span className="text-slate-300">{output.quality.components.snr}%</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-sky-500 h-2 rounded-full"
                        style={{ width: `${output.quality.components.snr}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">Motion</span>
                      <span className="text-slate-300">{output.quality.components.motion}%</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full"
                        style={{ width: `${output.quality.components.motion}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">Blink</span>
                      <span className="text-slate-300">{output.quality.components.blink}%</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full"
                        style={{ width: `${output.quality.components.blink}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">Spectral</span>
                      <span className="text-slate-300">{output.quality.components.spectral}%</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-purple-500 h-2 rounded-full"
                        style={{ width: `${output.quality.components.spectral}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Detailed Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {/* FFT Details */}
          <Card title="FFT Analysis">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Dominant Frequency</span>
                <span className="text-slate-200">
                  {output?.frequency?.toFixed(2) || 0} Hz
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Heart Rate</span>
                <span className="text-slate-200">
                  {output?.heartRateBPM?.toFixed(0) || 0} BPM
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">SNR</span>
                <span className="text-slate-200">
                  {output?.snr?.toFixed(1) || 0} dB
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Confidence</span>
                <span className="text-slate-200">
                  {(output?.confidence || 0).toFixed(0)}%
                </span>
              </div>
            </div>
          </Card>

          {/* Pulse Metrics */}
          <Card title="Pulse Metrics">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Heart Rate</span>
                <span className="text-slate-200">
                  {output?.HR?.toFixed(0) || 0} BPM
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">HRV (RMSSD)</span>
                <span className="text-slate-200">
                  {output?.pulse?.HRV?.toFixed(2) || 0} ms
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Venous PI</span>
                <span className="text-slate-200">
                  {output?.venous_PI?.toFixed(2) || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Confidence</span>
                <span className="text-slate-200">
                  {(output?.pulse?.confidence || 0).toFixed(0)}%
                </span>
              </div>
            </div>
          </Card>

          {/* Blink Analysis */}
          <Card title="Blink Analysis">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Blink Rate</span>
                <span className="text-slate-200">
                  {output?.blinkRatio?.toFixed(1) || 0} /min
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Blink Count</span>
                <span className="text-slate-200">
                  {output?.blink?.blinkCount || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Clean Segments</span>
                <span className="text-slate-200">
                  {cleanSegments.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Confidence Adj.</span>
                <span className="text-slate-200">
                  {(output?.blink?.confidenceAdjustment || 1).toFixed(2)}
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Clean Segments Info */}
        {cleanSegments.length > 0 && (
          <Card title="Clean Data Segments">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cleanSegments.map((segment, index) => (
                <div key={index} className="bg-slate-700/50 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-emerald-400">
                      Segment {index + 1}
                    </span>
                    <span className="text-xs text-slate-400">
                      {(segment.duration * 1000).toFixed(0)}ms
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Start: {segment.startIndex}</span>
                    <span>Confidence: {(segment.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Pipeline Progress */}
        <div className="mt-6">
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

        {/* Processing Log */}
        {pipeline.processingLog.length > 0 && (
          <Card title="Processing Log" className="mt-6 max-h-48 overflow-y-auto">
            <div className="space-y-1">
              {pipeline.processingLog.slice(-10).map((log, index) => (
                <div key={index} className={`text-xs font-mono ${
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warning' ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  <span className="opacity-50">[{log.frame}]</span> {log.message}
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
