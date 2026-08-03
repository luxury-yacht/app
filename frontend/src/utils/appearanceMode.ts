/**
 * frontend/src/utils/appearanceMode.ts
 *
 * Utility helpers for appearance modes.
 * Provides shared helper functions for the frontend.
 */

import { type AppearanceMode, setAppearanceModePreference } from '@/core/settings/appPreferences';

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
