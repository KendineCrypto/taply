'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/shell/Icons';
import { usePrefersReducedMotion } from '@/lib/hooks/browser';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { openLivePath, parseScanInput } from '@/lib/payments/pay-link';
import { CameraError, openCamera, stopStream } from '@/lib/qr/camera';
import type { CameraProblem, MediaDevicesLike } from '@/lib/qr/camera';
import { createFrameDecoder } from '@/lib/qr/decoder';
import type { DecoderFactory, FrameDecoder } from '@/lib/qr/decoder';
import { approvedPayOrigins } from '@/lib/share/origin';

/**
 * Full-screen QR scanner for paying a request (Phase 6A).
 *
 * - The camera is requested only when this mounts, which happens only after
 *   the person chose "Scan QR". The rear camera is preferred.
 * - Frames are decoded on this device (BarcodeDetector, or the bundled
 *   decoder) and never uploaded.
 * - Every track is stopped on close, unmount, a successful scan and when the
 *   page is hidden (tab switch, app switch, screen lock). Coming back shows a
 *   "Resume camera" button rather than silently re-opening the camera.
 * - Decoded text is untrusted. Only an approved Taply request ID is accepted;
 *   the app then opens its own /pay/<id>, which reads the terms from the pinned
 *   contract. Nothing is signed or paid from here.
 */

/** Between decode passes. Fast enough to feel instant, light on battery. */
export const SCAN_INTERVAL_MS = 140;
/** How long the success state shows before navigating (0 with reduced motion). */
export const SUCCESS_HOLD_MS = 280;
/** A rejected code's message stays this long, and the same code is not re-reported meanwhile. */
const HINT_MS = 2600;

type Phase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'scanning' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'problem'; readonly problem: CameraProblem }
  | { readonly kind: 'success'; readonly target: 'request' | 'merchant' | 'live' };

type Hint =
  | { readonly kind: 'not_taply' }
  | { readonly kind: 'other_site'; readonly host: string }
  | { readonly kind: 'invalid_merchant'; readonly reason: 'syntax' | 'not_testnet' };

export interface QrScannerProps {
  readonly onClose: () => void;
  /** Called once with a validated request ID. The caller navigates to /pay/<id>. */
  readonly onRequest: (id: string) => void;
  /**
   * Called once with a validated Testnet merchant account from an approved
   * discovery link. The caller opens this app's own read-only /checkout page.
   * Without it, merchant codes are rejected like any other non-payment QR.
   */
  readonly onMerchant?: (accountId: string) => void;
  /**
   * Called once with this app's own validated live-session path
   * (`/s/<room>#j=<token>`). Defaults to a full page load of that path.
   */
  readonly onLive?: (path: string) => void;
  readonly onPasteLink: () => void;
  /** Tests inject these; the defaults are the real browser APIs. */
  readonly media?: MediaDevicesLike | null;
  readonly secureContext?: boolean;
  readonly createDecoder?: DecoderFactory;
  readonly approvedOrigins?: ReadonlyArray<string>;
}

