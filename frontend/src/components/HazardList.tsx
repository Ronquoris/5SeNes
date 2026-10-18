import { useEffect, useState } from 'react';
import { confirmHazard, fetchNearbyHazards, type HazardReport } from '../api/client';
import { speechQueue } from '../speech/SpeechQueue';

interface HazardListProps {
  lat: number;
  lon: number;
  reloadKey?: number;
}

function severityBadge(severity: string) {
  return <span className={`badge severity-${severity}`}>{severity}</span>;
}

export function HazardList({ lat, lon, reloadKey }: HazardListProps) {
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { hazards } = await fetchNearbyHazards(lat, lon, 500);
      setHazards(hazards);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Hazards service is unavailable.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  async function handleConfirm(hazard: HazardReport) {
    try {
      const updated = await confirmHazard(hazard.id);
      setHazards((prev) => prev.map((h) => (h.id === updated.id ? { ...h, confirmCount: updated.confirmCount } : h)));
      speechQueue.speak('Confirmed, thank you.', 'INFO');
    } catch (err) {
      speechQueue.speak(err instanceof Error ? err.message : 'Could not confirm hazard.', 'INFO');
    }
  }

  return (
    <div className="card">
      <h2>Hazards nearby (within 500 m)</h2>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}

      <ul className="list-unstyled" aria-label="Nearby hazard reports">
        {hazards.map((hazard) => (
          <li key={hazard.id} className="list-item">
            {severityBadge(hazard.severity)}
            <strong>{hazard.type.replace(/_/g, ' ')}</strong> — {hazard.distanceMeters} m away
            {hazard.description && <p className="muted" style={{ margin: '0.3rem 0' }}>{hazard.description}</p>}
            <div className="row" style={{ marginTop: '0.4rem' }}>
              <button type="button" className="btn secondary" onClick={() => handleConfirm(hazard)}>
                Confirm still there ({hazard.confirmCount})
              </button>
            </div>
          </li>
        ))}
        {!loading && hazards.length === 0 && <p className="muted">No hazards reported nearby.</p>}
      </ul>
    </div>
  );
}
