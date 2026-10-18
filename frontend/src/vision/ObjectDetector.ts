// Ported from obstacle-detection-mvp/app.js (the standalone Phase 1 demo), adapted to a class
// so it can be driven by a React component and report alerts through the shared SpeechQueue
// instead of calling speechSynthesis directly — this is what lets a camera hazard correctly
// interrupt a turn-by-turn navigation instruction (or vice versa), since both now go through the
// same priority queue.
import type * as tfTypes from '@tensorflow/tfjs';
import type * as cocoSsdTypes from '@tensorflow-models/coco-ssd';
import { estimateDistance } from './distanceEstimator';
import { YoloDetector, type YoloPrediction } from './YoloDetector';

const CONFIDENCE_THRESHOLD = 0.28;
const TRACK_STALE_MS = 2500;
const TRACK_MATCH_MAX_DIST_FRAC = 0.35;

// Comprehensive set of real-world physical obstacles (pedestrians, vehicles, street infrastructure, furniture, trip hazards)
const HAZARD_CLASSES = new Set([
  // Pedestrians & Vehicles
  'person', 'car', 'bicycle', 'motorcycle', 'bus', 'truck', 'train', 'boat',
  // Street Infrastructure & Barriers
  'traffic light', 'stop sign', 'fire hydrant', 'parking meter', 'bench', 'potted plant',
  // Animals
  'dog', 'cat', 'bird', 'horse', 'sheep', 'cow', 'bear',
  // Furniture & Indoors
  'chair', 'couch', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'refrigerator', 'sink',
  // Floor & Trip Hazards / Objects
  'backpack', 'umbrella', 'handbag', 'suitcase', 'bottle', 'cup', 'bowl', 'cell phone', 'book', 'sports ball', 'skateboard',
]);
const GROWTH_THRESHOLD = 1.14;

const NEAR_HEIGHT_FRAC = 0.35;
const NEAR_COOLDOWN_MS = 2500;
const PRESENCE_COOLDOWN_MS = 4500;
const DEFAULT_COOLDOWN_MS = 3000;

const ROI_HISTORY_LEN = 12;
const ROI_MIN_HISTORY = 6;
const GROUND_STD_MULTIPLIER = 2.4;
const HEAD_STD_MULTIPLIER = 2.8;
const ROI_PERSISTENCE_REQUIRED = 3;

export type DetectionEngine = 'yolov8' | 'coco-ssd';
export type TargetModelMode = 'all' | 'person' | 'laptop' | 'bed';

export interface TargetModelConfig {
  id: TargetModelMode;
  modelNumber: number;
  name: string;
  shortName: string;
  icon: string;
  tag: string;
  description: string;
  speechConfirmation: string;
  targetClasses: string[];
}

export const TARGET_MODELS: Record<TargetModelMode, TargetModelConfig> = {
  all: {
    id: 'all',
    modelNumber: 0,
    name: 'All Objects',
    shortName: '🌐 All Objects',
    icon: '🌐',
    tag: 'ALL',
    description: 'Detects and announces all pedestrians, vehicles, furniture, and obstacles.',
    speechConfirmation: 'all objects',
    targetClasses: [],
  },
  person: {
    id: 'person',
    modelNumber: 1,
    name: 'Model 1 · Find People',
    shortName: '👤 Model 1: People',
    icon: '👤',
    tag: 'PEOPLE',
    description: 'Specialized model focusing exclusively on detecting and tracking people.',
    speechConfirmation: 'person mode',
    targetClasses: ['person'],
  },
  laptop: {
    id: 'laptop',
    modelNumber: 2,
    name: 'Model 2 · Find Laptop',
    shortName: '💻 Model 2: Laptop',
    icon: '💻',
    tag: 'LAPTOP',
    description: 'Specialized model focusing exclusively on locating laptops on desks or tables.',
    speechConfirmation: 'laptop mode',
    targetClasses: ['laptop'],
  },
  bed: {
    id: 'bed',
    modelNumber: 3,
    name: 'Model 3 · Find Bed',
    shortName: '🛏️ Model 3: Bed',
    icon: '🛏️',
    tag: 'BED',
    description: 'Specialized model focusing exclusively on locating beds and resting spots.',
    speechConfirmation: 'bed mode',
    targetClasses: ['bed', 'couch'],
  },
};

