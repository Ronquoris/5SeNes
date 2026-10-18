import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { config } from '../config.js';

interface SosSessionRow {
  id: string;
  user_id: string;
  status: string;
  message: string | null;
  contact_ids_json: string;
  started_at: string;
  stopped_at: string | null;
  stop_reason: string | null;
}

interface SosLocationRow {
  lat: number;
  lon: number;
  accuracy_meters: number | null;
  recorded_at: string;
}

export async function registerSosRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/sos/start', async (request, reply) => {
    const body = request.body as {
      contactIds?: string[];
      initialLocation?: { lat: number; lon: number };
      message?: string;
    };
    if (!body.initialLocation) {
      return reply.code(400).send({ error: { code: 'MISSING_LOCATION', message: '"initialLocation" is required.' } });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sos_sessions (id, user_id, status, message, contact_ids_json, started_at)
       VALUES (?, ?, 'active', ?, ?, ?)`
    ).run(id, request.userId, body.message ?? null, JSON.stringify(body.contactIds ?? []), now);

    db.prepare(`INSERT INTO sos_locations (session_id, lat, lon, accuracy_meters, recorded_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      body.initialLocation.lat,
      body.initialLocation.lon,
      null,
      now
    );

    const shareUrl = `${config.frontendDevOrigin}/share/${id}`;
    return reply.code(201).send({ sessionId: id, shareUrl });
  });

  app.post('/api/sos/:id/location', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { lat?: number; lon?: number; accuracyMeters?: number; timestamp?: string };
    const session = db.prepare('SELECT * FROM sos_sessions WHERE id = ?').get(id) as SosSessionRow | undefined;
    if (!session || session.status !== 'active') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'SOS session not found or already stopped.' } });
    }
    if (body.lat === undefined || body.lon === undefined) {
      return reply.code(400).send({ error: { code: 'MISSING_COORDS', message: '"lat" and "lon" are required.' } });
    }
    db.prepare(`INSERT INTO sos_locations (session_id, lat, lon, accuracy_meters, recorded_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      body.lat,
      body.lon,
      body.accuracyMeters ?? null,
      body.timestamp ?? new Date().toISOString()
    );
    return reply.code(204).send();
  });

  app.post('/api/sos/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };
    const result = db
      .prepare(`UPDATE sos_sessions SET status = 'stopped', stopped_at = ?, stop_reason = ? WHERE id = ? AND status = 'active'`)
      .run(new Date().toISOString(), body.reason ?? 'cancelled', id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'SOS session not found or already stopped.' } });
    }
    return { status: 'stopped' };
  });

  // Public, token-gated by knowledge of the session id (the share link) — no X-User-Id check,
  // this is what the trusted contact's viewer page polls.
  app.get('/api/sos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = db.prepare('SELECT * FROM sos_sessions WHERE id = ?').get(id) as SosSessionRow | undefined;
    if (!session) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'SOS session not found.' } });
    }
    const lastLocation = db
      .prepare('SELECT lat, lon, accuracy_meters, recorded_at FROM sos_locations WHERE session_id = ? ORDER BY recorded_at DESC LIMIT 1')
      .get(id) as SosLocationRow | undefined;

    return {
      status: session.status,
      message: session.message,
      startedAt: session.started_at,
      stoppedAt: session.stopped_at,
      lastLocation: lastLocation
        ? { lat: lastLocation.lat, lon: lastLocation.lon, accuracyMeters: lastLocation.accuracy_meters, timestamp: lastLocation.recorded_at }
        : null,
    };
  });
}
