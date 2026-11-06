import { z } from "zod";
import { AccountIdSchema, ChainHashSchema, HandshakeSessionSchema, SessionIdSchema, canonicalJson } from "@taply/shared";
const cursor = z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
const presence = z.enum(["joined", "active", "disconnected", "resumed"]);
const progress = z.strictObject({ phase: z.enum(["AWAITING_WALLET", "SUBMITTED", "OUTCOME_UNKNOWN", "USER_REJECTED"]), transactionHash: ChainHashSchema.nullable() });
const room = z.strictObject({ schemaVersion: z.literal("taply.room.v1"), authority: z.literal("coordination_only"),
  session: HandshakeSessionSchema,
  phase: z.enum(["WAITING_FOR_BIND", "WAITING_FOR_CUSTOMER", "WAITING_FOR_REVIEW", "WAITING_FOR_WALLET", "PENDING_CHAIN", "BLOCKED", "EXPIRED", "CLOSED"]),
  reviews: z.strictObject({ merchant: z.boolean(), payer: z.boolean() }),
  presence: z.strictObject({ merchant: presence, payer: presence.nullable() }), payerProgress: progress.nullable() });
const event = z.strictObject({ schemaVersion: z.literal("taply.room-event.v1"), eventId: cursor,
  sessionId: SessionIdSchema, emittedAt: z.iso.datetime(),
  type: z.enum(["session.created", "session.bound", "session.joined", "session.reviewed", "session.presence", "session.expired", "session.closed", "payer.progress"]), room });
export const RoomCatchUpSchema = z.strictObject({ schemaVersion: z.literal("taply.room-sync.v1"), sessionId: SessionIdSchema,
  cursor, reset: z.boolean(), serverTimeMs: z.number().safe().int().nonnegative(), room, events: z.array(event).max(64) });
export interface RoomClientScope { sessionId: string; accountId: string; authGeneration: number }
export type RoomClientState = RoomClientScope & { cursor: string; room: z.infer<typeof room> };

/** Replacement-state reducer for two independent clients. No wallet actions,
 * payment fields, verified receipt or chain authority can result from a hint.
 * Caller increments authGeneration on logout/account change, cancels outstanding
 * requests and sends its captured generation separately on completion. */
export function applyRoomCatchUp(previous: RoomClientState | null, untrusted: unknown, current: RoomClientScope, requestGeneration: number): RoomClientState | null {
  SessionIdSchema.parse(current.sessionId); AccountIdSchema.parse(current.accountId);
  if (!Number.isSafeInteger(current.authGeneration) || current.authGeneration < 0) throw Error("INVALID_ARGUMENT");
  const prior = previous?.sessionId === current.sessionId && previous.accountId === current.accountId
    && previous.authGeneration === current.authGeneration ? previous : null;
  if (requestGeneration !== current.authGeneration) return prior;
  const sync = RoomCatchUpSchema.parse(untrusted);
  if (sync.sessionId !== current.sessionId || sync.room.session.id !== current.sessionId
    || ![sync.room.session.merchantAccountId, sync.room.session.payerAccountId].includes(current.accountId)) throw Error("SESSION_MISMATCH");
  const high = BigInt(sync.cursor);
  let last: bigint | null = null;
  for (const e of sync.events) {
    const n = BigInt(e.eventId);
    if (e.sessionId !== current.sessionId || e.room.session.id !== current.sessionId || n === 0n || n > high
      || last !== null && n !== last + 1n) throw Error("ROOM_CURSOR_INVALID");
    last = n;
  }
  if (sync.reset && sync.events.length || last !== null && last !== high) throw Error("ROOM_CURSOR_INVALID");
  if (prior && BigInt(prior.cursor) > high) return prior;
  if (prior && prior.cursor === sync.cursor) {
    if (canonicalJson(prior.room) !== canonicalJson(sync.room)) throw Error("ROOM_CURSOR_CONFLICT");
    return prior;
  }
  if (prior && !sync.reset && !sync.events.some(e => BigInt(e.eventId) === BigInt(prior.cursor) + 1n)) throw Error("ROOM_REFRESH_REQUIRED");
  if (last !== null && canonicalJson(sync.events.at(-1)!.room) !== canonicalJson(sync.room)) throw Error("ROOM_CURSOR_CONFLICT");
  return { ...current, cursor: sync.cursor, room: sync.room };
}
