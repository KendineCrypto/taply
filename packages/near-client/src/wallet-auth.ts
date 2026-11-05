import { z } from "zod";
import { AccountIdSchema, canonicalJson, parseStrictJson } from "@taply/shared";

const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const ChallengeSchema = z.strictObject({ id: secret, accountId: AccountIdSchema,
  network: z.literal("near-testnet"), purpose: z.literal("merchant-login"),
  origin: z.string(), recipient: z.string(), nonceBase64: z.string(), state: secret,
  expiresAtMs: z.number().safe().int().positive(), message: z.string().max(4096), callbackUrl: z.string().optional() });
function bytes(value: string, size: number): Uint8Array {
  let decoded: string;
  try { decoded = atob(value); } catch { throw Error("AUTH_SIGNATURE_INVALID"); }
  if (decoded.length !== size || btoa(decoded) !== value) throw Error("AUTH_SIGNATURE_INVALID");
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
/** Capability declaration is not real-wallet compatibility evidence. Never calls
 * the wallet; absence must not fall back to transaction signing/key creation. */
export function signMessageCapability(wallet: unknown): "available_unverified" | "unsupported" {
  return wallet !== null && typeof wallet === "object" && "signMessage" in wallet
    && typeof wallet.signMessage === "function" ? "available_unverified" : "unsupported";
}

/** Pure preparation and one-use response correlation only, never authentication.
 * NEP-413: message bytes, recipient, 32 nonce bytes, optional signed callback URL.
 * Server must still check signature, FullAccess association, expiry and replay.
 * Redirect wallets require explicit callback support/evidence; the current HTTP
 * challenge omits callbackUrl and cannot certify such wallets. */
export function prepareWalletAuthentication(input: unknown, scope: { origin: string; contractId: string; accountId: string }, now = Date.now) {
  scope = { ...scope };
  const challenge = ChallengeSchema.parse(input), { message, callbackUrl, ...fields } = challenge;
  AccountIdSchema.parse(scope.contractId); AccountIdSchema.parse(scope.accountId);
  if (new URL(scope.origin).origin !== scope.origin || !scope.origin.startsWith("https://")
    || challenge.origin !== scope.origin || challenge.recipient !== scope.origin || challenge.accountId !== scope.accountId
    || callbackUrl !== undefined && callbackUrl !== `${scope.origin}/auth/callback`) throw Error("AUTH_SCOPE_MISMATCH");
  const expected = { ...fields, ...(callbackUrl === undefined ? {} : { callbackUrl }), contractId: scope.contractId };
  if (canonicalJson(parseStrictJson(message)) !== canonicalJson(expected)) throw Error("AUTH_SCOPE_MISMATCH");
  const nonce = bytes(challenge.nonceBase64, 32);
  const live = () => {
    if (now() >= challenge.expiresAtMs || challenge.expiresAtMs > now() + 120000) throw Error("AUTH_CHALLENGE_EXPIRED");
  };
  live(); let consumed = false;
  const params = { message, recipient: challenge.recipient, nonce, state: challenge.state,
    ...(callbackUrl === undefined ? {} : { callbackUrl }) };
  return { challengeId: challenge.id, params, delivery: callbackUrl === undefined ? "direct_only_unverified" as const : "callback_unverified" as const,
    accept(result: unknown, current: { origin: string; accountId: string }) {
      if (consumed) throw Error("AUTH_CHALLENGE_USED"); consumed = true; live();
      if (current.origin !== scope.origin || current.accountId !== scope.accountId) throw Error("AUTH_SCOPE_MISMATCH");
      const signed = z.strictObject({ accountId: AccountIdSchema, publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        signature: z.string().max(88), state: z.string().optional() }).parse(result);
      bytes(signed.signature, 64);
      if (signed.accountId !== challenge.accountId || signed.state !== undefined && signed.state !== challenge.state) throw Error("AUTH_SCOPE_MISMATCH");
      // SDKs omitting returned state can use the pending challenge's state: the
      // backend verifies that same state inside the signed, browser-bound message.
      return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, state: challenge.state };
    } };
}
