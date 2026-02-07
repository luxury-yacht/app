/**
 * frontend/src/utils/accentColor.test.ts
 *
 * Tests for accent color shade generation, CSS override application,
 * and localStorage bridge.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hexToHsl,
  hslToHex,
  hexToRgb,
  generateAccentShades,
  generateAccentBg,
  applyAccentColor,
  applyAccentBg,
  clearAccentColor,
  saveAccentColorToLocalStorage,
  clearAccentColorFromLocalStorage,
  LIGHT_OFFSETS,
  DARK_OFFSETS,
} from './accentColor';

describe('hexToHsl', () => {
  it('converts pure red', () => {
    const { h, s, l } = hexToHsl('#ff0000');
    expect(h).toBe(0);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  it('converts pure green', () => {
    const { h, s, l } = hexToHsl('#00ff00');
    expect(h).toBe(120);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  it('converts pure blue', () => {
    const { h, s, l } = hexToHsl('#0000ff');
    expect(h).toBe(240);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  it('converts white', () => {
    const { h, s, l } = hexToHsl('#ffffff');
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(100);
  });

  it('converts black', () => {
    const { h, s, l } = hexToHsl('#000000');
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  it('converts teal (#0d9488)', () => {
    const { h, s, l } = hexToHsl('#0d9488');
    // Teal is roughly hue ~174, saturation ~83%, lightness ~31%
    expect(h).toBeGreaterThanOrEqual(170);
    expect(h).toBeLessThanOrEqual(180);
    expect(s).toBeGreaterThan(70);
    expect(l).toBeGreaterThan(25);
    expect(l).toBeLessThan(40);
  });
});

describe('hslToHex', () => {
  it('converts pure red HSL to hex', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
  });

  it('converts pure green HSL to hex', () => {
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
  });

  it('converts pure blue HSL to hex', () => {
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('converts white HSL to hex', () => {
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
  });

  it('converts black HSL to hex', () => {
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });
});

describe('hexToHsl / hslToHex round-trip', () => {
  const testColors = ['#0d9488', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6'];

  for (const hex of testColors) {
    it(`round-trips ${hex}`, () => {
      const { h, s, l } = hexToHsl(hex);
      const result = hslToHex(h, s, l);
      // Allow ±3 per channel due to HSL rounding
      const orig = hexToRgb(hex);
      const roundTrip = hexToRgb(result);
      expect(Math.abs(orig.r - roundTrip.r)).toBeLessThanOrEqual(3);
      expect(Math.abs(orig.g - roundTrip.g)).toBeLessThanOrEqual(3);
      expect(Math.abs(orig.b - roundTrip.b)).toBeLessThanOrEqual(3);
    });
  }
});

describe('hexToRgb', () => {
  it('parses #ff0000', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('parses #0d9488', () => {
    expect(hexToRgb('#0d9488')).toEqual({ r: 13, g: 148, b: 136 });
  });
});

describe('generateAccentShades', () => {
  it('generates 5 shades for light mode', () => {
    const shades = generateAccentShades('#0d9488', 'light');
    expect(shades).toHaveLength(Object.keys(LIGHT_OFFSETS).length);
    // All tokens should be --color-accent-light-*
    for (const shade of shades) {
      expect(shade.token).toMatch(/^--color-accent-light-\d+$/);
      expect(shade.value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('generates 6 shades for dark mode', () => {
    const shades = generateAccentShades('#f59e0b', 'dark');
    expect(shades).toHaveLength(Object.keys(DARK_OFFSETS).length);
    // All tokens should be --color-accent-dark-*
    for (const shade of shades) {
      expect(shade.token).toMatch(/^--color-accent-dark-\d+$/);
      expect(shade.value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('produces darker shades for negative offsets', () => {
    const shades = generateAccentShades('#3b82f6', 'light');
    // 700 (offset -8) should be darker than 600 (offset 0)
    const shade700 = shades.find((s) => s.token === '--color-accent-light-700')!;
    const shade600 = shades.find((s) => s.token === '--color-accent-light-600')!;
    const shade300 = shades.find((s) => s.token === '--color-accent-light-300')!;
    const l700 = hexToHsl(shade700.value).l;
    const l600 = hexToHsl(shade600.value).l;
    const l300 = hexToHsl(shade300.value).l;
    expect(l700).toBeLessThan(l600);
    expect(l600).toBeLessThan(l300);
  });
});

describe('generateAccentBg', () => {
  it('generates rgba with 0.1 alpha for light mode', () => {
    const { token, value } = generateAccentBg('#0d9488', 'light');
    expect(token).toBe('--color-accent-bg');
    expect(value).toBe('rgba(13, 148, 136, 0.1)');
  });

  it('generates rgba with 0.15 alpha for dark mode', () => {
    const { token, value } = generateAccentBg('#f59e0b', 'dark');
    expect(token).toBe('--color-accent-bg');
    expect(value).toBe('rgba(245, 158, 11, 0.15)');
  });
});

describe('applyAccentColor', () => {
  beforeEach(() => {
    // Clear any inline styles from previous tests
    const root = document.documentElement;
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      root.style.removeProperty(token);
    }
    for (const token of Object.keys(DARK_OFFSETS)) {
      root.style.removeProperty(token);
    }
  });

  it('sets CSS custom properties when hex is provided', () => {
    applyAccentColor('#0d9488', '#f59e0b');
    const root = document.documentElement;
    // Light shades should be set.
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).not.toBe('');
    }
    // Dark shades should be set.
    for (const token of Object.keys(DARK_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).not.toBe('');
    }
  });

  it('removes CSS custom properties when hex is empty', () => {
    // First set them.
    applyAccentColor('#0d9488', '#f59e0b');
    // Then clear them.
    applyAccentColor('', '');
    const root = document.documentElement;
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).toBe('');
    }
    for (const token of Object.keys(DARK_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).toBe('');
    }
  });

  it('only sets light shades when dark hex is empty', () => {
    applyAccentColor('#0d9488', '');
    const root = document.documentElement;
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).not.toBe('');
    }
    for (const token of Object.keys(DARK_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).toBe('');
    }
  });
});

describe('applyAccentBg', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--color-accent-bg');
  });

  it('sets --color-accent-bg for light theme', () => {
    applyAccentBg('#0d9488', 'light');
    expect(document.documentElement.style.getPropertyValue('--color-accent-bg')).toBe(
      'rgba(13, 148, 136, 0.1)'
    );
  });

  it('sets --color-accent-bg for dark theme', () => {
    applyAccentBg('#f59e0b', 'dark');
    expect(document.documentElement.style.getPropertyValue('--color-accent-bg')).toBe(
      'rgba(245, 158, 11, 0.15)'
    );
  });

  it('removes --color-accent-bg when hex is empty', () => {
    applyAccentBg('#0d9488', 'light');
    applyAccentBg('', 'light');
    expect(document.documentElement.style.getPropertyValue('--color-accent-bg')).toBe('');
  });
});

describe('clearAccentColor', () => {
  it('removes all accent palette overrides and accent-bg', () => {
    applyAccentColor('#0d9488', '#f59e0b');
    applyAccentBg('#0d9488', 'light');
    clearAccentColor();
    const root = document.documentElement;
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).toBe('');
    }
    for (const token of Object.keys(DARK_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).toBe('');
    }
    expect(root.style.getPropertyValue('--color-accent-bg')).toBe('');
  });
});

describe('localStorage bridge', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('saves and retrieves accent color for light theme', () => {
    saveAccentColorToLocalStorage('light', '#0d9488');
    expect(localStorage.getItem('app-accent-color-light')).toBe('#0d9488');
    expect(localStorage.getItem('app-accent-color-dark')).toBeNull();
  });

  it('saves and retrieves accent color for dark theme', () => {
    saveAccentColorToLocalStorage('dark', '#f59e0b');
    expect(localStorage.getItem('app-accent-color-dark')).toBe('#f59e0b');
    expect(localStorage.getItem('app-accent-color-light')).toBeNull();
  });

  it('removes key when color is empty', () => {
    saveAccentColorToLocalStorage('light', '#0d9488');
    saveAccentColorToLocalStorage('light', '');
    expect(localStorage.getItem('app-accent-color-light')).toBeNull();
  });

  it('clearAccentColorFromLocalStorage removes all keys', () => {
    saveAccentColorToLocalStorage('light', '#0d9488');
    saveAccentColorToLocalStorage('dark', '#f59e0b');
    clearAccentColorFromLocalStorage();
    expect(localStorage.getItem('app-accent-color-light')).toBeNull();
    expect(localStorage.getItem('app-accent-color-dark')).toBeNull();
  });
});
