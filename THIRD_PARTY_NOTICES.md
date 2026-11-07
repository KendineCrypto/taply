# Third-party notices

Taply's MIT License covers only Taply's own code. The packages below (direct
dependencies, as declared by their installed package.json, checked 2026-11-06
and 2026-11-08) keep their own licences. Exact versions: `pnpm-lock.yaml`,
`contracts/*/Cargo.lock`. This is not a full transitive audit.

| Component | Licence | Note |
| --- | --- | --- |
| next 16.4.3 | MIT | |
| react / react-dom 19.3.1 | MIT | |
| @hot-labs/near-connect 0.12.0 | MIT | wallet selector |
| zod 4.6.7 | MIT | |
| lossless-json 4.3.3 | MIT | |
| jsonc-parser 3.3.1 | MIT | |
| @noble/hashes 2.4.0 / 2.2.0 | MIT | |
| near-api-js 7.4.0 | MIT AND Apache-2.0 | both apply; keep its LICENSE files |
| jsqr 1.4.0 | Apache-2.0 | keep LICENSE/NOTICE when redistributing |
| canonicalize 5.1.0 | Apache-2.0 | keep LICENSE/NOTICE when redistributing |
| Inter typeface (via next/font/google) | SIL Open Font License 1.1 | self-hosted at build time; the font is not MIT |
| Rust crates (near-sdk 5.30.0, borsh, near-workspaces, ...) | per crate | not re-audited locally; see Cargo.lock |

When redistributing builds, include the LICENSE and NOTICE files that ship
inside these packages (node_modules/<package>/LICENSE*, NOTICE*).
