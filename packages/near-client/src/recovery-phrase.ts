import { BIP39_ENGLISH } from "./bip39-english.js";

/**
 * 12-word Secret Recovery Phrase (BIP-39, English) and its NEAR Ed25519 key
 * (SLIP-10, path m/44'/397'/0' — the same derivation as MyNearWallet, Meteor
 * and near-seed-phrase, so the phrase can be imported into those wallets).
 * Web Crypto only; callers wipe the returned byte arrays.
 */
export const RECOVERY_DERIVATION = "BIP39-12/SLIP10-m/44'/397'/0'" as const;
export const RECOVERY_WORDS = 12;
const PATH = [44, 397, 0];
const encoder = new TextEncoder();

async function sha256(crypto: Crypto, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
async function hmacSha512(crypto: Crypto, key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** 16 bytes of entropy -> 12 words (4-bit SHA-256 checksum). */
export async function entropyToPhrase(crypto: Crypto, entropy: Uint8Array<ArrayBuffer>): Promise<string[]> {
  if (entropy.length !== 16) throw new Error("entropy");
  const checksum = (await sha256(crypto, entropy))[0]! >> 4;
  let bits = 0n;
  for (const byte of entropy) bits = (bits << 8n) | BigInt(byte);
  bits = (bits << 4n) | BigInt(checksum);
  const words: string[] = [];
  for (let i = RECOVERY_WORDS - 1; i >= 0; i--) words.push(BIP39_ENGLISH[Number((bits >> BigInt(i * 11)) & 2047n)]!);
  return words;
}

/** Lower-cases and splits on any whitespace. */
export function normalizePhrase(input: string | readonly string[]): string[] {
  const text = typeof input === "string" ? input : input.join(" ");
  return text.trim().toLowerCase().split(/\s+/).filter((w) => w !== "");
}

/** 12 known words with a valid checksum -> entropy, otherwise null. */
export async function phraseToEntropy(crypto: Crypto, words: readonly string[]): Promise<Uint8Array<ArrayBuffer> | null> {
  if (words.length !== RECOVERY_WORDS) return null;
  let bits = 0n;
  for (const word of words) {
    const index = BIP39_ENGLISH.indexOf(word);
    if (index < 0) return null;
    bits = (bits << 11n) | BigInt(index);
  }
  const checksum = Number(bits & 15n);
  let value = bits >> 4n;
  const entropy = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { entropy[i] = Number(value & 255n); value >>= 8n; }
  if (((await sha256(crypto, entropy))[0]! >> 4) !== checksum) { entropy.fill(0); return null; }
  return entropy;
}

/** BIP-39 seed (no extra passphrase) -> SLIP-10 Ed25519 private seed at m/44'/397'/0'. */
export async function phraseToEd25519Seed(crypto: Crypto, words: readonly string[]): Promise<Uint8Array<ArrayBuffer>> {
  const mnemonic = encoder.encode(words.join(" ").normalize("NFKD"));
  let seed: Uint8Array<ArrayBuffer> | null = null;
  try {
    const material = await crypto.subtle.importKey("raw", mnemonic, "PBKDF2", false, ["deriveBits"]);
    seed = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: encoder.encode("mnemonic"), iterations: 2048 }, material, 512));
    let node = await hmacSha512(crypto, encoder.encode("ed25519 seed"), seed);
    for (const index of PATH) {
      const data = new Uint8Array(37);
      data.set(node.subarray(0, 32), 1);
      new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0);
      const next = await hmacSha512(crypto, node.slice(32), data);
      data.fill(0); node.fill(0); node = next;
    }
    const key = node.slice(0, 32); node.fill(0);
    return key;
  } finally { mnemonic.fill(0); seed?.fill(0); }
}

const PKCS8_ED25519_PREFIX = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
/** Wraps a 32-byte Ed25519 private seed for Web Crypto `importKey("pkcs8")`. */
export function ed25519SeedToPkcs8(seed: Uint8Array): Uint8Array<ArrayBuffer> {
  if (seed.length !== 32) throw new Error("seed");
  const out = new Uint8Array(48);
  out.set(PKCS8_ED25519_PREFIX); out.set(seed, 16);
  return out;
}

/** Public key (hex) a phrase controls, or null for an invalid phrase. Lets a caller
 * check an account on chain before importing; the private bytes are wiped. */
export async function recoveryPhrasePublicKeyHex(crypto: Crypto, phrase: string | readonly string[]): Promise<string | null> {
  const words = normalizePhrase(phrase);
  const valid = await phraseToEntropy(crypto, words);
  if (valid === null) return null;
  valid.fill(0);
  const seed = await phraseToEd25519Seed(crypto, words);
  words.fill("");
  const pkcs8 = ed25519SeedToPkcs8(seed); seed.fill(0);
  try {
    const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    if (typeof jwk.x !== "string") return null;
    const x = atob(jwk.x.replace(/-/g, "+").replace(/_/g, "/"));
    return Array.from(x, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  } finally { pkcs8.fill(0); }
}
