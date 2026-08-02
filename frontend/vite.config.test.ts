/**
 * frontend/vite.config.test.ts
 *
 * Protects development-server configuration required by lazy-loaded features.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const sentryPluginMock = vi.hoisted(() => vi.fn(() => [{ name: 'sentry-vite-plugin' }]));

vi.mock('@sentry/vite-plugin', () => ({ sentryVitePlugin: sentryPluginMock }));

import { createViteConfig } from './vite.config';

interface WailsConfig {
  info: {
    productVersion: string;
  };
}

const wailsConfig = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../wails.json'), 'utf8')
) as WailsConfig;
const expectedSentryRelease = `luxury-yacht@${wailsConfig.info.productVersion}`;

describe('Vite configuration', () => {
  it('pre-bundles the object-map renderer dependency', () => {
    const config = createViteConfig({}, 'serve');

    expect(config.optimizeDeps?.include).toContain('@antv/g6');
  });

  it('disables the Sentry build integration while serving development', () => {
    sentryPluginMock.mockClear();

    const config = createViteConfig(
      {
        NODE_ENV: 'production',
        SENTRY_AUTH_TOKEN: 'token',
        SENTRY_FRONTEND_DSN: 'https://public@example.com/1',
        SENTRY_ORG: 'luxury-yacht',
        SENTRY_FRONTEND_PROJECT: 'desktop-frontend',
      },
      'serve'
    );

    expect(config.build?.sourcemap).toBe(false);
    expect(config.define?.__SENTRY_ENABLED__).toBe(JSON.stringify(false));
    expect(config.define?.__SENTRY_FRONTEND_DSN__).toBe(JSON.stringify(''));
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
        SENTRY_FRONTEND_DSN: 'https://public@example.com/1',
        SENTRY_ORG: 'luxury-yacht',
        SENTRY_FRONTEND_PROJECT: 'desktop-frontend',
      },
      'build'
    );
    expect(enabled.build?.sourcemap).toBe('hidden');
    expect(sentryPluginMock).toHaveBeenCalledWith({
      authToken: 'token',
      org: 'luxury-yacht',
      project: 'desktop-frontend',
      release: { name: expectedSentryRelease },
      sourcemaps: { filesToDeleteAfterUpload: './dist/**/*.map' },
    });
    expect(enabled.define?.__SENTRY_ENABLED__).toBe(JSON.stringify(true));
    expect(enabled.define?.__SENTRY_FRONTEND_DSN__).toBe(
      JSON.stringify('https://public@example.com/1')
    );
    expect(enabled.define?.__SENTRY_RELEASE__).toBe(JSON.stringify(expectedSentryRelease));
  });
});
