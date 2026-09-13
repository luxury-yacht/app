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
  generateAccentShades,
  hexToHsl,
  hexToRgb,
  hslToHex,
  LIGHT_OFFSETS,
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
  it('round-trips a color with fractional HSL components', () => {
    const hex = '#326ce5';
    const { h, s, l } = hexToHsl(hex);
    const result = hslToHex(h, s, l);
    // Allow ±3 per channel due to HSL rounding
    const orig = hexToRgb(hex);
    const roundTrip = hexToRgb(result);
    expect(Math.abs(orig.r - roundTrip.r)).toBeLessThanOrEqual(3);
    expect(Math.abs(orig.g - roundTrip.g)).toBeLessThanOrEqual(3);
    expect(Math.abs(orig.b - roundTrip.b)).toBeLessThanOrEqual(3);
  });
});

describe('generateAccentShades', () => {
  it('produces darker shades for negative offsets', () => {
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
  });

  it('removes CSS custom properties when hex is empty', () => {
    // First set them.
    applyAccentColor('#326ce5', '#f59e0b');
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
    applyAccentColor('#326ce5', '');
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

  it('removes --color-accent-bg when hex is empty', () => {
    applyAccentBg('#326ce5', 'light');
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
