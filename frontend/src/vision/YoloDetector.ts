/**
 * YOLOv8 Client-Side Object Detector
 * Uses ONNX Runtime Web (WASM/WebGL) to execute YOLOv8n directly in the browser.
 * Provides real-time, high-accuracy detection for persons, vehicles, obstacles, and indoor items.
 */
import type * as ortTypes from 'onnxruntime-web';

export const COCO_CLASSES: readonly string[] = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop',
  'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush',
];

export interface YoloPrediction {
  bbox: [number, number, number, number]; // [x, y, width, height] in source canvas coordinates
  class: string;
  score: number;
}

const CLASS_TO_INDEX: Record<string, number> = {};
COCO_CLASSES.forEach((cls, idx) => {
  CLASS_TO_INDEX[cls] = idx;
});

// Fast lookup table for uint8 -> float32 [0..1] normalization (eliminates 1.2M floating-point ops/tick)
const INV255_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  INV255_LUT[i] = i / 255.0;
}

export class YoloDetector {
  private session: ortTypes.InferenceSession | null = null;
  private ort: typeof ortTypes | null = null;
  private isInitializing = false;
  private isLoaded = false;

  // Offscreen pre-processing canvas (640x640)
  private inputCanvas: HTMLCanvasElement;
  private inputCtx: CanvasRenderingContext2D | null;
  private readonly inputSize = 640;
  // Reusable Float32Array to avoid creating 1.2MB garbage per frame
  private float32Data: Float32Array;

  constructor(
    private readonly confidenceThreshold = 0.28,
    private readonly iouThreshold = 0.45
  ) {
    this.inputCanvas = document.createElement('canvas');
    this.inputCanvas.width = this.inputSize;
    this.inputCanvas.height = this.inputSize;
    this.inputCtx = this.inputCanvas.getContext('2d', { willReadFrequently: true });
    this.float32Data = new Float32Array(3 * this.inputSize * this.inputSize);
  }

  get isReady(): boolean {
    return this.isLoaded && this.session !== null;
  }

