import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AmountSchema, U64Schema, U128Schema, AccountIdSchema, IntentTermsSchema,
  calculateRequestId, calculateTermsHash, calculateSessionCommitment, comparisonCode,
  canonicalJson, parseStrictJson, parseIntentTermsJson, U64_MAX, U128_MAX,
} from "../dist/index.js";

const read = (file) => readFileSync(new URL(`../test-vectors/${file}`, import.meta.url));
const a = parseIntentTermsJson(read("intent-a.json"));
const b = parseIntentTermsJson(read("intent-b.json"));
const expected = JSON.parse(read("expected.json"));
const identity = ({ contractId, creationNonce, creatorAccountId, network }) =>
  ({ contractId, creationNonce, creatorAccountId, network });
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");

for (const [name, terms] of [["a", a], ["b", b]]) {
  test(`frozen ${name.toUpperCase()} fixture matches all hashes and comparison code`, () => {
    assert.equal(calculateRequestId(identity(terms)), expected.requestId);
    assert.equal(canonicalJson(terms), read(`intent-${name}.canonical.json`).toString("utf8"));
    assert.equal(calculateTermsHash(terms), expected[name].termsHash);
    assert.equal(calculateSessionCommitment(terms), expected[name].sessionCommitment);
    assert.equal(comparisonCode(expected[name].sessionCommitment), expected[name].comparisonCode);
    // Independent platform SHA-256 confirms the exact LF and ASCII-hex preimages.
    assert.equal(hash(`taply.terms.v1\n${canonicalJson(terms)}`), expected[name].termsHash);
    assert.equal(hash(`taply.session.v1\n${expected[name].termsHash}`), expected[name].sessionCommitment);
  });
}

test("fixture B changes only amount, not deterministic request ID", () => {
  assert.deepEqual(b, { ...a, amountBaseUnits: (BigInt(a.amountBaseUnits) + 1n).toString() });
  assert.notEqual(calculateTermsHash(a), calculateTermsHash(b));
});

test("object key order and whitespace do not change terms hash", () => {
  const reversed = Object.fromEntries(Object.entries(a).reverse());
  reversed.sessionBinding = Object.fromEntries(Object.entries(a.sessionBinding).reverse());
  assert.equal(calculateTermsHash(parseIntentTermsJson(JSON.stringify(reversed, null, 4))), expected.a.termsHash);
});

for (const amount of ["0", "01", "-1", "+1", "1.0", "1e24", " 1", "1 ", "", "١", 1, null, (U128_MAX + 1n).toString(), "1".repeat(10000)]) {
  test(`reject invalid amount ${String(amount).slice(0, 45)}`, () => {
    assert.equal(AmountSchema.safeParse(amount).success, false);
    assert.equal(IntentTermsSchema.safeParse({ ...a, amountBaseUnits: amount }).success, false);
  });
}

test("integer boundaries remain exact above Number.MAX_SAFE_INTEGER", () => {
  assert.equal(U64Schema.parse(U64_MAX.toString()), U64_MAX.toString());
  assert.equal(U128Schema.parse(U128_MAX.toString()), U128_MAX.toString());
  assert.equal(U64Schema.safeParse((U64_MAX + 1n).toString()).success, false);
  assert.equal(AmountSchema.parse("9007199254740993"), "9007199254740993");
});

for (const raw of [
  '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"x":1,"x":2}}',
  '{"rows":[{"x":1,"x":2}]}', '{"__proto__":1,"__proto__":2}',
  '{"a":1,}', '{/*comment*/"a":1}', '[1,]', '', '{}{}', '{"a":NaN}',
  '{"a":1e400}', '{"memo":"\\ud800"}', '{"\\udc00":1}', '\uFEFF{}',
]) {
  test(`strict JSON rejects ${raw.slice(0, 50)}`, () => assert.throws(() => parseStrictJson(raw)));
}

