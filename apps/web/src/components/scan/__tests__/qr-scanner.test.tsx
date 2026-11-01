import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { QrScanner, SUCCESS_HOLD_MS } from '../QrScanner';
import type { QrScannerProps } from '../QrScanner';
import { I18nProvider } from '@/lib/i18n/provider';
import type { FrameDecoder } from '@/lib/qr/decoder';
import { CAMERA_CONSTRAINTS } from '@/lib/qr/camera';

/**
 * Phase 6A scanner: real camera API calls (mocked here), on-device decoding,
 * strict payload validation, and the camera always released.
 */

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const ORIGIN = 'https://pay.taply.app';

type GetUserMedia = (constraints?: MediaStreamConstraints) => Promise<MediaStream>;

interface FakeCamera {
  readonly media: { getUserMedia: Mock<GetUserMedia> };
  readonly tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
}

function fakeCamera(): FakeCamera {
  const tracks: FakeCamera['tracks'] = [];
  const media = {
    getUserMedia: vi.fn<GetUserMedia>(async () => {
      const track = { stop: vi.fn() };
      tracks.push(track);
      return { getTracks: () => [track] } as unknown as MediaStream;
    }),
  };
  return { media, tracks };
}

/** A decoder that returns whatever the test queues, one value per pass. */
function scriptedDecoder() {
  const queue: Array<string | null> = [];
  const decoder: FrameDecoder = {
    kind: 'bundled',
    decode: vi.fn(async () => (queue.length > 0 ? (queue.shift() ?? null) : null)),
  };
  return { decoder, queue, factory: vi.fn(async () => decoder) };
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

function renderScanner(props: Partial<QrScannerProps> & Pick<QrScannerProps, 'media' | 'createDecoder'>) {
  const handlers = { onClose: vi.fn(), onRequest: vi.fn(), onPasteLink: vi.fn() };
  const view = render(
    <I18nProvider locale="en">
      <QrScanner secureContext approvedOrigins={[ORIGIN]} {...handlers} {...props} />
    </I18nProvider>,
  );
  return { ...handlers, ...view };
}

const status = () => screen.getByRole('status', { hidden: true }).textContent ?? '';

beforeEach(() => {
  setReducedMotion(true);
  // jsdom has no media pipeline: report a playable frame and a no-op play().
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('QrScanner', () => {
  it('asks for the rear camera (no audio) on open, and decodes on this device', async () => {
    const cam = fakeCamera();
    const dec = scriptedDecoder();
    renderScanner({ media: cam.media, createDecoder: dec.factory });
    expect(cam.media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(cam.media.getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(CAMERA_CONSTRAINTS.audio).toBe(false);
    expect((CAMERA_CONSTRAINTS.video as MediaTrackConstraints).facingMode).toEqual({ ideal: 'environment' });
    await waitFor(() => expect(status()).toBe('Looking for a payment QR code'));
    await waitFor(() => expect(dec.decoder.decode).toHaveBeenCalled());
  });

  it('a valid Taply QR stops the camera, then opens exactly that request once', async () => {
    const cam = fakeCamera();
    const dec = scriptedDecoder();
    dec.queue.push(`${ORIGIN}/pay/${ID}?amount=999`);
    const { onRequest } = renderScanner({ media: cam.media, createDecoder: dec.factory });
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith(ID));
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(cam.tracks[0]?.stop).toHaveBeenCalled();
    expect(status()).toBe('Payment found. Opening the request…');
    expect(screen.getByTestId('scan-viewport').getAttribute('data-phase')).toBe('success');
  });

  it('an unrelated QR or another site’s link is reported and scanning continues', async () => {
    const cam = fakeCamera();
    const dec = scriptedDecoder();
    dec.queue.push('WIFI:S:cafe;T:WPA;P:secret;;');
    const { onRequest } = renderScanner({ media: cam.media, createDecoder: dec.factory });
    await waitFor(() => expect(status()).toBe('That QR code is not a Taply payment request.'));
    dec.queue.push(`https://taply-pay.evil.example/pay/${ID}`);
    await waitFor(() => expect(status()).toBe('That QR code points to taply-pay.evil.example, not to this Taply app.'));
    expect(onRequest).not.toHaveBeenCalled();
    expect(cam.tracks[0]?.stop).not.toHaveBeenCalled();
    // Still scanning: a valid code afterwards is accepted.
    dec.queue.push(ID);
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith(ID));
  });

  it('permission denied explains how to fix it and keeps "Paste a link" available', async () => {
    const media = {
      getUserMedia: vi.fn<GetUserMedia>(async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      }),
    };
    const dec = scriptedDecoder();
    const { onPasteLink } = renderScanner({ media, createDecoder: dec.factory });
    expect(await screen.findByText(/Allow camera access for this site/)).toBeTruthy();
    expect(status()).toBe('Camera access is off');
    expect(dec.factory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Paste a link instead', hidden: true }));
    expect(onPasteLink).toHaveBeenCalledTimes(1);
    // "Try again" asks the browser again.
    fireEvent.click(screen.getByRole('button', { name: 'Try again', hidden: true }));
    await waitFor(() => expect(media.getUserMedia).toHaveBeenCalledTimes(2));
  });

  it.each([
    [{ name: 'NotFoundError' }, 'No camera found'],
    [{ name: 'OverconstrainedError' }, 'No camera found'],
    [{ name: 'NotReadableError' }, 'Camera unavailable'],
  ])('camera error %o is shown as "%s"', async (error, title) => {
    const media = {
      getUserMedia: vi.fn<GetUserMedia>(async () => {
        throw Object.assign(new Error('x'), error);
      }),
    };
    renderScanner({ media, createDecoder: scriptedDecoder().factory });
    await waitFor(() => expect(status()).toBe(title));
  });

  it('no camera API: insecure pages and unsupported browsers say so', async () => {
    renderScanner({ media: null, secureContext: false, createDecoder: scriptedDecoder().factory });
    await waitFor(() => expect(status()).toBe('Camera needs a secure connection'));
    cleanup();
    renderScanner({ media: null, secureContext: true, createDecoder: scriptedDecoder().factory });
    await waitFor(() => expect(status()).toBe('Scanning is not supported here'));
  });

  it('a decoder that cannot load releases the camera and reports unsupported', async () => {
    const cam = fakeCamera();
    renderScanner({
      media: cam.media,
      createDecoder: vi.fn(async () => {
        throw new Error('chunk failed');
      }),
    });
    await waitFor(() => expect(status()).toBe('Scanning is not supported here'));
    expect(cam.tracks[0]?.stop).toHaveBeenCalled();
  });

  it('closing, unmounting and hiding the page all stop the camera', async () => {
    const cam = fakeCamera();
    const dec = scriptedDecoder();
    const { onClose, unmount } = renderScanner({ media: cam.media, createDecoder: dec.factory });
    await waitFor(() => expect(status()).toBe('Looking for a payment QR code'));

    // Tab hidden: camera off, then an explicit resume.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(cam.tracks[0]?.stop).toHaveBeenCalled();
    expect(status()).toBe('Camera paused');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(cam.media.getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Resume camera', hidden: true }));
    await waitFor(() => expect(cam.media.getUserMedia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(status()).toBe('Looking for a payment QR code'));

    fireEvent.click(screen.getByRole('button', { name: 'Close scanner', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(cam.tracks[1]?.stop).toHaveBeenCalled();
  });

  it('closed while the permission prompt is open: the late stream is released at once', async () => {
    const track = { stop: vi.fn() };
    let grant: (stream: MediaStream) => void = () => undefined;
    const media = {
      getUserMedia: vi.fn<GetUserMedia>(
        () =>
          new Promise<MediaStream>((resolve) => {
            grant = resolve;
          }),
      ),
    };
    const { unmount } = renderScanner({ media, createDecoder: scriptedDecoder().factory });
    unmount();
    await act(async () => {
      grant({ getTracks: () => [track] } as unknown as MediaStream);
    });
    expect(track.stop).toHaveBeenCalled();
  });

  it('reduced motion: no moving beam styling hook and no success delay', async () => {
    setReducedMotion(true);
    const cam = fakeCamera();
    const dec = scriptedDecoder();
    dec.queue.push(ID);
    const { onRequest, container } = renderScanner({ media: cam.media, createDecoder: dec.factory });
    expect(container.querySelector('dialog')?.getAttribute('data-motion')).toBe('reduced');
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith(ID));
  });

  it('full motion: the beam shows while scanning and the success animation plays before navigating', async () => {
    setReducedMotion(false);
    const cam = fakeCamera();
    const dec = scriptedDecoder();
    const { onRequest, container } = renderScanner({ media: cam.media, createDecoder: dec.factory });
    expect(container.querySelector('dialog')?.getAttribute('data-motion')).toBe('full');
    await waitFor(() => expect(screen.getByTestId('scan-beam')).toBeTruthy());
    dec.queue.push(ID);
    await waitFor(() => expect(status()).toBe('Payment found. Opening the request…'));
    expect(onRequest).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_HOLD_MS + 50));
    expect(onRequest).toHaveBeenCalledWith(ID);
  });

  it('closing during the success animation does not navigate', async () => {
    setReducedMotion(false);
    const cam = fakeCamera();
    const dec = scriptedDecoder();
    dec.queue.push(ID);
    const { onRequest, unmount } = renderScanner({ media: cam.media, createDecoder: dec.factory });
    await waitFor(() => expect(status()).toBe('Payment found. Opening the request…'));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_HOLD_MS + 50));
    expect(onRequest).not.toHaveBeenCalled();
  });
});
