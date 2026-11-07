// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BoundedBodyError, COORDINATION_MAX_BODY_BYTES, readBoundedText } from '../bounded-body';
import { createCoordinationReader } from '@/lib/handshake/http-reader';
import { createRoomReader } from '@/lib/handshake/room';

/** F-05 regressions: oversized coordination responses are refused without buffering them whole. */

const ID = '12345678-1234-4234-8234-123456789012';

/** A body of `chunks` x `size` bytes that records how many chunks were actually pulled. */
function streaming(chunks: number, size: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled += 1;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(stream, { headers: { 'content-type': 'application/json', ...headers } });
  return { response, pulled: () => pulled, cancelled: () => cancelled };
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error instanceof BoundedBodyError ? error.reason : 'other';
  }
}

describe('readBoundedText', () => {
  it('reads a body within the limit, including multi-byte UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"ad":"Ayşe ☕"}');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 11));
        c.enqueue(bytes.slice(11));
        c.close();
      },
    });
    await expect(readBoundedText(new Response(stream), 64)).resolves.toBe('{"ad":"Ayşe ☕"}');
  });

  it('accepts exactly the limit and refuses one byte more', async () => {
    await expect(readBoundedText(new Response('x'.repeat(100)), 100)).resolves.toHaveLength(100);
    expect(await reason(readBoundedText(new Response('x'.repeat(101)), 100))).toBe('too_large');
  });

  it('refuses a declared Content-Length over the limit before reading anything', async () => {
    const body = streaming(10, 1024, { 'content-length': String(10 * 1024) });
    expect(await reason(readBoundedText(body.response, 4096))).toBe('too_large');
    expect(body.pulled()).toBeLessThanOrEqual(1);
  });

  it('stops pulling and cancels an undeclared oversized stream at the limit', async () => {
    const body = streaming(1000, 16 * 1024); // 16 MB if read whole
    expect(await reason(readBoundedText(body.response, COORDINATION_MAX_BODY_BYTES))).toBe('too_large');
    expect(body.pulled()).toBeLessThanOrEqual(Math.ceil(COORDINATION_MAX_BODY_BYTES / (16 * 1024)) + 2);
    expect(body.cancelled()).toBe(true);
  });

  it('refuses invalid UTF-8 instead of replacing it', async () => {
    expect(await reason(readBoundedText(new Response(new Uint8Array([0x7b, 0xff, 0x7d])), 64))).toBe('malformed');
  });

  it('reports a broken stream as a read failure', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('connection reset');
      },
    });
    expect(await reason(readBoundedText(new Response(stream), 64))).toBe('read_failed');
  });
});

describe('Handshake coordination readers refuse oversized answers (F-05)', () => {
  it('session snapshot and events: oversized body is "unavailable", and the stream is not read to the end', async () => {
    for (const call of ['snapshot', 'events'] as const) {
      const body = streaming(1000, 16 * 1024);
      const reader = createCoordinationReader('https://taply.example', async () => body.response);
      expect(await reader[call](ID)).toEqual({ ok: false, error: 'unavailable' });
      expect(body.pulled()).toBeLessThan(10);
    }
  });

  it('declared oversized Content-Length is refused', async () => {
    const reader = createCoordinationReader('https://taply.example', async () =>
      new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '99999999' } }),
    );
    expect(await reader.snapshot(ID)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('room sync: oversized body is "unavailable"', async () => {
    const body = streaming(1000, 16 * 1024);
    const room = createRoomReader('https://pilot.taply.example', async () => body.response);
    expect(await room.sync(ID, null)).toEqual({ ok: false, error: 'unavailable' });
    expect(body.pulled()).toBeLessThan(10);
  });
});
