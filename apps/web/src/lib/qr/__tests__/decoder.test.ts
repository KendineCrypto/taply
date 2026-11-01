import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installQrWorkerStub } from '@/test/qr-worker';

/** Phase 6A: native BarcodeDetector when it reads QR; otherwise the bundled decoder. */

const jsQR = vi.fn();
vi.mock('jsqr', () => ({ default: (...args: unknown[]) => jsQR(...args) }));
let workers: ReturnType<typeof installQrWorkerStub>;
beforeEach(() => { workers = installQrWorkerStub(); });

afterEach(() => {
  vi.unstubAllGlobals();
  jsQR.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function video(width: number, height: number): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

describe('createFrameDecoder', () => {
  it('a native failure arriving after disposal cannot create a fallback worker', async () => {
    let reject!: (error: Error) => void;
    class LateDetector {
      static getSupportedFormats = async () => ['qr_code'];
      detect = () => new Promise<never>((_resolve, fail) => { reject = fail; });
    }
    vi.stubGlobal('BarcodeDetector', LateDetector);
    const { createFrameDecoder } = await import('../decoder');
    const decoder = await createFrameDecoder();
    const pending = decoder.decode(video(10, 10));
    decoder.dispose?.();
    reject(new DOMException('unsupported', 'NotSupportedError'));
    await expect(pending).resolves.toBeNull();
    expect(workers).toHaveLength(0);
  });
  it('transfers one frame to the worker and disposal settles pending work and terminates it', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(400) }),
    } as unknown as CanvasRenderingContext2D);
    const { createFrameDecoder } = await import('../decoder');
    const decoder = await createFrameDecoder();
    workers[0]?.postMessage.mockImplementationOnce(() => undefined);
    const pending = decoder.decode(video(10, 10));
    await expect(decoder.decode(video(10, 10))).resolves.toBeNull();
    expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1);
    expect(workers[0]?.postMessage.mock.calls[0]?.[1]).toEqual([expect.any(ArrayBuffer)]);
    decoder.dispose?.();
    await expect(pending).resolves.toBeNull();
    expect(workers[0]?.terminate).toHaveBeenCalled();
    await expect(decoder.decode(video(10, 10))).resolves.toBeNull();
  });

  it('the watchdog terminates a stalled worker; a later frame gets a new worker', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(400) }),
    } as unknown as CanvasRenderingContext2D);
    const { createFrameDecoder, DECODE_TIMEOUT_MS } = await import('../decoder');
    const decoder = await createFrameDecoder();
    workers[0]?.postMessage.mockImplementationOnce(() => undefined);
    const pending = decoder.decode(video(10, 10));
    await vi.advanceTimersByTimeAsync(DECODE_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
    expect(workers[0]?.terminate).toHaveBeenCalled();
    jsQR.mockReturnValue({ data: 'recovered' });
    const next = decoder.decode(video(10, 10));
    await vi.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toBe('recovered');
    expect(workers).toHaveLength(2);
    decoder.dispose?.();
  });
  it('a permanent native capability failure switches to bundled decoding', async () => {
    const detect = vi.fn(async () => { throw new DOMException('unsupported QR', 'NotSupportedError'); });
    class BrokenDetector {
      static getSupportedFormats = async () => ['qr_code'];
      detect = detect;
    }
    vi.stubGlobal('BarcodeDetector', BrokenDetector);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(400) }),
    } as unknown as CanvasRenderingContext2D);
    jsQR.mockReturnValue({ data: 'fallback' });
    const { createFrameDecoder } = await import('../decoder');
    const decoder = await createFrameDecoder();
    expect(await decoder.decode(video(10, 10))).toBe('fallback');
    expect(await decoder.decode(video(10, 10))).toBe('fallback');
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('canvas initialization failures do not reject into the scanner loop', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('allocation failed'); });
    const { createFrameDecoder } = await import('../decoder');
    const decoder = await createFrameDecoder();
    await expect(decoder.decode(video(10, 10))).resolves.toBeNull();
  });
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
