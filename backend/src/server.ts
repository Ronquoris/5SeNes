import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { seedIfEmpty } from './db/seed.js';
import { registerUserIdMiddleware } from './middleware/userId.js';
import { registerGeocodeRoutes } from './routes/geocode.js';
import { registerRouteRoutes } from './routes/route.js';
import { registerPlacesRoutes } from './routes/places.js';
import { registerHazardRoutes } from './routes/hazards.js';
import { registerContactRoutes } from './routes/contacts.js';
import { registerSosRoutes } from './routes/sos.js';
import { registerVisionRoutes } from './routes/vision.js';

seedIfEmpty();

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
await registerUserIdMiddleware(app);
await registerGeocodeRoutes(app);
await registerRouteRoutes(app);
await registerPlacesRoutes(app);
await registerHazardRoutes(app);
await registerContactRoutes(app);
await registerSosRoutes(app);
await registerVisionRoutes(app);

app.get('/api/health', async () => ({ status: 'ok' }));

app.listen({ port: config.port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`5Sense backend listening at ${address}`);
});
