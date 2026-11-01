/**
 * Camera access for the QR scanner (Phase 6A).
 *
 * Frames never leave the device: they are decoded in this page by the
 * browser's BarcodeDetector or the bundled decoder (lib/qr/decoder.ts).
 */

export type CameraProblem =
  /** The person (or a site setting) refused camera access. */
  | 'denied'
  /** No camera on this device, or none that can be opened. */
  | 'no_camera'
  /** Another app holds the camera, or the hardware failed to start. */
  | 'busy'
  /** Camera APIs exist only on HTTPS pages (and localhost). */
  | 'insecure'
  /** This browser has no camera API at all. */
  | 'unsupported';

export type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia'>;

export class CameraError extends Error {
  constructor(readonly problem: CameraProblem, options?: { cause?: unknown }) {
    super(`camera:${problem}`, options);
    this.name = 'CameraError';
  }
}

/** Rear camera preferred (`ideal`, so laptops with one front camera still work). No audio. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export function classifyCameraError(error: unknown): CameraProblem {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no_camera';
    case 'NotSupportedError':
    case 'TypeError':
      return 'unsupported';
    default:
      return 'busy';
  }
}

/**
 * Opens the camera. `media` is `navigator.mediaDevices` (undefined on insecure
 * pages and very old browsers). Throws CameraError.
 */
export async function openCamera(
  media: MediaDevicesLike | null | undefined,
  secureContext: boolean,
): Promise<MediaStream> {
  if (media === null || media === undefined || typeof media.getUserMedia !== 'function') {
    throw new CameraError(secureContext ? 'unsupported' : 'insecure');
  }
  try {
    return await media.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (cause) {
    throw new CameraError(classifyCameraError(cause), { cause });
  }
}

/** Stops every track, so the camera indicator turns off. Safe to call twice. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (stream === null || stream === undefined) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Already stopped.
    }
  }
}
