/** Dedicated, local-only decoder: pixel buffers are never sent over the network. */
import jsQR from 'jsqr';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; pixels: ArrayBuffer; edge: number; invert: boolean }>) => void) | null;
  postMessage(message: { id: number; text: string | null }): void;
};

scope.onmessage = ({ data: { id, pixels, edge, invert } }) => {
  let text: string | null = null;
  try {
    // jsqr@1.4.0's onlyInvert option throws. attemptBoth also handles inversion.
    text = jsQR(new Uint8ClampedArray(pixels), edge, edge, {
      inversionAttempts: invert ? 'attemptBoth' : 'dontInvert',
    })?.data || null;
  } catch {
    // A bad/unreadable frame is not a payment and must not end the session.
  }
  scope.postMessage({ id, text });
};
