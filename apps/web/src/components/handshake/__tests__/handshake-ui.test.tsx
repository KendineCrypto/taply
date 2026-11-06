import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HandshakeDemo } from '../HandshakeDemo';
import { SessionEntry } from '../SessionEntry';
import { UNAVAILABLE_HANDSHAKE } from '@/lib/handshake/adapter';
import { localComparisonCode } from '@/lib/handshake/present';
import { I18nProvider } from '@/lib/i18n/provider';
import { DEMO_TERMS } from '@/lib/mock/handshake-demo';

afterEach(() => cleanup());

const wrap = (ui: React.ReactNode, locale: 'en' | 'tr' = 'en') => render(<I18nProvider locale={locale}>{ui}</I18nProvider>);

describe('session entry (/s/[sessionId])', () => {
  it('a valid session ID lands in an honest unavailable state: no code, no terms, no pairing', () => {
    wrap(<SessionEntry sessionId="11111111-1111-4111-8111-111111111111" />);
    expect(screen.getByText('Live Handshake is not available yet')).toBeTruthy();
    expect(screen.getByTestId('handshake-unavailable').getAttribute('data-reason')).toBe('flag_off');
    expect(screen.queryByTestId('comparison-code')).toBeNull();
    expect(screen.queryByText(/Customer joined|Merchant connected|Paid/)).toBeNull();
    expect(screen.getByRole('link', { name: /Scan sale QR/ }).getAttribute('href')).toBe('/scan');
  });

  it('reports the backend reason when the adapter is the shipped one', () => {
    wrap(<SessionEntry sessionId="11111111-1111-4111-8111-111111111111" adapter={UNAVAILABLE_HANDSHAKE} />);
    expect(screen.getByTestId('handshake-unavailable').getAttribute('data-reason')).toBe('backend_not_connected');
  });

  it('rejects an invalid session ID', () => {
    wrap(<SessionEntry sessionId="../../pay/abc" />);
    expect(screen.getByText('Invalid session link')).toBeTruthy();
  });
});

describe('handshake demo', () => {
  const next = () => fireEvent.click(screen.getByRole('button', { name: /Next/ }));

  it('is unmistakably labelled DEMO and walks both sides with the canonical code', () => {
    wrap(<HandshakeDemo />);
    expect(screen.getByText('Synthetic data · no network · no wallet')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'DEMO · Merchant' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'DEMO · Customer' })).toBeTruthy();
    const code = localComparisonCode(DEMO_TERMS) ?? '';
    expect(code).toMatch(/^[0-9A-Z]{6}$/);
    next();
    next();
    const codes = screen.getAllByTestId('comparison-code');
    expect(codes).toHaveLength(2);
    for (const c of codes) expect(c.getAttribute('aria-label')).toBe(`Comparison code: ${code.split('').join(' ')}`);
  });

  it('a substituted code blocks progress', () => {
    wrap(<HandshakeDemo />);
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate a substituted code' }));
    expect(screen.getByText('Do not pay. Start a new session.')).toBeTruthy();
    // The two phones now show different codes, both from the canonical algorithm.
    const [merchantCode, customerCode] = screen.getAllByTestId('comparison-code').map((c) => c.getAttribute('aria-label'));
    expect(merchantCode).not.toBe(customerCode);
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('review must be explicit; the last step stops before payment with no paid state', () => {
    wrap(<HandshakeDemo />);
    next();
    next();
    next();
    const nextBtn = screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
    const confirm = screen.getByRole('button', { name: 'Confirm review' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(confirm);
    expect(screen.getByText('Customer reviewed the terms')).toBeTruthy();
    next();
    expect(screen.getByText('Ready for wallet approval')).toBeTruthy();
    expect(screen.getByText(/The demo stops here/)).toBeTruthy();
    expect(screen.queryByText(/Verified Paid|Paid per contract|Payment complete/)).toBeNull();
    expect(screen.getByRole('button', { name: /Restart/ })).toBeTruthy();
  });

  it('renders in Turkish', () => {
    wrap(<HandshakeDemo />, 'tr');
    expect(screen.getByText('Sentetik veri · ağ yok · cüzdan yok')).toBeTruthy();
  });
});
