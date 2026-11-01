import { z } from "zod";
import { isWellFormedUnicode, parseStrictJson } from "@taply/shared";
import { PublicKey, Signer, encodeTransaction, decodeSignedTransaction } from "near-api-js";
import type { Transaction, SignedTransaction } from "near-api-js";

// Internal bridge, deliberately not re-exported from the package entrypoint.
// No CryptoKey, private bytes, or general raw-message signer leaves the vault.
const transactionSigners = new WeakMap<EncryptedTestnetVault, (tx: Transaction) => Promise<{ txHash: Uint8Array; signedTransaction: SignedTransaction; assertActive(): void }>>();
export async function signVaultTransaction(vault: EncryptedTestnetVault, tx: Transaction) {
  const sign = transactionSigners.get(vault);
  if (!sign) throw new VaultError("LOCKED");
  return sign(tx);
}

export const VAULT_STORAGE_KEY = "taply.testnet-vault.v1";
export const VAULT_UNLOCK_MS = 5 * 60 * 1000;
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const HexKey = z.string().regex(/^[a-f0-9]{64}$/);
const RecordSchema = z.strictObject({
  version: z.literal(1), network: z.literal("near-testnet"),
  algorithm: z.literal("Ed25519"), publicKeyHex: HexKey, accountId: HexKey,
  kdf: z.literal("PBKDF2-SHA256"), iterations: z.literal(ITERATIONS),
  cipher: z.literal("AES-256-GCM"), salt: z.string().regex(/^[a-f0-9]{32}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/), ciphertext: z.string().regex(/^[a-f0-9]{64,1024}$/),
}).refine((r) => r.accountId === r.publicKeyHex);
type VaultRecord = z.infer<typeof RecordSchema>;

export interface VaultStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface LocalWalletIdentity {
  readonly network: "near-testnet";
  readonly accountId: string;
  readonly publicKeyHex: string;
  /** Local generation is NOT account creation or Testnet funding. */
  readonly provisioning: "LOCAL_ONLY";
}
export class VaultError extends Error {
  constructor(readonly code: "LOCKED" | "INVALID_RECORD" | "BAD_PASSWORD_OR_DATA" | "PASSWORD_POLICY" |
    "ALREADY_EXISTS" | "STORAGE_UNAVAILABLE" | "CANCELLED" | "CRYPTO_UNAVAILABLE" | "SIGNING_DISABLED") {
    super(`taply-vault:${code}`); this.name = "VaultError";
  }
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (value.length % 2 !== 0 || !/^[a-f0-9]+$/.test(value)) throw new VaultError("INVALID_RECORD");
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
function identity(r: Pick<VaultRecord, "accountId" | "publicKeyHex">): LocalWalletIdentity {
  return Object.freeze({ network: "near-testnet", accountId: r.accountId, publicKeyHex: r.publicKeyHex, provisioning: "LOCAL_ONLY" });
}
function aad(r: Omit<VaultRecord, "ciphertext">): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({ version: r.version, network: r.network, algorithm: r.algorithm,
    publicKeyHex: r.publicKeyHex, accountId: r.accountId, kdf: r.kdf, iterations: r.iterations,
    cipher: r.cipher, salt: r.salt, iv: r.iv }));
}
function parseRecord(raw: string): VaultRecord {
  if (raw.length > 4096) throw new VaultError("INVALID_RECORD");
  try { return RecordSchema.parse(parseStrictJson(raw)); } catch { throw new VaultError("INVALID_RECORD"); }
}
function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  if (typeof password !== "string" || !isWellFormedUnicode(password)) throw new VaultError("PASSWORD_POLICY");
  const bytes = encoder.encode(password);
  if (password.length < 16 || bytes.length > 1024) { bytes.fill(0); throw new VaultError("PASSWORD_POLICY"); }
  return bytes;
}
async function encryptionKey(crypto: Crypto, password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const bytes = passwordBytes(password);
  try {
    const material = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } finally { bytes.fill(0); }
}

/** Web Crypto primitives only. Storage receives ciphertext and public metadata.
 * Reload starts locked. No mnemonic/plaintext import or account-creation API.
 * Browser/XSS code while unlocked remains a threat; this is not a hardware wallet.
 */
