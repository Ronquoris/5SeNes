import type { FastifyInstance } from 'fastify';
import { geocode, reverseGeocode } from '../services/nominatim.js';

export async function registerGeocodeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/geocode', async (request, reply) => {
    const { q, limit, lat, lon } = request.query as { q?: string; limit?: string; lat?: string; lon?: string };
    if (!q || !q.trim()) {
      return reply.code(400).send({ error: { code: 'MISSING_QUERY', message: 'Query parameter "q" is required.' } });
    }
    try {
      const userLat = lat ? Number(lat) : undefined;
      const userLon = lon ? Number(lon) : undefined;
      const results = await geocode(q, limit ? Number(limit) : 5, userLat, userLon);
      return { results };
    } catch (err) {
      request.log.error(err);
      return reply
        .code(503)
        .send({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Geocoding service is unavailable.' } });
    }
  });

  app.get('/api/geocode/reverse', async (request, reply) => {
    const { lat, lon } = request.query as { lat?: string; lon?: string };
    if (!lat || !lon) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_COORDS', message: 'Query parameters "lat" and "lon" are required.' } });
    }
    try {
      const result = await reverseGeocode(Number(lat), Number(lon));
      return result;
    } catch (err) {
      request.log.error(err);
      return reply
        .code(503)
        .send({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Geocoding service is unavailable.' } });
    }
  });
}
