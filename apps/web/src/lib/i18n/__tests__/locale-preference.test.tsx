import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useLocale, useT } from '../testnet-provider';
import { LOCALE_COOKIE } from '../index';

function Probe() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <>
      <p data-testid="locale">{locale}</p>
      <p>{t.payment.create.edit}</p>
      <button type="button" onClick={() => setLocale('tr')}>tr</button>
      <button type="button" onClick={() => setLocale('en')}>en</button>
    </>
  );
}

const cookieWrites: string[] = [];

function stubBrowser() {
  cookieWrites.length = 0;
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
    cookieWrites.push(value);
  });
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  return reload;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('language preference', () => {
  it('renders exactly the locale the server resolved, without touching the saved choice', () => {
    stubBrowser();
    render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(cookieWrites).toEqual([]);
  });

  it.each(['tr', 'en'] as const)('saves an explicit %s choice for a year on every route and updates html lang', (next) => {
    const reload = stubBrowser();
    render(
      <I18nProvider locale={next === 'tr' ? 'en' : 'tr'}>
        <Probe />
      </I18nProvider>,
    );
    act(() => screen.getByRole('button', { name: next }).click());
    expect(cookieWrites).toEqual([`${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`]);
    expect(document.documentElement.lang).toBe(next);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
