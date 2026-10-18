import { useCallback, useRef } from 'react';

const SLOPE_DELTA_THRESHOLD_DEG = 8;
const SLOPE_PERSISTENCE_REQUIRED = 5; // consecutive orientation samples
const SLOPE_COOLDOWN_MS = 6000;
const SLOPE_SMOOTHING = 0.15;

// Phone-tilt based uphill/downhill detection — assumes the phone is held facing forward and
// roughly level. beta = front-back tilt in degrees. The sign convention is a best guess; flip
// the two comparisons below if uphill/downhill come out swapped on your device/mount.
export function useSlopeDetection(announce: (key: string, text: string, cooldownMs?: number) => void) {
  const baselineBeta = useRef<number | null>(null);
  const smoothedBeta = useRef<number | null>(null);
  const slopeState = useRef<'flat' | 'uphill' | 'downhill'>('flat');
  const slopeStreak = useRef(0);
  const listenerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);

  const handleOrientation = useCallback(
    (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.beta === undefined) return;

      if (baselineBeta.current === null) {
        baselineBeta.current = event.beta;
        smoothedBeta.current = event.beta;
        return;
      }

      smoothedBeta.current = (smoothedBeta.current ?? event.beta) * (1 - SLOPE_SMOOTHING) + event.beta * SLOPE_SMOOTHING;
      const delta = smoothedBeta.current - baselineBeta.current;

      let candidate: 'flat' | 'uphill' | 'downhill' = 'flat';
      if (delta <= -SLOPE_DELTA_THRESHOLD_DEG) candidate = 'uphill';
      else if (delta >= SLOPE_DELTA_THRESHOLD_DEG) candidate = 'downhill';

      if (candidate === slopeState.current) {
        slopeStreak.current = 0;
        return;
      }

      slopeStreak.current++;
      if (slopeStreak.current < SLOPE_PERSISTENCE_REQUIRED) return;

      slopeState.current = candidate;
      slopeStreak.current = 0;
      if (candidate === 'flat') return;
      announce(`slope-${candidate}`, `path going ${candidate}`, SLOPE_COOLDOWN_MS);
    },
    [announce]
  );

  const enable = useCallback(async () => {
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DOE === 'undefined') return;

    if (typeof DOE.requestPermission === 'function') {
      try {
        const resp = await DOE.requestPermission();
        if (resp !== 'granted') return;
      } catch {
        return;
      }
    }

    baselineBeta.current = null;
    smoothedBeta.current = null;
    slopeState.current = 'flat';
    slopeStreak.current = 0;
    listenerRef.current = handleOrientation;
    window.addEventListener('deviceorientation', listenerRef.current);
  }, [handleOrientation]);

  const disable = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('deviceorientation', listenerRef.current);
      listenerRef.current = null;
    }
  }, []);

  return { enable, disable };
}
