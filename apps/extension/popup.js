/* global chrome */
'use strict';
for (const button of document.querySelectorAll('button[data-url]')) {
  button.addEventListener('click', () => {
    const url = button.getAttribute('data-url');
    if (!url || !/^https:\/\/(x\.com|taplyapp\.xyz)(\/|$)/.test(url)) return;
    // User gesture only. No page scraping, account reads or automation.
    chrome.tabs.create({ url });
  });
}
