/**
 * frontend/vite.config.ts
 *
 * Configures the Vite dev/test build and frontend aliases, including
 * backend-owned JSON contracts consumed by TypeScript.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import wails from '@wailsio/runtime/plugins/vite';
import { defineConfig, type UserConfig } from 'vite';
import { parse } from 'yaml';

interface WailsBuildConfig {
  info: {
    version: string;
  };
}

const configDirectory = import.meta.dirname;
const wailsBuildConfig = parse(
  readFileSync(path.resolve(configDirectory, '../build/config.yml'), 'utf8')
) as WailsBuildConfig;
const sentryRelease = `luxury-yacht@${wailsBuildConfig.info.version}`;

const configuredValue = (environment: NodeJS.ProcessEnv, name: string) =>
  environment[name]?.trim() ?? '';

export function createViteConfig(
  environment: NodeJS.ProcessEnv = process.env,
  command: 'build' | 'serve' = 'serve',
  mode = command === 'build' ? 'production' : 'development'
): UserConfig {
  const productionBuild = mode === 'production';
  const authToken = configuredValue(environment, 'SENTRY_AUTH_TOKEN');
  const frontendDSN = configuredValue(environment, 'SENTRY_FRONTEND_DSN');
  const org = configuredValue(environment, 'SENTRY_ORG');
  const project = configuredValue(environment, 'SENTRY_FRONTEND_PROJECT');
  const uploadSentrySourceMaps = Boolean(productionBuild && authToken && org && project);
  const sentryPlugins = uploadSentrySourceMaps
    ? sentryVitePlugin({
        authToken,
        org,
        project,
        release: { name: sentryRelease },
        sourcemaps: { filesToDeleteAfterUpload: './dist/**/*.map' },
        bundleSizeOptimizations: { excludeTracing: true },
        // Defaults to true, which reports this plugin's own build errors and
        // timings to Sentry's servers on every release build.
        telemetry: false,
      })
    : [];

  return {
    plugins: [react(), wails('./bindings'), ...sentryPlugins],
    define: {
      __SENTRY_ENABLED__: JSON.stringify(productionBuild),
      __SENTRY_FRONTEND_DSN__: JSON.stringify(productionBuild ? frontendDSN : ''),
      __SENTRY_RELEASE__: JSON.stringify(productionBuild ? sentryRelease : ''),
    },
    server: {
      host: '127.0.0.1',
      port: Number(environment.WAILS_VITE_PORT) || 9245,
      strictPort: true,
    },
    envPrefix: ['VITE_', 'ENABLE_', 'ERROR_'],
    optimizeDeps: {
      include: ['@antv/g6'],
    },
    build: {
      outDir: 'dist',
      sourcemap: uploadSentrySourceMaps ? 'hidden' : false,
    },
    resolve: {
      alias: {
        '@': path.resolve(configDirectory, './src'),

        // Module aliases
        '@modules': path.resolve(configDirectory, './src/modules'),
        '@modules/cluster': path.resolve(configDirectory, './src/modules/cluster'),
        '@modules/namespace': path.resolve(configDirectory, './src/modules/namespace'),
        '@modules/kubernetes': path.resolve(configDirectory, './src/modules/kubernetes'),
        '@modules/object-panel': path.resolve(configDirectory, './src/modules/object-panel'),

        // UI aliases
        '@ui': path.resolve(configDirectory, './src/ui'),
        '@ui/layout': path.resolve(configDirectory, './src/ui/layout'),
        '@ui/navigation': path.resolve(configDirectory, './src/ui/navigation'),
        '@ui/command-palette': path.resolve(configDirectory, './src/ui/command-palette'),
        '@ui/shortcuts': path.resolve(configDirectory, './src/ui/shortcuts'),

        // Shared aliases (NEW location)
        '@shared': path.resolve(configDirectory, './src/shared'),
        '@shared/components': path.resolve(configDirectory, './src/shared/components'),
        '@shared/hooks': path.resolve(configDirectory, './src/shared/hooks'),
        '@shared/utils': path.resolve(configDirectory, './src/shared/utils'),

        // Styles alias
        '@styles': path.resolve(configDirectory, './styles'),

        // Core aliases
        '@core': path.resolve(configDirectory, './src/core'),
        '@core/contexts': path.resolve(configDirectory, './src/core/contexts'),

        // Remaining aliases
        '@hooks': path.resolve(configDirectory, './src/hooks'),
        '@types': path.resolve(configDirectory, './src/types'),
        '@utils': path.resolve(configDirectory, './src/utils'),
        '@contexts': path.resolve(configDirectory, './src/core/contexts'),
        '@assets': path.resolve(configDirectory, './src/assets'),
        '@bindings': path.resolve(configDirectory, './bindings'),

        // Backend-owned shared contracts
        '@yaml-field-policy-contract': path.resolve(
          configDirectory,
          '../backend/objectyaml/field-policy-contract.json'
        ),
        '@builtin-resource-identities': path.resolve(
          configDirectory,
          '../backend/resourcecontract/builtin-resource-identities.json'
        ),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './vitest.setup.ts',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json-summary'],
        reportsDirectory: 'coverage',
        exclude: ['**/*.css'],
      },
    },
  };
}

export default defineConfig(({ command, mode }) => createViteConfig(process.env, command, mode));
