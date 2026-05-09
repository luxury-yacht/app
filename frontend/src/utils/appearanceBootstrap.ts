/**
 * frontend/src/utils/appearanceBootstrap.ts
 *
 * Persists computed appearance CSS variable overrides so the inline startup
 * script can replay them before React mounts without duplicating color math.
 */

import { generateAccentBg, generateAccentShades } from './accentColor';
import { generateLinkHoverColor } from './linkColor';
import { generateTintedPalette, isPaletteActive } from './paletteTint';

export const APPEARANCE_BOOTSTRAP_STORAGE_KEY = 'app-appearance-bootstrap-v1';

export type ResolvedAppearanceMode = 'light' | 'dark';

export interface AppearanceBootstrapModeSettings {
  paletteHue: number;
  paletteSaturation: number;
  paletteBrightness: number;
  accentColor: string;
  linkColor: string;
}

export interface AppearanceBootstrapSettings {
  light: AppearanceBootstrapModeSettings;
  dark: AppearanceBootstrapModeSettings;
}

export interface AppearanceBootstrapPayload {
  version: 1;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export function buildAppearanceBootstrapVariables(
  mode: ResolvedAppearanceMode,
  settings: AppearanceBootstrapModeSettings
): Record<string, string> {
  const variables: Record<string, string> = {};

  if (isPaletteActive(settings.paletteSaturation, settings.paletteBrightness)) {
    for (const { token, value } of generateTintedPalette(
      settings.paletteHue,
      settings.paletteSaturation,
      settings.paletteBrightness
    )) {
      variables[token] = value;
    }
  }

  if (settings.accentColor) {
    for (const { token, value } of generateAccentShades(settings.accentColor, mode)) {
      variables[token] = value;
    }
    const { token, value } = generateAccentBg(settings.accentColor, mode);
    variables[token] = value;
  }

  if (settings.linkColor) {
    variables['--color-object-panel-link'] = settings.linkColor;
    variables['--color-object-panel-link-hover'] = generateLinkHoverColor(settings.linkColor, mode);
  }

  return variables;
}

export function buildAppearanceBootstrapPayload(
  settings: AppearanceBootstrapSettings
): AppearanceBootstrapPayload {
  return {
    version: 1,
    light: buildAppearanceBootstrapVariables('light', settings.light),
    dark: buildAppearanceBootstrapVariables('dark', settings.dark),
  };
}

export function saveAppearanceBootstrapToLocalStorage(settings: AppearanceBootstrapSettings): void {
  try {
    localStorage.setItem(
      APPEARANCE_BOOTSTRAP_STORAGE_KEY,
      JSON.stringify(buildAppearanceBootstrapPayload(settings))
    );
  } catch {
    // Storage can be unavailable in tests, private browsing, or locked-down environments.
  }
}

export function clearAppearanceBootstrapFromLocalStorage(): void {
  try {
    localStorage.removeItem(APPEARANCE_BOOTSTRAP_STORAGE_KEY);
  } catch {
    // Silently ignore storage errors.
  }
}
