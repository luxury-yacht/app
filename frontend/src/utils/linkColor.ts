/**
 * frontend/src/utils/linkColor.ts
 *
 * Applies custom link color overrides for the object panel link CSS variables.
 * Unlike accent colors (which generate a full shade palette), link colors are
 * simpler: a base color for --color-object-panel-link and a lightened variant
 * for --color-object-panel-link-hover.
 *
 * Persists the chosen hex per theme to localStorage so the FOUC-prevention
 * script in index.html can apply overrides before React mounts.
 *
 * IMPORTANT: The hover lightness offset (±12) and direction logic are
 * duplicated in the inline <script> in frontend/index.html for FOUC
 * prevention. Keep both in sync.
 */

import { hexToHsl, hslToHex } from './accentColor';

// localStorage keys for FOUC prevention bridge.
const LS_KEY_LINK_LIGHT = 'app-link-color-light';
const LS_KEY_LINK_DARK = 'app-link-color-dark';

// Hover shifts lightness by this amount: lighter in dark mode, darker in light mode.
const HOVER_LIGHTNESS_OFFSET = 12;

/**
 * Generate a hover color from a base hex by shifting lightness in HSL space.
 * Dark mode: lightens (+offset). Light mode: darkens (-offset).
 */
export function generateLinkHoverColor(hex: string, mode: 'light' | 'dark'): string {
  const { h, s, l } = hexToHsl(hex);
  const direction = mode === 'dark' ? 1 : -1;
  const adjusted = Math.min(95, Math.max(5, l + HOVER_LIGHTNESS_OFFSET * direction));
  return hslToHex(h, s, adjusted);
}

/**
 * Apply link color overrides on document.documentElement.style for the
 * current resolved theme. Pass empty string to remove overrides.
 */
export function applyLinkColor(hex: string, resolvedTheme: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (hex) {
    root.style.setProperty('--color-object-panel-link', hex);
    root.style.setProperty(
      '--color-object-panel-link-hover',
      generateLinkHoverColor(hex, resolvedTheme)
    );
  } else {
    root.style.removeProperty('--color-object-panel-link');
    root.style.removeProperty('--color-object-panel-link-hover');
  }
}

/**
 * Remove all link color overrides from inline styles.
 */
export function clearLinkColor(): void {
  const root = document.documentElement;
  root.style.removeProperty('--color-object-panel-link');
  root.style.removeProperty('--color-object-panel-link-hover');
}

/**
 * Persist link color hex to localStorage for the FOUC-prevention script.
 */
export function saveLinkColorToLocalStorage(theme: 'light' | 'dark', color: string): void {
  try {
    const key = theme === 'light' ? LS_KEY_LINK_LIGHT : LS_KEY_LINK_DARK;
    if (color) {
      localStorage.setItem(key, color);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Silently ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

/**
 * Remove all link color keys from localStorage.
 */
export function clearLinkColorFromLocalStorage(): void {
  try {
    localStorage.removeItem(LS_KEY_LINK_LIGHT);
    localStorage.removeItem(LS_KEY_LINK_DARK);
  } catch {
    // Silently ignore storage errors
  }
}