export interface Track {
  id: number;
  class: string;
  box: [number, number, number, number];
  score: number;
  lastSeen: number;
  heightHistory: Array<{ h: number; t: number }>;
  announcedAt?: number;
  announcedPosition?: 'left' | 'right' | 'ahead';
  announcedHeight?: number;
  announcedUrgency?: 'near' | 'approaching' | 'presence';
}

export interface RoiRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface RoiRects {
  ground: RoiRect;
  head: RoiRect;
  door: RoiRect;
}

export interface Prediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr: number[], m: number): number {
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

function normalizeDirection(position: string): string {
  const p = position.toLowerCase();
  if (p.includes('left')) return 'left';
  if (p.includes('right')) return 'right';
  if (p.includes('back') || p.includes('behind')) return 'back';
  return 'ahead';
}

function normalizeClassName(className: string): string {
  const c = className.toLowerCase().trim();
  if (c === 'person') return 'person';
  if (c === 'laptop') return 'laptop';
  if (c === 'bed' || c === 'couch') return 'bed';
  if (c === 'chair') return 'chair';
  if (c === 'dining table') return 'table';
  if (c === 'traffic light') return 'light';
  if (c === 'stop sign') return 'sign';
  if (c === 'fire hydrant') return 'hydrant';
  if (c === 'cell phone') return 'phone';
  if (c === 'potted plant') return 'plant';
  const parts = c.split(' ');
  return parts[parts.length - 1] || c;
}

/**
 * Concise 2-word voice prompt (e.g. "person right", "person left", "person ahead", "laptop ahead").
 * Strictly enforces user requirement: maximum 2 words spoken.
 */
export function formatHumanObstacleSpeech(
  className: string,
  _distanceText?: string,
  position: 'left' | 'right' | 'ahead' | 'center' | string = 'ahead',
  _urgency?: string,
  _targetModel: TargetModelMode = 'all'
): string {
  const obj = normalizeClassName(className);
  const dir = normalizeDirection(position);
  return `${obj} ${dir}`; // Exactly 2 words!
}

/**
 * Concise 2-word clearance response (e.g. "path clear", "no person", "no laptop").
 */
export function formatHumanClearSpeech(targetModel: TargetModelMode = 'all'): string {
  if (targetModel === 'person') return 'no person';
  if (targetModel === 'laptop') return 'no laptop';
  if (targetModel === 'bed') return 'no bed';
  return 'path clear'; // Exactly 2 words!
}

export class ObstacleDetector {
  private engine: DetectionEngine = 'yolov8';
  private targetModel: TargetModelMode = 'all';
  private yoloDetector = new YoloDetector(CONFIDENCE_THRESHOLD, 0.45);
  private cocoModel: cocoSsdTypes.ObjectDetection | null = null;
  private tracks: Track[] = [];
  private nextTrackId = 1;
  private lastAnnounceAt = new Map<string, number>();
  private recentSpokenObjects = new Map<string, { time: number; position: 'left' | 'right' | 'ahead'; height: number }>();
  private lastCrowdAnnouncedAt = 0;
  private groundHistory: Array<{ brightness: number; edge: number }> = [];
  private headHistory: Array<{ brightness: number; edge: number }> = [];
  private groundAnomalyStreak = 0;
  private headAnomalyStreak = 0;
  private tickCount = 0;

  roiRects: RoiRects | null = null;

  // onAlert is the only way this class speaks — the caller decides how (e.g. route it through
  // the shared SpeechQueue at CRITICAL priority so it correctly interrupts navigation/hazard
  // speech instead of this module managing its own speechSynthesis calls).
  constructor(private readonly onAlert: (text: string) => void) {}

  get currentEngine(): DetectionEngine {
    return this.engine;
  }

  get currentTargetModel(): TargetModelMode {
    return this.targetModel;
  }

  setTargetModel(model: TargetModelMode): void {
    this.targetModel = model;
    this.reset();
  }

  private announce(key: string, text: string, cooldownMs = DEFAULT_COOLDOWN_MS): void {
    const now = performance.now();
    const last = this.lastAnnounceAt.get(key) ?? 0;
    if (now - last < cooldownMs) return;
    this.lastAnnounceAt.set(key, now);
    this.onAlert(text);
  }

