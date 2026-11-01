import { afterEach, describe, expect, it, vi } from 'vitest';

/** Phase 6A: native BarcodeDetector when it reads QR; otherwise the bundled decoder. */

const jsQR = vi.fn();
vi.mock('jsqr', () => ({ default: (...args: unknown[]) => jsQR(...args) }));

afterEach(() => {
  vi.unstubAllGlobals();
  jsQR.mockReset();
});

function video(width: number, height: number): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

describe('createFrameDecoder', () => {
  it('uses BarcodeDetector when it supports qr_code', async () => {
    const detect = vi.fn(async () => [{ rawValue: 'hello' }]);
    class FakeDetector {
      static getSupportedFormats = async () => ['ean_13', 'qr_code'];
      detect = detect;
    }
    vi.stubGlobal('BarcodeDetector', FakeDetector);
    const { createFrameDecoder } = await import('../decoder');
    const decoder = await createFrameDecoder();
    expect(decoder.kind).toBe('native');
    expect(await decoder.decode(video(10, 10))).toBe('hello');
    // A detector failure on one frame is just "nothing found".
    detect.mockRejectedValueOnce(new Error('frame'));
    expect(await decoder.decode(video(10, 10))).toBeNull();
  });

  it('falls back to the bundled decoder without BarcodeDetector, or without QR support', async () => {
    const { createFrameDecoder } = await import('../decoder');
    expect((await createFrameDecoder()).kind).toBe('bundled');
    class NoQr {
      static getSupportedFormats = async () => ['ean_13'];
      detect = async () => [];
    }
    vi.stubGlobal('BarcodeDetector', NoQr);
    expect((await createFrameDecoder()).kind).toBe('bundled');
  });

  it('the bundled decoder reads the centre square, downscaled, on this device', async () => {
    const drawImage = vi.fn();
    const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    jsQR.mockReturnValueOnce({ data: 'payload' }).mockReturnValueOnce(null);
    const { createFrameDecoder, BUNDLED_MAX_EDGE } = await import('../decoder');
    const decoder = await createFrameDecoder();
    expect(decoder.kind).toBe('bundled');
    expect(await decoder.decode(video(1280, 720))).toBe('payload');
    // Centre 720x720 of a 1280x720 frame, scaled to at most BUNDLED_MAX_EDGE.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 280, 0, 720, 720, 0, 0, BUNDLED_MAX_EDGE, BUNDLED_MAX_EDGE);
    expect(jsQR.mock.calls[0]?.[1]).toBe(BUNDLED_MAX_EDGE);
    expect(await decoder.decode(video(1280, 720))).toBeNull();
    // No frame yet: nothing is drawn.
    expect(await decoder.decode(video(0, 0))).toBeNull();
    expect(drawImage).toHaveBeenCalledTimes(2);
  });
});
