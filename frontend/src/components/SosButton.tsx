import { useEffect, useRef, useState } from 'react';
import { pingSosLocation, startSos, stopSos } from '../api/client';
import { speechQueue } from '../speech/SpeechQueue';

const PING_INTERVAL_MS = 5000;

interface SosButtonProps {
  selectedContactIds: string[];
}

export function SosButton({ selectedContactIds }: SosButtonProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const lastPositionRef = useRef<{ lat: number; lon: number; accuracyMeters?: number } | null>(null);

  const active = sessionId !== null;

  async function start() {
    if (selectedContactIds.length === 0) {
      speechQueue.speak('Select at least one trusted contact before starting SOS.', 'CRITICAL');
      return;
    }
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      );
      const initialLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
      lastPositionRef.current = { ...initialLocation, accuracyMeters: position.coords.accuracy };

      const res = await startSos({ contactIds: selectedContactIds, initialLocation, message: 'I need help, please check on me.' });
      setSessionId(res.sessionId);
      setShareUrl(res.shareUrl);
      speechQueue.speak('S O S started. Sharing your live location with your trusted contacts.', 'CRITICAL');

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          lastPositionRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyMeters: pos.coords.accuracy };
        },
        () => {
          /* keep using the last known position if a later watch update fails */
        },
        { enableHighAccuracy: true, maximumAge: 5000 }
      );

      pingTimerRef.current = window.setInterval(() => {
        const pos = lastPositionRef.current;
        if (!pos) return;
        pingSosLocation(res.sessionId, { ...pos, timestamp: new Date().toISOString() }).catch(() => {
          /* a dropped ping isn't fatal — the next interval retries with a fresher position */
        });
      }, PING_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start SOS.');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!sessionId) return;
    setBusy(true);
    try {
      await stopSos(sessionId, 'safe');
      speechQueue.speak('S O S stopped.', 'CRITICAL');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop SOS.');
    } finally {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (pingTimerRef.current !== null) clearInterval(pingTimerRef.current);
      watchIdRef.current = null;
      pingTimerRef.current = null;
      setSessionId(null);
      setShareUrl(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (pingTimerRef.current !== null) clearInterval(pingTimerRef.current);
    };
  }, []);

  return (
    <div className="card">
      <h2>SOS</h2>
      <p className="muted">
        One tap shares your live location with the trusted contacts you've selected above, updated every few
        seconds, until you stop it.
      </p>
      <button type="button" className="btn" onClick={active ? stop : start} disabled={busy} aria-pressed={active}>
        {busy ? 'Working…' : active ? 'Stop SOS' : 'Start SOS'}
      </button>
      {error && <p className="error-text">{error}</p>}
      {shareUrl && (
        <p style={{ marginTop: '0.75rem' }}>
          Share this link with your contact: <br />
          <a href={shareUrl} target="_blank" rel="noreferrer">
            {shareUrl}
          </a>
        </p>
      )}
    </div>
  );
}
