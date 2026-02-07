/**
 * frontend/src/utils/paletteTint.test.ts
 *
 * Tests for palette tint generation, DOM application, and localStorage helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRAY_STEPS,
  MAX_SATURATION,
  generateTintedPalette,
  applyTintedPalette,
  clearTintedPalette,
  savePaletteTintToLocalStorage,
  clearPaletteTintFromLocalStorage,
  isPaletteActive,
} from './paletteTint';

describe('paletteTint', () => {
  // Store original style methods so we can spy/restore
  let setPropertySpy: ReturnType<typeof vi.spyOn>;
  let removePropertySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setPropertySpy = vi.spyOn(document.documentElement.style, 'setProperty');
    removePropertySpy = vi.spyOn(document.documentElement.style, 'removeProperty');
  });

  afterEach(() => {
    // Clean up any inline styles set during tests
    for (const { token } of GRAY_STEPS) {
      document.documentElement.style.removeProperty(token);
    }
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('isPaletteActive', () => {
    it('returns false when tone=0 and brightness=0', () => {
      expect(isPaletteActive(0, 0)).toBe(false);
    });

    it('returns true when tone > 0', () => {
      expect(isPaletteActive(50, 0)).toBe(true);
    });

    it('returns true when brightness != 0', () => {
      expect(isPaletteActive(0, 20)).toBe(true);
      expect(isPaletteActive(0, -20)).toBe(true);
    });
  });

  describe('generateTintedPalette', () => {
    it('returns all 11 gray steps', () => {
      const palette = generateTintedPalette(200, 50);
      expect(palette).toHaveLength(11);
    });

    it('produces 0% saturation when tone is 0', () => {
      const palette = generateTintedPalette(180, 0);
      for (const entry of palette) {
        expect(entry.value).toMatch(/hsl\(180, 0%, \d+%\)/);
      }
    });

    it('produces MAX_SATURATION% saturation when tone is 100', () => {
      const palette = generateTintedPalette(90, 100);
      for (const entry of palette) {
        expect(entry.value).toMatch(new RegExp(`hsl\\(90, ${MAX_SATURATION}%, \\d+%\\)`));
      }
    });

    it('scales saturation proportionally for tone=50', () => {
      const palette = generateTintedPalette(120, 50);
      const expectedSaturation = (50 / 100) * MAX_SATURATION; // 10
      for (const entry of palette) {
        expect(entry.value).toContain(`${expectedSaturation}%`);
      }
    });

    it('uses correct lightness for first and last steps with brightness=0', () => {
      const palette = generateTintedPalette(0, 100, 0);
      // gray-950 has lightness 4
      expect(palette[0].token).toBe('--color-gray-950');
      expect(palette[0].value).toContain('4%');
      // gray-50 has lightness 96
      expect(palette[10].token).toBe('--color-gray-50');
      expect(palette[10].value).toContain('96%');
    });

    it('handles boundary hue values (0 and 360)', () => {
      const paletteZero = generateTintedPalette(0, 50);
      const palette360 = generateTintedPalette(360, 50);
      expect(paletteZero[0].value).toMatch(/^hsl\(0,/);
      expect(palette360[0].value).toMatch(/^hsl\(360,/);
    });

    it('shifts lightness up with positive brightness', () => {
      // brightness=50 → offset = +10 percentage points
      const palette = generateTintedPalette(0, 0, 50);
      // gray-950 (L=4) → 4+10=14
      expect(palette[0].value).toContain('14%');
      // gray-500 (L=44) → 44+10=54
      expect(palette[5].value).toContain('54%');
    });

    it('shifts lightness down with negative brightness', () => {
      // brightness=-50 → offset = -10 percentage points
      const palette = generateTintedPalette(0, 0, -50);
      // gray-900 (L=10) → 10-10=0 → clamped to 1
      expect(palette[1].value).toContain('1%');
      // gray-500 (L=44) → 44-10=34
      expect(palette[5].value).toContain('34%');
    });

    it('clamps adjusted lightness to 1-99%', () => {
      // brightness=+50 → gray-50 (L=96) → 96+10=106 → clamped to 99
      const paletteUp = generateTintedPalette(0, 0, 50);
      expect(paletteUp[10].value).toContain('99%');

      // brightness=-50 → gray-950 (L=4) → 4-10=-6 → clamped to 1
      const paletteDown = generateTintedPalette(0, 0, -50);
      expect(paletteDown[0].value).toContain('1%');
    });

    it('defaults brightness to 0 when not provided', () => {
      const withoutBrightness = generateTintedPalette(200, 50);
      const withZeroBrightness = generateTintedPalette(200, 50, 0);
      expect(withoutBrightness).toEqual(withZeroBrightness);
    });
  });

  describe('applyTintedPalette', () => {
    it('sets style properties for each gray step when tone > 0', () => {
      applyTintedPalette(200, 50);
      expect(setPropertySpy).toHaveBeenCalledTimes(GRAY_STEPS.length);
      for (const { token } of GRAY_STEPS) {
        expect(setPropertySpy).toHaveBeenCalledWith(token, expect.stringContaining('hsl('));
      }
    });

    it('sets style properties when only brightness is non-zero', () => {
      applyTintedPalette(0, 0, 20);
      expect(setPropertySpy).toHaveBeenCalledTimes(GRAY_STEPS.length);
    });

    it('clears style properties when tone is 0 and brightness is 0', () => {
      // First apply a palette
      applyTintedPalette(200, 50);
      setPropertySpy.mockClear();
      removePropertySpy.mockClear();

      // Now apply with tone=0, brightness=0 which should clear
      applyTintedPalette(200, 0, 0);
      expect(setPropertySpy).not.toHaveBeenCalled();
      expect(removePropertySpy).toHaveBeenCalledTimes(GRAY_STEPS.length);
    });
  });

  describe('clearTintedPalette', () => {
    it('removes all gray step style properties', () => {
      applyTintedPalette(100, 80);
      removePropertySpy.mockClear();

      clearTintedPalette();
      expect(removePropertySpy).toHaveBeenCalledTimes(GRAY_STEPS.length);
      for (const { token } of GRAY_STEPS) {
        expect(removePropertySpy).toHaveBeenCalledWith(token);
      }
    });
  });

  describe('localStorage helpers', () => {
    it('saves hue, tone, and brightness to localStorage', () => {
      savePaletteTintToLocalStorage(220, 75, -30);
      expect(localStorage.getItem('app-palette-hue')).toBe('220');
      expect(localStorage.getItem('app-palette-tone')).toBe('75');
      expect(localStorage.getItem('app-palette-brightness')).toBe('-30');
    });

    it('clears hue, tone, and brightness from localStorage', () => {
      savePaletteTintToLocalStorage(220, 75, 10);
      clearPaletteTintFromLocalStorage();
      expect(localStorage.getItem('app-palette-hue')).toBeNull();
      expect(localStorage.getItem('app-palette-tone')).toBeNull();
      expect(localStorage.getItem('app-palette-brightness')).toBeNull();
    });

    it('defaults brightness to 0 when not provided', () => {
      savePaletteTintToLocalStorage(220, 75);
      expect(localStorage.getItem('app-palette-brightness')).toBe('0');
    });
  });
});
