import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/testnet-provider';
import { readFileSync } from 'node:fs';
import { personalGiftUrl } from '@/lib/gift/link';
import { PersonalGiftScreen } from '../PersonalGiftScreen';
import type { Verifier } from '../PersonalGiftScreen';
import { Envelope } from '../Envelope';
import { GiftShare } from '../GiftShare';

const GIFT = { v: 1 as const, tx: 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su', from: 'alice.testnet', to: 'bob.testnet', amt: '500000000000000000000000', msg: 'For you 🌿', d: 2 };
afterEach(() => {
  cleanup();
  window.location.hash = '';
});
const renderEn = (ui: React.ReactNode) => render(<I18nProvider locale="en">{ui}</I18nProvider>);

describe('PersonalGiftScreen', () => {
  it('shows "Delivered" only when the exact transfer is verified on chain', async () => {
    window.location.hash = new URL(personalGiftUrl('https://taplyapp.xyz', GIFT)).hash;
    const seen: unknown[] = [];
    const verify: Verifier = async (g) => {
      seen.push(g);
      return { kind: 'VERIFIED', blockHash: 'x', blockTimestampNs: '1' };
    };
    renderEn(<PersonalGiftScreen verify={verify} />);
    await waitFor(() => expect(screen.getByTestId('personal-state').getAttribute('data-state')).toBe('VERIFIED'));
    expect(seen[0]).toEqual(GIFT);
    expect(screen.getAllByText('Delivered on NEAR Testnet').length).toBeGreaterThan(0);
    expect(screen.getByText('0.5 NEAR')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Unwrap/ }));
    expect(screen.getByText('The message comes from the link, not from the chain.')).toBeTruthy();
  });

  it('a link that does not match the chain is called out; RPC outage is "unavailable"', async () => {
    window.location.hash = new URL(personalGiftUrl('https://taplyapp.xyz', GIFT)).hash;
    renderEn(<PersonalGiftScreen verify={async () => ({ kind: 'MISMATCH' })} />);
    expect(await screen.findByText('Does not match the chain')).toBeTruthy();
    expect(screen.queryByText('Delivered on NEAR Testnet')).toBeNull();
    cleanup();
    renderEn(<PersonalGiftScreen verify={async () => ({ kind: 'UNAVAILABLE' })} />);
    expect(await screen.findByText('Verification unavailable')).toBeTruthy();
  });

  it('a broken link is refused', async () => {
    window.location.hash = '#g=garbage!';
    renderEn(<PersonalGiftScreen verify={async () => ({ kind: 'VERIFIED', blockHash: 'x', blockTimestampNs: '1' })} />);
    expect(await screen.findByText('This gift link is broken')).toBeTruthy();
  });
});

describe('GiftShare and Envelope', () => {
  it('X share is a prefilled intent in a new tab; copy and QR available', () => {
    const url = 'https://taplyapp.xyz/gift/0123456789abcdef0123456789abcdef#k=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
    renderEn(<GiftShare url={url} kind="open" />);
    const x = screen.getByRole('link', { name: /Share on X/ });
    const href = new URL(x.getAttribute('href') ?? '');
    expect(href.searchParams.get('url')).toBe(url);
    expect(x.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('button', { name: /Copy gift link/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Gift link QR/ }));
    expect(screen.getByRole('img', { name: `Gift link QR: ${url}` })).toBeTruthy();
    expect(screen.getByText(/Anyone with this link can claim the gift/)).toBeTruthy();
  });

  it('envelope: open state is a data attribute; the letter is hidden from AT while closed', () => {
    const { rerender } = renderEn(<Envelope design={1} open={false} label="Closed gift envelope"><p>letter</p></Envelope>);
    const env = screen.getByRole('img', { name: 'Closed gift envelope' });
    expect(env.getAttribute('data-open')).toBe('false');
    expect(env.className).toContain('gift-env--lime');
    rerender(<I18nProvider locale="en"><Envelope design={1} open label="Open gift envelope"><p>letter</p></Envelope></I18nProvider>);
    expect(screen.getByRole('img', { name: 'Open gift envelope' }).getAttribute('data-open')).toBe('true');
  });

  it('reduced motion: the envelope CSS has a prefers-reduced-motion fallback with no 3D movement', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const block = css.slice(css.indexOf('Taply Gift envelope'));
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.gift-env\[data-open='true'\] \.gift-env__flap \{ transform: none; opacity: 0; \}/);
  });
});
