import jsQR from 'jsqr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameDecoder } from '../decoder';
import { installQrWorkerStub } from '@/test/qr-worker';
import { encodeQr } from '../encode';
import { parsePayInput } from '@/lib/payments/pay-link';
import { canonicalPayUrl } from '@/lib/share/origin';

/**
 * Phase 6A: the QR a request shows (lib/qr/encode, as rendered by QrCode)
 * decodes with the bundled fallback decoder, and the scanner's parser turns it
 * back into exactly the same request ID.
 */

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { installQrWorkerStub(); });

/** Night-on-cream pixels, 4-module quiet zone, `scale` px per module (as QrCode draws it). */
function rasterize(text: string, scale: number): { data: Uint8ClampedArray; side: number } {
  const qr = encodeQr(text, 'M');
  const quiet = 4;
  const side = (qr.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my]?.[mx] === true;
      const i = (y * side + x) * 4;
      data[i] = dark ? 11 : 244;
      data[i + 1] = dark ? 18 : 243;
      data[i + 2] = dark ? 14 : 232;
      data[i + 3] = 255;
    }
  }
  return { data, side };
}

describe('share QR round trip', () => {
  it('the real bundled scanner decodes an inverted QR on its fourth pass', async () => {
    const link = canonicalPayUrl('https://pilot.taply.app', ID);
    const { data, side } = rasterize(link, 4);
    for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = 255 - (data[i] ?? 0);
    vi.stubGlobal('BarcodeDetector', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data, width: side, height: side }),
    } as unknown as CanvasRenderingContext2D);
    const decoder = await createFrameDecoder();
    const frame = { videoWidth: side, videoHeight: side } as HTMLVideoElement;
    for (let i = 0; i < 3; i++) expect(await decoder.decode(frame)).toBeNull();
    expect(await decoder.decode(frame)).toBe(link);
  });
  it('a canonical pay link survives encode → bundled decode → parse', () => {
    const link = canonicalPayUrl('https://pilot.taply.app', ID);
    const { data, side } = rasterize(link, 4);
    const decoded = jsQR(data, side, side, { inversionAttempts: 'dontInvert' });
    expect(decoded?.data).toBe(link);
    expect(parsePayInput(decoded?.data ?? '', ['https://pilot.taply.app'])).toEqual({ kind: 'request', id: ID });
  });
});
