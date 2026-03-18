import type { StorybookConfig } from '@storybook/react-vite';
import path from 'path';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: '@storybook/react-vite',
  addons: ['@storybook/addon-essentials'],
  viteFinal: async (config) => {
    config.resolve = config.resolve || {};
    // Only alias @wailsjs/go/models — the mock replaces the generated classes
    // with browser-compatible versions (no window.go dependency).
    // The runtime and backend App .js files are NOT aliased; they delegate to
    // window.runtime.* and window.go.*, which are stubbed in preview.ts.
    config.resolve.alias = {
      '@wailsjs/go/models': path.resolve(__dirname, './mocks/wailsModels.ts'),
      ...config.resolve.alias,
    };
    return config;
  },
};

export default config;
