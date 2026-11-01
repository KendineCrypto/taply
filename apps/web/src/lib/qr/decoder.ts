/**
 * QR decoding for the scanner, entirely on this device (Phase 6A).
 *
 *  - `native`: the browser's BarcodeDetector (Android Chrome, desktop Chrome),
 *    used only when it reports `qr_code` support.
 *  - `bundled`: jsQR, shipped with the app and loaded on demand (iOS Safari and
 *    every browser without BarcodeDetector).
 *
 * Only the centre square of the frame is decoded, downscaled to at most
 * BUNDLED_MAX_EDGE pixels: that is where the viewfinder points and it keeps
 * each pass cheap on phones.
 */

export interface FrameDecoder {
  readonly kind: 'native' | 'bundled';
  /** The decoded text of one QR code in the frame, or null. Never throws. */
  decode(video: HTMLVideoElement): Promise<string | null>;
  /** Release worker resources and settle any frame still being decoded. */
  dispose?(): void;
}

export type DecoderFactory = () => Promise<FrameDecoder>;

export const BUNDLED_MAX_EDGE = 640;
export const DECODE_TIMEOUT_MS = 1_500;

interface DetectedBarcode {
  readonly rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<ReadonlyArray<DetectedBarcode>>;
}
interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

async function nativeDecoder(scope: typeof globalThis): Promise<FrameDecoder | null> {
  const Ctor = (scope as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (typeof Ctor !== 'function') return null;
  try {
    if (typeof Ctor.getSupportedFormats === 'function') {
      const formats = await Ctor.getSupportedFormats();
      if (!formats.includes('qr_code')) return null;
    }
    const detector = new Ctor({ formats: ['qr_code'] });
    let fallback: Promise<FrameDecoder> | null = null;
    let disposed = false;
    const decodeFallback = (video: HTMLVideoElement) => {
      fallback ??= bundledDecoder();
      return fallback.then((decoder) => decoder.decode(video)).catch(() => null);
    };
    return {
      kind: 'native',
      dispose() {
        disposed = true;
        void fallback?.then((decoder) => decoder.dispose?.()).catch(() => undefined);
      },
      async decode(video) {
        if (disposed) return null;
        if (fallback !== null) return decodeFallback(video);
        try {
          const found = await detector.detect(video);
          const first = found.find((code) => typeof code.rawValue === 'string' && code.rawValue !== '');
          return first?.rawValue ?? null;
        } catch (error) {
          if (disposed) return null;
          // Some engines advertise the API but cannot run this format. A
          // permanent capability error must not become an endless empty scan.
          if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotSupportedError') return decodeFallback(video);
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

async function bundledDecoder(): Promise<FrameDecoder> {
  // Heavy image recognition must never run on the UI thread: noise can take
  // hundreds of milliseconds even at 640px. This worker is bundled locally.
  let worker = new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module' });
  let disposed = false;
  let needsWorker = false;
  let nextId = 0;
  let pending: { id: number; resolve: (text: string | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const reset = () => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    needsWorker = true;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.resolve(null);
      pending = null;
    }
  };
  const listen = () => {
    worker.onmessage = (event: MessageEvent<{ id: number; text: string | null }>) => {
      if (pending === null || event.data.id !== pending.id) return;
      clearTimeout(pending.timer);
      pending.resolve(typeof event.data.text === 'string' ? event.data.text : null);
      pending = null;
    };
    worker.onerror = () => reset();
  };
  listen();
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let pass = 0;
  return {
    kind: 'bundled',
    dispose() {
      disposed = true;
      reset();
      canvas = null;
      context = null;
    },
    async decode(video) {
      if (disposed || pending !== null) return null;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width === 0 || height === 0) return null;
      const side = Math.min(width, height);
      const edge = Math.min(side, BUNDLED_MAX_EDGE);
      try {
        if (canvas === null) {
          canvas = document.createElement('canvas');
          context = canvas.getContext('2d', { willReadFrequently: true });
        }
        if (context === null) return null;
        if (canvas.width !== edge) {
          canvas.width = edge;
          canvas.height = edge;
        }
        context.drawImage(video, (width - side) / 2, (height - side) / 2, side, side, 0, 0, edge, edge);
        const image = context.getImageData(0, 0, edge, edge);
        // Dark-on-light every pass; light-on-dark (inverted) codes every fourth pass.
        pass = (pass + 1) % 4;
        if (needsWorker) {
          worker = new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module' });
          needsWorker = false;
          listen();
        }
        return await new Promise<string | null>((resolve) => {
          const id = ++nextId;
          pending = { id, resolve, timer: setTimeout(reset, DECODE_TIMEOUT_MS) };
          try {
            // Transfer ownership; no structured-clone copy of a ~1.6MB frame.
            worker.postMessage({ id, pixels: image.data.buffer, edge, invert: pass === 0 }, [image.data.buffer]);
          } catch {
            reset();
          }
        });
      } catch {
        return null;
      }
    },
  };
}

/** The best decoder this browser offers. Rejects only if the bundled decoder cannot load. */
export const createFrameDecoder: DecoderFactory = async () =>
  (await nativeDecoder(globalThis)) ?? (await bundledDecoder());
