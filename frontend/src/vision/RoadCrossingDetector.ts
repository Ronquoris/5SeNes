import type { Prediction } from './ObjectDetector';

export interface RoadCrossingState {
  kerbDetected: boolean;
  zebraCrossingDetected: boolean;
  safeToCross: boolean;
  vehicleHazards: string[];
  statusText: string;
}

const VEHICLE_CLASSES = new Set(['car', 'bus', 'truck', 'motorcycle', 'bicycle']);

export class RoadCrossingDetector {
  private lastKerbAlert = 0;
  private lastZebraAlert = 0;
  private lastSafeAlert = 0;
  private lastVehicleAlert = 0;
  private clearRoadStreak = 0;
  private zebraStreak = 0;
  private kerbStreak = 0;
  private kerbAnnounced = false;
  private zebraAnnounced = false;
  private safeAnnounced = false;

  constructor(private readonly onAlert: (text: string) => void) {}

  /**
   * Evaluates the road crossing scene from a raw video canvas frame and active predictions.
   */
  detectCrossing(
    sampleCtx: CanvasRenderingContext2D,
    predictions: Prediction[],
    width: number,
    height: number
  ): RoadCrossingState {
    const now = Date.now();
    const vehicleHazards: string[] = [];

    // 1. Check for vehicles in the road corridor
    let vehicleInCrosswalk = false;
    for (const pred of predictions) {
      if (VEHICLE_CLASSES.has(pred.class) && pred.score >= 0.38) {
        vehicleInCrosswalk = true;
        const [x, , w] = pred.bbox;
        const cx = (x + w / 2) / width;
        const side = cx < 0.4 ? 'left' : cx > 0.6 ? 'right' : 'ahead';
        vehicleHazards.push(`${pred.class} on your ${side}`);
      }
    }

    // 2. Check for Kerb / Asphalt Boundary in lower 30% of frame
    const kerbFound = this.detectKerbLine(sampleCtx, width, height);
    if (kerbFound) {
      this.kerbStreak++;
      // Announce ONCE on encountering kerb; suppress repetitive alerts while waiting stationary
      if (this.kerbStreak >= 2 && (!this.kerbAnnounced || now - this.lastKerbAlert > 25000)) {
        this.lastKerbAlert = now;
        this.kerbAnnounced = true;
        this.onAlert('kerb ahead');
      }
    } else {
      this.kerbStreak = 0;
      this.kerbAnnounced = false;
    }

    // 3. Check for Zebra Crossing Stripes on the road
    const zebraFound = this.detectZebraStripes(sampleCtx, width, height);
    if (zebraFound) {
      this.zebraStreak++;
      // Announce ONCE on encountering crossing; suppress repetitive alerts while stationary
      if (this.zebraStreak >= 2 && (!this.zebraAnnounced || now - this.lastZebraAlert > 25000)) {
        this.lastZebraAlert = now;
        this.zebraAnnounced = true;
        this.onAlert('crossing ahead');
      }
    } else {
      this.zebraStreak = 0;
      this.zebraAnnounced = false;
    }

    // 4. Crosswalk safety state
    let safeToCross = false;
    let statusText = 'Sidewalk';

    if (vehicleInCrosswalk) {
      this.clearRoadStreak = 0;
      this.safeAnnounced = false;
      if (now - this.lastVehicleAlert > 8000) {
        this.lastVehicleAlert = now;
        this.onAlert('vehicle wait');
      }
      statusText = 'Vehicle in road — Wait';
    } else if (zebraFound || kerbFound) {
      this.clearRoadStreak++;
      // If road corridor is clear for 3 ticks (~1 second) and zebra/kerb is active
      if (this.clearRoadStreak >= 3) {
        safeToCross = true;
        statusText = 'Road clear to cross';
        // Announce ONCE on clear road; do NOT loop while waiting to cross
        if (!this.safeAnnounced || now - this.lastSafeAlert > 25000) {
          this.lastSafeAlert = now;
          this.safeAnnounced = true;
          this.onAlert('safe cross');
        }
      }
    } else {
      this.clearRoadStreak = 0;
      this.safeAnnounced = false;
    }

    return {
      kerbDetected: kerbFound,
      zebraCrossingDetected: zebraFound,
      safeToCross,
      vehicleHazards,
      statusText,
    };
  }

  /**
   * Detects sharp horizontal contrast boundary between sidewalk concrete and dark asphalt road.
   */
  private detectKerbLine(sampleCtx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const startY = Math.round(height * 0.65);
    const h = Math.round(height * 0.3);
    const w = width;
    if (w < 40 || h < 20) return false;

    const data = sampleCtx.getImageData(0, startY, w, h).data;
    const rowBrightness: number[] = [];

    // Sample average brightness of horizontal rows
    for (let r = 0; r < h; r += 4) {
      let sum = 0;
      let count = 0;
      const rowOffset = r * w * 4;
      for (let c = 10; c < w - 10; c += 8) {
        const idx = rowOffset + c * 4;
        sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
      rowBrightness.push(count > 0 ? sum / count : 128);
    }

    // Look for sharp drop in brightness (sidewalk pavement dropping into dark road asphalt)
    for (let i = 1; i < rowBrightness.length - 1; i++) {
      const topPavement = (rowBrightness[i - 1] + rowBrightness[i]) / 2;
      const bottomAsphalt = rowBrightness[i + 1];
      // Step drop of 24+ units of brightness
      if (topPavement - bottomAsphalt > 24 && bottomAsphalt < 100) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detects alternating high-contrast white and dark stripes of zebra crossings on road.
   */
  private detectZebraStripes(sampleCtx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const startY = Math.round(height * 0.5);
    const h = Math.round(height * 0.35);
    const w = Math.round(width * 0.8);
    const startX = Math.round(width * 0.1);

    const data = sampleCtx.getImageData(startX, startY, w, h).data;
    const colBrightness: number[] = [];

    // Sample vertical column averages across horizontal span
    for (let c = 0; c < w; c += 6) {
      let sum = 0;
      let count = 0;
      for (let r = 4; r < h - 4; r += 6) {
        const idx = (r * w + c) * 4;
        sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
      colBrightness.push(count > 0 ? sum / count : 128);
    }

    if (colBrightness.length < 8) return false;

    // Check for periodic white stripe (high) and asphalt (low) crossings
    const avg = colBrightness.reduce((a, b) => a + b, 0) / colBrightness.length;
    let peaks = 0;
    let isHigh = colBrightness[0] > avg + 18;

    for (let i = 1; i < colBrightness.length; i++) {
      const high = colBrightness[i] > avg + 18;
      if (high !== isHigh) {
        if (high) peaks++;
        isHigh = high;
      }
    }

    // A real zebra crossing shows at least 3-6 distinct stripe transitions
    return peaks >= 3 && peaks <= 10;
  }
}
