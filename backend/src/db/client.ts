// In-Memory Data Store — Zero database files, zero native binaries, zero external database setup.
// Runs purely in Node memory across all environments (Windows, Linux, s390x mainframe, serverless).

interface UserRecord {
  id: string;
  created_at: string;
  settings_json?: string;
}

interface HazardRecord {
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

interface ContactRecord {
  id: string;
  user_id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
}

interface SosSessionRecord {
  id: string;
  user_id: string;
  status: string;
  message: string | null;
  contact_ids_json: string;
  started_at: string;
  stopped_at: string | null;
  stop_reason: string | null;
}

interface SosLocationRecord {
  id: number;
  session_id: string;
  lat: number;
  lon: number;
  accuracy_meters: number | null;
  recorded_at: string;
}

// In-Memory Tables
const users: UserRecord[] = [];
const hazards: HazardRecord[] = [];
const contacts: ContactRecord[] = [];
const sosSessions: SosSessionRecord[] = [];
const sosLocations: SosLocationRecord[] = [];
let nextLocationId = 1;

export const db = {
  exec(_sql: string): void {
    // No-op for in-memory store
  },

  prepare(sql: string) {
    const s = sql.trim().toLowerCase();

    return {
      run(...args: any[]) {
        if (s.startsWith('insert into hazard_reports')) {
          if (args.length === 7) {
            // Seed insertion: id, lat, lon, type, description, severity, created_at
            hazards.push({
              id: args[0],
              reporter_user_id: null,
              lat: Number(args[1]),
              lon: Number(args[2]),
              type: String(args[3]),
              description: args[4] ? String(args[4]) : null,
              severity: String(args[5]),
              confirm_count: 0,
              created_at: String(args[6]),
              resolved_at: null,
            });
          } else {
            // User report insertion: id, reporter_user_id, lat, lon, type, description, created_at
            hazards.push({
              id: args[0],
              reporter_user_id: args[1] ?? null,
              lat: Number(args[2]),
              lon: Number(args[3]),
              type: String(args[4]),
              description: args[5] ? String(args[5]) : null,
              severity: 'medium',
              confirm_count: 0,
              created_at: String(args[6]),
              resolved_at: null,
            });
          }
          return { changes: 1 };
        }

        if (s.startsWith('update hazard_reports set confirm_count')) {
          const id = args[0];
          const h = hazards.find((item) => item.id === id);
          if (h) h.confirm_count += 1;
          return { changes: h ? 1 : 0 };
        }

        if (s.startsWith('insert into trusted_contacts')) {
          contacts.push({
            id: args[0],
            user_id: args[1],
            name: args[2],
            relationship: args[3] ?? null,
            phone: args[4] ?? null,
            email: args[5] ?? null,
            created_at: args[6] ?? new Date().toISOString(),
          });
          return { changes: 1 };
        }

        if (s.startsWith('update trusted_contacts set')) {
          const name = args[0];
          const rel = args[1];
          const phone = args[2];
          const email = args[3];
          const id = args[4];
          const c = contacts.find((item) => item.id === id);
          if (c) {
            c.name = name;
            c.relationship = rel;
            c.phone = phone;
            c.email = email;
          }
          return { changes: c ? 1 : 0 };
        }

        if (s.startsWith('delete from trusted_contacts')) {
          const id = args[0];
          const userId = args[1];
          const idx = contacts.findIndex((item) => item.id === id && (userId === undefined || item.user_id === userId));
          if (idx !== -1) {
            contacts.splice(idx, 1);
            return { changes: 1 };
          }
          return { changes: 0 };
        }

        if (s.startsWith('insert into sos_sessions')) {
          sosSessions.push({
            id: args[0],
            user_id: args[1],
            status: 'active',
            message: args[2] ?? null,
            contact_ids_json: args[3] ?? '[]',
            started_at: args[4] ?? new Date().toISOString(),
            stopped_at: null,
            stop_reason: null,
          });
          return { changes: 1 };
        }

        if (s.startsWith('update sos_sessions set status = \'stopped\'')) {
          const stoppedAt = args[0];
          const reason = args[1];
          const id = args[2];
          const sess = sosSessions.find((item) => item.id === id);
          if (sess) {
            sess.status = 'stopped';
            sess.stopped_at = stoppedAt;
            sess.stop_reason = reason;
          }
          return { changes: sess ? 1 : 0 };
        }

        if (s.startsWith('insert into sos_locations')) {
          sosLocations.push({
            id: nextLocationId++,
            session_id: args[0],
            lat: Number(args[1]),
            lon: Number(args[2]),
            accuracy_meters: args[3] ? Number(args[3]) : null,
            recorded_at: args[4] ?? new Date().toISOString(),
          });
          return { changes: 1 };
        }

        if (s.startsWith('insert into users')) {
          users.push({
            id: args[0],
            created_at: args[1] ?? new Date().toISOString(),
          });
          return { changes: 1 };
        }

        return { changes: 0 };
      },

      get(...args: any[]) {
        if (s.includes('count(*) as count from hazard_reports')) {
          return { count: hazards.length };
        }

        if (s.startsWith('select * from hazard_reports where id =')) {
          const id = args[0];
          return hazards.find((h) => h.id === id);
        }

        if (s.startsWith('select * from trusted_contacts where id = ? and user_id = ?')) {
          const id = args[0];
          const userId = args[1];
          return contacts.find((c) => c.id === id && c.user_id === userId);
        }

        if (s.startsWith('select * from trusted_contacts where id = ?')) {
          const id = args[0];
          return contacts.find((c) => c.id === id);
        }

        if (s.startsWith('select * from sos_sessions where id = ?')) {
          const id = args[0];
          return sosSessions.find((sess) => sess.id === id);
        }

        if (s.includes('from sos_locations where session_id = ?')) {
          const sessId = args[0];
          const matching = sosLocations.filter((l) => l.session_id === sessId);
          return matching[matching.length - 1];
        }

        if (s.startsWith('select id from users where id = ?')) {
          const id = args[0];
          return users.find((u) => u.id === id);
        }

        return undefined;
      },

      all(...args: any[]) {
        if (s.includes('from hazard_reports where resolved_at is null')) {
          return hazards.filter((h) => h.resolved_at === null);
        }

        if (s.includes('from trusted_contacts where user_id = ?')) {
          const userId = args[0];
          return contacts
            .filter((c) => c.user_id === userId)
            .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
        }

        return [];
      },
    };
  },
};

export function ensureUser(userId: string): void {
  const existing = users.find((u) => u.id === userId);
  if (!existing) {
    users.push({ id: userId, created_at: new Date().toISOString() });
  }
}
