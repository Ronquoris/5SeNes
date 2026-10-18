/**
 * Monocular Distance Estimator
 * Estimates physical distance in metres using pinhole geometry, real-world object height priors,
 * and ground-plane contact coordinates. Tuned for standard mobile phone cameras (~60° vertical FOV).
 */

// Average physical heights of standard obstacle categories in metres
const OBJECT_HEIGHT_PRIORS: Record<string, number> = {
  person: 1.7,
  car: 1.5,
  truck: 2.8,
  bus: 3.2,
  bicycle: 1.05,
  motorcycle: 1.15,
  dog: 0.55,
  cat: 0.3,
  chair: 0.85,
  couch: 0.85,
  bed: 0.65,
  'dining table': 0.75,
  table: 0.75,
  desk: 0.75,
  tv: 0.6,
  laptop: 0.28,
  'cell phone': 0.15,
  bottle: 0.24,
  cup: 0.12,
  backpack: 0.45,
  suitcase: 0.65,
  handbag: 0.3,
  bench: 0.75,
  'fire hydrant': 0.75,
  'stop sign': 1.8,
  'traffic light': 1.2,
  'potted plant': 0.65,
  potted_plant: 0.65,
  sink: 0.85,
  refrigerator: 1.75,
  toilet: 0.75,
  book: 0.2,
};

export interface DistanceEstimate {
  distanceMeters: number;
  distanceText: string;
}

/**
 * Estimates distance to a bounding box in metres.
 * @param box [x, y, width, height] normalized or pixel coordinates
 * @param classLabel object category name
 * @param frameWidth video frame width
 * @param frameHeight video frame height
 */
export function estimateDistance(
  box: [number, number, number, number],
  classLabel: string,
  _frameWidth: number,
  frameHeight: number
): DistanceEstimate {
  const [, y, , h] = box;
  const normalizedH = Math.max(0.01, h / frameHeight);
  const normalizedBottomY = Math.min(1.0, (y + h) / frameHeight);

  // 1. Geometric height-based distance estimation
  // Pinhole formula: distance = (real_height * f) / pixel_height
  // For ~60° vertical FOV, normalized focal length f_norm ≈ 0.85
  const realHeight = OBJECT_HEIGHT_PRIORS[classLabel] ?? 1.5;
  const fNorm = 0.88;
  const heightBasedDist = (realHeight * fNorm) / normalizedH;

  // 2. Ground-contact plane estimation
  // The lower the bottom edge is in the frame, the closer the object's base is to the user's feet
  // y_bottom = 1.0 means right at feet (< 0.8m)
  // y_bottom = 0.8 means ~1.5m
  // y_bottom = 0.65 means ~3m
  // y_bottom = 0.5 means ~5m+
  let groundBasedDist = 5.0;
  if (normalizedBottomY >= 0.9) {
    groundBasedDist = 0.8 + (1.0 - normalizedBottomY) * 5;
  } else if (normalizedBottomY >= 0.75) {
    groundBasedDist = 1.3 + (0.9 - normalizedBottomY) * 6;
  } else if (normalizedBottomY >= 0.55) {
    groundBasedDist = 2.2 + (0.75 - normalizedBottomY) * 10;
  } else {
    groundBasedDist = 4.2 + (0.55 - normalizedBottomY) * 15;
  }

  // 3. Weighted fusion of height and ground heuristics
  // Objects with reliable height (doors, adults) weight height; floor-bound obstacles weight ground
  const weightHeight = classLabel.includes('door') || classLabel === 'car' ? 0.65 : 0.45;
  let fusedDist = heightBasedDist * weightHeight + groundBasedDist * (1 - weightHeight);

  // Clamp within plausible practical range [0.5m, 15m]
  fusedDist = Math.max(0.5, Math.min(15.0, fusedDist));

  // Round to human-friendly distance:
  // Under 2m: round to nearest 0.5m (e.g. 1m, 1.5m, 2m)
  // 2m to 6m: round to nearest whole metre (e.g. 3m, 4m)
  // Over 6m: round to nearest 2m (e.g. 8m, 10m)
  let rounded: number;
  if (fusedDist <= 2.2) {
    rounded = Math.round(fusedDist * 2) / 2;
  } else if (fusedDist <= 6.5) {
    rounded = Math.round(fusedDist);
  } else {
    rounded = Math.round(fusedDist / 2) * 2;
  }

  const distanceText = rounded === 1 ? '1 metre' : `${rounded} metres`;

  return {
    distanceMeters: rounded,
    distanceText,
  };
}