test("UTF-8 boundary rejects invalid bytes, excessive nesting, and excessive size", () => {
  assert.throws(() => parseStrictJson(new Uint8Array([0xc3, 0x28])));
  assert.throws(() => parseStrictJson("[".repeat(33) + "0" + "]".repeat(33)), /DEPTH_LIMIT/);
  assert.throws(() => parseStrictJson(" ".repeat(65537)), /SIZE_LIMIT/);
  assert.deepEqual(parseStrictJson('{"a":{"x":1},"b":{"x":2}}'), { a: { x: 1 }, b: { x: 2 } });
});

test("unknown fields and omitted nullable fields reject before hashing", () => {
  assert.throws(() => calculateTermsHash({ ...a, paid: true }));
  assert.throws(() => calculateTermsHash({ ...a, sessionBinding: { ...a.sessionBinding, token: "secret" } }));
  const { memo: ignored, ...missing } = a;
  assert.equal(typeof ignored, "string");
  assert.throws(() => calculateTermsHash(missing));
  assert.throws(() => calculateRequestId({ ...identity(a), amountBaseUnits: "1" }));
});

test("duplicate amount is rejected before an ordinary JSON parser could erase it", () => {
  const raw = read("intent-a.json").toString().replace('"amountBaseUnits":', '"amountBaseUnits":"1","amountBaseUnits":');
  assert.throws(() => parseIntentTermsJson(raw), /DUPLICATE_KEY/);
});

test("no Unicode normalization; memo limit is UTF-8 bytes", () => {
  assert.notEqual(calculateTermsHash({ ...a, memo: "é" }), calculateTermsHash({ ...a, memo: "e\u0301" }));
  assert.equal(IntentTermsSchema.safeParse({ ...a, memo: "😀".repeat(64) }).success, true);
  assert.equal(IntentTermsSchema.safeParse({ ...a, memo: "😀".repeat(65) }).success, false);
  assert.equal(IntentTermsSchema.safeParse({ ...a, memo: "\ud800" }).success, false);
});

test("hashes bind session, mode, amount, account, and payer restriction", () => {
  for (const update of [
    { sessionBinding: { ...a.sessionBinding, nonce: "a".repeat(64) } },
    { permittedPayerAccountId: "bob.testnet" },
    { mode: "instant", cancelDurationNs: null },
    { cancelDurationNs: "61000000000" },
    { fundingExpiresAtNs: "1793520900000000001" },
  ]) assert.notEqual(calculateTermsHash({ ...a, ...update }), expected.a.termsHash);
  assert.throws(() => calculateTermsHash({ ...a, id: "f".repeat(64) }));
  assert.throws(() => calculateTermsHash({ ...a, network: "near-mainnet" }));
  assert.throws(() => calculateTermsHash({ ...a, merchantAccountId: "mallory.testnet" }));
});

test("Instant/no-session terms have no cancellation or comparison commitment", () => {
  const instant = { ...a, mode: "instant", cancelDurationNs: null, sessionBinding: null };
  assert.equal(calculateSessionCommitment(instant), null);
  assert.throws(() => calculateTermsHash({ ...instant, cancelDurationNs: "60000000000" }));
  assert.throws(() => calculateTermsHash({ ...a, mode: "milestone" }));
  assert.throws(() => calculateTermsHash({ ...a, assetId: "nep141:fake.testnet" }));
});

for (const duration of [null, "0", "59999999999", "3600000000001", "bad"]) {
  test(`reject protected duration ${duration}`, () => {
    assert.equal(IntentTermsSchema.safeParse({ ...a, cancelDurationNs: duration }).success, false);
  });
}

test("maximum Protected duration and account syntax", () => {
  assert.equal(IntentTermsSchema.safeParse({ ...a, cancelDurationNs: "3600000000000" }).success, true);
  for (const id of ["alice.testnet", "a-b_c.testnet", "f".repeat(64)]) assert.equal(AccountIdSchema.safeParse(id).success, true);
  for (const id of ["a", "Alice.testnet", ".alice", "alice..testnet", "a-_b", "x".repeat(65)]) assert.equal(AccountIdSchema.safeParse(id).success, false);
});
