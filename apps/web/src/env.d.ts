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
  }
}
