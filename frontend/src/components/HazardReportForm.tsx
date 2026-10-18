import { FormEvent, useState } from 'react';
import { reportHazard } from '../api/client';
import { speechQueue } from '../speech/SpeechQueue';

interface HazardReportFormProps {
  lat: number;
  lon: number;
  onReported?: () => void;
}

const HAZARD_TYPES = [
  { value: 'broken_sidewalk', label: 'Broken or uneven pavement' },
  { value: 'construction', label: 'Construction / scaffolding' },
  { value: 'missing_curb_ramp', label: 'Missing dropped kerb' },
  { value: 'obstruction', label: 'Obstruction blocking the path' },
  { value: 'other', label: 'Other' },
];

export function HazardReportForm({ lat, lon, onReported }: HazardReportFormProps) {
  const [type, setType] = useState(HAZARD_TYPES[0].value);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await reportHazard({ lat, lon, type, description: description.trim() || undefined });
      speechQueue.speak('Hazard reported. Thank you.', 'INFO');
      setDescription('');
      onReported?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not report hazard.';
      setError(message);
      speechQueue.speak(message, 'INFO');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Report a hazard</h2>
      <p className="muted">Reports at your current location ({lat.toFixed(5)}, {lon.toFixed(5)}).</p>

      <div className="field">
        <label htmlFor="hazard-type">Type</label>
        <select id="hazard-type" value={type} onChange={(e) => setType(e.target.value)}>
          {HAZARD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="hazard-description">Description (optional)</label>
        <textarea
          id="hazard-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. near the bus stop, blocking most of the path"
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? 'Reporting…' : 'Report hazard'}
      </button>
    </form>
  );
}
