import type { FastifyInstance } from 'fastify';
import { findNearbyPlaces } from '../services/overpass.js';

export async function registerPlacesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/places/nearby', async (request, reply) => {
    const { lat, lon, radius, category } = request.query as {
      lat?: string;
      lon?: string;
      radius?: string;
      category?: string;
    };
    if (!lat || !lon) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_COORDS', message: 'Query parameters "lat" and "lon" are required.' } });
    }
    try {
      const places = await findNearbyPlaces(Number(lat), Number(lon), radius ? Number(radius) : 300, category);
      return { places };
    } catch (err) {
      request.log.error(err);
      return reply
        .code(503)
        .send({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Places service is unavailable.' } });
    }
  });
}
