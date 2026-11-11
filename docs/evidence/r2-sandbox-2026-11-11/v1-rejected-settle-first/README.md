# Rejected design: settle-first (PR #31, first version)

These are real NEAR sandbox outputs of the FIRST version of the R-2 candidate,
which marked a request `FINAL_PAID` / `CANCELLED_REFUNDED` as soon as the
settlement was committed, before the callback confirmed the transfer.

`3-failed-transfer-callback-panic-candidate.json` shows why it was rejected in
review: the transfer FAILED (the recipient received nothing) and the callback
also failed, yet `get_request` returned `FINAL_PAID` with a `SUCCEEDED`
operation. Fed to the web app's `mapChainState`, that view yields
`contractReportsPaid: true` and money "to_recipient": a false paid.

The current candidate keeps the deployed meaning of `FINAL_PAID` (only after
the callback confirms delivery). See ../ and docs/R2_CALLBACK_RECOVERY.md.
