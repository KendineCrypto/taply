import { z } from 'zod';
import { ApiErrorSchema, HandshakeSessionSchema, SessionEventSchema, parseStrictJson } from '@taply/shared';

const Id = z.uuid();
const Cursor = z.string().regex(/^(0|[1-9][0-9]*)$/).max(20);
const EventPage = z.strictObject({ reset: z.boolean(), events: z.array(SessionEventSchema).max(64) });
export type CoordinationRead<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'unavailable' | 'unauthenticated' | 'forbidden' | 'expired' | 'invalid' };

/** Read-only integration seam. No login, signing, join authority, polling timer or
 * payment output. Not installed in live routes or the Handshake adapter resolver.
 * Events are hints to re-read session AND chain; they cannot settle a payment.
 */
export function createCoordinationReader(origin: string, transport: typeof fetch) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || (typeof window !== 'undefined' && window.location.origin !== origin)) throw new Error('Invalid coordination origin');

  async function read<T>(path: string, schema: z.ZodType<T>, cursor?: string): Promise<CoordinationRead<T>> {
    try {
      const response = await transport(`${origin}/api/v1/${path}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(cursor === undefined ? {} : { 'Last-Event-ID': cursor }) },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.headers.get('content-type')?.startsWith('application/json')) return { ok: false, error: 'unavailable' };
      const data = parseStrictJson(await response.text());
      if (!response.ok) {
        const failure = ApiErrorSchema.safeParse(data);
        if (!failure.success) return { ok: false, error: 'unavailable' };
        return { ok: false, error: response.status === 401 ? 'unauthenticated'
          : response.status === 403 ? 'forbidden'
            : failure.data.error.code === 'SESSION_EXPIRED' ? 'expired' : 'unavailable' };
      }
      return { ok: true, value: schema.parse(data) };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  }

  return {
    async snapshot(sessionId: string) {
      if (!Id.safeParse(sessionId).success) return { ok: false, error: 'invalid' } as const;
      return read(`sessions/${sessionId}`, HandshakeSessionSchema.refine(s => s.id === sessionId));
    },
    async events(sessionId: string, cursor?: string) {
      if (!Id.safeParse(sessionId).success || (cursor !== undefined && !Cursor.safeParse(cursor).success)) return { ok: false, error: 'invalid' } as const;
      return read(`sessions/${sessionId}/events`, EventPage.refine(p => p.events.every(e => e.sessionId === sessionId)), cursor);
    },
  };
}
