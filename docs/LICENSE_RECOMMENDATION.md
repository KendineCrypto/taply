# License and attribution recommendation — owner approval required

Recommend MIT for original Taply code, subject to the owner's explicit approval
of the copyright holder(s), year (2026), contributor rights and brand scope.
No LICENSE or package-license metadata was added. This recommendation is not
an assertion that the repository is already MIT-licensed.

[MIT text](https://opensource.org/license/mit) permits broad reuse subject to
preserving its copyright and permission notice. It does not replace bundled
third-party terms. [Hackathon Q-014](https://nearhackathon.com/HACKATHON.md)
allows MIT and requires a LICENSE file; verified 2026-11-06. License adoption
is a remaining submission blocker, not permission to alter contract pins.

## Observed direct JavaScript dependency metadata

Installed package.json metadata was inspected after the frozen install. This is
an initial attribution inventory, not a complete transitive license audit.

| Package | Pinned version | Declared license |
| --- | --- | --- |
| next | 16.4.3 | MIT |
| react / react-dom | 19.3.1 | MIT |
| @hot-labs/near-connect | 0.12.0 | MIT |
| jsqr | 1.4.0 | Apache-2.0 |
| zod | 4.6.7 | MIT |
| near-api-js | 7.4.0 | MIT AND Apache-2.0 |
| lossless-json | 4.3.3 | MIT |
| jsonc-parser | 3.3.1 | MIT |
| canonicalize | 5.1.0 | Apache-2.0 |
| @noble/hashes | 2.4.0 (also 2.2.0 transitively) | MIT |

Before redistribution, retain applicable dependency LICENSE and NOTICE files
and review bundled/transitive code. In particular, do not collapse the
near-api-js AND expression to a choice of either license. Cargo manifests and
locks remain pinned; Rust sources/licenses were not downloaded locally, so
near-sdk, near-workspaces, borsh and their transitive notice inventory remains
for owner review. Do not edit approved Cargo inputs to add metadata in this task.

## Fonts, brand and media

`apps/web/src/app/layout.tsx` uses Inter through next/font/google (build-time
self-hosting). Confirm and retain the actual font's license/OFL notice in the
redistribution plan; do not assume the app's MIT notice covers the font.
Brand vectors, PNGs, CSS and brand-book PDF are project assets; confirm ownership
and whether the owner includes them under MIT or documents a separate scope.
README already discloses Claude Code/Codex assistance; preserve that disclosure.
Screenshot/video publication must retain DEMO/historical labels and exclude
credentials, private hostnames and personal data. The committed UI fixtures
are not payment proof. Review any added music, stock footage or wallet marks
separately; this preparation adds none.

Owner checklist: approve license + holder/year; confirm contributor/asset rights;
collect dependency/font notices; add LICENSE in a separately approved change;
review public media and final repository reference. No approval is inferred.
