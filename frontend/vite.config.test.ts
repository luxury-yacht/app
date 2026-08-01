/**
 * frontend/vite.config.test.ts
 *
 * Protects development-server configuration required by lazy-loaded features.
 */

import { describe, expect, it, vi } from 'vitest';

const sentryPluginMock = vi.hoisted(() => vi.fn(() => [{ name: 'sentry-vite-plugin' }]));

vi.mock('@sentry/vite-plugin', () => ({ sentryVitePlugin: sentryPluginMock }));

import { createViteConfig } from './vite.config';

describe('Vite configuration', () => {
  it('pre-bundles the object-map renderer dependency', () => {
    const config = createViteConfig({}, 'serve');

    expect(config.optimizeDeps?.include).toContain('@antv/g6');
  });

  it('disables the Sentry build integration while serving development', () => {
    sentryPluginMock.mockClear();

    const config = createViteConfig(
      {
        SENTRY_AUTH_TOKEN: 'token',
        SENTRY_ORG: 'luxury-yacht',
        SENTRY_PROJECT: 'desktop-frontend',
      },
      'serve'
    );

    expect(config.build?.sourcemap).toBe(false);
    expect(config.define?.__SENTRY_RELEASE__).toBe(JSON.stringify(''));
    expect(sentryPluginMock).not.toHaveBeenCalled();
  });

  it('enables private source-map upload only with complete Sentry build credentials', () => {
    sentryPluginMock.mockClear();

    const disabled = createViteConfig({}, 'build');
    expect(disabled.build?.sourcemap).toBe(false);
    expect(sentryPluginMock).not.toHaveBeenCalled();

    const enabled = createViteConfig(
      {
        SENTRY_AUTH_TOKEN: 'token',
        SENTRY_ORG: 'luxury-yacht',
        SENTRY_PROJECT: 'desktop-frontend',
      },
      'build'
    );
    expect(enabled.build?.sourcemap).toBe('hidden');
    expect(sentryPluginMock).toHaveBeenCalledWith({
      authToken: 'token',
      org: 'luxury-yacht',
      project: 'desktop-frontend',
      release: { name: 'luxury-yacht@v1.11.2' },
      sourcemaps: { filesToDeleteAfterUpload: './dist/**/*.map' },
      bundleSizeOptimizations: { excludeTracing: true },
      telemetry: false,
    });
    expect(enabled.define?.__SENTRY_RELEASE__).toBe(JSON.stringify('luxury-yacht@v1.11.2'));
  });
});
