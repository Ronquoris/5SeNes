import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { haversineMeters } from '../services/geo.js';

const VALID_TYPES = new Set(['broken_sidewalk', 'construction', 'missing_curb_ramp', 'obstruction', 'other']);

interface HazardRow {
  id: string;
  reporter_user_id: string | null;
  lat: number;
  lon: number;
  type: string;
  description: string | null;
  severity: string;
  confirm_count: number;
  created_at: string;
  resolved_at: string | null;
}

function toApiShape(row: HazardRow) {
  return {
    id: row.id,
    lat: row.lat,
    lon: row.lon,
    type: row.type,
    description: row.description,
    severity: row.severity,
    confirmCount: row.confirm_count,
    createdAt: row.created_at,
  };
}

export async function registerHazardRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/hazards', async (request, reply) => {
    const body = request.body as { lat?: number; lon?: number; type?: string; description?: string };
    if (body.lat === undefined || body.lon === undefined || !body.type) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_FIELDS', message: '"lat", "lon" and "type" are required.' } });
    }
    const type = VALID_TYPES.has(body.type) ? body.type : 'other';
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO hazard_reports (id, reporter_user_id, lat, lon, type, description, severity, confirm_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'medium', 0, ?)`
    ).run(id, request.userId, body.lat, body.lon, type, body.description ?? null, createdAt);

    return reply.code(201).send({ id, createdAt });
  });

  app.get('/api/hazards/nearby', async (request, reply) => {
    const { lat, lon, radius } = request.query as { lat?: string; lon?: string; radius?: string };
    if (!lat || !lon) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_COORDS', message: 'Query parameters "lat" and "lon" are required.' } });
    }
    const centerLat = Number(lat);
    const centerLon = Number(lon);
    const radiusM = radius ? Number(radius) : 500;

    const rows = db.prepare('SELECT * FROM hazard_reports WHERE resolved_at IS NULL').all() as unknown as HazardRow[];
    const hazards = rows
      .map((row) => ({ ...toApiShape(row), distanceMeters: Math.round(haversineMeters(centerLat, centerLon, row.lat, row.lon)) }))
      .filter((h) => h.distanceMeters <= radiusM)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return { hazards };
  });

  app.get('/api/hazards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT * FROM hazard_reports WHERE id = ?').get(id) as unknown as HazardRow | undefined;
    if (!row) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Hazard not found.' } });
    }
    return toApiShape(row);
  });

  app.post('/api/hazards/:id/confirm', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare('UPDATE hazard_reports SET confirm_count = confirm_count + 1 WHERE id = ?').run(id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Hazard not found.' } });
    }
    const row = db.prepare('SELECT * FROM hazard_reports WHERE id = ?').get(id) as unknown as HazardRow;
    return toApiShape(row);
  });

  app.delete('/api/hazards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db
      .prepare('UPDATE hazard_reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL')
      .run(new Date().toISOString(), id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Hazard not found or already resolved.' } });
    }
    return reply.code(204).send();
  });
}
