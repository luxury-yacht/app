/**
 * frontend/src/utils/paletteTint.ts
 *
 * Generates tinted gray palettes using HSL and applies them as CSS custom
 * property overrides on document.documentElement. Persists hue/tone/brightness
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
  { token: '--color-gray-950', lightness: 4 },
  { token: '--color-gray-900', lightness: 10 },
  { token: '--color-gray-800', lightness: 18 },
  { token: '--color-gray-700', lightness: 25 },
  { token: '--color-gray-600', lightness: 32 },
  { token: '--color-gray-500', lightness: 44 },
  { token: '--color-gray-400', lightness: 54 },
  { token: '--color-gray-300', lightness: 69 },
  { token: '--color-gray-200', lightness: 82 },
  { token: '--color-gray-100', lightness: 88 },
  { token: '--color-gray-50', lightness: 96 },
];

// Maximum CSS saturation percentage when tone is at 100.
// 20% is enough to tint without losing the "gray" feel.
export const MAX_SATURATION = 20;

// Maximum lightness offset in percentage points when brightness is at ±50.
// brightness * (MAX_BRIGHTNESS_OFFSET / 50) gives the actual offset.
export const MAX_BRIGHTNESS_OFFSET = 10;

// localStorage keys for FOUC prevention bridge.
const LS_KEY_HUE = 'app-palette-hue';
const LS_KEY_TONE = 'app-palette-tone';
const LS_KEY_BRIGHTNESS = 'app-palette-brightness';

/**
 * Returns true when any palette customization is active and overrides
 * should be applied (tone > 0 or brightness != 0).
 */
export function isPaletteActive(tone: number, brightness: number): boolean {
  return tone > 0 || brightness !== 0;
}

/**
 * Generates an array of tinted palette entries from hue, tone, and brightness values.
 * Each entry contains the CSS custom property token and its HSL value string.
 *
 * @param brightness - Lightness offset (-50 to +50). Maps to ±MAX_BRIGHTNESS_OFFSET
 *                     percentage points of lightness. Each step is clamped to 1-99%.
 */
export function generateTintedPalette(
  hue: number,
  tone: number,
  brightness: number = 0
): { token: string; value: string }[] {
  const saturation = (tone / 100) * MAX_SATURATION;
  const lightnessOffset = (brightness / 50) * MAX_BRIGHTNESS_OFFSET;
  return GRAY_STEPS.map(({ token, lightness }) => {
    // Clamp adjusted lightness to 1-99% to avoid pure black/white.
    const adjusted = Math.min(99, Math.max(1, lightness + lightnessOffset));
    return {
      token,
      value: `hsl(${hue}, ${saturation}%, ${adjusted}%)`,
    };
  });
}

/**
 * Applies tinted gray palette as inline style overrides on the document root.
 * When no customization is active (tone=0, brightness=0), clears the overrides
 * to restore original CSS hex values.
 */
export function applyTintedPalette(hue: number, tone: number, brightness: number = 0): void {
  if (!isPaletteActive(tone, brightness)) {
    clearTintedPalette();
    return;
  }

  const palette = generateTintedPalette(hue, tone, brightness);
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
 * Persists palette hue, tone, and brightness to localStorage for the
 * FOUC-prevention script in index.html.
 */
export function savePaletteTintToLocalStorage(
  hue: number,
  tone: number,
  brightness: number = 0
): void {
  try {
    localStorage.setItem(LS_KEY_HUE, String(hue));
    localStorage.setItem(LS_KEY_TONE, String(tone));
    localStorage.setItem(LS_KEY_BRIGHTNESS, String(brightness));
  } catch {
    // Silently ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

/**
 * Removes palette hue, tone, and brightness from localStorage.
 */
export function clearPaletteTintFromLocalStorage(): void {
  try {
    localStorage.removeItem(LS_KEY_HUE);
    localStorage.removeItem(LS_KEY_TONE);
    localStorage.removeItem(LS_KEY_BRIGHTNESS);
  } catch {
    // Silently ignore storage errors
  }
}
