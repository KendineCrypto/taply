/** Message transport stand-in for jsdom. It is not a browser Worker test. */
import { vi } from 'vitest';
import jsQR from 'jsqr';

export function installQrWorkerStub() {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    stopped = false;
    terminate = vi.fn(() => { this.stopped = true; });
    postMessage = vi.fn((data: { id: number; pixels: ArrayBuffer; edge: number; invert: boolean }, _transfer?: Transferable[]) => {
      void _transfer; // jsdom records the transfer list; it cannot detach buffers.
      queueMicrotask(() => {
        if (this.stopped) return;
        const text = jsQR(new Uint8ClampedArray(data.pixels), data.edge, data.edge, {
          inversionAttempts: data.invert ? 'attemptBoth' : 'dontInvert',
        })?.data ?? null;
        this.onmessage?.(new MessageEvent('message', { data: { id: data.id, text } }));
      });
    });
    constructor() { workers.push(this); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return workers;
}
