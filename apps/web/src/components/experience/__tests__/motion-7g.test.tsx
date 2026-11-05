import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SharedSession } from '../SharedSession';
import { I18nProvider } from '@/lib/i18n/provider';
import type { ProgressStage } from '../progress';

/**
 * Phase 7G motion rules. jsdom does not run CSS, so the stylesheet is checked
 * statically and components are checked for which motion hooks they render.
 * Real computed-style checks under prefers-reduced-motion run in the browser
 * QA script (scripts/phase7g-qa.mjs).
 */

const CSS = readFileSync(resolve(__dirname, '../../../app/globals.css'), 'utf8');
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const BASE: ComponentProps<typeof SharedSession> = {
  side: 'receiver',
  context: 'pos',
  stage: 'awaiting',
  requestId: ID,
  amountBaseUnits: '1000000000000000000000000',
  recipientAccountId: 'shop.testnet',
  payerAccountId: 'customer.testnet',
  showAmount: true,
  live: false,
};
const STAGES: ReadonlyArray<ProgressStage> = ['awaiting', 'wallet', 'transfer', 'contract_paid', 'verified', 'failed', 'unresolved', 'cancelled'];

function renderStage(stage: ProgressStage) {
  return render(
    <I18nProvider locale="en">
      <SharedSession {...BASE} stage={stage} />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('evidence-led motion hooks', () => {
  it('the travelling pulse appears only while the chain shows the payout in flight', () => {
    for (const stage of STAGES) {
      renderStage(stage);
      expect(document.querySelector('[data-testid="track-pulse"]') !== null).toBe(stage === 'transfer');
      cleanup();
    }
  });

  it('the settle pop plays only on the Contract step, only at Paid per contract', () => {
    for (const stage of STAGES) {
      renderStage(stage);
      const settled = [...document.querySelectorAll('[data-settle]')];
      expect(settled.length).toBe(stage === 'contract_paid' ? 1 : 0);
      cleanup();
    }
  });

  it('no stage before verification renders the one-time Verified Paid burst', () => {
    for (const stage of STAGES.filter((s) => s !== 'verified')) {
      renderStage(stage);
      expect(document.querySelector('.celebrate-burst, .celebrate-burst-late')).toBeNull();
      cleanup();
    }
  });
});

/** Every class with an animation must be listed in a prefers-reduced-motion block. */
function reducedMotionBlocks(css: string): string {
  const blocks: string[] = [];
  const re = /@media \(prefers-reduced-motion: reduce\) \{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push(css.slice(match.index, i));
  }
  return blocks.join('\n');
}

describe('stylesheet: reduced motion and no progress-without-evidence', () => {
  const reduced = reducedMotionBlocks(CSS);

  it('keeps the global reduced-motion safety net', () => {
    expect(reduced).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration: 0\.01ms !important/);
  });

  it.each([
    '.journey-hero',
    '.journey-hero::after',
    '.journey-amount-glow',
    '.journey-connect',
    '.journey-live-dot',
    '.journey-node-current::after',
    '.journey-status',
    '.journey-track-pulse',
    '.journey-settle',
    ".journey-terms[data-confirmed='true']::after",
    '.celebrate-burst',
  ])('%s has an explicit still state under reduced motion', (selector) => {
    expect(reduced).toContain(selector);
  });

  it('waiting shows no ripple on the current step', () => {
    expect(CSS).toMatch(/\.journey-hero\[data-stage='awaiting'\] \.journey-node-current::after \{\s*animation: none;/);
  });

  it('infinite animations are limited to evidence-backed states', () => {
    // Allowed: live chain watch / money moving (caution) glow, the live dot and checkout
    // pulse, the current-step ripple (suppressed while awaiting), the in-flight track pulse,
    // and the camera scanner's own beam/glow/dot while the camera is live.
    const allowed = [
      'taply-glow 3.4s',
      'taply-checkout-pulse',
      'taply-node-ripple',
      'taply-track-pulse',
      'taply-halo', // wallet window open on this device / payout in flight on chain only
      'taply-scan-',
      'taply-breathe 3.4s', // 7F rule, overridden by the 7G block below it
      'taply-breathe 3.6s', // amount glow, iteration count capped to 2 by 7G
      'spin',
    ];
    const infinite = [...CSS.matchAll(/animation:[^;]*infinite[^;]*;/g)].map((m) => m[0]);
    for (const rule of infinite) {
      expect(allowed.some((a) => rule.includes(a)), rule).toBe(true);
    }
  });

  it('the success glow repeats a fixed number of times, never forever', () => {
    expect(CSS).toMatch(/\.journey-hero\[data-tone='success'\]::after \{\s*animation: taply-glow 2\.4s 0\.6s ease-in-out 2;/);
  });
});
