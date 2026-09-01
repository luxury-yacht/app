/**
 * frontend/src/utils/appearanceMode.ts
 *
 * Utility helpers for appearance modes.
 * Provides shared helper functions for the frontend.
 */

import { applyAccentBg, applyAccentColor } from '@utils/accentColor';
import { applyLinkColor } from '@utils/linkColor';
import { applyTintedPalette, isPaletteActive } from '@utils/paletteTint';
import {
  type AppearanceMode,
  getAccentColor,
  getLinkColor,
  getPaletteTint,
  setAppearanceModePreference,
} from '@/core/settings/appPreferences';

export const resolveAppearanceMode = (): 'light' | 'dark' =>
  document.documentElement.dataset.appearanceMode === 'dark' ? 'dark' : 'light';

export const applyAppearanceOverrides = (mode: 'light' | 'dark'): void => {
  const tint = getPaletteTint(mode);
  if (isPaletteActive(tint.saturation, tint.brightness)) {
    applyTintedPalette(tint.hue, tint.saturation, tint.brightness);
  } else {
    applyTintedPalette(0, 0, 0);
  }

  const lightAccent = getAccentColor('light');
  const darkAccent = getAccentColor('dark');
  applyAccentColor(lightAccent, darkAccent);
  applyAccentBg(mode === 'light' ? lightAccent : darkAccent, mode);

  const linkColor = getLinkColor(mode);
  applyLinkColor(linkColor, mode);
};

/**
 * Changes the application appearance mode.
 * AppearanceModeProvider observes the preference event and owns document updates.
 */
export const changeAppearanceMode = async (mode: AppearanceMode): Promise<void> => {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
    throw new Error(`Invalid appearance mode: ${mode}`);
  }

  // Persist preference in backend and update cached state.
  await setAppearanceModePreference(mode);
};
