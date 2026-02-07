/**
 * frontend/src/utils/accentColor.ts
 *
 * Generates accent color shade scales from a base hex color using HSL lightness
 * offsets and applies them as CSS custom property overrides on
 * document.documentElement. Persists the chosen hex per theme to localStorage
 * so the FOUC-prevention script in index.html can apply shades before React mounts.
 *
 * IMPORTANT: The hex→HSL→hex conversion and lightness offset tables are
 * duplicated in the inline <script> in frontend/index.html for FOUC prevention.
 * Keep both in sync when changing the formula.
 */

// Lightness offsets for the light accent palette (base maps to 600 shade).
export const LIGHT_OFFSETS: Record<string, number> = {
  '--color-accent-light-700': -8,
  '--color-accent-light-600': 0, // base
  '--color-accent-light-500': 10,
  '--color-accent-light-400': 20,
  '--color-accent-light-300': 32,
};

// Lightness offsets for the dark accent palette (base maps to 500 shade).
export const DARK_OFFSETS: Record<string, number> = {
  '--color-accent-dark-700': -14,
  '--color-accent-dark-600': -7,
  '--color-accent-dark-500': 0, // base
  '--color-accent-dark-400': 7,
  '--color-accent-dark-300': 15,
  '--color-accent-dark-200': 27,
};

// localStorage keys for FOUC prevention bridge.
const LS_KEY_ACCENT_LIGHT = 'app-accent-color-light';
const LS_KEY_ACCENT_DARK = 'app-accent-color-dark';

/**
 * Parse a #rrggbb hex string to HSL values.
 * Returns { h: 0-360, s: 0-100, l: 0-100 }.
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL values to a #rrggbb hex string.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;

  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;

  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const toHex = (v: number) => {
    const hex = Math.round((v + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

/**
 * Parse a #rrggbb hex string to { r, g, b } integers (0-255).
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Generate accent shade scale from a base hex color for a given mode.
 * Each shade applies a lightness offset to the base HSL, clamped to 5%-95%.
 */
export function generateAccentShades(
  hex: string,
  mode: 'light' | 'dark'
): { token: string; value: string }[] {
  const { h, s, l } = hexToHsl(hex);
  const offsets = mode === 'light' ? LIGHT_OFFSETS : DARK_OFFSETS;

  return Object.entries(offsets).map(([token, offset]) => {
    const adjusted = Math.min(95, Math.max(5, l + offset));
    return { token, value: hslToHex(h, s, adjusted) };
  });
}

/**
 * Generate the --color-accent-bg override for the given accent hex and theme.
 * Alpha is 0.1 for light, 0.15 for dark.
 */
export function generateAccentBg(
  hex: string,
  mode: 'light' | 'dark'
): { token: string; value: string } {
  const { r, g, b } = hexToRgb(hex);
  const alpha = mode === 'light' ? 0.1 : 0.15;
  return { token: '--color-accent-bg', value: `rgba(${r}, ${g}, ${b}, ${alpha})` };
}

/**
 * Apply accent shade overrides for BOTH palettes on document.documentElement.style.
 * For each non-empty hex, generate shades and set CSS custom properties.
 * If a hex is empty, remove those overrides to restore CSS defaults.
 */
export function applyAccentColor(lightHex: string, darkHex: string): void {
  const root = document.documentElement;

  // Light palette shades.
  if (lightHex) {
    const shades = generateAccentShades(lightHex, 'light');
    for (const { token, value } of shades) {
      root.style.setProperty(token, value);
    }
  } else {
    for (const token of Object.keys(LIGHT_OFFSETS)) {
      root.style.removeProperty(token);
    }
  }

  // Dark palette shades.
  if (darkHex) {
    const shades = generateAccentShades(darkHex, 'dark');
    for (const { token, value } of shades) {
      root.style.setProperty(token, value);
    }
  } else {
    for (const token of Object.keys(DARK_OFFSETS)) {
      root.style.removeProperty(token);
    }
  }
}

/**
 * Set or remove --color-accent-bg override based on the current theme's accent hex.
 * Called on theme switch and when accent color changes.
 */
export function applyAccentBg(hex: string, resolvedTheme: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (hex) {
    const { value } = generateAccentBg(hex, resolvedTheme);
    root.style.setProperty('--color-accent-bg', value);
  } else {
    root.style.removeProperty('--color-accent-bg');
  }
}

/**
 * Remove all accent palette overrides and --color-accent-bg from inline styles.
 */
export function clearAccentColor(): void {
  const root = document.documentElement;
  for (const token of Object.keys(LIGHT_OFFSETS)) {
    root.style.removeProperty(token);
  }
  for (const token of Object.keys(DARK_OFFSETS)) {
    root.style.removeProperty(token);
  }
  root.style.removeProperty('--color-accent-bg');
}

/**
 * Persist accent color hex to localStorage for the FOUC-prevention script.
 */
export function saveAccentColorToLocalStorage(theme: 'light' | 'dark', color: string): void {
  try {
    const key = theme === 'light' ? LS_KEY_ACCENT_LIGHT : LS_KEY_ACCENT_DARK;
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
 * Remove all accent color keys from localStorage.
 */
export function clearAccentColorFromLocalStorage(): void {
  try {
    localStorage.removeItem(LS_KEY_ACCENT_LIGHT);
    localStorage.removeItem(LS_KEY_ACCENT_DARK);
  } catch {
    // Silently ignore storage errors
  }
}
