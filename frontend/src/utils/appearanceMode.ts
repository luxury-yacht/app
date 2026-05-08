/**
 * frontend/src/utils/appearanceMode.ts
 *
 * Utility helpers for appearance modes.
 * Provides shared helper functions for the frontend.
 */

import {
  getAppearanceModePreference,
  setAppearanceModePreference,
  type AppearanceMode,
} from '@/core/settings/appPreferences';

/**
 * Detects the system's preferred appearance mode (light or dark).
 */
const detectSystemAppearanceMode = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

/**
 * Applies an appearance mode to the document element.
 */
const applyAppearanceModeToDocument = (mode: AppearanceMode): void => {
  const resolvedMode = mode === 'system' ? detectSystemAppearanceMode() : mode;
  document.documentElement.setAttribute('data-appearance-mode', resolvedMode);
  document.documentElement.className = resolvedMode;
};

/**
 * Changes the application appearance mode.
 */
export const changeAppearanceMode = async (mode: AppearanceMode): Promise<void> => {
  try {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
      throw new Error(`Invalid appearance mode: ${mode}`);
    }

    // Persist preference in backend and update cached state.
    await setAppearanceModePreference(mode);

    applyAppearanceModeToDocument(mode);
  } catch (error) {
    console.error('Failed to change appearance mode:', error);
    throw error;
  }
};

/**
 * Initializes a listener for system appearance mode changes.
 */
export const initSystemAppearanceModeListener = (): (() => void) => {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const handleSystemModeChange = (_e: MediaQueryListEvent) => {
    const preference = getAppearanceModePreference();
    if (preference === 'system' || !preference) {
      applyAppearanceModeToDocument('system');
    }
  };

  mediaQuery.addEventListener('change', handleSystemModeChange);

  return () => {
    mediaQuery.removeEventListener('change', handleSystemModeChange);
  };
};
