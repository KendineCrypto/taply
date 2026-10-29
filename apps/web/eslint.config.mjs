import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Protocol Freeze v1 §9 / SECURITY.md §5: chain amounts are u128 base-unit
      // decimal strings. Number()/parseFloat on money is a correctness bug.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Chain amounts are base-unit strings. Use lib/format/amount.ts (BigInt).' },
        { name: 'parseInt', message: 'Chain amounts/timestamps are decimal strings. Use BigInt.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='Number']",
          message: 'Never convert chain amounts or ns timestamps with Number(). Use BigInt + lib/format.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='round']",
          message: 'Rounding money is forbidden. Format base units exactly via lib/format/amount.ts.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Formatter and its tests legitimately need numeric primitives internally.
    files: ['src/lib/format/**', 'src/lib/**/__tests__/**'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off' },
  },
];
