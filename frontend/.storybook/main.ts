import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: '@storybook/react-vite',
  viteFinal: async (viteConfig) => {
    viteConfig.resolve = viteConfig.resolve || {};
    // Only alias @wailsjs/go/models — the mock replaces the generated classes
    // with browser-compatible versions (no window.go dependency).
    // The runtime and backend App .js files are NOT aliased; they delegate to
    // window.runtime.* and window.go.*, which are stubbed in preview.ts.
    viteConfig.resolve.alias = {
      '@wailsjs/go/models': path.resolve(__dirname, './mocks/wailsModels.ts'),
      ...viteConfig.resolve.alias,
    };
    return viteConfig;
  },
};

export default config;
