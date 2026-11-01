import { z } from "zod";
import { AccountIdSchema, ChainHashSchema, parseStrictJson } from "@taply/shared";
import type { VaultStorage } from "./wallet-vault.js";
import { WalletEngineError } from "./wallet-transfer.js";

const KEY = "taply.testnet-wallet-attempt.v1";
const Attempt = z.strictObject({
  version: z.literal(1), network: z.literal("near-testnet"), accountId: AccountIdSchema,
  reviewId: z.string().uuid(), transactionHash: ChainHashSchema.nullable(),
  phase: z.enum(["RESERVED", "UNKNOWN", "SUBMITTED", "FINAL_SUCCEEDED", "FINAL_FAILED", "NOT_SENT"]),
});
export type WalletAttempt = z.infer<typeof Attempt>;

/** One unresolved operation blocks ALL new local-wallet spends, across reloads.
 * Entries hold public references only. Neither an error nor time passing clears
 * the brake. Web Locks in the browser adapter serialize access across tabs.
 */
export class WalletAttemptJournal {
  constructor(private readonly storage: VaultStorage) {}
  read(): WalletAttempt | null {
    try {
      const raw = this.storage.getItem(KEY);
      return raw === null ? null : Attempt.parse(parseStrictJson(raw));
    } catch { throw new WalletEngineError("STORAGE_UNAVAILABLE"); }
  }
  assertClear(): void {
    const previous = this.read();
    if (previous && ["RESERVED", "UNKNOWN", "SUBMITTED"].includes(previous.phase)) throw new WalletEngineError("OUTCOME_UNRESOLVED");
  }
  private write(attempt: WalletAttempt): void {
    const raw = JSON.stringify(Attempt.parse(attempt));
    try {
      this.storage.setItem(KEY, raw);
      if (this.storage.getItem(KEY) !== raw) throw new Error();
    } catch { throw new WalletEngineError("STORAGE_UNAVAILABLE"); }
  }
  begin(accountId: string, reviewId: string): void {
    this.assertClear();
    this.write({ version: 1, network: "near-testnet", accountId, reviewId, phase: "RESERVED", transactionHash: null });
  }
  update(reviewId: string, phase: WalletAttempt["phase"], transactionHash?: string): void {
    const attempt = this.read();
    if (!attempt || attempt.reviewId !== reviewId) throw new WalletEngineError("OUTCOME_UNRESOLVED");
    const allowed: Record<WalletAttempt["phase"], readonly WalletAttempt["phase"][]> = {
      RESERVED: ["NOT_SENT", "UNKNOWN", "SUBMITTED"],
      SUBMITTED: ["UNKNOWN", "FINAL_SUCCEEDED", "FINAL_FAILED"],
      UNKNOWN: ["FINAL_SUCCEEDED", "FINAL_FAILED"], FINAL_SUCCEEDED: [], FINAL_FAILED: [], NOT_SENT: [],
    };
    const hash = transactionHash ?? attempt.transactionHash;
    if (!allowed[attempt.phase].includes(phase) ||
      (attempt.transactionHash !== null && hash !== attempt.transactionHash) ||
      (["SUBMITTED", "FINAL_SUCCEEDED", "FINAL_FAILED"].includes(phase) && hash === null))
      throw new WalletEngineError("OUTCOME_UNRESOLVED");
    this.write({ ...attempt, phase, transactionHash: transactionHash ?? attempt.transactionHash });
  }
}
