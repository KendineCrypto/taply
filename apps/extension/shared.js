/* eslint-disable no-undef */
/**
 * Shared pure validation for X content script + local tests.
 * The X username is NEVER a proof that a NEAR account is controlled by
 * that person. Every mapping is locally entered and labelled UNVERIFIED.
 */
(function (root) {
  'use strict';
  const RESERVED = new Set([
    'home', 'explore', 'notifications', 'messages', 'search', 'settings',
    'compose', 'i', 'intent', 'login', 'signup', 'account', 'tos',
    'privacy', 'help', 'jobs', 'communities', 'bookmarks', 'lists'
  ]);

  function profileHandle(pathname) {
    const match = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(pathname);
    if (!match || RESERVED.has(match[1].toLowerCase())) return null;
    return match[1];
  }

  function validTestnetAccount(raw) {
    if (typeof raw !== 'string') return false;
    const id = raw.trim().toLowerCase();
    return (
      /^(?=.{2,64}$)[a-z0-9_]+(?:[-_.][a-z0-9_]+)*\.testnet$/.test(id) ||
      /^[0-9a-f]{64}$/.test(id)
    );
  }

  function validNearAmount(raw) {
    if (typeof raw !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,24})?$/.test(raw)) return false;
    const [integer = '0', fraction = ''] = raw.split('.');
    return BigInt(integer) * (10n ** 24n) + BigInt((fraction + '0'.repeat(24)).slice(0, 24)) > 0n;
  }

  function parseTaplyLink(raw) {
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'taplyapp.xyz' ||
        url.username || url.password || url.port) return null;
    const match = /^\/(pay|protected|receipt)\/([0-9a-f]{64})\/?$/.exec(url.pathname);
    if (!match) return null;
    return {
      kind: match[1],
      id: match[2],
      // Scrub any query/fragment; the app reads actual terms from its contract.
      url: 'https://taplyapp.xyz/' + match[1] + '/' + match[2]
    };
  }

  function tipUrl(account, amount) {
    const to = String(account).trim().toLowerCase();
    if (!validTestnetAccount(to) || !validNearAmount(amount)) return null;
    const url = new URL('https://taplyapp.xyz/send');
    url.searchParams.set('source', 'x-tip');
    url.searchParams.set('to', to);
    url.searchParams.set('amount', amount);
    return url.toString();
  }

  const api = { profileHandle, validTestnetAccount, validNearAmount, parseTaplyLink, tipUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TaplyXShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
