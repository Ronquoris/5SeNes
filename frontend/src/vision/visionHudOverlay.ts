import type { Prediction, RoiRects } from './ObjectDetector';
import { estimateDistance } from './distanceEstimator';

export interface VisionHudOptions {
  engineName?: string;
  statusText?: string;
  showRoiGuides?: boolean;
  targetModel?: 'all' | 'person' | 'laptop' | 'bed';
  drawVideoBackground?: boolean;
}

/**
 * Draws real-time high-contrast YOLO bounding boxes, distance tags, and HUD telemetry onto the canvas.
 * Designed specifically for low-vision accessibility and visually striking hackathon demo presentation.
 */
export function drawVisionHud(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvasWidth: number,
  canvasHeight: number,
  predictions: Prediction[],
  roiRects?: RoiRects | null,
  options: VisionHudOptions = {}
): void {
  const {
    engineName = 'YOLOv8',
    statusText,
    showRoiGuides = true,
    targetModel = 'all',
    drawVideoBackground = false,
  } = options;

  // 1. Either clear transparent canvas for native 60fps GPU video, or blit video bitmap
  if (drawVideoBackground) {
    ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
  } else {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  // 2. Filter high-confidence detections (threshold 0.28 covers all objects without noise)
  const activePreds = predictions.filter((p) => p.score >= 0.28);

  // 3. Draw live HUD Status Badge in top-left corner
  ctx.save();
  let modelTag = `⚡ ${engineName}`;
  if (targetModel === 'person') modelTag = '🎯 MODEL 1 · PEOPLE';
  else if (targetModel === 'laptop') modelTag = '🎯 MODEL 2 · LAPTOP';
  else if (targetModel === 'bed') modelTag = '🎯 MODEL 3 · BED';

  const hudLabel = statusText
    ? `● ${statusText}`
    : activePreds.length > 0
    ? `${modelTag} · ${activePreds.length} FOUND`
    : `${modelTag} · SCANNING…`;

  ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  const hudTextW = ctx.measureText(hudLabel).width;
  const hudBadgeW = hudTextW + 18;
  const hudBadgeH = 26;

  // Badge background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
  ctx.fillRect(8, 8, hudBadgeW, hudBadgeH);

  // Badge border
  ctx.strokeStyle = activePreds.length > 0 ? '#FFEA00' : '#00FF66';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(8, 8, hudBadgeW, hudBadgeH);

  // Badge text
  ctx.fillStyle = activePreds.length > 0 ? '#FFEA00' : '#00FF66';
  ctx.fillText(hudLabel, 16, 8 + hudBadgeH / 2);
  ctx.restore();

  // 4. Draw bounding boxes and high-contrast overlay badges for every detected object
  for (const pred of activePreds) {
    const [x, y, w, h] = pred.bbox;

    const isPerson = pred.class === 'person';
    const isVehicle = ['car', 'bicycle', 'motorcycle', 'bus', 'truck', 'train', 'boat'].includes(pred.class);
    const isFurniture = ['chair', 'couch', 'bed', 'dining table', 'table', 'desk', 'toilet', 'refrigerator', 'sink'].includes(pred.class);
    const isTech = ['laptop', 'cell phone', 'tv', 'mouse', 'keyboard', 'remote', 'microwave', 'oven', 'clock'].includes(pred.class);
    const isItem = ['backpack', 'umbrella', 'handbag', 'suitcase', 'bottle', 'cup', 'bowl', 'book'].includes(pred.class);
    const isStreet = ['traffic light', 'stop sign', 'fire hydrant', 'bench', 'parking meter', 'potted plant', 'potted_plant'].includes(pred.class);
    const isAnimal = ['dog', 'cat', 'bird', 'horse', 'sheep', 'cow', 'bear'].includes(pred.class);

    let accentColor = '#00FF66';
    let icon = '📦 ';

    if (isPerson) {
      accentColor = '#00e5ff';
      icon = '👤 ';
    } else if (isVehicle) {
      accentColor = '#FFEA00';
      icon = '🚗 ';
    } else if (isStreet) {
      accentColor = '#FF1744';
      icon = '🛑 ';
    } else if (isFurniture) {
      accentColor = '#FF9100';
      icon = '🪑 ';
    } else if (isTech) {
      accentColor = '#38BDF8';
      icon = '💻 ';
    } else if (isItem) {
      accentColor = '#C084FC';
      icon = '🎒 ';
    } else if (isAnimal) {
      accentColor = '#34D399';
      icon = '🐾 ';
    }

    // Bounding Box Rectangle
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = isPerson || isStreet || isVehicle ? 3.5 : 2.5;
    ctx.strokeRect(x, y, w, h);

    // Modern Vision HUD Corner Brackets for visual clarity
    const cornerSize = Math.max(12, Math.min(22, w * 0.2, h * 0.2));
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = accentColor;

    // Top-left corner
    ctx.beginPath();
    ctx.moveTo(x, y + cornerSize);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerSize, y);
    ctx.stroke();

    // Top-right corner
    ctx.beginPath();
    ctx.moveTo(x + w - cornerSize, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + cornerSize);
    ctx.stroke();

    // Bottom-left corner
    ctx.beginPath();
    ctx.moveTo(x, y + h - cornerSize);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + cornerSize, y + h);
    ctx.stroke();

    // Bottom-right corner
    ctx.beginPath();
    ctx.moveTo(x + w - cornerSize, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - cornerSize);
    ctx.stroke();

    // 5. Distance Estimation & High-Contrast Label Pill
    const est = estimateDistance(pred.bbox, pred.class, canvasWidth, canvasHeight);
    const distText = est ? ` ~${est.distanceText}` : '';
    const scorePct = `${(pred.score * 100).toFixed(0)}%`;
    const label = `${icon}${pred.class.toUpperCase()}${distText} · ${scorePct}`;

    // Set font BEFORE measuring dimensions
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    const textW = ctx.measureText(label).width;
    const pillH = 26;
    const pillW = textW + 16;

    // Compute pill coordinates (keep on screen and avoid clipping off top)
    let pillY = y - pillH - 4;
    if (pillY < 4) {
      pillY = y + 4; // place inside top of box if clipped
    }
    const pillX = Math.max(4, Math.min(x, canvasWidth - pillW - 4));

    // Solid Black Pill Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.94)';
    ctx.fillRect(pillX, pillY, pillW, pillH);

    // Colored Accent Border
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(pillX, pillY, pillW, pillH);

    // Pure Brilliant White Text (#ffffff)
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, pillX + 8, pillY + pillH / 2);
    ctx.restore();
  }

  // 6. Draw Subtle Ground Check ROI Guide
  if (showRoiGuides && roiRects?.ground) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 234, 0, 0.45)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(roiRects.ground.x, roiRects.ground.y, roiRects.ground.w, roiRects.ground.h);
    ctx.restore();
  }
}