  /**
   * Initializes the ONNX Runtime Web session and loads the YOLOv8n ONNX model.
   */
  async loadModel(onStatus?: (text: string) => void): Promise<void> {
    if (this.isLoaded) return;
    if (this.isInitializing) return;

    this.isInitializing = true;
    try {
      onStatus?.('Loading YOLOv8 engine…');
      const ortModule = (await import('onnxruntime-web')) as typeof ortTypes;
      this.ort = ortModule;

      // Configure WASM paths and multi-threaded compatibility when available
      try {
        const concurrency = typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator ? navigator.hardwareConcurrency : 2;
        if (typeof window !== 'undefined' && (window as any).crossOriginIsolated) {
          ortModule.env.wasm.numThreads = Math.min(4, Math.max(1, concurrency));
        } else {
          ortModule.env.wasm.numThreads = 1;
        }
      } catch {
        ortModule.env.wasm.numThreads = 1;
      }

      if (typeof window !== 'undefined') {
        const baseUrl = window.location.origin;
        ortModule.env.wasm.wasmPaths = `${baseUrl}/wasm/`;
      }

      // Try local model first, fallback to CDN if not reachable
      const modelUrls = [
        '/models/yolov8n.onnx',
        'https://hyuto.github.io/yolov8-onnxruntime-web/model/yolov8n.onnx',
      ];

      let lastError: unknown = null;
      for (const url of modelUrls) {
        try {
          onStatus?.(`Loading YOLOv8 weights from ${url.startsWith('/') ? 'local cache' : 'cloud'}…`);
          // Hardware acceleration order: WebGPU -> WebGL -> WASM
          try {
            this.session = await ortModule.InferenceSession.create(url, {
              executionProviders: ['webgpu', 'webgl', 'wasm'],
            });
          } catch {
            this.session = await ortModule.InferenceSession.create(url, {
              executionProviders: ['wasm'],
            });
          }

          if (this.session) {
            this.isLoaded = true;
            onStatus?.('YOLOv8 ready.');
            break;
          }
        } catch (err) {
          lastError = err;
          console.warn(`Failed loading model from ${url}:`, err);
        }
      }

      if (!this.isLoaded) {
        throw lastError || new Error('Could not load YOLOv8 model from any source.');
      }
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Runs YOLOv8 object detection on a video or canvas element.
   * If targetClasses are supplied, decodes only target categories (up to 80x faster post-processing).
   */
  async detect(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    targetClasses?: string[]
  ): Promise<YoloPrediction[]> {
    if (!this.session || !this.ort || !this.inputCtx) {
      return [];
    }

    const { inputSize } = this;
    const ctx = this.inputCtx;

    // 1. Compute aspect-ratio letterboxing
    const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
    const scaledW = Math.round(sourceWidth * scale);
    const scaledH = Math.round(sourceHeight * scale);
    const padX = Math.round((inputSize - scaledW) / 2);
    const padY = Math.round((inputSize - scaledH) / 2);

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, inputSize, inputSize);
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, padX, padY, scaledW, scaledH);

    // 2. Preprocess pixels into normalized planar Float32Array [1, 3, 640, 640] using pre-allocated buffer
    const imgData = ctx.getImageData(0, 0, inputSize, inputSize).data;
    const totalPixels = inputSize * inputSize;
    const float32Data = this.float32Data;

    const greenOffset = totalPixels;
    const blueOffset = totalPixels * 2;

    for (let i = 0; i < totalPixels; i++) {
      const p = i << 2;
      float32Data[i] = INV255_LUT[imgData[p]];
      float32Data[greenOffset + i] = INV255_LUT[imgData[p + 1]];
      float32Data[blueOffset + i] = INV255_LUT[imgData[p + 2]];
    }

    // 3. Run ONNX Inference
    const inputTensor = new this.ort.Tensor('float32', float32Data, [1, 3, inputSize, inputSize]);
    const inputName = this.session.inputNames[0] || 'images';
    const outputName = this.session.outputNames[0] || 'output0';

    const results = await this.session.run({ [inputName]: inputTensor });
    const outputTensor = results[outputName];
    if (!outputTensor) return [];

    const outputData = outputTensor.data as Float32Array;
    const numBoxes = 8400;
    const numClasses = 80;
    const candidates: YoloPrediction[] = [];

    // 4. Fast decode candidate boxes
    // When target classes are specified, only check those indices for massive 80x speedup
    const targetIndices = targetClasses && targetClasses.length > 0
      ? targetClasses.map((c) => CLASS_TO_INDEX[c]).filter((idx): idx is number => idx !== undefined)
      : null;

    if (targetIndices && targetIndices.length > 0) {
      const targetLen = targetIndices.length;
      for (let b = 0; b < numBoxes; b++) {
        let maxScore = 0;
        let bestClassIdx = -1;

        for (let t = 0; t < targetLen; t++) {
          const c = targetIndices[t];
          const score = outputData[(4 + c) * numBoxes + b];
          if (score > maxScore) {
            maxScore = score;
            bestClassIdx = c;
          }
        }

        if (maxScore < this.confidenceThreshold) continue;

        const cx = outputData[0 * numBoxes + b];
        const cy = outputData[1 * numBoxes + b];
        const bw = outputData[2 * numBoxes + b];
        const bh = outputData[3 * numBoxes + b];

        const origX = (cx - bw / 2 - padX) / scale;
        const origY = (cy - bh / 2 - padY) / scale;
        const origW = bw / scale;
        const origH = bh / scale;

        const clampedX = Math.max(0, Math.min(sourceWidth - 1, origX));
        const clampedY = Math.max(0, Math.min(sourceHeight - 1, origY));
        const clampedW = Math.max(2, Math.min(sourceWidth - clampedX, origW));
        const clampedH = Math.max(2, Math.min(sourceHeight - clampedY, origH));

        candidates.push({
          bbox: [Math.round(clampedX), Math.round(clampedY), Math.round(clampedW), Math.round(clampedH)],
          class: COCO_CLASSES[bestClassIdx] ?? 'object',
          score: Math.round(maxScore * 100) / 100,
        });
      }
    } else {
      for (let b = 0; b < numBoxes; b++) {
        let maxScore = 0;
        let bestClassIdx = -1;

        for (let c = 0; c < numClasses; c++) {
          const score = outputData[(4 + c) * numBoxes + b];
          if (score > maxScore) {
            maxScore = score;
            bestClassIdx = c;
          }
        }

        if (maxScore < this.confidenceThreshold) continue;

        const cx = outputData[0 * numBoxes + b];
        const cy = outputData[1 * numBoxes + b];
        const bw = outputData[2 * numBoxes + b];
        const bh = outputData[3 * numBoxes + b];

        const origX = (cx - bw / 2 - padX) / scale;
        const origY = (cy - bh / 2 - padY) / scale;
        const origW = bw / scale;
        const origH = bh / scale;

        const clampedX = Math.max(0, Math.min(sourceWidth - 1, origX));
        const clampedY = Math.max(0, Math.min(sourceHeight - 1, origY));
        const clampedW = Math.max(2, Math.min(sourceWidth - clampedX, origW));
        const clampedH = Math.max(2, Math.min(sourceHeight - clampedY, origH));

        candidates.push({
          bbox: [Math.round(clampedX), Math.round(clampedY), Math.round(clampedW), Math.round(clampedH)],
          class: COCO_CLASSES[bestClassIdx] ?? 'object',
          score: Math.round(maxScore * 100) / 100,
        });
      }
    }

    // 5. Non-Maximum Suppression (NMS)
    return this.applyNms(candidates);
  }

  /**
   * Applies Non-Maximum Suppression to remove redundant overlapping boxes.
   */
  private applyNms(candidates: YoloPrediction[]): YoloPrediction[] {
    if (candidates.length === 0) return [];

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    const selected: YoloPrediction[] = [];
    const suppressed = new Uint8Array(candidates.length);

    for (let i = 0; i < candidates.length; i++) {
      if (suppressed[i]) continue;
      const current = candidates[i];
      selected.push(current);

      for (let j = i + 1; j < candidates.length; j++) {
        if (suppressed[j]) continue;
        const candidate = candidates[j];
        if (current.class === candidate.class) {
          const iou = this.computeIoU(current.bbox, candidate.bbox);
          if (iou > this.iouThreshold) {
            suppressed[j] = 1;
          }
        }
      }
    }

    return selected;
  }

  private computeIoU(
    boxA: [number, number, number, number],
    boxB: [number, number, number, number]
  ): number {
    const [x1, y1, w1, h1] = boxA;
    const [x2, y2, w2, h2] = boxB;

    const interX1 = Math.max(x1, x2);
    const interY1 = Math.max(y1, y2);
    const interX2 = Math.min(x1 + w1, x2 + w2);
    const interY2 = Math.min(y1 + h1, y2 + h2);

    const interW = Math.max(0, interX2 - interX1);
    const interH = Math.max(0, interY2 - interY1);
    const interArea = interW * interH;

    if (interArea === 0) return 0;

    const areaA = w1 * h1;
    const areaB = w2 * h2;
    return interArea / (areaA + areaB - interArea);
  }
}
