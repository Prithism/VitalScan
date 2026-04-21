import { useState, useCallback, useRef, useEffect } from 'react';

export function useQualityEngine() {
  const [qualityScore, setQualityScore] = useState(0);
  const [qualityFactors, setQualityFactors] = useState({});
  const [qualityLevel, setQualityLevel] = useState('none');
  const [issues, setIssues] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const qualityHistoryRef = useRef([]);
  const maxHistoryRef = useRef(30);
  const thresholdsRef = useRef({
    excellent: 0.8,
    good: 0.6,
    fair: 0.4,
    poor: 0.2,
  });

  // Analyze eye tracking quality
  const analyzeEyeQuality = useCallback((eyeData) => {
    if (!eyeData) {
      return {
        score: 0,
        factors: { eyeOpenness: 0, gazeStability: 0, trackingConfidence: 0 },
        issues: ['No eye data available'],
      };
    }

    const { eyeRegions, averageOpenness, gazeDirection } = eyeData;

    // Calculate eye openness score
    const opennessScore = Math.min(1, averageOpenness / 0.5);

    // Calculate gaze stability score
    const gazeMagnitude = Math.sqrt(gazeDirection.x ** 2 + gazeDirection.y ** 2);
    const gazeStabilityScore = Math.max(0, 1 - gazeMagnitude * 2);

    // Calculate tracking confidence based on blink count
    const blinkFactor = 1; // In a real implementation, track blink patterns

    const score = (opennessScore * 0.4 + gazeStabilityScore * 0.4 + blinkFactor * 0.2);
    const factors = {
      eyeOpenness: opennessScore,
      gazeStability: gazeStabilityScore,
      trackingConfidence: blinkFactor,
    };

    const issues = [];
    if (opennessScore < 0.3) issues.push('Eyes not open enough');
    if (gazeStabilityScore < 0.5) issues.push('Gaze unstable');
    if (blinkFactor < 0.5) issues.push('Frequent blinking detected');

    return { score, factors, issues };
  }, []);

  // Analyze signal quality
  const analyzeSignalQuality = useCallback((signalData) => {
    if (!signalData) {
      return {
        score: 0,
        factors: { signalStrength: 0, noiseLevel: 1, stability: 0 },
        issues: ['No signal data available'],
      };
    }

    const { stats, greenSignal } = signalData;

    if (!stats) {
      return {
        score: 0,
        factors: { signalStrength: 0, noiseLevel: 1, stability: 0 },
        issues: ['Signal statistics not available'],
      };
    }

    const { mean, variance, range } = stats;

    // Calculate signal strength score
    const signalStrengthScore = Math.min(1, mean / 255);

    // Calculate noise level score (inverse)
    const noiseLevelScore = Math.max(0, 1 - variance / 1000);

    // Calculate stability score based on range
    const stabilityScore = Math.max(0, 1 - range / 50);

    const score = (signalStrengthScore * 0.4 + noiseLevelScore * 0.3 + stabilityScore * 0.3);
    const factors = {
      signalStrength: signalStrengthScore,
      noiseLevel: noiseLevelScore,
      stability: stabilityScore,
    };

    const issues = [];
    if (signalStrengthScore < 0.2) issues.push('Weak signal');
    if (noiseLevelScore < 0.5) issues.push('High noise level');
    if (stabilityScore < 0.5) issues.push('Unstable signal');

    return { score, factors, issues };
  }, []);

  // Analyze mask quality
  const analyzeMaskQuality = useCallback((maskData, frameData) => {
    if (!maskData || !frameData) {
      return {
        score: 0,
        factors: { coverage: 0, position: 0, size: 0 },
        issues: ['No mask data available'],
      };
    }

    const { eyeROI } = maskData;

    // Calculate coverage score
    const coverageScore = eyeROI.width * eyeROI.height;

    // Calculate position score (centered is better)
    const centerX = eyeROI.x + eyeROI.width / 2;
    const centerY = eyeROI.y + eyeROI.height / 2;
    const positionError = Math.sqrt((centerX - 0.5) ** 2 + (centerY - 0.5) ** 2);
    const positionScore = Math.max(0, 1 - positionError * 2);

    // Calculate size score
    const sizeScore = Math.min(1, coverageScore / 0.05);

    const score = (coverageScore * 0.3 + positionScore * 0.3 + sizeScore * 0.4);
    const factors = {
      coverage: coverageScore,
      position: positionScore,
      size: sizeScore,
    };

    const issues = [];
    if (coverageScore < 0.01) issues.push('Mask too small');
    if (positionScore < 0.5) issues.push('Mask not centered');
    if (sizeScore < 0.5) issues.push('Mask size suboptimal');

    return { score, factors, issues };
  }, []);

  // Analyze overall quality
  const analyzeQuality = useCallback(async (eyeData, signalData, maskData, frameData) => {
    setIsAnalyzing(true);

    const eyeQuality = analyzeEyeQuality(eyeData);
    const signalQuality = analyzeSignalQuality(signalData);
    const maskQuality = analyzeMaskQuality(maskData, frameData);

    // Calculate weighted overall score
    const overallScore = (eyeQuality.score * 0.3 + signalQuality.score * 0.5 + maskQuality.score * 0.2);

    // Determine quality level
    let qualityLevel = 'poor';
    if (overallScore >= thresholdsRef.current.excellent) qualityLevel = 'excellent';
    else if (overallScore >= thresholdsRef.current.good) qualityLevel = 'good';
    else if (overallScore >= thresholdsRef.current.fair) qualityLevel = 'fair';

    // Combine all issues
    const allIssues = [
      ...eyeQuality.issues,
      ...signalQuality.issues,
      ...maskQuality.issues,
    ];

    // Update quality history
    qualityHistoryRef.current.push(overallScore);
    if (qualityHistoryRef.current.length > maxHistoryRef.current) {
      qualityHistoryRef.current.shift();
    }

    setQualityScore(overallScore);
    setQualityFactors({
      eye: eyeQuality.factors,
      signal: signalQuality.factors,
      mask: maskQuality.factors,
    });
    setQualityLevel(qualityLevel);
    setIssues(allIssues);

    setIsAnalyzing(false);

    return {
      score: overallScore,
      level: qualityLevel,
      factors: {
        eye: eyeQuality.factors,
        signal: signalQuality.factors,
        mask: maskQuality.factors,
      },
      issues: allIssues,
    };
  }, [analyzeEyeQuality, analyzeSignalQuality, analyzeMaskQuality]);

  // Get quality recommendations
  const getRecommendations = useCallback(() => {
    const recommendations = [];

    if (qualityFactors.eye?.eyeOpenness < 0.3) {
      recommendations.push('Please open your eyes wider');
    }

    if (qualityFactors.eye?.gazeStability < 0.5) {
      recommendations.push('Try to keep your gaze steady');
    }

    if (qualityFactors.signal?.signalStrength < 0.2) {
      recommendations.push('Ensure proper lighting conditions');
    }

    if (qualityFactors.signal?.noiseLevel < 0.5) {
      recommendations.push('Minimize movement during measurement');
    }

    if (qualityFactors.mask?.coverage < 0.01) {
      recommendations.push('Adjust mask position to cover the sclera');
    }

    return recommendations;
  }, [qualityFactors]);

  // Reset quality engine
  const reset = useCallback(() => {
    setQualityScore(0);
    setQualityFactors({});
    setQualityLevel('none');
    setIssues([]);
    qualityHistoryRef.current = [];
  }, []);

  // Get quality summary
  const getQualitySummary = useCallback(() => {
    return {
      score: qualityScore,
      level: qualityLevel,
      factors: qualityFactors,
      issues,
      history: qualityHistoryRef.current,
      recommendations: getRecommendations(),
    };
  }, [qualityScore, qualityLevel, qualityFactors, issues, getRecommendations]);

  useEffect(() => {
    if (qualityScore > 0) {
      setQualityLevel(
        qualityScore >= thresholdsRef.current.excellent ? 'excellent' :
        qualityScore >= thresholdsRef.current.good ? 'good' :
        qualityScore >= thresholdsRef.current.fair ? 'fair' : 'poor'
      );
    }
  }, [qualityScore]);

  return {
    qualityScore,
    qualityFactors,
    qualityLevel,
    issues,
    isAnalyzing,
    analyzeQuality,
    getRecommendations,
    reset,
    getQualitySummary,
  };
}
