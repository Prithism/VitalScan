from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import numpy as np
from scipy import signal
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import io
import base64

app = FastAPI(title="VitalScan Signal Processing API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SignalData(BaseModel):
    raw_signal: List[float]
    sample_rate: float = 30.0  # Default 30 FPS

class FilteredSignal(BaseModel):
    filtered_signal: List[float]
    raw_vs_filtered_b64: str

def detrend_signal(data: np.ndarray) -> np.ndarray:
    """Remove linear trend from signal"""
    return signal.detrend(data)

def bandpass_filter(data: np.ndarray, sample_rate: float, low_freq: float = 0.5, high_freq: float = 8.0) -> np.ndarray:
    """Apply bandpass filter for 0.5-8 Hz range"""
    nyquist = sample_rate / 2
    low = low_freq / nyquist
    high = high_freq / nyquist
    
    # Use Butterworth filter
    b, a = signal.butter(4, [low, high], btype='band')
    filtered = signal.filtfilt(b, a, data)
    
    return filtered

def remove_motion_artifacts(data: np.ndarray, sample_rate: float) -> np.ndarray:
    """Remove low-frequency motion artifacts using high-pass filter"""
    nyquist = sample_rate / 2
    high = 0.3 / nyquist  # Remove below 0.3 Hz
    
    b, a = signal.butter(2, high, btype='high')
    cleaned = signal.filtfilt(b, a, data)
    
    return cleaned

def savitzky_golay_smooth(data: np.ndarray, window_size: int = 11, poly_order: int = 3) -> np.ndarray:
    """Apply Savitzky-Golay smoothing"""
    # Ensure window_size is odd
    if window_size % 2 == 0:
        window_size += 1
    return signal.savgol_filter(data, window_size, poly_order)

def normalize_signal(data: np.ndarray) -> np.ndarray:
    """Normalize signal to 0-1 range"""
    min_val = np.min(data)
    max_val = np.max(data)
    
    if max_val - min_val == 0:
        return np.zeros_like(data)
    
    return (data - min_val) / (max_val - min_val)

def generate_comparison_plot(raw: np.ndarray, filtered: np.ndarray) -> str:
    """Generate base64 encoded comparison plot"""
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(12, 8))
    
    # Raw signal
    ax1.plot(raw, 'b-', linewidth=1)
    ax1.set_title('Raw Signal (Green Channel V(t))')
    ax1.set_ylabel('Intensity')
    ax1.grid(True, alpha=0.3)
    
    # After detrend and bandpass
    ax2.plot(filtered, 'r-', linewidth=1)
    ax2.set_title('Filtered Signal (0.5-8 Hz Bandpass)')
    ax2.set_ylabel('Amplitude')
    ax2.grid(True, alpha=0.3)
    
    # FFT comparison
    n = len(filtered)
    freq_raw = np.fft.rfftfreq(n, 1/n)
    fft_raw = np.abs(np.fft.rfft(raw))
    fft_filtered = np.abs(np.fft.rfft(filtered))
    
    ax3.plot(freq_raw[:50], fft_raw[:50], 'b-', label='Raw', alpha=0.7)
    ax3.plot(freq_raw[:50], fft_filtered[:50], 'r-', label='Filtered', alpha=0.7)
    ax3.set_title('Frequency Domain Comparison')
    ax3.set_xlabel('Frequency (Hz)')
    ax3.set_ylabel('Magnitude')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    ax3.set_xlim([0, 10])
    
    plt.tight_layout()
    
    # Convert to base64
    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=100, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)
    
    return base64.b64encode(buf.read()).decode('utf-8')

@app.post("/process-signal", response_model=FilteredSignal)
async def process_signal(data: SignalData):
    """Process raw V(t) signal and return filtered result"""
    try:
        raw = np.array(data.raw_signal)
        sample_rate = data.sample_rate
        
        if len(raw) < 10:
            raise HTTPException(status_code=400, detail="Signal too short (minimum 10 samples)")
        
        # Step 1: Detrend
        detrended = detrend_signal(raw)
        
        # Step 2: Bandpass filter (0.5-8 Hz)
        bandpassed = bandpass_filter(detrended, sample_rate)
        
        # Step 3: Remove motion artifacts
        motion_removed = remove_motion_artifacts(bandpassed, sample_rate)
        
        # Step 4: Savitzky-Golay smoothing
        smoothed = savitzky_golay_smooth(motion_removed, window_size=11, poly_order=3)
        
        # Step 5: Normalize
        normalized = normalize_signal(smoothed)
        
        # Generate comparison plot
        plot_b64 = generate_comparison_plot(raw, normalized)
        
        return FilteredSignal(
            filtered_signal=normalized.tolist(),
            raw_vs_filtered_b64=plot_b64
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signal processing error: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "VitalScan Signal Processing"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
