import { fileURLToPath } from 'node:url';
// Core-owned tests exercise the unchanged frontend verifier.
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../../apps/web/src', import.meta.url)) } },
  test: { environment: 'node', include: ['*.test.ts'] },
};
