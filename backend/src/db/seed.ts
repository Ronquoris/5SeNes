import { randomUUID } from 'node:crypto';
import { db } from './client.js';

// A handful of real Manchester locations so "nearby hazards" has content on first run,
// without needing anyone to manually report something before the demo.
const MANCHESTER_SEED_HAZARDS = [
  { lat: 53.4809, lon: -2.2374, type: 'obstruction', description: 'A-board sign blocking part of the path, Piccadilly Gardens', severity: 'medium' },
  { lat: 53.4722, lon: -2.238, type: 'construction', description: 'Scaffolding and hoarding narrowing the pavement, Oxford Road', severity: 'high' },
  { lat: 53.4794, lon: -2.25, type: 'broken_sidewalk', description: 'Cracked and uneven paving slabs, Deansgate', severity: 'medium' },
  { lat: 53.4824, lon: -2.2414, type: 'missing_curb_ramp', description: 'No dropped kerb at this crossing, Market Street', severity: 'high' },
  { lat: 53.4773, lon: -2.2309, type: 'obstruction', description: 'Bike share dock partly on the footway, Manchester Piccadilly Station', severity: 'low' },
];

export function seedIfEmpty(): void {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM hazard_reports').get() as { count: number };
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO hazard_reports (id, reporter_user_id, lat, lon, type, description, severity, confirm_count, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 0, ?)`
  );

  const now = new Date().toISOString();
  for (const row of MANCHESTER_SEED_HAZARDS) {
    insert.run(randomUUID(), row.lat, row.lon, row.type, row.description, row.severity, now);
  }
}