  async loadCocoModel(onStatus?: (text: string) => void): Promise<void> {
    if (this.cocoModel) return;
    onStatus?.('Loading GPU Vision Model…');
    try {
      await import('@tensorflow/tfjs-backend-webgl');
    } catch (e) {
      console.warn('tfjs WebGL backend import notice:', e);
    }
    try {
      await import('@tensorflow/tfjs-backend-cpu');
    } catch (e) {
      console.warn('tfjs CPU backend import notice:', e);
    }
    const tf = (await import('@tensorflow/tfjs')) as typeof tfTypes;
    const cocoSsd = (await import('@tensorflow-models/coco-ssd')) as typeof cocoSsdTypes;
    await tf.ready();

    // 1. First attempt: Load local model from Vite public assets (0 network latency, 100% offline)
    try {
      this.cocoModel = await cocoSsd.load({ modelUrl: '/models/coco-ssd/model.json' });
      onStatus?.('GPU Vision ready.');
      return;
    } catch (err) {
      console.warn('Local COCO-SSD load failed, falling back to CDN base:', err);
    }

    // 2. Second attempt: Fallback to CDN base
    this.cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    onStatus?.('GPU Vision ready.');
  }

  async setEngine(newEngine: DetectionEngine, onStatus?: (text: string) => void): Promise<void> {
    if (this.engine === newEngine) return;
    this.engine = newEngine;
    if (newEngine === 'yolov8') {
      if (!this.yoloDetector.isReady) {
        await this.yoloDetector.loadModel(onStatus);
      }
    } else {
      if (!this.cocoModel) {
        await this.loadCocoModel(onStatus);
      }
    }
  }

  async loadModel(onStatus?: (text: string) => void): Promise<void> {
    if (this.engine === 'coco-ssd') {
      try {
        await this.loadCocoModel(onStatus);
        // Pre-warm YOLO in background for instantaneous switching
        this.yoloDetector.loadModel().catch(() => {});
      } catch (err) {
        console.warn('COCO-SSD load failed, falling back to YOLOv8:', err);
        this.engine = 'yolov8';
        await this.yoloDetector.loadModel(onStatus);
      }
    } else {
      try {
        await this.yoloDetector.loadModel(onStatus);
        // Pre-warm COCO-SSD in background for instantaneous switching
        this.loadCocoModel().catch(() => {});
      } catch (err) {
        console.warn('YOLOv8 load failed, falling back to COCO-SSD:', err);
        this.engine = 'coco-ssd';
        await this.loadCocoModel(onStatus);
      }
    }
  }

  reset(): void {
    this.tracks = [];
    this.groundHistory = [];
    this.headHistory = [];
    this.groundAnomalyStreak = 0;
    this.headAnomalyStreak = 0;
    this.lastAnnounceAt.clear();
    this.recentSpokenObjects.clear();
    this.lastCrowdAnnouncedAt = 0;
  }

  computeRoiRects(w: number, h: number): RoiRects {
    const groundW = Math.round(w * 0.4);
    const groundH = Math.round(h * 0.2);
    const headW = Math.round(w * 0.5);
    const headH = Math.round(h * 0.15);
    const doorW = Math.round(w * 0.52);
    const doorH = Math.round(h * 0.72);
    const rects: RoiRects = {
      ground: { x: Math.round((w - groundW) / 2), y: h - groundH, w: groundW, h: groundH, label: 'ground check' },
      head: { x: Math.round((w - headW) / 2), y: 0, w: headW, h: headH, label: 'head check' },
      door: { x: Math.round((w - doorW) / 2), y: Math.round(h * 0.12), w: doorW, h: doorH, label: 'door check' },
    };
    this.roiRects = rects;
    return rects;
  }

  // Direction calculation with hysteresis deadbands to eliminate boundary jitter (e.g. flipping between left/ahead)
  private positionLabel(centerXFrac: number, prevPosition?: 'left' | 'right' | 'ahead'): 'left' | 'right' | 'ahead' {
    if (prevPosition === 'left') {
      return centerXFrac > 0.42 ? (centerXFrac > 0.65 ? 'right' : 'ahead') : 'left';
    }
    if (prevPosition === 'right') {
      return centerXFrac < 0.58 ? (centerXFrac < 0.35 ? 'left' : 'ahead') : 'right';
    }
    if (centerXFrac < 0.35) return 'left';
    if (centerXFrac > 0.65) return 'right';
    return 'ahead';
  }

