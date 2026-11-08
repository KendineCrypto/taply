/**
 * Reads a fetch Response body with a hard byte budget (F-05).
 *
 * `response.text()` buffers the whole body before anything can look at its
 * size, so a fast oversized answer is held in memory in full. This reader:
 *  - refuses a declared Content-Length over the limit before reading;
 *  - streams and counts BYTES, and stops (cancelling the stream) as soon as
 *    the limit would be crossed, so at most one extra chunk is ever held;
 *  - decodes strict UTF-8 (invalid bytes are an error, never replaced).
 */

/** The shared strict JSON parser refuses bodies above this size anyway (docs/API.md). */
export const COORDINATION_MAX_BODY_BYTES = 65_536;

export class BoundedBodyError extends Error {
  // A plain field, not a parameter property: Node's type stripping (apps/api tests) rejects those.
  readonly reason: 'too_large' | 'malformed' | 'read_failed';

  constructor(reason: 'too_large' | 'malformed' | 'read_failed') {
    super(`bounded-body:${reason}`);
    this.reason = reason;
    this.name = 'BoundedBodyError';
  }
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && BigInt(declared) > BigInt(maxBytes)) {
    void response.body?.cancel().catch(() => undefined);
    throw new BoundedBodyError('too_large');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new BoundedBodyError('read_failed');
      }
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new BoundedBodyError('too_large');
      try {
        text += decoder.decode(chunk.value, { stream: true });
      } catch {
        throw new BoundedBodyError('malformed');
      }
    }
    try {
      text += decoder.decode();
    } catch {
      throw new BoundedBodyError('malformed');
    }
    return text;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancel in some engines.
    }
  }
}
