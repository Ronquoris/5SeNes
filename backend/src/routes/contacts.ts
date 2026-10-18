import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';

interface ContactRow {
  id: string;
  user_id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
}

function toApiShape(row: ContactRow) {
  return { id: row.id, name: row.name, relationship: row.relationship, phone: row.phone, email: row.email };
}

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/contacts', async (request) => {
    const rows = db
      .prepare('SELECT * FROM trusted_contacts WHERE user_id = ? ORDER BY created_at DESC')
      .all(request.userId) as unknown as ContactRow[];
    return { contacts: rows.map(toApiShape) };
  });

  app.post('/api/contacts', async (request, reply) => {
    const body = request.body as { name?: string; relationship?: string; phone?: string; email?: string };
    if (!body.name?.trim()) {
      return reply.code(400).send({ error: { code: 'MISSING_NAME', message: '"name" is required.' } });
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO trusted_contacts (id, user_id, name, relationship, phone, email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, request.userId, body.name.trim(), body.relationship ?? null, body.phone ?? null, body.email ?? null, new Date().toISOString());
    const row = db.prepare('SELECT * FROM trusted_contacts WHERE id = ?').get(id) as unknown as ContactRow;
    return reply.code(201).send(toApiShape(row));
  });

  app.patch('/api/contacts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; relationship?: string; phone?: string; email?: string };
    const existing = db.prepare('SELECT * FROM trusted_contacts WHERE id = ? AND user_id = ?').get(id, request.userId) as unknown as
      | ContactRow
      | undefined;
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Contact not found.' } });
    }
    db.prepare('UPDATE trusted_contacts SET name = ?, relationship = ?, phone = ?, email = ? WHERE id = ?').run(
      body.name?.trim() || existing.name,
      body.relationship ?? existing.relationship,
      body.phone ?? existing.phone,
      body.email ?? existing.email,
      id
    );
    const row = db.prepare('SELECT * FROM trusted_contacts WHERE id = ?').get(id) as unknown as ContactRow;
    return toApiShape(row);
  });

  app.delete('/api/contacts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare('DELETE FROM trusted_contacts WHERE id = ? AND user_id = ?').run(id, request.userId);
    if (result.changes === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Contact not found.' } });
    }
    return reply.code(204).send();
  });
}
