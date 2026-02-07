/**
 * frontend/src/core/settings/appPreferences.test.ts
 *
 * Test suite for appPreferences hydration and persistence helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccentColor,
  getAutoRefreshEnabled,
  getBackgroundRefreshEnabled,
  getGridTablePersistenceMode,
  getMetricsRefreshIntervalMs,
  getPaletteTint,
  getThemePreference,
  getUseShortResourceNames,
  hydrateAppPreferences,
  resetAppPreferencesCacheForTesting,
  setAccentColor,
  setAutoRefreshEnabled,
  setBackgroundRefreshEnabled,
  setGridTablePersistenceMode,
  setPaletteTint,
  setThemePreference,
  setUseShortResourceNames,
} from './appPreferences';

const appMocks = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
  SetTheme: vi.fn(),
  SetUseShortResourceNames: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppSettings: (...args: unknown[]) => appMocks.GetAppSettings(...args),
  SetTheme: (...args: unknown[]) => appMocks.SetTheme(...args),
  SetUseShortResourceNames: (...args: unknown[]) => appMocks.SetUseShortResourceNames(...args),
}));

describe('appPreferences', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockReset();
    appMocks.SetTheme.mockReset();
    appMocks.SetUseShortResourceNames.mockReset();
    (window as any).go = {
      backend: {
        App: {
          SetAutoRefreshEnabled: vi.fn().mockResolvedValue(undefined),
          SetBackgroundRefreshEnabled: vi.fn().mockResolvedValue(undefined),
          SetGridTablePersistenceMode: vi.fn().mockResolvedValue(undefined),
          SetPaletteTint: vi.fn().mockResolvedValue(undefined),
          SetAccentColor: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  afterEach(() => {
    delete (window as any).go;
  });

  it('hydrates preferences from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'light',
      useShortResourceNames: true,
      autoRefreshEnabled: false,
      refreshBackgroundClustersEnabled: false,
      metricsRefreshIntervalMs: 7000,
      gridTablePersistenceMode: 'namespaced',
      paletteHueLight: 220,
      paletteToneLight: 50,
      paletteBrightnessLight: -15,
      paletteHueDark: 120,
      paletteToneDark: 40,
      paletteBrightnessDark: 10,
      accentColorLight: '#0d9488',
      accentColorDark: '#f59e0b',
    });

    await hydrateAppPreferences({ force: true });

    expect(getThemePreference()).toBe('light');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(7000);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
    expect(getPaletteTint('light')).toEqual({ hue: 220, tone: 50, brightness: -15 });
    expect(getPaletteTint('dark')).toEqual({ hue: 120, tone: 40, brightness: 10 });
    expect(getAccentColor('light')).toBe('#0d9488');
    expect(getAccentColor('dark')).toBe('#f59e0b');
  });

  it('defaults palette hue, tone, and brightness to 0 when not present', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
    });

    await hydrateAppPreferences({ force: true });

    expect(getPaletteTint('light')).toEqual({ hue: 0, tone: 0, brightness: 0 });
    expect(getPaletteTint('dark')).toEqual({ hue: 0, tone: 0, brightness: 0 });
    expect(getAccentColor('light')).toBe('');
    expect(getAccentColor('dark')).toBe('');
  });

  it('persists preference updates and updates the cache', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      useShortResourceNames: false,
      autoRefreshEnabled: true,
      refreshBackgroundClustersEnabled: true,
      metricsRefreshIntervalMs: 6000,
      gridTablePersistenceMode: 'shared',
    });

    await hydrateAppPreferences({ force: true });

    await setThemePreference('dark');
    await setUseShortResourceNames(true);
    setAutoRefreshEnabled(false);
    setBackgroundRefreshEnabled(false);
    setGridTablePersistenceMode('namespaced');

    expect(appMocks.SetTheme).toHaveBeenCalledWith('dark');
    expect(appMocks.SetUseShortResourceNames).toHaveBeenCalledWith(true);
    expect((window as any).go.backend.App.SetAutoRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetBackgroundRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetGridTablePersistenceMode).toHaveBeenCalledWith(
      'namespaced'
    );

    expect(getThemePreference()).toBe('dark');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(6000);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
  });

  it('setPaletteTint updates cache and calls backend for the specified theme', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      paletteHueLight: 0,
      paletteToneLight: 0,
      paletteBrightnessLight: 0,
      paletteHueDark: 0,
      paletteToneDark: 0,
      paletteBrightnessDark: 0,
    });

    await hydrateAppPreferences({ force: true });

    setPaletteTint('light', 180, 75, -25);

    expect(getPaletteTint('light')).toEqual({ hue: 180, tone: 75, brightness: -25 });
    // Dark theme should remain at defaults.
    expect(getPaletteTint('dark')).toEqual({ hue: 0, tone: 0, brightness: 0 });
    expect((window as any).go.backend.App.SetPaletteTint).toHaveBeenCalledWith(
      'light',
      180,
      75,
      -25
    );

    setPaletteTint('dark', 300, 60, 20);

    expect(getPaletteTint('dark')).toEqual({ hue: 300, tone: 60, brightness: 20 });
    // Light theme should be unchanged.
    expect(getPaletteTint('light')).toEqual({ hue: 180, tone: 75, brightness: -25 });
    expect((window as any).go.backend.App.SetPaletteTint).toHaveBeenCalledWith('dark', 300, 60, 20);
  });

  it('setAccentColor updates cache and calls backend for the specified theme', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      accentColorLight: '',
      accentColorDark: '',
    });

    await hydrateAppPreferences({ force: true });

    setAccentColor('light', '#0d9488');

    expect(getAccentColor('light')).toBe('#0d9488');
    // Dark theme should remain at default.
    expect(getAccentColor('dark')).toBe('');
    expect((window as any).go.backend.App.SetAccentColor).toHaveBeenCalledWith('light', '#0d9488');

    setAccentColor('dark', '#f59e0b');

    expect(getAccentColor('dark')).toBe('#f59e0b');
    // Light theme should be unchanged.
    expect(getAccentColor('light')).toBe('#0d9488');
    expect((window as any).go.backend.App.SetAccentColor).toHaveBeenCalledWith('dark', '#f59e0b');
  });

  it('setAccentColor resets to empty string', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      accentColorLight: '#0d9488',
      accentColorDark: '#f59e0b',
    });

    await hydrateAppPreferences({ force: true });

    setAccentColor('light', '');
    expect(getAccentColor('light')).toBe('');
    expect(getAccentColor('dark')).toBe('#f59e0b');
  });
});
