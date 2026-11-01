import { describe, expect, it } from 'vitest';
import { requestIdFromPayLink } from '../pay-link';

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';

describe('requestIdFromPayLink', () => {
  it('accepts a pay link from any host, keeping only the request ID', () => {
    expect(requestIdFromPayLink(`https://taply.example/pay/${ID}`)).toBe(ID);
    expect(requestIdFromPayLink(`  http://localhost:3000/pay/${ID}/  `)).toBe(ID);
  });

  it('accepts a bare request ID', () => {
    expect(requestIdFromPayLink(ID)).toBe(ID);
  });

  it('rejects anything that is not exactly a request link', () => {
    for (const text of [
      '',
      'hello',
      `https://taply.example/receipt/${ID}`,
      `https://taply.example/pay/${ID}/extra`,
      `https://taply.example/pay/${ID.slice(1)}`,
      `https://taply.example/pay/${ID.toUpperCase()}`,
      `javascript:alert(1)//pay/${ID}`,
      `ftp://taply.example/pay/${ID}`,
    ]) {
      expect(requestIdFromPayLink(text), text).toBeNull();
    }
  });
});
