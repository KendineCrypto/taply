/**
 * Hard release gates for the NEAR mainnet candidate.
 *
 * Owner decision 2026-11-13: NO-GO for mainnet funds. These are compile-time
 * constants, not environment variables, on purpose: no dashboard value can
 * enable real-money signing or a funded 1Click quote. Opening a gate needs a
 * reviewed code change after the separate owner-approved release review
 * (docs/MAINNET_1CLICK_INTEGRATION.md "Owner approvals").
 */

/** External-wallet signing of any mainnet transaction (create, pay, register, cancel, retry). */
export const MAINNET_SIGNING_RELEASE_APPROVED = false as const;

/** 1Click quotes with `dry: false`, i.e. quotes that return a fundable deposit address. */
export const ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED = false as const;

/**
 * Independent mainnet receipt verification (receipt graph, merchant transfer,
 * callback, code hash at every block). Not implemented: "Verified Paid" is
 * unavailable on mainnet and the best possible state is "Payment recorded".
 */
export const MAINNET_INDEPENDENT_VERIFIER_AVAILABLE = false as const;
