# Mainnet unlock across reload

The Mainnet UI constructed EncryptedMainnetVault without its existing optional
session store and never resumed it. Reload therefore always lost the unlocked
state. Wire it to an isolated Mainnet IndexedDB database and a random per-tab row
identifier in sessionStorage. No password, recovery words or private bytes enter
sessionStorage/localStorage; IndexedDB receives a nonextractable CryptoKey plus
the encrypted vault record and the original expiry.

The existing five-minute expiry is preserved, not renewed by F5. Resume proves
the key against the exact current vault record. Explicit lock revokes the tab row
synchronously before asynchronous IndexedDB deletion. A page release clears the
in-memory key without revoking a valid reload session. UI subscribers receive
unlock/resume notifications. Blocked storage preserves page-only unlocking.
Testnet's existing store defaults are unchanged.

Tests cover reload/resume, fixed expiry, explicit lock, changed vault, separate
tab rows, storage failure and a lock/delete race. The release browser script also
exercises actual reload, real IndexedDB CryptoKey cloning and a fresh tab using
an unfunded disposable local vault. No real wallet or on-chain signature is used.

This is source/test evidence. A deployment must succeed before the live site
can be claimed fixed; the existing Vercel daily quota is a separate blocker.

Follow-up, 15 November UTC: activation reads are keyed to account, public key and
explicit refresh, rather than the identity object's reference. Unlock/resume
notifications must update the lock UI without retriggering a chain activation
read or removing Check again mid-click. The first CI run caught this regression;
a dedicated hook regression test covers cloned identities, refresh and key change.
