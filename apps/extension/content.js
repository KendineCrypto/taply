/* global chrome, TaplyXShared */
(() => {
  'use strict';
  if (typeof TaplyXShared === 'undefined') return;

  const PREFIX = 'taply:x:account:';
  let mountedFor = null;
  let launcher = null;
  let overlay = null;
  let framePending = false;

  function el(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function closeDialog() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  async function openTip(handle) {
    closeDialog();
    const background = el('div', 'taply-x-overlay');
    const dialog = el('section', 'taply-x-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Tip with Taply');

    const top = el('div', 'taply-x-top');
    top.append(el('strong', 'taply-x-wordmark', 'taply.'));
    const close = el('button', 'taply-x-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeDialog);
    top.append(close);
    dialog.append(top);
    dialog.append(el('h2', 'taply-x-headline', 'Tip with Taply'));
    dialog.append(el('p', 'taply-x-subtitle', '@' + handle + ' · NEAR Testnet'));

    const warning = el('p', 'taply-x-warning',
      'UNVERIFIED X identity. A handle does not prove ownership of a NEAR account. Confirm the full account with the recipient independently.');
    dialog.append(warning);

    const form = el('form', 'taply-x-form');
    const recipientLabel = el('label', '', 'NEAR Testnet recipient');
    const recipient = el('input', 'taply-x-input');
    recipient.type = 'text';
    recipient.autocomplete = 'off';
    recipient.spellcheck = false;
    recipient.placeholder = 'recipient.testnet';
    recipient.required = true;
    recipient.setAttribute('aria-label', 'NEAR Testnet account');
    recipientLabel.append(recipient);

    const amountLabel = el('label', '', 'Amount (NEAR)');
    const amount = el('input', 'taply-x-input');
    amount.type = 'text';
    amount.inputMode = 'decimal';
    amount.autocomplete = 'off';
    amount.value = '0.1';
    amount.required = true;
    amount.setAttribute('aria-label', 'NEAR amount');
    amountLabel.append(amount);

    const quick = el('div', 'taply-x-amounts');
    for (const value of ['0.1', '0.5', '1']) {
      const btn = el('button', 'taply-x-amount', value + ' NEAR');
      btn.type = 'button';
      btn.addEventListener('click', () => { amount.value = value; });
      quick.append(btn);
    }

    const error = el('p', 'taply-x-error');
    error.setAttribute('role', 'alert');
    const action = el('button', 'taply-x-primary', 'Review in Taply ↗');
    action.type = 'submit';

    form.append(recipientLabel, amountLabel, quick, error, action);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const account = recipient.value.trim().toLowerCase();
      const value = amount.value.trim();
      const url = TaplyXShared.tipUrl(account, value);
      if (url === null) {
        error.textContent = 'Enter an existing NEAR Testnet account and a valid positive amount.';
        return;
      }
      if (window.location.pathname !== '/' + handle &&
          window.location.pathname !== '/' + handle + '/') {
        error.textContent = 'X profile changed. Open the profile again before tipping.';
        return;
      }
      // Local note only, NEVER a verified social identity binding.
      // Do NOT await storage: opening after an async boundary can lose the
      // browser's user-gesture permission and be blocked as a popup.
      void chrome.storage.local.set({ [PREFIX + handle.toLowerCase()]: account }).catch(() => {});
      // Only a direct user submit opens a new tab. No signing here.
      window.open(url, '_blank', 'noopener,noreferrer');
      closeDialog();
    });
    dialog.append(form);
    dialog.append(el('p', 'taply-x-footnote',
      'Taply Wallet confirms recipient, amount and fee before signing. No Testnet funds move in this extension.'));

    background.append(dialog);
    background.addEventListener('click', (event) => {
      if (event.target === background) closeDialog();
    });
    background.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDialog();
    });
    document.body.append(background);
    overlay = background;
    close.focus();

    try {
      const stored = await chrome.storage.local.get(PREFIX + handle.toLowerCase());
      if (overlay === background && typeof stored[PREFIX + handle.toLowerCase()] === 'string') {
        recipient.value = stored[PREFIX + handle.toLowerCase()];
      }
    } catch {
      // Storage failure must not bypass address entry or signing review.
    }
  }

  function installProfileTip(handle) {
    if (launcher && mountedFor === handle && launcher.isConnected) return;
    launcher?.remove();
    mountedFor = handle;
    launcher = el('button', 'taply-x-launcher', '↗ Tip with Taply');
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Tip @' + handle + ' with Taply — Testnet');
    launcher.addEventListener('click', () => { void openTip(handle); });
    document.body.append(launcher);
  }

  function showMessagePreviews() {
    // Never attempt to read DMs into extension storage or send messages.
    if (!/^\/(messages|i\/chat)(?:\/|$)/.test(location.pathname)) return;
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (anchor.dataset.taplyXPreviewHandled) continue;
      const link = TaplyXShared.parseTaplyLink(anchor.href);
      if (!link) continue;
      anchor.dataset.taplyXPreviewHandled = '1';
      const card = el('div', 'taply-x-request');
      card.append(el('strong', '', link.kind === 'receipt' ? 'Taply proof link' : 'Taply payment request'));
      card.append(el('p', '', 'Check the actual account, amount and network in Taply. This preview does not prove payment.'));
      const buttons = el('div', 'taply-x-request-actions');
      const review = el('a', 'taply-x-review', link.kind === 'receipt' ? 'Verify on Taply ↗' : 'Review in Taply ↗');
      review.href = link.url;
      review.target = '_blank';
      review.rel = 'noopener noreferrer';
      const dismiss = el('button', 'taply-x-dismiss', 'Dismiss');
      dismiss.type = 'button';
      dismiss.addEventListener('click', () => { card.remove(); });
      buttons.append(review, dismiss);
      card.append(buttons);
      anchor.insertAdjacentElement('afterend', card);
    }
  }

  function sync() {
    if (!document.body) return;
    const handle = TaplyXShared.profileHandle(location.pathname);
    if (handle) installProfileTip(handle);
    else {
      launcher?.remove();
      launcher = null;
      mountedFor = null;
      closeDialog();
    }
    showMessagePreviews();
  }

  function schedule() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      sync();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('focus', schedule);
  sync();
})();
