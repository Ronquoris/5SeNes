import type { FastifyInstance } from 'fastify';
import { getFootRoute } from '../services/osrm.js';
import { annotateRouteWithHazards } from '../services/hazardRouteAnnotator.js';

interface RouteBody {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
}

export async function registerRouteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/route', async (request, reply) => {
    const body = request.body as Partial<RouteBody>;
    if (!body?.origin || !body?.destination) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_COORDS', message: '"origin" and "destination" are required.' } });
    }
    try {
      const route = await getFootRoute(body.origin, body.destination);
      const annotated = annotateRouteWithHazards(route);
      return annotated;
    } catch (err) {
      request.log.error(err);
      return reply
        .code(503)
        .send({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Routing service is unavailable.' } });
    }
  });
}
