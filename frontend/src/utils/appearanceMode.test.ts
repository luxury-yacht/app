/**
 * frontend/src/utils/appearanceMode.test.ts
 *
 * The appearance helpers over the real preference owner: overrides for a mode
 * use that mode's saved tint, accent, and link colors (an inactive tint clears
 * the palette), a mode change is saved through the preference owner and
 * reported back by the page's resolved mode, and an unknown mode is rejected
 * without saving. Runs inside the production shell, whose appearance owner
 * applies the saved mode, over the faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppearanceMode } from '@/core/settings/appPreferences';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import {
  applyAppearanceOverrides,
  changeAppearanceMode,
  resolveAppearanceMode,
} from './appearanceMode';

const app = installAppStateHarness();

/** Preference changes the backend saved, in order. */
const saved = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

const rootStyle = (property: string) => document.documentElement.style.getPropertyValue(property);

beforeEach(async () => {
  app.preferences({
    appearanceMode: 'light',
    paletteHueLight: 20,
    paletteSaturationLight: 0,
    paletteBrightnessLight: 0,
    paletteHueDark: 210,
    paletteSaturationDark: 40,
    paletteBrightnessDark: -5,
    accentColorLight: '#112233',
    accentColorDark: '#445566',
    linkColorLight: '#654321',
    linkColorDark: '#abcdef',
  });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map(({ key }) => key),
  }));
  await app.render(null);
});

describe('appearance mode utilities', () => {
  it('applies the given mode’s saved tint, accent, and link colors', () => {
    applyAppearanceOverrides('dark');

    expect(rootStyle('--color-base-500')).toMatch(/^hsl\(210, /);
    expect(rootStyle('--color-accent-bg')).toBe('rgba(68, 85, 102, 0.15)');
    expect(rootStyle('--color-object-panel-link')).toBe('#abcdef');
  });

  it('clears the tinted palette for a mode whose saved tint is inactive', () => {
    applyAppearanceOverrides('dark');
    expect(rootStyle('--color-base-500')).not.toBe('');

    applyAppearanceOverrides('light');

    expect(rootStyle('--color-base-500')).toBe('');
    expect(rootStyle('--color-object-panel-link')).toBe('#654321');
  });

  it('saves a mode change, which the page then resolves to', async () => {
    expect(resolveAppearanceMode()).toBe('light');

    await act(async () => changeAppearanceMode('dark'));
    await app.settle();

    expect(saved()).toEqual([{ key: 'appearanceMode', value: 'dark' }]);
    expect(resolveAppearanceMode()).toBe('dark');
  });

  it('rejects an unknown mode without saving it', async () => {
    await expect(changeAppearanceMode('invalid' as AppearanceMode)).rejects.toThrow(
      'Invalid appearance mode: invalid'
    );
    await app.settle();

    expect(saved()).toEqual([]);
    expect(resolveAppearanceMode()).toBe('light');
  });
});
