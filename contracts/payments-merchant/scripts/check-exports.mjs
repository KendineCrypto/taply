import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const abi = JSON.parse(readFileSync(new URL('../abi.merchant-v1.json', import.meta.url), 'utf8'));
const module = new WebAssembly.Module(readFileSync(new URL('../artifacts/merchant-v1/payments.wasm', import.meta.url)));
const names = WebAssembly.Module.exports(module).filter(e => e.kind === 'function').map(e => e.name).sort();
assert.deepEqual(names, abi.methods.map(m => m.name).sort());
console.log(`UNAPPROVED candidate WASM exports exactly ${names.length} documented methods; no disabled or administrative methods`);
