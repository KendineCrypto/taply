import { z } from "zod";
import { MainnetAccountSchema, isWellFormedUnicode, parseStrictJson } from "@taply/shared";
import { PublicKey, Signer, encodeTransaction, decodeSignedTransaction } from "near-api-js";
import type { Transaction, SignedTransaction } from "near-api-js";
import {mainnetAuthorityMessageParameters,mainnetAuthorityPayload,type MainnetAuthorityCommand} from './mainnet-wallet-auth.js';
import {ed25519PublicKeyFromHex} from './wallet-chain.js';
import { RECOVERY_DERIVATION, ed25519SeedToPkcs8, entropyToPhrase, normalizePhrase, phraseToEd25519Seed, phraseToEntropy } from "./recovery-phrase.js";

// Internal bridge, deliberately not re-exported from the package entrypoint.
// No CryptoKey, private bytes, or general raw-message signer leaves the vault.
const transactionSigners = new WeakMap<EncryptedMainnetVault, (tx: Transaction) => Promise<{ txHash: Uint8Array; signedTransaction: SignedTransaction; assertActive(): void }>>();
export async function signMainnetVaultTransaction(vault: EncryptedMainnetVault, tx: Transaction) {
  if (!MAINNET_PROTOCOL_SIGNING_RELEASED) throw new MainnetVaultError("SIGNING_DISABLED");
  const sign = transactionSigners.get(vault);
  if (!sign) throw new MainnetVaultError("LOCKED");
  return sign(tx);
}

export const MAINNET_PROTOCOL_SIGNING_RELEASED: boolean = true;
export const MAINNET_WALLET_STORAGE_KEY = "taply.mainnet-vault.v1";
export const MAINNET_VAULT_UNLOCK_MS = 5 * 60 * 1000;
/** Longest delay setTimeout supports; longer unlocks rely on the expiry check alone. */
const MAX_TIMER_MS = 2_147_000_000;

/**
 * Optional persistence of an UNLOCKED session (e.g. IndexedDB). It stores the
 * NONEXTRACTABLE signing CryptoKey (structured clone: usable for signing, never
 * exportable), the exact vault record it belongs to and its expiry. No password,
 * phrase or private bytes are ever handed to it.
 */