  private updateTracks(predictions: Prediction[], canvasWidth: number, canvasHeight: number): Track[] {
    const now = performance.now();
    const maxDist = Math.hypot(canvasWidth, canvasHeight) * TRACK_MATCH_MAX_DIST_FRAC;
    const usedTrackIds = new Set<number>();
    const results: Track[] = [];

    for (const pred of predictions) {
      if (pred.score < CONFIDENCE_THRESHOLD) continue;
      const [x, y, bw, bh] = pred.bbox;
      const cx = x + bw / 2;
      const cy = y + bh / 2;

      let best: Track | null = null;
      let bestDist = Infinity;
      for (const track of this.tracks) {
        if (track.class !== pred.class || usedTrackIds.has(track.id)) continue;
        const lcx = track.box[0] + track.box[2] / 2;
        const lcy = track.box[1] + track.box[3] / 2;
        const dist = Math.hypot(cx - lcx, cy - lcy);
        if (dist < maxDist && dist < bestDist) {
          best = track;
          bestDist = dist;
        }
      }

      if (best) {
        usedTrackIds.add(best.id);
        best.box = [x, y, bw, bh];
        best.score = pred.score;
        best.lastSeen = now;
        best.heightHistory.push({ h: bh, t: now });
        if (best.heightHistory.length > 5) best.heightHistory.shift();
        results.push(best);
      } else {
        results.push({
          id: this.nextTrackId++,
          class: pred.class,
          box: [x, y, bw, bh],
          score: pred.score,
          lastSeen: now,
          heightHistory: [{ h: bh, t: now }],
        });
      }
    }

    this.tracks = results.filter((t) => now - t.lastSeen < TRACK_STALE_MS);
    return this.tracks;
  }

  private formatHumanSpeech(
    className: string,
    distanceText: string,
    position: string,
    urgency: 'near' | 'approaching' | 'presence'
  ): string {
    return formatHumanObstacleSpeech(className, distanceText, position, urgency, this.targetModel);
  }

  /**
   * Stateful, movement-aware obstacle classification.
   * Eliminates infinite alert loops when people or objects are stationary.
   */
  private classifyAndAnnounceHazards(liveTracks: Track[], canvasWidth: number, canvasHeight: number): void {
    const now = performance.now();

    // ================= CROWD & DENSE PEDESTRIAN ENVIRONMENT (>= 3 PEOPLE) =================
    // When surrounded by many people, avoid overwhelming the user with individual alerts.
    // Instead, aggregate the crowd and guide the user toward the open walking corridor.
    const personTracks = liveTracks.filter(
      (t) => t.class === 'person' && t.score >= CONFIDENCE_THRESHOLD
    );
    if (personTracks.length >= 3 && (this.targetModel === 'all' || this.targetModel === 'person')) {
      // 1. Immediate Collision Override: If a pedestrian is dangerously close (< 1.2m, heightFrac >= 0.42)
      const immediateCollision = personTracks.find((t) => (t.box[3] / canvasHeight) >= 0.42);
      if (immediateCollision) {
        const cx = (immediateCollision.box[0] + immediateCollision.box[2] / 2) / canvasWidth;
        const pos = this.positionLabel(cx);
        this.announce('crowd-collision', `person ${pos}`, 4000);
      }

      // 2. Clear Walking Corridor Detection:
      if (now - this.lastCrowdAnnouncedAt > 18000) {
        this.lastCrowdAnnouncedAt = now;
        let leftCount = 0;
        let centerCount = 0;
        let rightCount = 0;
        for (const pt of personTracks) {
          const cx = (pt.box[0] + pt.box[2] / 2) / canvasWidth;
          if (cx < 0.38) leftCount++;
          else if (cx > 0.62) rightCount++;
          else centerCount++;
        }

        let crowdMsg = 'crowd ahead';
        if (leftCount === 0 && (centerCount > 0 || rightCount > 0)) {
          crowdMsg = 'pass left'; // Free path on left
        } else if (rightCount === 0 && (centerCount > 0 || leftCount > 0)) {
          crowdMsg = 'pass right'; // Free path on right
        }
        this.onAlert(crowdMsg);
      }

      // Suppress individual person loop to eliminate auditory clutter in crowds
      return;
    }

    for (const track of liveTracks) {
      if (this.targetModel !== 'all' && !TARGET_MODELS[this.targetModel].targetClasses.includes(track.class)) continue;
      if (this.targetModel === 'all' && !HAZARD_CLASSES.has(track.class)) continue;

      const cxFrac = (track.box[0] + track.box[2] / 2) / canvasWidth;
      const position = this.positionLabel(cxFrac, track.announcedPosition);
      const heightFrac = track.box[3] / canvasHeight;
      const { distanceText } = estimateDistance(track.box, track.class, canvasWidth, canvasHeight);

      // 1. Cross-check with recentSpokenObjects global cache:
      // If camera briefly lost the bounding box for a frame and acquired a new track ID,
      // prevent re-announcing the same stationary object.
      const recentCacheKey = `${track.class}-${position}`;
      const recent = this.recentSpokenObjects.get(recentCacheKey);
      if (!track.announcedAt && recent && now - recent.time < 18000) {
        const heightDiff = Math.abs(track.box[3] - recent.height) / (recent.height || 1);
        if (heightDiff < 0.25) {
          track.announcedAt = recent.time;
          track.announcedPosition = recent.position;
          track.announcedHeight = recent.height;
        }
      }

      // 2. Stationary suppression check:
      // If already announced, verify if state has ACTUALLY changed:
      // - Is object approaching significantly closer (height increased by >= 28%)?
      // - Has position shifted (e.g. 'ahead' -> 'left')?
      if (track.announcedAt) {
        const referenceHeight = track.announcedHeight || track.box[3];
        const heightRatio = track.box[3] / referenceHeight;
        const isApproaching = heightRatio >= 1.28;
        const positionChanged = track.announcedPosition && track.announcedPosition !== position;
        const timeSinceAnnounced = now - track.announcedAt;

        // If neither approaching closer nor changing direction, and announced recently (<30s):
        // COMPLETE SUPPRESSION - STAY QUIET! No repetitive loop when neither party is moving.
        if (!isApproaching && !positionChanged && timeSinceAnnounced < 30000) {
          continue;
        }

        // If approaching, throttle re-announcements to once per 5 seconds minimum
        if (isApproaching && timeSinceAnnounced < 5000) {
          continue;
        }
      }

      // 3. Determine urgency:
      let urgency: 'near' | 'approaching' | 'presence' = 'presence';
      if (heightFrac >= NEAR_HEIGHT_FRAC) {
        urgency = 'near';
      } else if (track.heightHistory.length >= 2) {
        const earliest = track.heightHistory[0].h;
        const latest = track.heightHistory[track.heightHistory.length - 1].h;
        if (earliest > 0 && latest / earliest >= GROWTH_THRESHOLD) {
          urgency = 'approaching';
        }
      }

      // Filter out tiny background objects (<12% of screen height) for generic presence
      if (urgency === 'presence' && heightFrac < 0.12) {
        continue;
      }

      const speech = this.formatHumanSpeech(track.class, distanceText, position, urgency);

      // Mark track as announced
      track.announcedAt = now;
      track.announcedPosition = position;
      track.announcedHeight = track.box[3];
      track.announcedUrgency = urgency;

      // Update global recent cache
      this.recentSpokenObjects.set(recentCacheKey, {
        time: now,
        position,
        height: track.box[3],
      });

      this.onAlert(speech);
    }
  }