export class EncryptedTestnetVault {
  #key: CryptoKey | null = null;
  #unlockedRecord: string | null = null;
  #generation = 0;
  #expiresAt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #listeners = new Set<() => void>();
  constructor(private readonly storage: VaultStorage, private readonly options: {
    crypto?: Crypto; now?: () => number;
  } = {}) {
    transactionSigners.set(this, (tx) => this.#signTransaction(tx));
  }
  private get crypto(): Crypto {
    const value = this.options.crypto ?? globalThis.crypto;
    if (!value?.subtle) throw new VaultError("CRYPTO_UNAVAILABLE");
    return value;
  }
  private get now(): number { return (this.options.now ?? Date.now)(); }
  private raw(): string | null {
    try { return this.storage.getItem(VAULT_STORAGE_KEY); } catch { throw new VaultError("STORAGE_UNAVAILABLE"); }
  }
  private persist(raw: string): void {
    try {
      this.storage.setItem(VAULT_STORAGE_KEY, raw);
      if (this.storage.getItem(VAULT_STORAGE_KEY) !== raw) throw new Error();
    } catch { throw new VaultError("STORAGE_UNAVAILABLE"); }
  }
  getIdentity(): LocalWalletIdentity | null { const raw = this.raw(); return raw === null ? null : identity(parseRecord(raw)); }
  get unlocked(): boolean {
    if (this.#key !== null) {
      try { if (this.now >= this.#expiresAt || this.raw() !== this.#unlockedRecord) this.lock(); }
      catch { this.lock(); throw new VaultError("STORAGE_UNAVAILABLE"); }
    }
    return this.#key !== null;
  }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  lock(): void {
    this.#generation++; this.#key = null; this.#unlockedRecord = null; this.#expiresAt = 0;
    clearTimeout(this.#timer); this.#timer = undefined;
    for (const listener of this.#listeners) listener();
  }
  /** Generates a LOCAL implicit identity and encrypted vault, then leaves it locked. */
  async create(password: string): Promise<LocalWalletIdentity> {
    if (this.raw() !== null) throw new VaultError("ALREADY_EXISTS");
    this.lock(); const generation = this.#generation;
    const salt = this.crypto.getRandomValues(new Uint8Array(16));
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const encryption = await encryptionKey(this.crypto, password, salt);
    let pair: CryptoKeyPair;
    try { pair = await this.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair; }
    catch { throw new VaultError("CRYPTO_UNAVAILABLE"); }
    const publicBytes = new Uint8Array(await this.crypto.subtle.exportKey("raw", pair.publicKey));
    const publicKeyHex = hex(publicBytes);
    const metadata: Omit<VaultRecord, "ciphertext"> = { version: 1, network: "near-testnet", algorithm: "Ed25519",
      publicKeyHex, accountId: publicKeyHex, kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
      cipher: "AES-256-GCM", salt: hex(salt), iv: hex(iv) };
    const secret = new Uint8Array(await this.crypto.subtle.exportKey("pkcs8", pair.privateKey));
    try {
      const encrypted = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(metadata), tagLength: 128 }, encryption, secret);
      if (generation !== this.#generation) throw new VaultError("CANCELLED");
      if (this.raw() !== null) throw new VaultError("ALREADY_EXISTS");
      this.persist(JSON.stringify({ ...metadata, ciphertext: hex(new Uint8Array(encrypted)) }));
      return identity(metadata);
    } finally { secret.fill(0); }
  }
  private async decrypt(raw: string, password: string): Promise<{ record: VaultRecord; key: CryptoKey }> {
    const record = parseRecord(raw);
    const encryption = await encryptionKey(this.crypto, password, unhex(record.salt));
    let secret: Uint8Array<ArrayBuffer> | null = null;
    try {
      secret = new Uint8Array(await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(record.iv),
        additionalData: aad(record), tagLength: 128 }, encryption, unhex(record.ciphertext)));
      // Unlocked key is nonextractable. Never retain the passphrase or PKCS8 bytes.
      const key = await this.crypto.subtle.importKey("pkcs8", secret, { name: "Ed25519" }, false, ["sign"]);
      const pub = await this.crypto.subtle.importKey("raw", unhex(record.publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
      const challenge = this.crypto.getRandomValues(new Uint8Array(32));
      const signature = await this.crypto.subtle.sign("Ed25519", key, challenge);
      if (!await this.crypto.subtle.verify("Ed25519", pub, signature, challenge)) throw new Error();
      return { record, key };
    } catch { throw new VaultError("BAD_PASSWORD_OR_DATA"); }
    finally { secret?.fill(0); }
  }
  async unlock(password: string): Promise<LocalWalletIdentity> {
    this.lock(); const generation = this.#generation;
    const raw = this.raw(); if (raw === null) throw new VaultError("INVALID_RECORD");
    const { record, key } = await this.decrypt(raw, password);
    if (generation !== this.#generation || this.raw() !== raw) throw new VaultError("CANCELLED");
    this.#key = key; this.#unlockedRecord = raw; this.#expiresAt = this.now + VAULT_UNLOCK_MS;
    this.#timer = setTimeout(() => this.lock(), VAULT_UNLOCK_MS);
    // Do not keep Node test processes alive; browsers simply have no unref.
    const timer = this.#timer as unknown as { unref?: () => void }; timer.unref?.();
    return identity(record);
  }
  exportEncryptedBackup(): string {
    const raw = this.raw(); if (raw === null) throw new VaultError("INVALID_RECORD");
    parseRecord(raw); return raw;
  }
  async restoreEncryptedBackup(raw: string, password: string): Promise<LocalWalletIdentity> {
    if (this.raw() !== null) throw new VaultError("ALREADY_EXISTS");
    this.lock(); const generation = this.#generation;
    const { record } = await this.decrypt(raw, password);
    if (generation !== this.#generation || this.raw() !== null) throw new VaultError("CANCELLED");
    this.persist(JSON.stringify(record)); return identity(record); // recovery always locked
  }
  async #signTransaction(tx: Transaction) {
    if (!this.unlocked || this.#key === null || this.#key.extractable) throw new VaultError("LOCKED");
    const owner = this;
    const generation = this.#generation;
    const local = this.getIdentity();
    if (!local || tx.signerId !== local.accountId || tx.publicKey.keyType !== 0 ||
      hex(tx.publicKey.data) !== local.publicKeyHex) throw new VaultError("INVALID_RECORD");
    const publicKey = PublicKey.from(tx.publicKey.toString());
    const signer = new class extends Signer {
      async getPublicKey() { return publicKey; }
      protected async signBytes(bytes: Uint8Array): Promise<Uint8Array> {
        if (!owner.unlocked || owner.#key === null || generation !== owner.#generation) throw new VaultError("CANCELLED");
        return new Uint8Array(await owner.crypto.subtle.sign("Ed25519", owner.#key, new Uint8Array(bytes)));
      }
    }();
    const result = await signer.signTransaction(tx);
    const serialized = new Uint8Array(encodeTransaction(tx));
    const localHash = new Uint8Array(await this.crypto.subtle.digest("SHA-256", serialized));
    const publicCryptoKey = await this.crypto.subtle.importKey("raw", unhex(local.publicKeyHex), "Ed25519", false, ["verify"]);
    const decoded = decodeSignedTransaction(encodeTransaction(result.signedTransaction));
    if (!this.unlocked || generation !== this.#generation ||
      hex(localHash) !== hex(result.txHash) ||
      hex(new Uint8Array(encodeTransaction(decoded.transaction))) !== hex(serialized) ||
      !decoded.signature.ed25519Signature ||
      hex(decoded.signature.ed25519Signature.data) !== hex(result.signedTransaction.signature.data) ||
      !publicKey.verify(localHash, result.signedTransaction.signature.data) ||
      !await this.crypto.subtle.verify("Ed25519", publicCryptoKey, new Uint8Array(result.signedTransaction.signature.data), localHash))
      throw new VaultError("CANCELLED");
    if (!this.unlocked || generation !== this.#generation) throw new VaultError("CANCELLED");
    return { ...result, assertActive: () => {
      if (!this.unlocked || generation !== this.#generation) throw new VaultError("CANCELLED");
    } };
  }
}
