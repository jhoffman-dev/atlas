// Flat config. The "architecture" block is the dependency rule from CLAUDE.md made mechanical:
// domain depends on nothing, application on domain, adapters on both, presentation on application.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Every layer that must stay out of a given layer's imports. */
const forbidden = {
  domain: ['@atlas/application', '@atlas/adapters', '@atlas/ui', 'react*', '@tauri-apps/*'],
  application: ['@atlas/adapters', '@atlas/ui', 'react*', '@tauri-apps/*'],
  adapters: ['@atlas/ui', 'react*'],
  ui: ['@atlas/adapters'],
};

const architecture = Object.entries(forbidden).map(([layer, patterns]) => ({
  files: [`packages/${layer}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: patterns.map((group) => ({
          group: [group],
          message: `packages/${layer} must not import ${group} — dependencies point inward.`,
        })),
      },
    ],
  },
}));

export default tseslint.config(
  {
    // `.claude/worktrees` holds whole copies of this repo while an agent works
    // in one. Linting them resolves files against the wrong tsconfig root and
    // buries the real output in hundreds of parse errors.
    ignores: [
      '**/dist/**',
      '**/target/**',
      '**/coverage/**',
      '**/src-tauri/gen/**',
      '.claude/**',
      'design/out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['packages/ui/**/*.tsx', 'apps/**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: react.configs.flat.recommended.languageOptions,
    // Pinned rather than detected: eslint-plugin-react 7.37's detection breaks on ESLint 10.
    settings: { react: { version: '19.3' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      // The automatic JSX runtime makes the React import unnecessary.
      'react/react-in-jsx-scope': 'off',
    },
  },
  ...architecture,
  {
    // The MCP server is a translator onto the local API (ADR-0016): it may know
    // the contract's types and nothing else of the app — no rules, no I/O code.
    files: ['apps/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@atlas/application'],
              allowTypeImports: true,
              message: 'apps/mcp may import only types from @atlas/application — the API contract.',
            },
            ...['@atlas/domain', '@atlas/adapters', '@atlas/ui', 'react*', '@tauri-apps/*'].map(
              (group) => ({
                group: [group],
                message: `apps/mcp must not import ${group} — it speaks the API, not the app.`,
              }),
            ),
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tools/**/*.{mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
);