  private sampleRoiMetrics(sampleCtx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step = 4) {
    const data = sampleCtx.getImageData(x, y, w, h).data;
    let sumBrightness = 0;
    let edgeSum = 0;
    let count = 0;
    for (let row = 0; row < h; row += step) {
      let prevGray: number | null = null;
      for (let col = 0; col < w; col += step) {
        const idx = (row * w + col) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        sumBrightness += gray;
        count++;
        if (prevGray !== null) edgeSum += Math.abs(gray - prevGray);
        prevGray = gray;
      }
    }
    if (count === 0) return { brightness: 0, edge: 0 };
    return { brightness: sumBrightness / count, edge: edgeSum / count };
  }

  private detectRoiAnomaly(history: Array<{ brightness: number; edge: number }>, metrics: { brightness: number; edge: number }, stdMultiplier: number): boolean {
    history.push(metrics);
    while (history.length > ROI_HISTORY_LEN) history.shift();
    if (history.length < ROI_MIN_HISTORY) return false;

    const past = history.slice(0, -1);
    const bMean = mean(past.map((p) => p.brightness));
    const bStd = std(past.map((p) => p.brightness), bMean) || 1;
    const eMean = mean(past.map((p) => p.edge));
    const eStd = std(past.map((p) => p.edge), eMean) || 1;

    const brightnessDeviation = Math.abs(metrics.brightness - bMean) / bStd;
    const edgeDeviation = Math.abs(metrics.edge - eMean) / eStd;
    return brightnessDeviation > stdMultiplier || edgeDeviation > stdMultiplier;
  }

