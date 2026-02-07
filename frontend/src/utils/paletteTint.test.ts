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

    it('uses correct lightness for first and last steps', () => {
      const palette = generateTintedPalette(0, 100);
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
  });

  describe('applyTintedPalette', () => {
    it('sets style properties for each gray step when tone > 0', () => {
      applyTintedPalette(200, 50);
      expect(setPropertySpy).toHaveBeenCalledTimes(GRAY_STEPS.length);
      for (const { token } of GRAY_STEPS) {
        expect(setPropertySpy).toHaveBeenCalledWith(token, expect.stringContaining('hsl('));
      }
    });

    it('clears style properties when tone is 0', () => {
      // First apply a palette
      applyTintedPalette(200, 50);
      setPropertySpy.mockClear();
      removePropertySpy.mockClear();

      // Now apply with tone=0 which should clear
      applyTintedPalette(200, 0);
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
    it('saves hue and tone to localStorage', () => {
      savePaletteTintToLocalStorage(220, 75);
      expect(localStorage.getItem('app-palette-hue')).toBe('220');
      expect(localStorage.getItem('app-palette-tone')).toBe('75');
    });

    it('clears hue and tone from localStorage', () => {
      savePaletteTintToLocalStorage(220, 75);
      clearPaletteTintFromLocalStorage();
      expect(localStorage.getItem('app-palette-hue')).toBeNull();
      expect(localStorage.getItem('app-palette-tone')).toBeNull();
    });
  });
});
