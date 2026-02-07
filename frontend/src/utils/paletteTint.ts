/**
 * frontend/src/utils/paletteTint.ts
 *
 * Generates tinted gray palettes using HSL and applies them as CSS custom
 * property overrides on document.documentElement. Persists hue/tone to
 * localStorage so the FOUC-prevention script in index.html can apply
 * the palette before React mounts.
 *
 * IMPORTANT: The lightness values and MAX_SATURATION constant are duplicated
 * in the inline <script> in frontend/index.html for FOUC prevention.
 * Keep both in sync when changing the formula.
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

// localStorage keys for FOUC prevention bridge.
const LS_KEY_HUE = 'app-palette-hue';
const LS_KEY_TONE = 'app-palette-tone';

/**
 * Generates an array of tinted palette entries from hue and tone values.
 * Each entry contains the CSS custom property token and its HSL value string.
 */
export function generateTintedPalette(
  hue: number,
  tone: number
): { token: string; value: string }[] {
  const saturation = (tone / 100) * MAX_SATURATION;
  return GRAY_STEPS.map(({ token, lightness }) => ({
    token,
    value: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
  }));
}

/**
 * Applies tinted gray palette as inline style overrides on the document root.
 * When tone is 0, clears the overrides to restore original CSS hex values.
 */
export function applyTintedPalette(hue: number, tone: number): void {
  if (tone === 0) {
    clearTintedPalette();
    return;
  }

  const palette = generateTintedPalette(hue, tone);
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
 * Persists palette hue and tone to localStorage for the FOUC-prevention
 * script in index.html.
 */
export function savePaletteTintToLocalStorage(hue: number, tone: number): void {
  try {
    localStorage.setItem(LS_KEY_HUE, String(hue));
    localStorage.setItem(LS_KEY_TONE, String(tone));
  } catch {
    // Silently ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

/**
 * Removes palette hue and tone from localStorage.
 */
export function clearPaletteTintFromLocalStorage(): void {
  try {
    localStorage.removeItem(LS_KEY_HUE);
    localStorage.removeItem(LS_KEY_TONE);
  } catch {
    // Silently ignore storage errors
  }
}
