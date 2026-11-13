import { createNearTestnetClient } from '@taply/near-client';
import { z } from 'zod';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { FLAGS } from '@/lib/flags/features';
import { nsToDate } from '@/lib/format/time';
import { redisFromEnv } from './redis';
import type { RedisCommand } from './redis';
import { createRooms, PRESENCE_STATES, ROOM_ID, RoomError, TOKEN } from './rooms';
import type { Rooms } from './rooms';

/**
 * HTTP layer for Live Handshake. JSON in/out, no cookies, `no-store`, small
 * bodies, per-IP limits. Room creation re-reads the on-chain request at a final
 * block: only an OPEN request on the approved contract gets a room.
 */
const HEX64 = /^[a-f0-9]{64}$/;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => json(status, { error: code, ...extra });
const ERROR_STATUS: Record<RoomError['code'], number> = { NOT_FOUND: 404, FORBIDDEN: 403, EXPIRED: 410, CLOSED: 410, ALREADY_JOINED: 409, UNAVAILABLE: 503 };

export interface HandshakeDeps {
  readonly redis: RedisCommand | null;
  /** OPEN request's funding deadline in ms, or null when it is not payable. */
  readonly openRequestDeadlineMs: (requestId: string) => Promise<number | null>;
  readonly now?: () => number;
  /** Redis key namespace; omitted = the Testnet namespace. Mainnet uses its own. */
  readonly namespace?: string;
}

async function readOpenDeadline(requestId: string): Promise<number | null> {
  if (!CHAIN_CONFIG.ok) return null;
  const { observation } = await createNearTestnetClient(CHAIN_CONFIG.client).readPaymentRequest(requestId);
  const request = observation.data?.request;
  if (observation.assurance !== 'verified_final' || !request || request.status !== 'OPEN') return null;
  return nsToDate(request.terms.fundingExpiresAtNs).getTime();
}

export function defaultDeps(): HandshakeDeps {
  return { redis: FLAGS.handshake.enabled ? redisFromEnv() : null, openRequestDeadlineMs: readOpenDeadline };
}

async function body(request: Request): Promise<unknown> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) throw new Error('BAD_REQUEST');
  const text = await request.text();
  if (text.length > 2048) throw new Error('BAD_REQUEST');
  return JSON.parse(text);
}
const clientKey = (request: Request) => (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';

const Create = z.strictObject({ requestId: z.string().regex(HEX64) });
const Action = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('join'), joinToken: z.string().regex(TOKEN), participantToken: z.string().regex(TOKEN) }),
  z.strictObject({ action: z.literal('sync'), role: z.enum(['merchant', 'customer']), token: z.string().regex(TOKEN), state: z.enum(PRESENCE_STATES).optional() }),
  z.strictObject({ action: z.literal('close'), token: z.string().regex(TOKEN) }),
]);

function roomsOf(deps: HandshakeDeps): Rooms | null {
  return deps.redis === null ? null : createRooms({ redis: deps.redis, ...(deps.now ? { now: deps.now } : {}), ...(deps.namespace ? { namespace: deps.namespace } : {}) });
}

export async function handleHealth(deps: HandshakeDeps): Promise<Response> {
  if (deps.redis === null) return json(200, { available: false });
  try {
    await deps.redis(['PING']);
    return json(200, { available: true });
  } catch {
    return json(200, { available: false });
  }
}

export async function handleCreate(request: Request, deps: HandshakeDeps): Promise<Response> {
  const rooms = roomsOf(deps);
  if (rooms === null) return fail(503, 'UNAVAILABLE');
  let input: z.infer<typeof Create>;
  try { input = Create.parse(await body(request)); } catch { return fail(400, 'BAD_REQUEST'); }
  try {
    if (!(await rooms.allow('create', clientKey(request), 30))) return fail(429, 'RATE_LIMITED');
    const deadline = await deps.openRequestDeadlineMs(input.requestId);
    if (deadline === null) return fail(409, 'REQUEST_NOT_OPEN');
    const room = await rooms.create(input.requestId, deadline);
    return json(201, room);
  } catch (error) {
    if (error instanceof RoomError) return fail(ERROR_STATUS[error.code], error.code);
    return fail(503, 'UNAVAILABLE');
  }
}

export async function handleRoom(request: Request, roomId: string, deps: HandshakeDeps): Promise<Response> {
  const rooms = roomsOf(deps);
  if (rooms === null) return fail(503, 'UNAVAILABLE');
  if (!ROOM_ID.test(roomId)) return fail(404, 'NOT_FOUND');
  let input: z.infer<typeof Action>;
  try { input = Action.parse(await body(request)); } catch { return fail(400, 'BAD_REQUEST'); }
  try {
    if (!(await rooms.allow('room', clientKey(request), 600))) return fail(429, 'RATE_LIMITED');
    if (input.action === 'join') return json(200, await rooms.join(roomId, input.joinToken, input.participantToken));
    if (input.action === 'close') { await rooms.close(roomId, input.token); return json(200, { closed: true }); }
    return json(200, await rooms.sync(roomId, input.role, input.token, input.state ?? 'viewing'));
  } catch (error) {
    if (error instanceof RoomError) return fail(ERROR_STATUS[error.code], error.code, error.requestId ? { requestId: error.requestId } : {});
    return fail(503, 'UNAVAILABLE');
  }
}
