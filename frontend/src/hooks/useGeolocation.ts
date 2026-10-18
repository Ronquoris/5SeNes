import { useEffect, useState } from 'react';

// Manchester city centre — used whenever geolocation is denied/unavailable, e.g. a desktop demo
// machine with no GPS, so the app still has somewhere sensible to centre on.
export const MANCHESTER_FALLBACK = { lat: 53.4808, lon: -2.2426 };

export interface GeoState {
  lat: number;
  lon: number;
  accuracyMeters: number | null;
  isFallback: boolean;
  error: string | null;
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({
    ...MANCHESTER_FALLBACK,
    accuracyMeters: null,
    isFallback: true,
    error: null,
  });

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState((prev) => ({ ...prev, error: 'Geolocation is not supported in this browser.' }));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setState({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          isFallback: false,
          error: null,
        });
      },
      (err) => {
        setState((prev) => ({ ...prev, error: err.message, isFallback: true }));
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return state;
}
