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
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@wailsjs/go/backend/App',
              importNames: [
                'EvaluateCapabilities',
                'FindCatalogObjectByUID',
                'FindCatalogObjectMatch',
                'GetAllClusterAuthStates',
                'GetAllClusterLifecycleStates',
                'GetAppInfo',
                'GetAppSettings',
                'GetClusterPortForwardCount',
                'GetKubeconfigSearchPaths',
                'GetKubeconfigs',
                'GetLogScopeContainers',
                'GetLogs',
                'GetObjectYAMLByGVK',
                'GetPodContainers',
                'GetRefreshBaseURL',
                'GetRevisionHistory',
                'GetSelectedKubeconfigs',
                'GetSelectionDiagnostics',
                'GetShellSessionBacklog',
                'GetTargetPorts',
                'GetThemeInfo',
                'GetThemes',
                'GetZoomLevel',
                'IsWorkloadHPAManaged',
                'ListPortForwards',
                'ListShellSessions',
              ],
              message:
                'Route read-only backend bindings through appStateAccess/dataAccess adapters instead of importing them directly.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='GetAllClusterLifecycleStates']",
          message:
            'Route lifecycle state reads through appStateAccess adapters instead of calling runtime methods directly.',
        },
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Use the refresh orchestrator client instead of direct fetch calls.',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch']",
          message: 'Use the refresh orchestrator client instead of direct fetch calls.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='fetchScopedDomain']",
          message:
            'Route read requests through dataAccess instead of calling fetchScopedDomain directly.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='triggerManualRefreshForContext']",
          message:
            'Route contextual refreshes through dataAccess instead of calling triggerManualRefreshForContext directly.',
        },
      ],
    },
  },
  {
    files: [
      'src/core/app-state-access/readers.ts',
      'src/core/data-access/readers.ts',
      'src/core/capabilities/store.ts',
      'src/core/refresh/client.ts',
      'src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/core/refresh/**/*', 'src/core/data-access/**/*'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
