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
}

export type DecoderFactory = () => Promise<FrameDecoder>;

export const BUNDLED_MAX_EDGE = 640;

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
    return {
      kind: 'native',
      async decode(video) {
        try {
          const found = await detector.detect(video);
          const first = found.find((code) => typeof code.rawValue === 'string' && code.rawValue !== '');
          return first?.rawValue ?? null;
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

async function bundledDecoder(): Promise<FrameDecoder> {
  const { default: jsQR } = await import('jsqr');
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let pass = 0;
  return {
    kind: 'bundled',
    async decode(video) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width === 0 || height === 0) return null;
      const side = Math.min(width, height);
      const edge = Math.min(side, BUNDLED_MAX_EDGE);
      if (canvas === null) {
        canvas = document.createElement('canvas');
        context = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (context === null) return null;
      if (canvas.width !== edge) {
        canvas.width = edge;
        canvas.height = edge;
      }
      try {
        context.drawImage(video, (width - side) / 2, (height - side) / 2, side, side, 0, 0, edge, edge);
        const image = context.getImageData(0, 0, edge, edge);
        // Dark-on-light every pass; light-on-dark (inverted) codes every fourth pass.
        pass = (pass + 1) % 4;
        const code = jsQR(image.data, edge, edge, { inversionAttempts: pass === 0 ? 'onlyInvert' : 'dontInvert' });
        return code === null || code.data === '' ? null : code.data;
      } catch {
        return null;
      }
    },
  };
}

/** The best decoder this browser offers. Rejects only if the bundled decoder cannot load. */
export const createFrameDecoder: DecoderFactory = async () =>
  (await nativeDecoder(globalThis)) ?? (await bundledDecoder());
