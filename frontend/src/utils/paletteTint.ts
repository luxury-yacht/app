/**
 * frontend/src/utils/paletteTint.ts
 *
 * Generates tinted gray palettes using HSL and applies them as CSS custom
 * property overrides on document.documentElement. Persists hue/saturation/brightness
 * to localStorage so the FOUC-prevention script in index.html can apply
 * the palette before React mounts.
 *
 * IMPORTANT: The lightness values, MAX_SATURATION, and MAX_BRIGHTNESS_OFFSET
 * constants are duplicated in the inline <script> in frontend/index.html for
 * FOUC prevention. Keep both in sync when changing the formula.
 */

// Gray scale token definitions with their original lightness values.
// Lightness is derived from the neutral hex values in colors.css (:root).
export const GRAY_STEPS: { token: string; lightness: number }[] = [
  { token: '--color-base-950', lightness: 4 },
  { token: '--color-base-900', lightness: 10 },
  { token: '--color-base-800', lightness: 18 },
  { token: '--color-base-700', lightness: 25 },
  { token: '--color-base-600', lightness: 32 },
  { token: '--color-base-500', lightness: 44 },
  { token: '--color-base-400', lightness: 54 },
  { token: '--color-base-300', lightness: 69 },
  { token: '--color-base-200', lightness: 82 },
  { token: '--color-base-100', lightness: 88 },
  { token: '--color-base-50', lightness: 96 },
];

// Maximum CSS saturation percentage when saturation is at 100.
// 20% is enough to tint without losing the "gray" feel.
export const MAX_SATURATION = 20;

// Maximum lightness offset in percentage points when brightness is at ±50.
// brightness * (MAX_BRIGHTNESS_OFFSET / 50) gives the actual offset.
// Also duplicated in index.html inline script for FOUC prevention.
/** @lintignore */
export const MAX_BRIGHTNESS_OFFSET = 10;

// Per-theme localStorage keys for FOUC prevention bridge.
const LS_KEY_HUE_LIGHT = 'app-palette-hue-light';
const LS_KEY_TONE_LIGHT = 'app-palette-saturation-light';
const LS_KEY_BRIGHTNESS_LIGHT = 'app-palette-brightness-light';
const LS_KEY_HUE_DARK = 'app-palette-hue-dark';
const LS_KEY_TONE_DARK = 'app-palette-saturation-dark';
const LS_KEY_BRIGHTNESS_DARK = 'app-palette-brightness-dark';

// Old localStorage keys for migration cleanup.
const LS_KEY_HUE_OLD = 'app-palette-hue';
const LS_KEY_TONE_OLD = 'app-palette-saturation';
const LS_KEY_BRIGHTNESS_OLD = 'app-palette-brightness';

/**
 * Returns true when any palette customization is active and overrides
 * should be applied (saturation > 0 or brightness != 0).
 */
export function isPaletteActive(saturation: number, brightness: number): boolean {
  return saturation > 0 || brightness !== 0;
}

/**
 * Generates an array of tinted palette entries from hue, saturation, and brightness values.
 * Each entry contains the CSS custom property token and its HSL value string.
 *
 * @param brightness - Lightness offset (-50 to +50). Maps to ±MAX_BRIGHTNESS_OFFSET
 *                     percentage points of lightness. Each step is clamped to 1-99%.
 */
export function generateTintedPalette(
  hue: number,
  saturation: number,
  brightness: number = 0
): { token: string; value: string }[] {
  const saturationOffset = (saturation / 100) * MAX_SATURATION;
  const lightnessOffset = (brightness / 50) * MAX_BRIGHTNESS_OFFSET;
  return GRAY_STEPS.map(({ token, lightness }) => {
    // Clamp adjusted lightness to 1-99% to avoid pure black/white.
    const adjusted = Math.min(99, Math.max(1, lightness + lightnessOffset));
    return {
      token,
      value: `hsl(${hue}, ${saturationOffset}%, ${adjusted}%)`,
    };
  });
}

/**
 * Applies tinted gray palette as inline style overrides on the document root.
 * When no customization is active (saturation=0, brightness=0), clears the overrides
 * to restore original CSS hex values.
 */
export function applyTintedPalette(hue: number, saturation: number, brightness: number = 0): void {
  if (!isPaletteActive(saturation, brightness)) {
    clearTintedPalette();
    return;
  }

  const palette = generateTintedPalette(hue, saturation, brightness);
  const root = document.documentElement;
  for (const { token, value } of palette) {
    root.style.setProperty(token, value);
  }
}

/**
 * Removes all tinted palette inline style overrides from the document root,
 * restoring the original hex values declared in colors.css.
 */
export function clearTintedPalette(): void {
  const root = document.documentElement;
  for (const { token } of GRAY_STEPS) {
    root.style.removeProperty(token);
  }
}

/**
 * Persists palette hue, saturation, and brightness to per-theme localStorage keys
 * for the FOUC-prevention script in index.html.
 */
export function savePaletteTintToLocalStorage(
  theme: 'light' | 'dark',
  hue: number,
  saturation: number,
  brightness: number = 0
): void {
  try {
    if (theme === 'light') {
      localStorage.setItem(LS_KEY_HUE_LIGHT, String(hue));
      localStorage.setItem(LS_KEY_TONE_LIGHT, String(saturation));
      localStorage.setItem(LS_KEY_BRIGHTNESS_LIGHT, String(brightness));
    } else {
      localStorage.setItem(LS_KEY_HUE_DARK, String(hue));
      localStorage.setItem(LS_KEY_TONE_DARK, String(saturation));
      localStorage.setItem(LS_KEY_BRIGHTNESS_DARK, String(brightness));
    }
  } catch {
    // Silently ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

/**
 * Removes all palette hue, saturation, and brightness keys from localStorage,
 * including old single-value keys for migration cleanup.
 */
export function clearPaletteTintFromLocalStorage(): void {
  try {
    // Remove per-theme keys.
    localStorage.removeItem(LS_KEY_HUE_LIGHT);
    localStorage.removeItem(LS_KEY_TONE_LIGHT);
    localStorage.removeItem(LS_KEY_BRIGHTNESS_LIGHT);
    localStorage.removeItem(LS_KEY_HUE_DARK);
    localStorage.removeItem(LS_KEY_TONE_DARK);
    localStorage.removeItem(LS_KEY_BRIGHTNESS_DARK);
    // Remove old single-value keys.
    localStorage.removeItem(LS_KEY_HUE_OLD);
    localStorage.removeItem(LS_KEY_TONE_OLD);
    localStorage.removeItem(LS_KEY_BRIGHTNESS_OLD);
  } catch {
    // Silently ignore storage errors
  }
}
