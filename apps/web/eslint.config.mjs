import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships native flat configs, so no @eslint/eslintrc
 * FlatCompat shim is needed (and the shim in fact crashes under ESLint 10).
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    rules: {
      /**
       * SECURITY.md section 5 / freeze section 3: chain amounts are u128
       * base-unit decimal strings and nanosecond timestamps are decimal strings.
       * Any float conversion on those is a correctness bug, so the primitives
       * are banned outright and the one module allowed to use them is exempted
       * below.
       */
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Chain amounts are base-unit strings. Use lib/format/amount.ts (BigInt).',
        },
        {
          name: 'parseInt',
          message: 'Chain amounts and ns timestamps are decimal strings. Use BigInt.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='Number']",
          message:
            'Never convert a chain amount or ns timestamp with Number(). Use BigInt and lib/format.',
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
    /**
     * The formatter and the time module convert to primitives deliberately, at
     * the display boundary only. Tests assert on those conversions.
     */
    files: ['src/lib/format/**', 'src/lib/**/__tests__/**', 'scripts/**'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off' },
  },
];

export default config;