export function QrScanner({
  onClose,
  onRequest,
  onMerchant,
  onLive,
  onPasteLink,
  media,
  secureContext,
  createDecoder = createFrameDecoder,
  approvedOrigins,
}: QrScannerProps) {
  const t = useT();
  const sc = t.oneTap.scanner;
  const reduced = usePrefersReducedMotion();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [hint, setHint] = useState<Hint | null>(null);
  // Bumped to (re)start the camera: retry after a problem, resume after a pause.
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const stopSession = useRef<() => void>(() => undefined);
  const pathname = usePathname();
  const openedPath = useRef(pathname);

  // Latest values for the long-running scan loop, without restarting the camera.
  const latest = useRef({ onRequest, onMerchant, onLive, approvedOrigins, reduced, createDecoder });
  useEffect(() => {
    latest.current = { onRequest, onMerchant, onLive, approvedOrigins, reduced, createDecoder };
  });

  // A success that is still showing its animation must not navigate after a close.
  const navTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(navTimer.current), []);

  const dismiss = (action: () => void) => {
    clearTimeout(navTimer.current);
    stopSession.current();
    action();
  };

  // The scanner can live in the persistent navigation shell across route changes.
  useEffect(() => {
    if (pathname !== openedPath.current) {
      clearTimeout(navTimer.current);
      stopSession.current();
      onClose();
    }
  }, [pathname, onClose]);

  useEffect(() => {
    const onBack = () => {
      clearTimeout(navTimer.current);
      stopSession.current();
      onClose();
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [onClose]);

  // Top-layer modal: focus trap, inert page and Escape come from the browser.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const opener = document.activeElement;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Hidden page: stop the camera now. Back: offer to resume.
  useEffect(() => {
    const pause = () => {
      // Release hardware in the event handler, before React can be suspended.
      clearTimeout(navTimer.current);
      stopSession.current();
      setPaused(true);
      setPhase({ kind: 'paused' });
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    const onPageHide = pause;
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    onHidden();
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // The camera session. Everything it opens is closed in the cleanup.
  useEffect(() => {
    if (paused) return;
    let active = true;
    let stream: MediaStream | null = null;
    let frameDecoder: FrameDecoder | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRejected: { text: string; at: number } | null = null;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    const trackCleanups: Array<() => void> = [];
    const video = videoRef.current;

    const stop = () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(hintTimer);
      for (const cleanup of trackCleanups) cleanup();
      frameDecoder?.dispose?.();
      stopStream(stream);
      stream = null;
      if (video !== null) video.srcObject = null;
    };
    stopSession.current = stop;
    if (document.visibilityState === 'hidden') {
      stop();
      return stop;
    }

    const handle = (text: string): boolean => {
      const parsed = parseScanInput(text, latest.current.approvedOrigins ?? approvedPayOrigins(window.location.origin));
      const onMerchantNow = latest.current.onMerchant;
      if (parsed.kind === 'request' || parsed.kind === 'live' || (parsed.kind === 'merchant' && onMerchantNow !== undefined)) {
        stop();
        setHint(null);
        setPhase({ kind: 'success', target: parsed.kind });
        const hold = latest.current.reduced ? 0 : SUCCESS_HOLD_MS;
        // Navigation only. Nothing is signed, created or funded from a scan.
        const go =
          parsed.kind === 'request'
            ? () => latest.current.onRequest(parsed.id)
            : parsed.kind === 'live'
              ? () => (latest.current.onLive ?? openLivePath)(parsed.path)
              : () => onMerchantNow?.(parsed.accountId);
        if (hold === 0) go();
        else navTimer.current = setTimeout(go, hold);
        return true;
      }
      const now = Date.now();
      if (lastRejected !== null && lastRejected.text === text && now - lastRejected.at < HINT_MS) return false;
      lastRejected = { text, at: now };
      setHint(
        parsed.kind === 'other_site'
          ? { kind: 'other_site', host: parsed.host }
          : parsed.kind === 'invalid_merchant'
            ? { kind: 'invalid_merchant', reason: parsed.reason }
            : { kind: 'not_taply' },
      );
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        if (active) setHint(null);
      }, HINT_MS);
      return false;
    };

    const loop = (decoder: FrameDecoder) => {
      const tick = async () => {
        if (!active || video === null) return;
        if (video.readyState >= 2) {
          const text = await decoder.decode(video);
          if (!active) return;
          if (text !== null && handle(text)) return;
        }
        if (active) timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    };

    void (async () => {
      const devices = media === undefined ? navigator.mediaDevices : media;
      const secure = secureContext ?? window.isSecureContext;
      let decoder: FrameDecoder;
      try {
        stream = await openCamera(devices, secure);
      } catch (error) {
        if (active) setPhase({ kind: 'problem', problem: error instanceof CameraError ? error.problem : 'busy' });
        return;
      }
      if (!active) {
        // Closed while the permission prompt was open: release it immediately.
        stopStream(stream);
        return;
      }
      for (const track of stream.getTracks()) {
        const ended = () => {
          if (!active) return;
          stop();
          setPhase({ kind: 'problem', problem: 'busy' });
        };
        track.addEventListener?.('ended', ended);
        trackCleanups.push(() => track.removeEventListener?.('ended', ended));
      }
      if (video !== null) {
        video.srcObject = stream;
        // iOS needs muted + playsInline (set on the element) for autoplay.
        try {
          await video.play();
        } catch {
          if (active) {
            stop();
            setPhase({ kind: 'problem', problem: 'busy' });
          }
          return;
        }
      }
      if (!active) return;
      try {
        decoder = await latest.current.createDecoder();
        frameDecoder = decoder;
      } catch {
        if (active) {
          stop();
          setPhase({ kind: 'problem', problem: 'unsupported' });
        }
        return;
      }
      if (!active) {
        decoder.dispose?.();
        return;
      }
      setPhase({ kind: 'scanning' });
      loop(decoder);
    })();

    return stop;
  }, [attempt, paused, media, secureContext]);

  const restart = () => {
    setPhase({ kind: 'starting' });
    setHint(null);
    setPaused(false);
    setAttempt((n) => n + 1);
  };

  const status =
    phase.kind === 'success'
      ? phase.target === 'merchant'
        ? t.commerce.scan.merchantFound
        : sc.found
      : phase.kind === 'paused'
        ? sc.paused
        : phase.kind === 'starting'
          ? sc.starting
          : phase.kind === 'problem'
            ? sc.problems[phase.problem].title
            : hint === null
              ? sc.scanning
              : hint.kind === 'other_site'
                ? fill(sc.otherSite, { host: hint.host })
                : hint.kind === 'invalid_merchant'
                  ? hint.reason === 'not_testnet'
                    ? t.commerce.scan.notTestnetMerchant
                    : t.commerce.scan.invalidMerchant
                  : sc.notTaply;
  const tone =
    phase.kind === 'problem' || hint !== null ? 'warn' : phase.kind === 'scanning' || phase.kind === 'success' ? 'live' : 'idle';

  return (
    <dialog
      ref={dialogRef}
      className="taply-scanner"
      aria-labelledby={titleId}
      data-motion={reduced ? 'reduced' : 'full'}
      onCancel={(event) => {
        event.preventDefault();
        dismiss(onClose);
      }}
    >
      <div className="scan-shell">
        <header className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => dismiss(onClose)}
            aria-label={sc.close}
            className="tap-target grid place-items-center rounded-full bg-[rgb(244_243_232/0.06)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)] hover:bg-[rgb(244_243_232/0.1)]"
          >
            <Icon name="x" size={20} />
          </button>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {sc.title}
          </h2>
          <span aria-hidden="true" className="size-11" />
        </header>

        <p className="mt-6 text-center text-sm leading-relaxed text-[var(--text-secondary)]">{sc.hint}</p>

        <div className="scan-stage">
          <div aria-hidden="true" className="scan-glow" />
          <div
            className={`scan-viewport ${phase.kind === 'success' ? 'is-success' : ''}`}
            data-testid="scan-viewport"
            data-phase={phase.kind}
          >
            <video
              ref={videoRef}
              className={`scan-video ${phase.kind === 'scanning' || phase.kind === 'success' ? 'is-live' : ''}`}
              muted
              playsInline
              autoPlay
              aria-hidden="true"
            />
            {phase.kind === 'problem' && (
              <span className="absolute inset-0 grid place-items-center text-[var(--text-muted)]" aria-hidden="true">
                <Icon name="scan" size={44} />
              </span>
            )}
            <span className="scan-corner" data-pos="tl" aria-hidden="true" />
            <span className="scan-corner" data-pos="tr" aria-hidden="true" />
            <span className="scan-corner" data-pos="bl" aria-hidden="true" />
            <span className="scan-corner" data-pos="br" aria-hidden="true" />
            {phase.kind === 'scanning' && <span className="scan-beam" data-testid="scan-beam" aria-hidden="true" />}
            {phase.kind === 'success' && (
              <span className="scan-success" aria-hidden="true">
                <span className="animate-seal grid size-16 place-items-center rounded-full bg-[var(--taply-lime)] text-[var(--taply-night)] shadow-[0_0_40px_-6px_rgb(199_252_117/0.55)]">
                  <Icon name="check" size={30} />
                </span>
              </span>
            )}
          </div>
        </div>

        <p className="scan-status" data-tone={tone} role="status" aria-live="polite">
          <span className="scan-dot" aria-hidden="true" />
          {status}
        </p>

        {phase.kind === 'problem' && (
          <div className="mx-auto mt-4 w-full max-w-[340px] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            {sc.problems[phase.problem].body}
            {phase.problem !== 'insecure' && phase.problem !== 'unsupported' && (
              <button
                type="button"
                onClick={restart}
                className="pressable mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-2)] px-4 font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]"
              >
                <Icon name="refresh" size={16} />
                {sc.retry}
              </button>
            )}
          </div>
        )}
        {phase.kind === 'paused' && (
          <button
            type="button"
            onClick={restart}
            className="pressable mx-auto mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--taply-lime)] px-6 font-semibold text-[var(--taply-night)]"
          >
            <Icon name="scan" size={18} />
            {sc.resume}
          </button>
        )}

        <div className="mt-auto flex flex-col items-center gap-2 pt-6">
          <button
            type="button"
            onClick={() => dismiss(onPasteLink)}
            className="pressable inline-flex min-h-12 w-full max-w-[340px] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[rgb(244_243_232/0.06)] px-5 font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)] hover:bg-[rgb(244_243_232/0.1)]"
          >
            <Icon name="link" size={18} />
            {sc.pasteLink}
          </button>
          <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Icon name="shield" size={14} />
            {sc.privacy}
          </p>
        </div>
      </div>
    </dialog>
  );
}
