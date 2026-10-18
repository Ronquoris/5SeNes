import { estimateDistance, type DistanceEstimate } from './distanceEstimator';

export type DoorState = 'closed' | 'open';

export interface DetectedDoor {
  state: DoorState;
  bbox: [number, number, number, number]; // [x, y, w, h] in canvas coordinates
  confidence: number;
  distance: DistanceEstimate;
  side: 'left' | 'right' | 'ahead';
  label: string;
}

export class DoorDetector {
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D | null;
  private readonly sampleW = 160;
  private readonly sampleH = 120;
  private persistenceStreak = 0;
  private lastDetectedDoor: DetectedDoor | null = null;
  private lastAnnounceTime = 0;

  constructor(private readonly onAlert?: (text: string) => void) {
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = this.sampleW;
    this.sampleCanvas.height = this.sampleH;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Scans the full camera frame for both open and closed doors/doorways.
   * Returns detected door objects with bounding boxes and metric distances.
   */
  detectDoors(
    sourceVideoOrCanvas: CanvasImageSource,
    frameWidth: number,
    frameHeight: number
  ): DetectedDoor[] {
    if (!this.sampleCtx) return [];

    // 1. Draw downscaled frame for ultra-fast edge analysis
    this.sampleCtx.drawImage(sourceVideoOrCanvas, 0, 0, this.sampleW, this.sampleH);
    const imgData = this.sampleCtx.getImageData(0, 0, this.sampleW, this.sampleH).data;

    // Convert to grayscale grid
    const gray = new Uint8Array(this.sampleW * this.sampleH);
    for (let i = 0, j = 0; i < imgData.length; i += 4, j++) {
      gray[j] = Math.round((imgData[i] * 299 + imgData[i + 1] * 587 + imgData[i + 2] * 114) / 1000);
    }

    // 2. Compute vertical edge response across all columns
    // Door frames create strong vertical lines spanning the middle 70% of height
    const startY = Math.round(this.sampleH * 0.12);
    const endY = Math.round(this.sampleH * 0.88);
    const spanH = endY - startY;

    const vEdgeProfile = new Float32Array(this.sampleW);
    const edgeRows = new Uint8Array(this.sampleW * this.sampleH);

    for (let y = startY; y < endY; y++) {
      const rowOffset = y * this.sampleW;
      for (let x = 2; x < this.sampleW - 2; x++) {
        // Horizontal gradient (vertical edge)
        const diff = Math.abs(gray[rowOffset + x + 1] - gray[rowOffset + x - 1]);
        if (diff > 12) {
          edgeRows[rowOffset + x] = 1;
          vEdgeProfile[x] += diff;
        }
      }
    }

    // Normalize column edge energy
    for (let x = 0; x < this.sampleW; x++) {
      vEdgeProfile[x] /= spanH;
    }

    // 3. Find vertical edge peaks (potential door jambs)
    const peaks: number[] = [];
    const minEdgeStrength = 4.5;

    for (let x = 4; x < this.sampleW - 4; x++) {
      const val = vEdgeProfile[x];
      if (val >= minEdgeStrength) {
        // Local maximum check within radius of 3 columns
        let isMax = true;
        for (let dx = -3; dx <= 3; dx++) {
          if (dx !== 0 && vEdgeProfile[x + dx] > val) {
            isMax = false;
            break;
          }
        }
        if (isMax) {
          // Check vertical continuity of this column (at least 35% of rows must show edge)
          let edgeCount = 0;
          for (let y = startY; y < endY; y++) {
            if (
              edgeRows[y * this.sampleW + x] ||
              edgeRows[y * this.sampleW + x - 1] ||
              edgeRows[y * this.sampleW + x + 1]
            ) {
              edgeCount++;
            }
          }
          if (edgeCount / spanH >= 0.35) {
            peaks.push(x);
          }
        }
      }
    }

    // 4. Test pairs of vertical peaks for door proportions
    let bestCandidate: {
      left: number;
      right: number;
      top: number;
      bottom: number;
      score: number;
      state: DoorState;
    } | null = null;

    const minDoorW = Math.round(this.sampleW * 0.16);
    const maxDoorW = Math.round(this.sampleW * 0.72);

    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        const xL = peaks[i];
        const xR = peaks[j];
        const w = xR - xL;
        if (w < minDoorW || w > maxDoorW) continue;

        // Find top lintel (horizontal edge connecting the top of the door frame)
        let bestTopY = startY;
        let maxLintelEdge = 0;
        const testTopMax = Math.round(this.sampleH * 0.38);

        for (let y = Math.round(this.sampleH * 0.08); y < testTopMax; y += 2) {
          let hDiffSum = 0;
          let count = 0;
          const r1 = (y + 1) * this.sampleW;
          const r0 = (y - 1) * this.sampleW;
          for (let x = xL + 2; x < xR - 2; x += 3) {
            hDiffSum += Math.abs(gray[r1 + x] - gray[r0 + x]);
            count++;
          }
          const avgLintel = count > 0 ? hDiffSum / count : 0;
          if (avgLintel > maxLintelEdge) {
            maxLintelEdge = avgLintel;
            bestTopY = y;
          }
        }

        const bottomY = Math.min(this.sampleH - 4, Math.round(this.sampleH * 0.94));
        const doorH = bottomY - bestTopY;
        const aspectRatio = doorH / w; // Standard door is ~1.8 to 2.5

        if (aspectRatio < 1.1 || aspectRatio > 3.2) continue;

        // 5. Evaluate Door Interior: Closed vs Open
        // Sample interior pixels
        let interiorSum = 0;
        let interiorCount = 0;
        const interiorVals: number[] = [];

        for (let y = bestTopY + 4; y < bottomY - 6; y += 4) {
          const rowOffset = y * this.sampleW;
          for (let x = xL + 4; x < xR - 4; x += 4) {
            const val = gray[rowOffset + x];
            interiorSum += val;
            interiorVals.push(val);
            interiorCount++;
          }
        }
        if (interiorCount < 12) continue;

        const interiorMean = interiorSum / interiorCount;
        let interiorVarianceSum = 0;
        for (const v of interiorVals) {
          interiorVarianceSum += (v - interiorMean) ** 2;
        }
        const interiorStd = Math.sqrt(interiorVarianceSum / interiorCount);

        // Compare with surrounding wall on left and right
        let wallLeftSum = 0;
        let wallLeftCount = 0;
        let wallRightSum = 0;
        let wallRightCount = 0;

        for (let y = bestTopY + 6; y < bottomY - 10; y += 4) {
          const rowOffset = y * this.sampleW;
          // Left wall sample
          if (xL > 6) {
            wallLeftSum += gray[rowOffset + Math.max(0, xL - 6)];
            wallLeftCount++;
          }
          // Right wall sample
          if (xR < this.sampleW - 6) {
            wallRightSum += gray[rowOffset + Math.min(this.sampleW - 1, xR + 6)];
            wallRightCount++;
          }
        }

        const avgWallLeft = wallLeftCount > 0 ? wallLeftSum / wallLeftCount : interiorMean;
        const avgWallRight = wallRightCount > 0 ? wallRightSum / wallRightCount : interiorMean;
        const wallContrast = (Math.abs(interiorMean - avgWallLeft) + Math.abs(interiorMean - avgWallRight)) / 2;

        // Check floor threshold seam at bottom
        let thresholdEdge = 0;
        let thresholdCount = 0;
        const rBottom1 = Math.min(this.sampleH - 1, bottomY + 2) * this.sampleW;
        const rBottom0 = Math.max(0, bottomY - 2) * this.sampleW;
        for (let x = xL + 4; x < xR - 4; x += 4) {
          thresholdEdge += Math.abs(gray[rBottom1 + x] - gray[rBottom0 + x]);
          thresholdCount++;
        }
        const avgThreshold = thresholdCount > 0 ? thresholdEdge / thresholdCount : 0;

        // Scoring heuristic:
        // A door candidate has vertical jamb edges + lintel edge + wall contrast
        const baseScore =
          (vEdgeProfile[xL] + vEdgeProfile[xR]) * 0.25 +
          maxLintelEdge * 0.25 +
          wallContrast * 0.3;

        if (baseScore < 6.0) continue;

        // Determine if OPEN or CLOSED:
        // - CLOSED DOOR: Uniform interior panel (interiorStd < 38), distinct bottom threshold line (avgThreshold > 8)
        // - OPEN DOOR: Interior is a receding hallway/corridor or bright/dark opening, continuous floor (low threshold)
        let state: DoorState = 'closed';
        if (interiorStd > 36 || (avgThreshold < 6 && maxLintelEdge > 8)) {
          state = 'open';
        } else {
          state = 'closed';
        }

        if (!bestCandidate || baseScore > bestCandidate.score) {
          bestCandidate = {
            left: xL,
            right: xR,
            top: bestTopY,
            bottom: bottomY,
            score: Math.min(0.95, baseScore / 18),
            state,
          };
        }
      }
    }

