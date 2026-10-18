import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ensureUser } from '../db/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

// Anonymous, local-first identity: the client generates a UUID, stores it in localStorage, and
// sends it as X-User-Id on every request. No passwords, no login flow — deliberately out of
// scope for the hackathon build. If a client doesn't send one, we mint one so the request still
// works, though the client should persist it going forward.
export async function registerUserIdMiddleware(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-user-id'];
    const userId = (Array.isArray(header) ? header[0] : header) || randomUUID();
    ensureUser(userId);
    request.userId = userId;
  });
}
