/**
 * frontend/src/core/settings/appPreferences.test.ts
 *
 * Test suite for appPreferences hydration and persistence helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAutoRefreshEnabled,
  getBackgroundRefreshEnabled,
  getGridTablePersistenceMode,
  getMetricsRefreshIntervalMs,
  getPaletteBrightness,
  getPaletteHue,
  getPaletteTone,
  getThemePreference,
  getUseShortResourceNames,
  hydrateAppPreferences,
  resetAppPreferencesCacheForTesting,
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
      paletteHue: 220,
      paletteTone: 50,
      paletteBrightness: -15,
    });

    await hydrateAppPreferences({ force: true });

    expect(getThemePreference()).toBe('light');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(7000);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
    expect(getPaletteHue()).toBe(220);
    expect(getPaletteTone()).toBe(50);
    expect(getPaletteBrightness()).toBe(-15);
  });

  it('defaults palette hue, tone, and brightness to 0 when not present', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
    });

    await hydrateAppPreferences({ force: true });

    expect(getPaletteHue()).toBe(0);
    expect(getPaletteTone()).toBe(0);
    expect(getPaletteBrightness()).toBe(0);
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

  it('setPaletteTint updates cache and calls backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      paletteHue: 0,
      paletteTone: 0,
      paletteBrightness: 0,
    });

    await hydrateAppPreferences({ force: true });

    setPaletteTint(180, 75, -25);

    expect(getPaletteHue()).toBe(180);
    expect(getPaletteTone()).toBe(75);
    expect(getPaletteBrightness()).toBe(-25);
    expect((window as any).go.backend.App.SetPaletteTint).toHaveBeenCalledWith(180, 75, -25);
  });
});
