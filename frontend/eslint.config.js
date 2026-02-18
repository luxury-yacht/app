import { fileURLToPath } from 'node:url';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

const tsconfigDir = fileURLToPath(new URL('.', import.meta.url));

export default [
  {
    ignores: ['dist/**', 'wailsjs/**'],
  },
  {
    files: ['eslint.config.js', 'vite.config.ts', 'vitest.setup.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        tsconfigRootDir: tsconfigDir,
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Use the refresh orchestrator client instead of direct fetch calls.',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch']",
          message: 'Use the refresh orchestrator client instead of direct fetch calls.',
        },
      ],
    },
  },
  {
    files: ['src/core/refresh/client.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
