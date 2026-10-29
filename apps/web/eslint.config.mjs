import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Lint stack notes (Phase 0.5).
 *
 * `eslint-config-next` is deliberately NOT used. It pulls in
 * `eslint-import-resolver-typescript` -> `unrs-resolver`, a package with a
 * native postinstall build. The root workspace does not allow unapproved build
 * scripts, so installing it made every pnpm command fail with
 * ERR_PNPM_IGNORED_BUILDS until `pnpm-workspace.yaml` was edited - and that file
 * belongs to Codex. Composing the Next plugin with typescript-eslint directly
 * keeps the same rules that matter here with no native build and no root change.
 *
 * `eslint-plugin-jsx-a11y` and `eslint-plugin-react` are also absent: both peer
 * at `eslint@^9` only, the whole ESLint 9 line is end-of-life, and the root
 * workspace sets `strictPeerDependencies: true`. See apps/web/README.md
 * "Unresolved dependencies" - the a11y rules come back when the plugin supports
 * ESLint 10.
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'] },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,

      /**
       * SECURITY.md section 5 / freeze section 3: chain amounts are u128
       * base-unit decimal strings and nanosecond timestamps are decimal strings.
       * Any float conversion on those is a correctness bug, so the primitives
       * are banned outright and the modules allowed to use them are exempted
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
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  {
    /**
     * The formatter and time module convert to primitives deliberately, at the
     * display boundary only. Tests assert on those conversions.
     */
    files: ['src/lib/format/**', 'src/lib/**/__tests__/**', 'scripts/**'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

export default config;
