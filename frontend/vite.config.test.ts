/**
 * frontend/vite.config.test.ts
 *
 * Protects development-server configuration required by lazy-loaded features.
 */

import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import viteConfig from './vite.config';

describe('Vite configuration', () => {
  it('pre-bundles the object-map renderer dependency', () => {
    const config = viteConfig as UserConfig;

    expect(config.optimizeDeps?.include).toContain('@antv/g6');
  });
});