export interface MainnetVaultSessionStore {
  save(session: { key: CryptoKey; record: string; expiresAt: number }): Promise<void>;
  load(): Promise<{ key: CryptoKey; record: string; expiresAt: number } | null>;
  clear(): Promise<void>;
}
const ITERATIONS = 600_000;
/** Local unlock password (Phantom-style). Recovery is the 12-word phrase, not this password. */
export const MIN_PASSWORD_LENGTH = 8;
const encoder = new TextEncoder();
const HexKey = z.string().regex(/^[a-f0-9]{64}$/);
/** A named NEAR Mainnet account such as `alice.testnet` (2-64 chars, NEAR syntax). */
export const NamedMainnetAccountSchema = MainnetAccountSchema.refine((v) => !/^[a-f0-9]{64}$/.test(v));
export function isNamedMainnetAccount(value: string): boolean { return NamedMainnetAccountSchema.safeParse(value).success; }
const CommonFields = {
  network: z.literal("near-mainnet"),
  algorithm: z.literal("Ed25519"), publicKeyHex: HexKey, accountId: z.union([HexKey, NamedMainnetAccountSchema]),
  kdf: z.literal("PBKDF2-SHA256"), iterations: z.literal(ITERATIONS),
  cipher: z.literal("AES-256-GCM"), salt: z.string().regex(/^[a-f0-9]{32}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
};
const RecordSchema = z.union([
  // v1: random key, PKCS8 encrypted; recovery only via the encrypted backup file (legacy).
  z.strictObject({ version: z.literal(1), ...CommonFields, ciphertext: z.string().regex(/^[a-f0-9]{64,1024}$/) }),
  // v2: key derived from a 12-word recovery phrase; only its 16-byte entropy is encrypted.
  z.strictObject({ version: z.literal(2), ...CommonFields, secret: z.literal(RECOVERY_DERIVATION), ciphertext: z.string().regex(/^[a-f0-9]{64}$/) }),
  // Implicit accounts are bound to their key; a named account must still be proven on chain.
]).refine((r) => !HexKey.safeParse(r.accountId).success || r.accountId === r.publicKeyHex);
type VaultRecord = z.infer<typeof RecordSchema>;

export interface MainnetVaultStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface MainnetWalletIdentity {
  readonly network: "near-mainnet";
  readonly accountId: string;
  readonly publicKeyHex: string;
  /** Local generation is NOT account creation or Mainnet funding. The vault itself
   * only ever reports LOCAL_ONLY; ON_CHAIN is set by a caller after a FINAL chain
   * read proved the account exists and holds this key with full access
   * (`WalletChain.provisioning`). */
  readonly provisioning: "LOCAL_ONLY" | "ON_CHAIN";
  /** How this wallet is recovered: the 12-word phrase (new) or the legacy encrypted file. */
  readonly recovery: "RECOVERY_PHRASE" | "ENCRYPTED_FILE";
}
export class MainnetVaultError extends Error {
  constructor(readonly code: "LOCKED" | "INVALID_RECORD" | "BAD_PASSWORD_OR_DATA" | "PASSWORD_POLICY" |
    "ALREADY_EXISTS" | "STORAGE_UNAVAILABLE" | "CANCELLED" | "CRYPTO_UNAVAILABLE" | "SIGNING_DISABLED" |
    "INVALID_ACCOUNT_ID" | "INVALID_PHRASE" | "NO_RECOVERY_PHRASE") {
    super(`taply-vault:${code}`); this.name = "MainnetVaultError";
  }
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (value.length % 2 !== 0 || !/^[a-f0-9]+$/.test(value)) throw new MainnetVaultError("INVALID_RECORD");
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
type VaultMetadata = Omit<Extract<VaultRecord, { version: 1 }>, "ciphertext"> | Omit<Extract<VaultRecord, { version: 2 }>, "ciphertext">;
function identity(r: Pick<VaultRecord, "accountId" | "publicKeyHex" | "version">): MainnetWalletIdentity {
  return Object.freeze({ network: "near-mainnet", accountId: r.accountId, publicKeyHex: r.publicKeyHex, provisioning: "LOCAL_ONLY",
    recovery: r.version === 2 ? "RECOVERY_PHRASE" : "ENCRYPTED_FILE" });
}
function aad(r: VaultMetadata): Uint8Array<ArrayBuffer> {
  // v1 bytes are unchanged; v2 additionally authenticates the derivation scheme.
  return encoder.encode(JSON.stringify({ version: r.version, network: r.network, algorithm: r.algorithm,
    publicKeyHex: r.publicKeyHex, accountId: r.accountId, kdf: r.kdf, iterations: r.iterations,
    cipher: r.cipher, salt: r.salt, iv: r.iv, ...(r.version === 2 ? { secret: r.secret } : {}) }));
}
function metadataOf(r: VaultRecord): VaultMetadata {
  const { ciphertext: _ciphertext, ...rest } = r;
  return rest;
}
function parseRecord(raw: string): VaultRecord {
  if (raw.length > 4096) throw new MainnetVaultError("INVALID_RECORD");
  try { return RecordSchema.parse(parseStrictJson(raw)); } catch { throw new MainnetVaultError("INVALID_RECORD"); }
}
function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  if (typeof password !== "string" || !isWellFormedUnicode(password)) throw new MainnetVaultError("PASSWORD_POLICY");
  const bytes = encoder.encode(password);
  if (password.length < MIN_PASSWORD_LENGTH || bytes.length > 1024) { bytes.fill(0); throw new MainnetVaultError("PASSWORD_POLICY"); }
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
 * Reload starts locked. New vaults hold a 12-word recovery phrase (BIP-39, NEAR
 * path m/44'/397'/0'); only its entropy is stored, encrypted. The phrase can be
 * revealed with the password or imported. No raw private-key import and no
 * account-creation API: a named account ID is only a binding until a chain read proves it.
 * Browser/XSS code while unlocked remains a threat; this is not a hardware wallet.
 */
export class EncryptedMainnetVault {
  #key: CryptoKey | null = null;
  #unlockedRecord: string | null = null;
  #generation = 0;
  #expiresAt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #listeners = new Set<() => void>();
  constructor(private readonly storage: MainnetVaultStorage, private readonly options: {
    crypto?: Crypto; now?: () => number;
    /** How long an unlock lasts (default MAINNET_VAULT_UNLOCK_MS). */
    unlockMs?: number;
    /** Keep the unlocked state across page loads until lock() or expiry. */
    session?: MainnetVaultSessionStore;
  } = {}) {
    transactionSigners.set(this, (tx) => this.#signTransaction(tx));
  }
  private get crypto(): Crypto {
    const value = this.options.crypto ?? globalThis.crypto;
    if (!value?.subtle) throw new MainnetVaultError("CRYPTO_UNAVAILABLE");
    return value;
  }
  private get now(): number { return (this.options.now ?? Date.now)(); }
  private raw(): string | null {
    try { return this.storage.getItem(MAINNET_WALLET_STORAGE_KEY); } catch { throw new MainnetVaultError("STORAGE_UNAVAILABLE"); }
  }
  private persist(raw: string): void {
    try {
      this.storage.setItem(MAINNET_WALLET_STORAGE_KEY, raw);
      if (this.storage.getItem(MAINNET_WALLET_STORAGE_KEY) !== raw) throw new Error();
    } catch { throw new MainnetVaultError("STORAGE_UNAVAILABLE"); }
  }
  getIdentity(): MainnetWalletIdentity | null { const raw = this.raw(); return raw === null ? null : identity(parseRecord(raw)); }
  /** Fixed authority authentication only; no arbitrary raw-message signing.
   * Remains disabled with the Mainnet signing release gate. */
  async authorizeAuthorityCommand(challenge:unknown,command:MainnetAuthorityCommand,policyHash:string,
    confirm:(command:MainnetAuthorityCommand)=>Promise<boolean>) {
    if(!MAINNET_PROTOCOL_SIGNING_RELEASED)throw new MainnetVaultError('SIGNING_DISABLED');
    const id=this.getIdentity();
    if(!id||!this.unlocked||!this.#key||this.#key.extractable)throw new MainnetVaultError('LOCKED');
    const generation=this.#generation,op=structuredClone(command),publicKey=ed25519PublicKeyFromHex(id.publicKeyHex);
    const expected={accountId:id.accountId,publicKey,command:op,policyHash};
    const original=structuredClone(challenge);
    await mainnetAuthorityMessageParameters(original,expected,this.now);
    if(await confirm(structuredClone(op))!==true)throw new MainnetVaultError('CANCELLED');
    const params=await mainnetAuthorityMessageParameters(original,expected,this.now);
    if(!this.unlocked||!this.#key||generation!==this.#generation)throw new MainnetVaultError('CANCELLED');
    const digest=await this.crypto.subtle.digest('SHA-256',mainnetAuthorityPayload(params));
    if(!this.unlocked||!this.#key||generation!==this.#generation)throw new MainnetVaultError('CANCELLED');
    const signature=new Uint8Array(await this.crypto.subtle.sign('Ed25519',this.#key,digest));
    if(!this.unlocked||generation!==this.#generation)throw new MainnetVaultError('CANCELLED');
    await mainnetAuthorityMessageParameters(original,expected,this.now);
    return {accountId:id.accountId,publicKey,signature:btoa(String.fromCharCode(...signature))};
  }
  get unlocked(): boolean {
    if (this.#key !== null) {
      try { if (this.now >= this.#expiresAt || this.raw() !== this.#unlockedRecord) this.lock(); }
      catch { this.lock(); throw new MainnetVaultError("STORAGE_UNAVAILABLE"); }
    }
    return this.#key !== null;
  }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  lock(): void {
    this.#generation++; this.#key = null; this.#unlockedRecord = null; this.#expiresAt = 0;
    clearTimeout(this.#timer); this.#timer = undefined;
    // An explicit lock (or any revocation) also ends the persisted session.
    void this.options.session?.clear().catch(() => undefined);
    for (const listener of this.#listeners) listener();
  }
  /** Drops the in-memory key WITHOUT ending a persisted session (page/component teardown). */
  release(): void {
    this.#generation++; this.#key = null; this.#unlockedRecord = null; this.#expiresAt = 0;
    clearTimeout(this.#timer); this.#timer = undefined;
  }
  private get unlockMs(): number {
    const ms = this.options.unlockMs ?? MAINNET_VAULT_UNLOCK_MS;
    return Number.isSafeInteger(ms) && ms > 0 ? ms : MAINNET_VAULT_UNLOCK_MS;
  }
  #activate(key: CryptoKey, raw: string, expiresAt: number): void {
    this.#key = key; this.#unlockedRecord = raw; this.#expiresAt = expiresAt;
    const delay = expiresAt - this.now;
    if (delay <= MAX_TIMER_MS) {
      this.#timer = setTimeout(() => this.lock(), Math.max(0, delay));
      // Do not keep Node test processes alive; browsers simply have no unref.
      const timer = this.#timer as unknown as { unref?: () => void }; timer.unref?.();
    }
  }
  /**
   * Restores a persisted unlocked session after a page load. Accepted only if it
   * belongs to the CURRENT vault record, has not expired, the key is a
   * nonextractable Ed25519 signing key and it signs a fresh challenge that the
   * record's public key verifies. Anything else clears it. Never asks for the password.
   */
  async resume(): Promise<boolean> {
    const store = this.options.session;
    if (!store || this.#key !== null) return this.#key !== null;
    const generation = this.#generation;
    let saved: Awaited<ReturnType<MainnetVaultSessionStore["load"]>> = null;
    try { saved = await store.load(); } catch { saved = null; }
    if (saved === null) return false;
    try {
      const raw = this.raw();
      if (raw === null || saved.record !== raw || !(saved.expiresAt > this.now) || saved.key.extractable ||
        saved.key.type !== "private" || saved.key.algorithm.name !== "Ed25519" || !saved.key.usages.includes("sign")) throw new Error();
      const record = parseRecord(raw);
      const pub = await this.crypto.subtle.importKey("raw", unhex(record.publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
      const challenge = this.crypto.getRandomValues(new Uint8Array(32));
      const signature = await this.crypto.subtle.sign("Ed25519", saved.key, challenge);
      if (!await this.crypto.subtle.verify("Ed25519", pub, signature, challenge)) throw new Error();
      if (generation !== this.#generation || this.#key !== null || this.raw() !== raw) return this.#key !== null;
      this.#activate(saved.key, raw, saved.expiresAt);
      return true;
    } catch {
      void store.clear().catch(() => undefined);
      return false;
    }
  }
  /** PKCS8 bytes of the key a 12-word phrase derives (caller wipes). No key export. */
  private async pkcs8FromEntropy(entropy: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const words = await entropyToPhrase(this.crypto, entropy);
    const seed = await phraseToEd25519Seed(this.crypto, words);
    words.fill("");
    try { return ed25519SeedToPkcs8(seed); } finally { seed.fill(0); }
  }
  /** Public key of a NEW phrase (creation/import only; unlock never exports a private key). */
  private async publicKeyHexOf(entropy: Uint8Array<ArrayBuffer>): Promise<string> {
    const pkcs8 = await this.pkcs8FromEntropy(entropy);
    try {
      const temporary = await this.crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
      const jwk = await this.crypto.subtle.exportKey("jwk", temporary);
      if (typeof jwk.x !== "string") throw new Error();
      const x = atob(jwk.x.replace(/-/g, "+").replace(/_/g, "/"));
      return hex(Uint8Array.from(x, (c) => c.charCodeAt(0)));
    } catch { throw new MainnetVaultError("CRYPTO_UNAVAILABLE"); }
    finally { pkcs8.fill(0); }
  }
  /** Encrypts the phrase entropy under a fresh salt/IV and persists a v2 record (locked). */
  private async sealEntropy(password: string, entropy: Uint8Array<ArrayBuffer>, accountId: string | undefined,
    generation: number, publicKeyHex?: string): Promise<MainnetWalletIdentity> {
    const derivedKey = publicKeyHex ?? await this.publicKeyHexOf(entropy);
    const salt = this.crypto.getRandomValues(new Uint8Array(16));
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const encryption = await encryptionKey(this.crypto, password, salt);
    const metadata: VaultMetadata = { version: 2, network: "near-mainnet", algorithm: "Ed25519",
      publicKeyHex: derivedKey, accountId: accountId ?? derivedKey, kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
      cipher: "AES-256-GCM", salt: hex(salt), iv: hex(iv), secret: RECOVERY_DERIVATION };
    const encrypted = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(metadata), tagLength: 128 }, encryption, entropy);
    if (generation !== this.#generation) throw new MainnetVaultError("CANCELLED");
    if (this.raw() !== null) throw new MainnetVaultError("ALREADY_EXISTS");
    const raw = JSON.stringify({ ...metadata, ciphertext: hex(new Uint8Array(encrypted)) });
    parseRecord(raw);
    this.persist(raw);
    return identity(metadata);
  }
  /** Generates a LOCAL identity from a new 12-word recovery phrase and an encrypted
   * vault, then leaves it locked. Without `accountId` the identity is the implicit
   * account of the key; with a named `Mainnet` account ID the record is bound to
   * that name (authenticated metadata). Neither creates or funds anything on chain. */
  async create(password: string, accountId?: string): Promise<MainnetWalletIdentity> {
    if (accountId !== undefined && !isNamedMainnetAccount(accountId)) throw new MainnetVaultError("INVALID_ACCOUNT_ID");
    if (this.raw() !== null) throw new MainnetVaultError("ALREADY_EXISTS");
    passwordBytes(password).fill(0);
    this.lock(); const generation = this.#generation;
    const entropy = this.crypto.getRandomValues(new Uint8Array(16));
    try { return await this.sealEntropy(password, entropy, accountId, generation); }
    finally { entropy.fill(0); }
  }
  /** Imports a 12-word recovery phrase (e.g. from another device) into empty storage,
   * locked. A named account is only a binding until a chain read proves it holds the key. */
  async restoreFromRecoveryPhrase(phrase: string | readonly string[], password: string, accountId?: string): Promise<MainnetWalletIdentity> {
    if (accountId !== undefined && !isNamedMainnetAccount(accountId)) throw new MainnetVaultError("INVALID_ACCOUNT_ID");
    if (this.raw() !== null) throw new MainnetVaultError("ALREADY_EXISTS");
    passwordBytes(password).fill(0);
    this.lock(); const generation = this.#generation;
    const words = normalizePhrase(phrase);
    const entropy = await phraseToEntropy(this.crypto, words);
    words.fill("");
    if (entropy === null) throw new MainnetVaultError("INVALID_PHRASE");
    try { return await this.sealEntropy(password, entropy, accountId, generation); }
    finally { entropy.fill(0); }
  }
  /** The 12 words, after the password is verified. Does not unlock the vault. Shown
   * only on explicit user request; the caller must not log, store or send them. */
  async revealRecoveryPhrase(password: string): Promise<string[]> {
    const raw = this.raw(); if (raw === null) throw new MainnetVaultError("INVALID_RECORD");
    if (parseRecord(raw).version !== 2) throw new MainnetVaultError("NO_RECOVERY_PHRASE");
    const out: { words?: string[] } = {};
    await this.decrypt(raw, password, async (plaintext) => { out.words = await entropyToPhrase(this.crypto, plaintext); });
    if (!out.words) throw new MainnetVaultError("BAD_PASSWORD_OR_DATA");
    return out.words;
  }
  /** Decrypts and proves the key (local challenge). `reseal` sees the raw plaintext:
   * PKCS8 for v1, phrase entropy for v2. */
  private async decrypt(raw: string, password: string,
    reseal?: (plaintext: Uint8Array<ArrayBuffer>, record: VaultRecord) => Promise<void>): Promise<{ record: VaultRecord; key: CryptoKey }> {
    const record = parseRecord(raw);
    const encryption = await encryptionKey(this.crypto, password, unhex(record.salt));
    let plaintext: Uint8Array<ArrayBuffer> | null = null;
    let pkcs8: Uint8Array<ArrayBuffer> | null = null;
    try {
      plaintext = new Uint8Array(await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(record.iv),
        additionalData: aad(metadataOf(record)), tagLength: 128 }, encryption, unhex(record.ciphertext)));
      if (record.version === 2) {
        if (plaintext.length !== 16) throw new Error();
        // The challenge below proves the derived key matches record.publicKeyHex.
        pkcs8 = await this.pkcs8FromEntropy(plaintext);
      } else pkcs8 = plaintext.slice();
      // Unlocked key is nonextractable. Never retain the passphrase or PKCS8 bytes.
      const key = await this.crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
      const pub = await this.crypto.subtle.importKey("raw", unhex(record.publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
      const challenge = this.crypto.getRandomValues(new Uint8Array(32));
      const signature = await this.crypto.subtle.sign("Ed25519", key, challenge);
      if (!await this.crypto.subtle.verify("Ed25519", pub, signature, challenge)) throw new Error();
      if (reseal) await reseal(plaintext, record);
      return { record, key };
    } catch { throw new MainnetVaultError("BAD_PASSWORD_OR_DATA"); }
    finally { plaintext?.fill(0); pkcs8?.fill(0); }
  }
  async unlock(password: string): Promise<MainnetWalletIdentity> {
    this.lock(); const generation = this.#generation;
    const raw = this.raw(); if (raw === null) throw new MainnetVaultError("INVALID_RECORD");
    const { record, key } = await this.decrypt(raw, password);
    if (generation !== this.#generation || this.raw() !== raw) throw new MainnetVaultError("CANCELLED");
    const expiresAt = this.now + this.unlockMs;
    this.#activate(key, raw, expiresAt);
    // Best effort: without persistence the unlock simply lasts for this page.
    await this.options.session?.save({ key, record: raw, expiresAt }).catch(() => undefined);
    if (generation !== this.#generation) {
      // Locked while saving: make sure the just-saved session cannot be resumed.
      await this.options.session?.clear().catch(() => undefined);
      throw new MainnetVaultError("CANCELLED");
    }
    return identity(record);
  }
  /** Re-binds the SAME key to another named `Mainnet` account ID with a fresh
   * salt and IV (the account ID is authenticated metadata). Meant for a name that
   * was never provisioned, e.g. taken by someone else before the sponsor
   * created it. Needs the passphrase, never exports the key and leaves the vault
   * locked. Callers must only offer it while the current account is NOT proven
   * on chain, otherwise the user loses the easy path back to that account. */
  async rebindAccount(password: string, accountId: string): Promise<MainnetWalletIdentity> {
    if (!isNamedMainnetAccount(accountId)) throw new MainnetVaultError("INVALID_ACCOUNT_ID");
    this.lock(); const generation = this.#generation;
    const raw = this.raw(); if (raw === null) throw new MainnetVaultError("INVALID_RECORD");
    const out: { replacement?: string } = {};
    await this.decrypt(raw, password, async (plaintext, record) => {
      const salt = this.crypto.getRandomValues(new Uint8Array(16));
      const iv = this.crypto.getRandomValues(new Uint8Array(12));
      const encryption = await encryptionKey(this.crypto, password, salt);
      const metadata: VaultMetadata = { ...metadataOf(record), accountId, salt: hex(salt), iv: hex(iv) };
      const encrypted = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(metadata), tagLength: 128 }, encryption, plaintext);
      out.replacement = JSON.stringify({ ...metadata, ciphertext: hex(new Uint8Array(encrypted)) });
    });
    if (out.replacement === undefined) throw new MainnetVaultError("BAD_PASSWORD_OR_DATA");
    if (generation !== this.#generation || this.raw() !== raw) throw new MainnetVaultError("CANCELLED");
    const record = parseRecord(out.replacement);
    this.persist(out.replacement); return identity(record);
  }
  exportEncryptedBackup(): string {
    const raw = this.raw(); if (raw === null) throw new MainnetVaultError("INVALID_RECORD");
    parseRecord(raw); return raw;
  }
  async restoreEncryptedBackup(raw: string, password: string): Promise<MainnetWalletIdentity> {
    if (this.raw() !== null) throw new MainnetVaultError("ALREADY_EXISTS");
    this.lock(); const generation = this.#generation;
    const { record } = await this.decrypt(raw, password);
    if (generation !== this.#generation || this.raw() !== null) throw new MainnetVaultError("CANCELLED");
    this.persist(JSON.stringify(record)); return identity(record); // recovery always locked
  }
  async #signTransaction(tx: Transaction) {
    if (!this.unlocked || this.#key === null || this.#key.extractable) throw new MainnetVaultError("LOCKED");
    const owner = this;
    const generation = this.#generation;
    const local = this.getIdentity();
    if (!local || tx.signerId !== local.accountId || tx.publicKey.keyType !== 0 ||
      hex(tx.publicKey.data) !== local.publicKeyHex) throw new MainnetVaultError("INVALID_RECORD");
    const publicKey = PublicKey.from(tx.publicKey.toString());
    const signer = new class extends Signer {
      async getPublicKey() { return publicKey; }
      protected async signBytes(bytes: Uint8Array): Promise<Uint8Array> {
        if (!owner.unlocked || owner.#key === null || generation !== owner.#generation) throw new MainnetVaultError("CANCELLED");
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
      throw new MainnetVaultError("CANCELLED");
    if (!this.unlocked || generation !== this.#generation) throw new MainnetVaultError("CANCELLED");
    return { ...result, assertActive: () => {
      if (!this.unlocked || generation !== this.#generation) throw new MainnetVaultError("CANCELLED");
    } };
  }
}
