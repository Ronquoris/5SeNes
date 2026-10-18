import { useEffect, useRef } from 'react';

/**
 * Hook to detect vigorous shaking of the mobile device.
 * Eyes-free safety trigger: shaking the phone immediately broadcasts Emergency SOS.
 */
export function useShakeDetection(onShake: () => void, enabled = true, threshold = 22) {
  const lastShakeTimeRef = useRef(0);
  const shakeCountRef = useRef(0);
  const lastXRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  const lastZRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    function handleMotion(event: DeviceMotionEvent) {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const { x, y, z } = acc;

      if (lastXRef.current !== null && lastYRef.current !== null && lastZRef.current !== null) {
        const deltaX = Math.abs(x - lastXRef.current);
        const deltaY = Math.abs(y - lastYRef.current);
        const deltaZ = Math.abs(z - lastZRef.current);
        const totalDelta = deltaX + deltaY + deltaZ;

        if (totalDelta > threshold) {
          const now = Date.now();
          if (now - lastShakeTimeRef.current > 180) {
            shakeCountRef.current += 1;
            lastShakeTimeRef.current = now;

            if (resetTimerRef.current !== null) {
              window.clearTimeout(resetTimerRef.current);
            }

            resetTimerRef.current = window.setTimeout(() => {
              shakeCountRef.current = 0;
            }, 1000);

            // 2 rapid shake reversals triggers immediate emergency action
            if (shakeCountRef.current >= 2) {
              shakeCountRef.current = 0;
              if (resetTimerRef.current !== null) {
                window.clearTimeout(resetTimerRef.current);
                resetTimerRef.current = null;
              }
              onShake();
            }
          }
        }
      }

      lastXRef.current = x;
      lastYRef.current = y;
      lastZRef.current = z;
    }

    window.addEventListener('devicemotion', handleMotion, true);

    return () => {
      window.removeEventListener('devicemotion', handleMotion, true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, [enabled, onShake, threshold]);
}