  private runRoiHeuristics(sampleCtx: CanvasRenderingContext2D): void {
    if (!this.roiRects) return;
    const { ground, head } = this.roiRects;

    const groundMetrics = this.sampleRoiMetrics(sampleCtx, ground.x, ground.y, ground.w, ground.h);
    const groundAnomalous = this.detectRoiAnomaly(this.groundHistory, groundMetrics, GROUND_STD_MULTIPLIER);
    this.groundAnomalyStreak = groundAnomalous ? this.groundAnomalyStreak + 1 : 0;
    if (this.groundAnomalyStreak >= ROI_PERSISTENCE_REQUIRED) {
      // 18s cooldown prevents repeating "step down" in loops when stationary
      this.announce('ground-anomaly', 'step down', 18000);
      this.groundAnomalyStreak = 0;
    }

    const headMetrics = this.sampleRoiMetrics(sampleCtx, head.x, head.y, head.w, head.h);
    const headAnomalous = this.detectRoiAnomaly(this.headHistory, headMetrics, HEAD_STD_MULTIPLIER);
    this.headAnomalyStreak = headAnomalous ? this.headAnomalyStreak + 1 : 0;
    if (this.headAnomalyStreak >= ROI_PERSISTENCE_REQUIRED) {
      // 18s cooldown prevents repeating "duck ahead" in loops when stationary
      this.announce('head-anomaly', 'duck ahead', 18000);
      this.headAnomalyStreak = 0;
    }
  }

  // Runs one detection cycle: inference + tracking + hazard/ROI alerts. Returns the raw
  // predictions so the caller can draw boxes; sampling for the ROI heuristics reads from
  // sampleCtx (a hidden, overlay-free canvas) so our own drawn graphics never contaminate it.
  async detectTick(
    video: HTMLVideoElement,
    sampleCtx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number
  ): Promise<Prediction[]> {
    let predictions: Prediction[] = [];
    const allowed = this.targetModel !== 'all' ? TARGET_MODELS[this.targetModel].targetClasses : undefined;

    // 1. Draw current video frame to sample canvas so pixels are always ready and valid
    sampleCtx.drawImage(video, 0, 0, canvasWidth, canvasHeight);

    // 2. Perform detection with active engine and automatic resilient fallback
    if (this.engine === 'coco-ssd') {
      if (this.cocoModel) {
        try {
          // Detect using the offscreen canvas (never throws readyState errors) with confidence threshold
          const cocoRaw = await this.cocoModel.detect(sampleCtx.canvas, 25, CONFIDENCE_THRESHOLD);
          predictions = cocoRaw as Prediction[];
        } catch (err) {
          console.warn('[COCO-SSD] Inference error, falling back to YOLOv8:', err);
          if (this.yoloDetector.isReady) {
            predictions = await this.yoloDetector.detect(sampleCtx.canvas, canvasWidth, canvasHeight, allowed);
          }
        }
      } else if (this.yoloDetector.isReady) {
        predictions = await this.yoloDetector.detect(sampleCtx.canvas, canvasWidth, canvasHeight, allowed);
      }
    } else {
      // YOLOv8 active
      if (this.yoloDetector.isReady) {
        try {
          predictions = await this.yoloDetector.detect(sampleCtx.canvas, canvasWidth, canvasHeight, allowed);
        } catch (err) {
          console.warn('[YOLOv8] Inference error, falling back to COCO-SSD:', err);
          if (this.cocoModel) {
            const cocoRaw = await this.cocoModel.detect(sampleCtx.canvas, 25, CONFIDENCE_THRESHOLD);
            predictions = cocoRaw as Prediction[];
          }
        }
      } else if (this.cocoModel) {
        const cocoRaw = await this.cocoModel.detect(sampleCtx.canvas, 25, CONFIDENCE_THRESHOLD);
        predictions = cocoRaw as Prediction[];
      }
    }

    // Isolate target object when a specialized model is active
    if (allowed && allowed.length > 0) {
      predictions = predictions.filter((p) => allowed.includes(p.class));
    }

    const liveTracks = this.updateTracks(predictions, canvasWidth, canvasHeight);
    this.classifyAndAnnounceHazards(liveTracks, canvasWidth, canvasHeight);

    // Only run expensive canvas pixel readbacks for ground texture heuristics in All Objects mode and throttled (every 8 ticks ~ 600ms)
    this.tickCount++;
    if (this.targetModel === 'all' && this.tickCount % 8 === 0) {
      this.runRoiHeuristics(sampleCtx);
    }

    return predictions;
  }
}
