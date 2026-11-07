# LICENSE proposal — awaiting owner confirmation (no LICENSE committed)

Prepared 2026-11-08. Supersedes nothing; extends [LICENSE_RECOMMENDATION.md](LICENSE_RECOMMENDATION.md).

## Rule check (re-verified 2026-11-08 at https://nearhackathon.com/HACKATHON.md)

- **Q-014:** "Any. MIT is fine. Repo stays public through judging; add a LICENSE file."
- **Q-013:** "Team keeps all rights; organizers get non-exclusive promo rights to name, screenshots, video, repo link."
- **Q-005:** AI code and libraries allowed; list them in the README (already done).

## Facts found in the repository (not assumptions)

- Commit authors: `Fatih Gören` (two email addresses) and the GitHub account
  `KendineCrypto` (3 commits). Many commits carry `Co-Authored-By: Claude …`
  trailers; README discloses Claude Code (frontend) and Codex (contract,
  backend, packages) as AI agents under human direction.
- No `LICENSE` file exists; no package declares a `license` field.
- Brand: `brand/` (wordmark/icon SVG+PNG, favicon, tokens, CSS, brand book PDF);
  README says "made for this project"; BRAND_GUIDELINES calls the vector master
  "carefully reconstructed … based on the approved appearance".
- Font: Inter via `next/font/google` (self-hosted at build time). Inter is under
  the SIL Open Font License 1.1, not MIT.
- No audio/video files are committed. Screenshots in `apps/web/docs/screenshots/` are
  captures of Taply itself.
- Third-party JS with notice duties: `jsqr` and `canonicalize` (Apache-2.0),
  `near-api-js` (MIT AND Apache-2.0). Rust crates (near-sdk, borsh, …) were not
  re-audited locally. These keep their own licenses; MIT for Taply does not
  relicense them.

## Proposal

1. **`LICENSE` (MIT) covers original Taply source code** (apps, packages,
   contracts, scripts, tests, docs).
2. **Brand is excluded from MIT** and kept as "all rights reserved; may be
   used only to refer to the Taply project", via a `NOTICE` / `BRAND_LICENSE`
   note. MIT is a copyright licence and gives no trademark rights either way;
   excluding the brand avoids implying anyone may reuse the logo for their own product.
3. **`THIRD_PARTY_NOTICES.md`** listing the dependencies above with their
   licences, the Apache-2.0 NOTICE requirement, and Inter (OFL 1.1).
4. AI-assisted code: covered by the same licence as the owner's code; README
   disclosure stays. If any image/video was AI-generated (for example the
   promotional clips prepared outside the repo), keep it out of the repo or
   list its tool and terms before publishing.

### Draft `LICENSE` (holder left blank on purpose)

```
MIT License

Copyright (c) 2026 <COPYRIGHT HOLDER — TO BE CONFIRMED BY OWNER>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The Taply name, logo and brand assets in brand/ are not licensed under the
MIT License. See NOTICE.
```

## Owner decisions needed

1. Exact copyright holder text (for example a personal name, or a team name).
2. Is anyone else (another person or the `KendineCrypto` account holder, if different) a contributor who must agree?
3. Brand assets: excluded from MIT (recommended) or included?
4. Confirm the brand assets and any promo media are yours to license (not third-party or tool-restricted).

Not changed: G1 contract code, Cargo manifests/locks, approved hash pins.
