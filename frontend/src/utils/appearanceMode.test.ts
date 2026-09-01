import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAppearanceOverrides,
  changeAppearanceMode,
  resolveAppearanceMode,
} from './appearanceMode';

const mocks = vi.hoisted(() => ({
  applyAccentBg: vi.fn(),
  applyAccentColor: vi.fn(),
  applyLinkColor: vi.fn(),
  applyTintedPalette: vi.fn(),
  getAccentColor: vi.fn((mode: 'light' | 'dark') => (mode === 'light' ? '#112233' : '#445566')),
  getLinkColor: vi.fn((_mode: 'light' | 'dark') => '#abcdef'),
  getPaletteTint: vi.fn(),
  isPaletteActive: vi.fn(),
  setAppearanceModePreference: vi.fn(),
}));

vi.mock('@utils/accentColor', () => ({
  applyAccentBg: (...args: unknown[]) => mocks.applyAccentBg(...args),
  applyAccentColor: (...args: unknown[]) => mocks.applyAccentColor(...args),
}));

vi.mock('@utils/linkColor', () => ({
  applyLinkColor: (...args: unknown[]) => mocks.applyLinkColor(...args),
}));

vi.mock('@utils/paletteTint', () => ({
  applyTintedPalette: (...args: unknown[]) => mocks.applyTintedPalette(...args),
  isPaletteActive: (...args: unknown[]) => mocks.isPaletteActive(...args),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAccentColor: (mode: 'light' | 'dark') => mocks.getAccentColor(mode),
  getLinkColor: (mode: 'light' | 'dark') => mocks.getLinkColor(mode),
  getPaletteTint: (...args: unknown[]) => mocks.getPaletteTint(...args),
  setAppearanceModePreference: (...args: unknown[]) => mocks.setAppearanceModePreference(...args),
}));

describe('appearance mode utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaletteTint.mockReturnValue({ hue: 210, saturation: 40, brightness: -5 });
    mocks.isPaletteActive.mockReturnValue(true);
    mocks.setAppearanceModePreference.mockResolvedValue(undefined);
  });

  it('resolves the current document mode', () => {
    document.documentElement.dataset.appearanceMode = 'dark';
    expect(resolveAppearanceMode()).toBe('dark');
    document.documentElement.dataset.appearanceMode = 'light';
    expect(resolveAppearanceMode()).toBe('light');
  });

  it('applies the active mode palette, accent, and link overrides', () => {
    applyAppearanceOverrides('dark');

    expect(mocks.applyTintedPalette).toHaveBeenCalledWith(210, 40, -5);
    expect(mocks.applyAccentColor).toHaveBeenCalledWith('#112233', '#445566');
    expect(mocks.applyAccentBg).toHaveBeenCalledWith('#445566', 'dark');
    expect(mocks.applyLinkColor).toHaveBeenCalledWith('#abcdef', 'dark');
  });

  it('clears an inactive palette and validates preference changes', async () => {
    mocks.isPaletteActive.mockReturnValue(false);
    applyAppearanceOverrides('light');
    expect(mocks.applyTintedPalette).toHaveBeenCalledWith(0, 0, 0);

    await changeAppearanceMode('system');
    expect(mocks.setAppearanceModePreference).toHaveBeenCalledWith('system');
    await expect(changeAppearanceMode('invalid' as 'system')).rejects.toThrow(
      'Invalid appearance mode: invalid'
    );
  });
});
