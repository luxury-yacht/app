import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';

const tsconfigDir = new URL('.', import.meta.url).pathname;

export default [
  {
    ignores: ['dist/**'],
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
      import: importPlugin,
      'react-hooks': reactHooks,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
    rules: {
      'import/no-unused-modules': [
        'warn',
        {
          missingExports: false,
          unusedExports: true,
          src: ['src/shared/components/kubernetes/**/*.{ts,tsx}'],
        },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Use the refresh orchestrator client instead of direct fetch calls.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch']",
          message: 'Use the refresh orchestrator client instead of direct fetch calls.',
        },
      ],
    },
  },
  {
    files: ['src/core/refresh/client.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
