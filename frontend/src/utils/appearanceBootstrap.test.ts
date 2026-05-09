/**
 * frontend/src/utils/appearanceBootstrap.test.ts
 *
 * Tests for the precomputed appearance bootstrap payload used by index.html.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APPEARANCE_BOOTSTRAP_STORAGE_KEY,
  buildAppearanceBootstrapPayload,
  buildAppearanceBootstrapVariables,
  clearAppearanceBootstrapFromLocalStorage,
  saveAppearanceBootstrapToLocalStorage,
} from './appearanceBootstrap';

describe('appearanceBootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('builds palette, accent, and link variables for a mode', () => {
    const variables = buildAppearanceBootstrapVariables('light', {
      paletteHue: 210,
      paletteSaturation: 50,
      paletteBrightness: 10,
      accentColor: '#326ce5',
      linkColor: '#525252',
    });

    expect(variables['--color-base-950']).toMatch(/^hsl\(210,/);
    expect(variables['--color-accent-light-600']).toMatch(/^#[0-9a-f]{6}$/);
    expect(variables['--color-accent-bg']).toBe('rgba(50, 108, 229, 0.1)');
    expect(variables['--color-object-panel-link']).toBe('#525252');
    expect(variables['--color-object-panel-link-hover']).toMatch(/^#[0-9a-f]{6}$/);
    expect(variables['--color-accent-dark-500']).toBeUndefined();
  });

  it('omits inactive palette and empty color overrides', () => {
    const variables = buildAppearanceBootstrapVariables('dark', {
      paletteHue: 0,
      paletteSaturation: 0,
      paletteBrightness: 0,
      accentColor: '',
      linkColor: '',
    });

    expect(variables).toEqual({});
  });

  it('builds a versioned two-mode payload', () => {
    const payload = buildAppearanceBootstrapPayload({
      light: {
        paletteHue: 0,
        paletteSaturation: 0,
        paletteBrightness: 0,
        accentColor: '#326ce5',
        linkColor: '',
      },
      dark: {
        paletteHue: 30,
        paletteSaturation: 25,
        paletteBrightness: -5,
        accentColor: '#f59e0b',
        linkColor: '#aaaaaa',
      },
    });

    expect(payload.version).toBe(1);
    expect(payload.light['--color-accent-light-600']).toMatch(/^#[0-9a-f]{6}$/);
    expect(payload.dark['--color-base-950']).toMatch(/^hsl\(30,/);
    expect(payload.dark['--color-accent-dark-500']).toMatch(/^#[0-9a-f]{6}$/);
    expect(payload.dark['--color-object-panel-link']).toBe('#aaaaaa');
  });

  it('saves and clears the payload in localStorage', () => {
    saveAppearanceBootstrapToLocalStorage({
      light: {
        paletteHue: 0,
        paletteSaturation: 0,
        paletteBrightness: 0,
        accentColor: '#326ce5',
        linkColor: '',
      },
      dark: {
        paletteHue: 0,
        paletteSaturation: 0,
        paletteBrightness: 0,
        accentColor: '',
        linkColor: '#aaaaaa',
      },
    });

    const raw = localStorage.getItem(APPEARANCE_BOOTSTRAP_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw || '{}')).toMatchObject({
      version: 1,
      light: {
        '--color-accent-light-600': expect.stringMatching(/^#[0-9a-f]{6}$/),
      },
      dark: {
        '--color-object-panel-link': '#aaaaaa',
      },
    });

    clearAppearanceBootstrapFromLocalStorage();
    expect(localStorage.getItem(APPEARANCE_BOOTSTRAP_STORAGE_KEY)).toBeNull();
  });
});
