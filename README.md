# Scleral PPG

A web-based application for detecting and analyzing scleral photoplethysmography (PPG) signals using computer vision and signal processing techniques.

## Features

- Real-time eye tracking using MediaPipe Iris
- Scleral mask generation for signal extraction
- Pulse signal detection and analysis
- FFT analysis for frequency domain processing
- Signal quality assessment
- Butterworth filtering for noise reduction

## Tech Stack

- React 18
- Vite
- Tailwind CSS
- MediaPipe Iris
- Zustand for state management

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview

```bash
npm run preview
```

## Project Structure

```
src/
├── app/              # React Router setup and layout
├── modules/          # Feature modules
│   ├── blinkDetection/
│   ├── butterworth/
│   ├── components/   # Reusable components
│   ├── eyeTracker/
│   ├── fftAnalyzer/
│   ├── pipeline/
│   ├── processing/
│   ├── pulseMetrics/
│   ├── qualityEngine/
│   ├── scan/
│   ├── scleraMask/
│   ├── signalExtractor/
│   ├── simulation/
│   └── webcamManager/
└── styles/           # Global styles
```

## License

MIT
