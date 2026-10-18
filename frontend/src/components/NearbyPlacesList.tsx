import { useEffect, useState } from 'react';
import { fetchNearbyPlaces, type NearbyPlace } from '../api/client';
import { speechQueue } from '../speech/SpeechQueue';

interface NearbyPlacesListProps {
  lat: number;
  lon: number;
}

function stepFreeBadge(place: NearbyPlace) {
  if (place.accessibility.stepFree === true) return <span className="badge step-free-yes">step-free</span>;
  if (place.accessibility.stepFree === false) return <span className="badge step-free-no">has steps</span>;
  return <span className="badge">accessibility unknown</span>;
}

export function NearbyPlacesList({ lat, lon }: NearbyPlacesListProps) {
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radius, setRadius] = useState(300);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { places } = await fetchNearbyPlaces(lat, lon, radius);
      setPlaces(places);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nearby places service is unavailable.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function announcePlace(place: NearbyPlace) {
    const accessNote =
      place.accessibility.stepFree === true
        ? ', step-free entrance'
        : place.accessibility.stepFree === false
          ? ', has steps'
          : '';
    speechQueue.speak(`${place.name}, ${place.category.replace(/_/g, ' ')}, ${place.distanceMeters} metres, ${place.bearingLabel}${accessNote}.`, 'INFO');
  }

  return (
    <div className="card">
      <h2>What's around me</h2>
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <label htmlFor="radius-select" style={{ marginBottom: 0 }}>
          Search radius
        </label>
        <select
          id="radius-select"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          style={{ width: 'auto' }}
        >
          <option value={150}>150 m</option>
          <option value={300}>300 m</option>
          <option value={600}>600 m</option>
          <option value={1000}>1 km</option>
        </select>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Searching…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <ul className="list-unstyled" aria-label="Nearby places">
        {places.map((place) => (
          <li key={place.id} className="list-item">
            <button
              type="button"
              className="btn secondary"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => announcePlace(place)}
            >
              <strong>{place.name}</strong> — {place.category.replace(/_/g, ' ')}
              <br />
              <span className="muted">
                {place.distanceMeters} m, {place.bearingLabel}
              </span>
              <br />
              {stepFreeBadge(place)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
