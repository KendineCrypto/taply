/**
 * Declared shape of the public environment.
 *
 * Two reasons this exists rather than bracket-indexing `process.env`:
 *  - `noPropertyAccessFromIndexSignature` rejects dot access on an index
 *    signature, and Next inlines `process.env.NEXT_PUBLIC_*` most reliably as a
 *    literal member expression;
 *  - it documents exactly which public variables the frontend is allowed to
 *    read. Anything secret must never appear here, because NEXT_PUBLIC_* values
 *    are compiled into the client bundle.
 *
 * Keep in sync with .env.example.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** Logical network. Only 'near-testnet' is supported (freeze section 1). */
    readonly NEXT_PUBLIC_TAPLY_NETWORK?: string;
    /** Codex API base; endpoints live under /api/v1. */
    readonly NEXT_PUBLIC_TAPLY_API_BASE_URL?: string;
    /** Testnet payments contract account id. Empty until Codex deploys one. */
    readonly NEXT_PUBLIC_TAPLY_CONTRACT_ID?: string;
    /**
     * Human-approved base58 code hash of that contract. Required together with
     * the contract id; every contract read checks it at the same final block.
     */
    readonly NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH?: string;
    readonly NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL?: string;
    readonly NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL?: string;
    readonly NEXT_PUBLIC_TAPLY_VERIFIER_RPC_PROVIDER_ID?: string;
    /** Second archival verifier provider ('off' disables; default FastNEAR archival). Read-only. */
    readonly NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL?: string;
    readonly NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_PROVIDER_ID?: string;
    /** Public Testnet JSON-RPC endpoint (HTTPS, CORS-enabled, no credentials). */
    readonly NEXT_PUBLIC_TAPLY_RPC_URL?: string;
    /** Label recorded on every observation so provenance is visible. */
    readonly NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID?: string;
    /**
     * Optional public HTTPS origin for share links and payment QR codes (local
     * pilots behind an HTTPS tunnel). Validated in lib/share/origin.ts.
     */
    readonly NEXT_PUBLIC_TAPLY_SHARE_ORIGIN?: string;

    readonly NEXT_PUBLIC_TAPLY_FLAG_WALLET?: string;
    /** Instant Pay signing gate. Off unless a human turns it on after Testnet review. */
    readonly NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY?: string;
    readonly NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY?: string;
    readonly NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE?: string;
    readonly NEXT_PUBLIC_TAPLY_FLAG_MERCHANT?: string;
    readonly NEXT_PUBLIC_TAPLY_FLAG_CONTACTS?: string;
    readonly NEXT_PUBLIC_TAPLY_FLAG_RECURRING?: string;
    readonly NEXT_PUBLIC_TAPLY_FLAG_SPLIT?: string;

    /**
     * Protected Pay (G3 CANDIDATE) escrow contract. Separate from the G1 pilot,
     * which cannot hold escrow; both must be set together. Ignored unless
     * NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY=on. Never set in production until the
     * contract is reviewed and refund + release are proven on Testnet.
     */
    readonly NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID?: string;
    readonly NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH?: string;
    /** Taply Gift (Open / claimable): separate UNREVIEWED gift contract, pinned by code hash. Off unless all three are set. */
    readonly NEXT_PUBLIC_TAPLY_FLAG_GIFT_CLAIMABLE?: string;
    readonly NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID?: string;
    readonly NEXT_PUBLIC_TAPLY_GIFT_CODE_HASH?: string;
    /** Kill switch for Taply Gift (Personal gifts are on by default). */
    readonly NEXT_PUBLIC_TAPLY_FLAG_GIFT?: string;
    /** 'on' only on a protected QA build: allows signing against the UNREVIEWED candidate. */
    readonly NEXT_PUBLIC_TAPLY_PROTECTED_QA?: string;

    /** Mainnet build only: 'on' serves clearly labelled fixture data instead of chain reads. Never on Production. */
    readonly NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES?: string;
    /** Mainnet build only: signing flag. Also needs the compile-time gate in lib/mainnet/release-gates.ts (false). */
    readonly NEXT_PUBLIC_TAPLY_MAINNET_SIGNING?: string;
    /** SERVER ONLY. 1Click mode: off (default) | fixture | dry. Funded quotes are refused in code. */
    readonly TAPLY_ONECLICK_MODE?: string;
    /** Native USDC token code pin for USDC operations (observed hash ≠ approval). Unset → USDC operations refused. */
    readonly NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH?: string;
    /** TEST ONLY: single-browser simulated wallet authority (requires fixtures). Refused on Production. */
    readonly NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION?: string;
    /** Mainnet Protected Pay escrow (account + pinned code hash). Not deployed/approved: refused on Production. */
    readonly NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID?: string;
    readonly NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CODE_HASH?: string;
    /** Mainnet Gift contract profile (all five or none). Not approved: refused on Production. */
    readonly NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID?: string;
    readonly NEXT_PUBLIC_TAPLY_GIFT_CODE_HASH?: string;
    readonly NEXT_PUBLIC_TAPLY_GIFT_MIN_YOCTO?: string;
    readonly NEXT_PUBLIC_TAPLY_GIFT_MAX_YOCTO?: string;
    readonly NEXT_PUBLIC_TAPLY_GIFT_FEE_YOCTO?: string;
    /** SERVER ONLY. Optional 1Click API key; sent as a Bearer token, never to the browser. */
    readonly TAPLY_ONECLICK_API_KEY?: string;
  }
}
