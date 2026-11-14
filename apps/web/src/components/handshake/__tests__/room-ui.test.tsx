import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomDemo } from '../RoomDemo';
import { I18nProvider } from '@/lib/i18n/testnet-provider';
import { ROOM_SCENARIOS } from '@/lib/mock/room-demo';

/** Phase 7G: gated room UI (DEMO preview) and real-vs-demo isolation. Synthetic only. */

afterEach(cleanup);

function renderDemo(locale: 'en' | 'tr' = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <RoomDemo />
    </I18nProvider>,
  );
}

const panels = () => screen.getAllByTestId('room-panel');
const choose = (scenario: string) => fireEvent.change(screen.getByLabelText('Room state'), { target: { value: scenario } });

describe('room adapter preview (DEMO)', () => {
  it('is stamped DEMO and shows both phones', () => {
    renderDemo();
    expect(within(screen.getByTestId('room-demo')).getByText('DEMO')).toBeTruthy();
    expect(panels()).toHaveLength(2);
  });

  it('every scenario: merchant identity is never verified and payment only appears on the chain row', () => {
    renderDemo();
    for (const scenario of ROOM_SCENARIOS) {
      choose(scenario);
      for (const panel of panels()) {
        if (panel.getAttribute('data-room') === 'unavailable') continue;
        expect(within(panel).getByTestId('room-identity').textContent).toContain('not verified');
        const text = (panel.textContent ?? '').replace(within(panel).getByTestId('room-chain').textContent ?? '', '');
        expect(text).not.toMatch(/Verified Paid|Payment recorded|\bpaid\b(?! again)/i);
      }
    }
  });

  it('no customer presence before an authenticated join', () => {
    renderDemo();
    choose('waiting');
    expect(panels().map((p) => p.getAttribute('data-connection'))).toEqual(['not_joined', 'connected']);
    for (const panel of panels()) expect(panel.textContent).not.toContain('Customer joined');
  });

  it('interrupted and reconnected are shown to the merchant', () => {
    renderDemo();
    choose('interrupted');
    expect(panels()[0]?.getAttribute('data-connection')).toBe('interrupted');
    choose('reconnected');
    expect(panels()[0]?.getAttribute('data-connection')).toBe('reconnected');
  });

  it('a reported submission waits for the chain, which still reads open', () => {
    renderDemo();
    choose('pending');
    for (const panel of panels()) {
      expect(panel.getAttribute('data-room')).toBe('pending_chain');
      expect(within(panel).getByTestId('room-chain').getAttribute('data-chain')).toBe('open');
      expect(within(panel).getByText('Reported by the payer’s phone. Not proof of payment.')).toBeTruthy();
    }
  });

  it('substituted terms: the customer phone blocks, codes differ', () => {
    renderDemo();
    choose('mismatch');
    const customer = panels()[1];
    expect(customer?.getAttribute('data-room')).toBe('mismatch');
    expect(within(customer as HTMLElement).getByTestId('room-code-match').textContent).toBe('Codes differ');
  });

  it('unsupported versions and an unbindable contract are refused plainly', () => {
    renderDemo();
    choose('unsupported');
    expect(panels().every((p) => p.getAttribute('data-reason') === 'unsupported_version')).toBe(true);
    choose('verification');
    expect(screen.getAllByText('Cannot check this room')).toHaveLength(2);
  });

  it('Turkish copy', () => {
    renderDemo('tr');
    expect(screen.getAllByText(/Satıcı kimliği: doğrulanmadı/).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------ */
/* Real vs demo isolation (source scan)                                      */
/* ------------------------------------------------------------------------ */

const SRC = resolve(__dirname, '../../..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('real vs demo isolation', () => {
  const files = sources(SRC).map((path) => ({ path: relative(SRC, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));

  it('only demo surfaces import lib/mock', () => {
    const allowed = [/^app\/demo\//, /^components\/demo\//, /^components\/handshake\/(HandshakeDemo|RoomDemo)\.tsx$/, /^lib\/mock\//];
    const offenders = files.filter((f) => /from '@\/lib\/mock\//.test(f.text) && !allowed.some((re) => re.test(f.path))).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('the room demo is mounted only on /demo/handshake', () => {
    const users = files.filter((f) => /components\/handshake\/RoomDemo'/.test(f.text)).map((f) => f.path);
    expect(users).toEqual(['app/demo/handshake/page.tsx']);
  });

  it('no live route constructs a room reader or a backend room adapter', () => {
    const users = files.filter((f) => /createRoomReader\(|createCoordinationReader\(/.test(f.text) && !/^lib\/handshake\//.test(f.path)).map((f) => f.path);
    expect(users).toEqual([]);
  });
});
