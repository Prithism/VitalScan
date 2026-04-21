import { useEffect, useRef, useCallback } from 'react';

// Production-grade oscilloscope-style signal plot
// Optimized for 60fps with Canvas 2D and requestAnimationFrame

export default function SignalPlot({
  width = 800,
  height = 200,
  rawSignal = [],
  filteredSignal = [],
  showFiltered = true,
  showGrid = true,
  showGridLabels = true,
  color = '#00ff00',
  filteredColor = '#ff6600',
  gridColor = '#003300',
  labelColor = '#00ff00',
  backgroundColor = '#000000',
  yRange = { min: 0, max: 255 },
  xSamples = 300,
  lineWidth = 1.5,
  filteredLineWidth = 2,
}) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const lastDrawTimeRef = useRef(0);
  const fpsHistoryRef = useRef([]);
  
  // Use refs for signal data to avoid re-renders
  const rawSignalRef = useRef([]);
  const filteredSignalRef = useRef([]);
  const lastProcessedIndexRef = useRef(0);

  // Sync signal data without re-renders
  useEffect(() => {
    rawSignalRef.current = rawSignal;
  }, [rawSignal]);

  useEffect(() => {
    filteredSignalRef.current = filteredSignal;
  }, [filteredSignal]);

  // Main render loop using requestAnimationFrame
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const now = performance.now();

    // Calculate FPS
    const frameTime = now - lastDrawTimeRef.current;
    lastDrawTimeRef.current = now;
    
    fpsHistoryRef.current.push(frameTime);
    if (fpsHistoryRef.current.length > 60) {
      fpsHistoryRef.current.shift();
    }

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    if (showGrid) {
      drawGrid(ctx, width, height, gridColor, labelColor, showGridLabels);
    }

    // Get signal data from refs
    const rawData = rawSignalRef.current;
    const filteredData = filteredSignalRef.current;

    if (rawData.length < 2) {
      animationRef.current = requestAnimationFrame(render);
      return;
    }

    // Draw raw signal
    drawSignal(ctx, rawData, color, lineWidth, yRange, xSamples);

    // Draw filtered signal overlay
    if (showFiltered && filteredData.length > 0) {
      drawSignal(ctx, filteredData, filteredColor, filteredLineWidth, yRange, xSamples);
    }

    // Draw oscilloscope effects
    drawOscilloscopeEffects(ctx, width, height);

    // Continue animation loop
    animationRef.current = requestAnimationFrame(render);
  }, [width, height, color, filteredColor, gridColor, labelColor, backgroundColor, yRange, xSamples, showGrid, showGridLabels, showFiltered, lineWidth, filteredLineWidth]);

  // Draw grid
  const drawGrid = useCallback((ctx, w, h, gridColor, labelColor, showLabels) => {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.font = '10px monospace';
    ctx.fillStyle = labelColor;

    // Vertical grid lines (time)
    const verticalLines = 10;
    const verticalSpacing = w / verticalLines;
    
    for (let i = 0; i <= verticalLines; i++) {
      const x = i * verticalSpacing;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      // Time labels
      if (showLabels && i < verticalLines) {
        const time = ((i / verticalLines) * xSamples / 60).toFixed(1);
        ctx.fillText(`${time}s`, x + 2, h - 2);
      }
    }

    // Horizontal grid lines (amplitude)
    const horizontalLines = 8;
    const horizontalSpacing = h / horizontalLines;
    const amplitudeRange = yRange.max - yRange.min;
    
    for (let i = 0; i <= horizontalLines; i++) {
      const y = i * horizontalSpacing;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      // Amplitude labels
      if (showLabels) {
        const value = yRange.max - (i / horizontalLines) * amplitudeRange;
        ctx.fillText(`${value.toFixed(0)}`, 2, y - 2);
      }
    }
  }, [yRange, xSamples]);

  // Draw signal trace
  const drawSignal = useCallback((ctx, data, signalColor, strokeWidth, yRange, numSamples) => {
    if (!data || data.length < 2) return;

    ctx.strokeStyle = signalColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Use last N samples for display
    const displayData = data.slice(-numSamples);
    const dataLength = displayData.length;
    
    if (dataLength < 2) return;

    // Calculate scaling
    const xScale = width / numSamples;
    const yScale = height / (yRange.max - yRange.min);
    const yOffset = yRange.min;

    ctx.beginPath();

    // Draw signal with sub-pixel rendering
    for (let i = 0; i < dataLength; i++) {
      const x = i * xScale;
      const y = height - (displayData[i] - yOffset) * yScale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Add glow effect for oscilloscope look
    ctx.shadowColor = signalColor;
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [width, height, yRange]);

  // Draw oscilloscope effects
  const drawOscilloscopeEffects = useCallback((ctx, w, h) => {
    // Draw trace persistence effect (fading trail)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, w, h);

    // Draw center line
    const centerY = height / 2;
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw corner brackets
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const bracketSize = 20;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(0, bracketSize);
    ctx.lineTo(0, 0);
    ctx.lineTo(bracketSize, 0);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(w - bracketSize, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, bracketSize);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(0, h - bracketSize);
    ctx.lineTo(0, h);
    ctx.lineTo(bracketSize, h);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(w - bracketSize, h);
    ctx.lineTo(w, h);
    ctx.lineTo(w, h - bracketSize);
    ctx.stroke();
  }, [height, color]);

  // Get current FPS
  const getFPS = useCallback(() => {
    if (fpsHistoryRef.current.length === 0) return 0;
    const avgFrameTime = fpsHistoryRef.current.reduce((a, b) => a + b, 0) / fpsHistoryRef.current.length;
    return 1000 / avgFrameTime;
  }, []);

  // Start animation
  useEffect(() => {
    animationRef.current = requestAnimationFrame(render);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [render]);

  // Clear signal
  const clearSignal = useCallback(() => {
    rawSignalRef.current = [];
    filteredSignalRef.current = [];
    lastProcessedIndexRef.current = 0;
  }, []);

  // Force redraw
  const redraw = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    lastDrawTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(render);
  }, [render]);

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
      
      {/* FPS indicator */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          color: labelColor,
          fontSize: '10px',
          fontFamily: 'monospace',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          padding: '2px 6px',
          borderRadius: '2px',
        }}
      >
        {getFPS().toFixed(1)} FPS
      </div>

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          display: 'flex',
          gap: '16px',
          fontSize: '10px',
          fontFamily: 'monospace',
          color: labelColor,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          padding: '4px 8px',
          borderRadius: '2px',
        }}
      >
        <span style={{ color: color }}>● Raw</span>
        {showFiltered && <span style={{ color: filteredColor }}>● Filtered</span>}
      </div>
    </div>
  );
}