import type { Prediction } from './ObjectDetector';

export type EnvironmentType = 'indoor' | 'outdoor';

export interface SceneClassification {
  environment: EnvironmentType;
  confidence: number;
  reason: string;
}

const INDOOR_OBJECTS = new Set([
  'chair',
  'couch',
  'dining table',
  'bed',
  'tv',
  'laptop',
  'refrigerator',
  'sink',
  'toilet',
  'microwave',
  'oven',
  'clock',
  'vase',
  'book',
]);

const OUTDOOR_OBJECTS = new Set([
  'car',
  'truck',
  'bus',
  'motorcycle',
  'bicycle',
  'traffic light',
  'fire hydrant',
  'stop sign',
  'parking meter',
]);

export class SceneClassifier {
  private lastEnvironment: EnvironmentType | null = null;
  private indoorScore = 0;
  private outdoorScore = 0;

  constructor(private readonly onSceneChange?: (env: EnvironmentType, reason: string) => void) {}

  /**
   * Classifies the scene based on visual frame lighting, detected object priors, and GPS accuracy.
   */
  classifyScene(
    sampleCtx: CanvasRenderingContext2D,
    predictions: Prediction[],
    width: number,
    height: number,
    gpsAccuracyMeters: number | null
  ): SceneClassification {
    let indoorPoints = 0;
    let outdoorPoints = 0;
    const reasons: string[] = [];

    // 1. Detected object evidence
    for (const pred of predictions) {
      if (pred.score >= 0.38) {
        if (INDOOR_OBJECTS.has(pred.class)) {
          indoorPoints += 3;
          reasons.push(`indoor object (${pred.class})`);
        } else if (OUTDOOR_OBJECTS.has(pred.class)) {
          outdoorPoints += 4;
          reasons.push(`outdoor object (${pred.class})`);
        }
      }
    }

    // 2. Visual lighting & sky check
    // Outdoors typically has bright open sky gradient in upper 25% of the frame
    const topH = Math.round(height * 0.25);
    const topData = sampleCtx.getImageData(0, 0, width, topH).data;
    let topBrightnessSum = 0;
    let topBlueSum = 0;
    let sampleCount = 0;

    for (let i = 0; i < topData.length; i += 16) {
      const r = topData[i];
      const g = topData[i + 1];
      const b = topData[i + 2];
      topBrightnessSum += (r + g + b) / 3;
      topBlueSum += b;
      sampleCount++;
    }

    const avgTopBrightness = sampleCount > 0 ? topBrightnessSum / sampleCount : 128;
    const avgTopBlue = sampleCount > 0 ? topBlueSum / sampleCount : 128;

    if (avgTopBrightness > 195 && avgTopBlue > 180) {
      // Very bright sky/open daylight
      outdoorPoints += 3;
      reasons.push('open sky lighting');
    } else if (avgTopBrightness < 160) {
      // Enclosed ceiling / indoor artificial illumination
      indoorPoints += 2;
      reasons.push('enclosed ceiling');
    }

    // 3. GPS satellite fix accuracy
    if (gpsAccuracyMeters !== null) {
      if (gpsAccuracyMeters <= 12) {
        // High precision satellite line-of-sight
        outdoorPoints += 3;
        reasons.push('strong outdoor GPS');
      } else if (gpsAccuracyMeters >= 35) {
        // Poor satellite reception typical inside buildings
        indoorPoints += 3;
        reasons.push('indoor GPS attenuation');
      }
    } else {
      indoorPoints += 1;
    }

    // Temporal smoothing to avoid bouncing
    if (indoorPoints > outdoorPoints) {
      this.indoorScore = Math.min(10, this.indoorScore + 1);
      this.outdoorScore = Math.max(0, this.outdoorScore - 1);
    } else {
      this.outdoorScore = Math.min(10, this.outdoorScore + 1);
      this.indoorScore = Math.max(0, this.indoorScore - 1);
    }

    const currentEnv: EnvironmentType = this.outdoorScore > this.indoorScore ? 'outdoor' : 'indoor';
    const total = this.indoorScore + this.outdoorScore;
    const confidence = total > 0 ? Math.round((Math.max(this.indoorScore, this.outdoorScore) / total) * 100) : 50;

    const reasonSummary = reasons.slice(0, 2).join(', ') || (currentEnv === 'indoor' ? 'enclosed space' : 'open area');

    if (this.lastEnvironment !== currentEnv) {
      this.lastEnvironment = currentEnv;
      this.onSceneChange?.(currentEnv, reasonSummary);
    }

    return {
      environment: currentEnv,
      confidence,
      reason: reasonSummary,
    };
  }
}
