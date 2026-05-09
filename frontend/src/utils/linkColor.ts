/**
 * frontend/src/utils/linkColor.ts
 *
 * Applies custom link color overrides for the object panel link CSS variables.
 * Unlike accent colors (which generate a full shade palette), link colors are
 * simpler: a base color for --color-object-panel-link and a lightened variant
 * for --color-object-panel-link-hover.
 *
 * Startup FOUC prevention uses the precomputed payload from appearanceBootstrap.ts.
 */

import { hexToHsl, hslToHex } from './accentColor';

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
 * current resolved appearance mode. Pass empty string to remove overrides.
 */
export function applyLinkColor(hex: string, resolvedMode: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (hex) {
    root.style.setProperty('--color-object-panel-link', hex);
    root.style.setProperty(
      '--color-object-panel-link-hover',
      generateLinkHoverColor(hex, resolvedMode)
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
