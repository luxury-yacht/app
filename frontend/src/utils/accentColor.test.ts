/**
 * frontend/src/utils/accentColor.test.ts
 *
 * Tests for accent color shade generation and CSS override application.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import {
  applyAccentBg,
  applyAccentColor,
  clearAccentColor,
  DARK_OFFSETS,
  generateAccentBg,
  generateAccentShades,
  hexToHsl,
  hexToRgb,
  hslToHex,
  LIGHT_OFFSETS,
} from './accentColor';

describe('hexToHsl', () => {
  it('covers hexToHsl scenarios', async () => {
    {
      // Scenario: converts pure red
      const { h, s, l } = hexToHsl('#ff0000');
      expect(h).toBe(0);
      expect(s).toBe(100);
      expect(l).toBe(50);
    }

    {
      // Scenario: converts pure green
      const { h, s, l } = hexToHsl('#00ff00');
      expect(h).toBe(120);
      expect(s).toBe(100);
      expect(l).toBe(50);
    }

    {
      // Scenario: converts pure blue
      const { h, s, l } = hexToHsl('#0000ff');
      expect(h).toBe(240);
      expect(s).toBe(100);
      expect(l).toBe(50);
    }

    {
      // Scenario: converts white
      const { h, s, l } = hexToHsl('#ffffff');
      expect(h).toBe(0);
      expect(s).toBe(0);
      expect(l).toBe(100);
    }

    {
      // Scenario: converts black
      const { h, s, l } = hexToHsl('#000000');
      expect(h).toBe(0);
      expect(s).toBe(0);
      expect(l).toBe(0);
    }

    {
      // Scenario: converts blue (#326ce5)
      const { h, s, l } = hexToHsl('#326ce5');
      // Kubernetes blue is roughly hue ~221, saturation ~77%, lightness ~55%.
      expect(h).toBeGreaterThanOrEqual(215);
      expect(h).toBeLessThanOrEqual(225);
      expect(s).toBeGreaterThan(70);
      expect(l).toBeGreaterThan(50);
      expect(l).toBeLessThan(60);
    }
  });
});

describe('hslToHex', () => {
  it('covers hslToHex scenarios', async () => {
    // Scenario: converts pure red HSL to hex
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    // Scenario: converts pure green HSL to hex
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    // Scenario: converts pure blue HSL to hex
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    // Scenario: converts white HSL to hex
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    // Scenario: converts black HSL to hex
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });
});

describe('hexToHsl / hslToHex round-trip', () => {
  const testColors = ['#326ce5', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6'];

  it('round-trips every representative accent color', () => {
    for (const hex of testColors) {
      const { h, s, l } = hexToHsl(hex);
      const result = hslToHex(h, s, l);
      // Allow ±3 per channel due to HSL rounding
      const orig = hexToRgb(hex);
      const roundTrip = hexToRgb(result);
      expect(Math.abs(orig.r - roundTrip.r), `${hex} red channel`).toBeLessThanOrEqual(3);
      expect(Math.abs(orig.g - roundTrip.g), `${hex} green channel`).toBeLessThanOrEqual(3);
      expect(Math.abs(orig.b - roundTrip.b), `${hex} blue channel`).toBeLessThanOrEqual(3);
    }
  });
});

describe('hexToRgb', () => {
  it('covers hexToRgb scenarios', async () => {
    // Scenario: parses #ff0000
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    // Scenario: parses #326ce5
    expect(hexToRgb('#326ce5')).toEqual({ r: 50, g: 108, b: 229 });
  });
});

describe('generateAccentShades', () => {
  it('covers generateAccentShades scenarios', async () => {
    {
      // Scenario: generates 5 shades for light mode
      const shades = generateAccentShades('#326ce5', 'light');
      expect(shades).toHaveLength(Object.keys(LIGHT_OFFSETS).length);
      // All tokens should be --color-accent-light-*
      for (const shade of shades) {
        expect(shade.token).toMatch(/^--color-accent-light-\d+$/);
        expect(shade.value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }

    {
      // Scenario: generates 6 shades for dark mode
      const shades = generateAccentShades('#f59e0b', 'dark');
      expect(shades).toHaveLength(Object.keys(DARK_OFFSETS).length);
      // All tokens should be --color-accent-dark-*
      for (const shade of shades) {
        expect(shade.token).toMatch(/^--color-accent-dark-\d+$/);
        expect(shade.value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }

    {
      // Scenario: produces darker shades for negative offsets
      const shades = generateAccentShades('#3b82f6', 'light');
      // 700 (offset -8) should be darker than 600 (offset 0)
      const shade700 = requireValue(
        shades.find((s) => s.token === '--color-accent-light-700'),
        'Expected the generated 700 accent shade'
      );
      const shade600 = requireValue(
        shades.find((s) => s.token === '--color-accent-light-600'),
        'Expected the generated 600 accent shade'
      );
      const shade300 = requireValue(
        shades.find((s) => s.token === '--color-accent-light-300'),
        'Expected the generated 300 accent shade'
      );
      const l700 = hexToHsl(shade700.value).l;
      const l600 = hexToHsl(shade600.value).l;
      const l300 = hexToHsl(shade300.value).l;
      expect(l700).toBeLessThan(l600);
      expect(l600).toBeLessThan(l300);
    }
  });
});

describe('generateAccentBg', () => {
  it('covers generateAccentBg scenarios', async () => {
    {
      // Scenario: generates rgba with 0.1 alpha for light mode
      const { token, value } = generateAccentBg('#326ce5', 'light');
      expect(token).toBe('--color-accent-bg');
      expect(value).toBe('rgba(50, 108, 229, 0.1)');
    }

    {
      // Scenario: generates rgba with 0.15 alpha for dark mode
      const { token, value } = generateAccentBg('#f59e0b', 'dark');
      expect(token).toBe('--color-accent-bg');
      expect(value).toBe('rgba(245, 158, 11, 0.15)');
    }
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

  it('sets, selectively applies, and removes accent palette properties', () => {
    applyAccentColor('#326ce5', '#f59e0b');
    const root = document.documentElement;
    // Light shades should be set.
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).not.toBe('');
    }
    // Dark shades should be set.
    for (const token of Object.keys(DARK_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).not.toBe('');
    }

    applyAccentColor('', '');
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).toBe('');
    }
    for (const token of Object.keys(DARK_OFFSETS)) {
      expect(root.style.getPropertyValue(token)).toBe('');
    }

    applyAccentColor('#326ce5', '');
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

  it('sets the mode-specific background and removes it when empty', () => {
    applyAccentBg('#326ce5', 'light');
    expect(document.documentElement.style.getPropertyValue('--color-accent-bg')).toBe(
      'rgba(50, 108, 229, 0.1)'
    );

    applyAccentBg('#f59e0b', 'dark');
    expect(document.documentElement.style.getPropertyValue('--color-accent-bg')).toBe(
      'rgba(245, 158, 11, 0.15)'
    );

    applyAccentBg('', 'light');
    expect(document.documentElement.style.getPropertyValue('--color-accent-bg')).toBe('');
  });
});

describe('clearAccentColor', () => {
  it('removes all accent palette overrides and accent-bg', () => {
    applyAccentColor('#326ce5', '#f59e0b');
    applyAccentBg('#326ce5', 'light');
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
