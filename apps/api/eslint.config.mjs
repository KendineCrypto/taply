// Reuse installed tooling without adding dependencies or editing workspace manifests.
import tseslint from '../web/node_modules/typescript-eslint/dist/index.js';
export default [
  ...tseslint.configs.recommended,
  { files: ['**/test/*.mts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
];
