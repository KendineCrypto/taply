# Cross-language protocol vectors

`intent-a.json` and `intent-b.json` are the complete objects frozen by the lead.
They differ only in amount by one yoctoNEAR. `expected.json` contains literal,
lead-frozen expected hashes and codes; do not regenerate those expectations from
the implementation. The `*.canonical.json` files are exact UTF-8 JCS bytes with
no BOM or trailing newline. Files and account names are synthetic, not on-chain
evidence or deployed addresses.

Domains end with literal LF byte `0A`, not backslash followed by `n`:

1. Request ID: SHA-256 of `taply.id.v1` + LF + JCS of the four identity fields.
2. Terms hash: SHA-256 of `taply.terms.v1` + LF + JCS of the full intent.
3. Session commitment: SHA-256 of `taply.session.v1` + LF + the **ASCII lowercase
   hex** terms hash (not its decoded digest bytes). Null session means null
   commitment.
4. Comparison: first 30 bits of digest, most significant first, six characters
   of `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.

Rust consumers must use identical camelCase names, explicit Option nulls and
decimal strings for u64/u128. Reject unknown/duplicate JSON keys before a generic
JSON value/map can discard them. Validate Unicode; do not normalize it. Use an
RFC 8785 implementation, not arbitrary HashMap iteration or plain serde_json
serialization as a substitute. Compare its bytes to the committed canonical
files, then the SHA-256 values/codes to `expected.json`.

These vectors are Rust-compatible data. No Rust contract or Rust test has been
implemented or run in Phase 0. Cross-runtime execution is a later acceptance
gate, not something established by the TypeScript tests.
