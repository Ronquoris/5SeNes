import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSosView, type SosView } from '../api/client';
import { MapView } from '../components/MapView';

const POLL_INTERVAL_MS = 5000;

export function SosSharePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [view, setView] = useState<SosView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchSosView(sessionId!);
        if (!cancelled) {
          setView(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this SOS session.');
      }
    }

    void poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  if (!sessionId) {
    return <p className="card error-text">No SOS session specified.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="card">
        <h2>Live SOS location</h2>
        {error && <p className="error-text">{error}</p>}
        {view && (
          <>
            <p>
              <strong>Status:</strong> {view.status === 'active' ? 'Active — sharing live location' : 'Stopped'}
            </p>
            {view.message && <p>{view.message}</p>}
            {view.lastLocation ? (
              <p className="muted">
                Last update: {new Date(view.lastLocation.timestamp).toLocaleTimeString('en-GB')}
                {view.lastLocation.accuracyMeters ? ` (±${Math.round(view.lastLocation.accuracyMeters)}m)` : ''}
              </p>
            ) : (
              <p className="muted">No location received yet.</p>
            )}
          </>
        )}
      </div>

      {view?.lastLocation && <MapView origin={{ lat: view.lastLocation.lat, lon: view.lastLocation.lon }} />}
    </div>
  );
}