    if (!bestCandidate) {
      this.persistenceStreak = Math.max(0, this.persistenceStreak - 1);
      return [];
    }

    // Temporal smoothing
    this.persistenceStreak++;
    if (this.persistenceStreak < 2 && !this.lastDetectedDoor) {
      return [];
    }

    // Convert coordinates from 160x120 back to full frame
    const scaleX = frameWidth / this.sampleW;
    const scaleY = frameHeight / this.sampleH;

    const bboxX = Math.round(bestCandidate.left * scaleX);
    const bboxY = Math.round(bestCandidate.top * scaleY);
    const bboxW = Math.round((bestCandidate.right - bestCandidate.left) * scaleX);
    const bboxH = Math.round((bestCandidate.bottom - bestCandidate.top) * scaleY);

    const centerXFrac = (bboxX + bboxW / 2) / frameWidth;
    const side: 'left' | 'right' | 'ahead' =
      centerXFrac < 0.35 ? 'left' : centerXFrac > 0.65 ? 'right' : 'ahead';

    const distance = estimateDistance([bboxX, bboxY, bboxW, bboxH], 'door', frameWidth, frameHeight);
    const stateStr = bestCandidate.state === 'closed' ? 'closed door' : 'open doorway';
    const sideText = side === 'ahead' ? 'ahead' : `on your ${side}`;

    const doorObj: DetectedDoor = {
      state: bestCandidate.state,
      bbox: [bboxX, bboxY, bboxW, bboxH],
      confidence: Math.round(bestCandidate.score * 100) / 100,
      distance,
      side,
      label: `${stateStr} ${distance.distanceText} ${sideText}`,
    };

    this.lastDetectedDoor = doorObj;

    // Periodic announcement if door is ahead
    const now = Date.now();
    if (now - this.lastAnnounceTime > 6000) {
      this.lastAnnounceTime = now;
      this.onAlert?.(doorObj.label);
    }

    return [doorObj];
  }

  reset() {
    this.persistenceStreak = 0;
    this.lastDetectedDoor = null;
    this.lastAnnounceTime = 0;
  }
}
