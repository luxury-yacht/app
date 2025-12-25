/**
 * frontend/src/utils/themes.ts
 *
 * Utility helpers for themes.
 * Provides shared helper functions for the frontend.
 */

import { SetTheme } from '@wailsjs/go/backend/App';
import { eventBus } from '@/core/events';

/**
 * Detects the system's preferred theme (light or dark)
 */
const detectSystemTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

/**
 * Applies a theme to the document element
 * @param theme - The theme to apply ('light', 'dark', or 'system')
 */
const applyThemeToDocument = (theme: string): void => {
  let actualTheme = theme;
  if (theme === 'system') {
    actualTheme = detectSystemTheme();
  }
  document.documentElement.setAttribute('data-theme', actualTheme);
  document.documentElement.className = actualTheme;
};

/**
 * Changes the application theme
 * @param theme - The theme to set ('light', 'dark', or 'system')
 * @returns Promise that resolves when theme is changed
 */
export const changeTheme = async (theme: string): Promise<void> => {
  try {
    // Update localStorage with preference
    localStorage.setItem('app-theme-preference', theme);

    // Update backend
    await SetTheme(theme);

    // Apply theme to document
    applyThemeToDocument(theme);

    // Emit theme-changed event for any listeners
    eventBus.emit('settings:theme', theme);
  } catch (error) {
    console.error('Failed to change theme:', error);
    throw error;
  }
};

/**
 * Initializes theme change listener for system theme changes
 * @returns Cleanup function to remove listener
 */
export const initSystemThemeListener = (): (() => void) => {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const handleSystemThemeChange = (_e: MediaQueryListEvent) => {
    const preference = localStorage.getItem('app-theme-preference');
    if (preference === 'system' || !preference) {
      applyThemeToDocument('system');
    }
  };

  mediaQuery.addEventListener('change', handleSystemThemeChange);

  return () => {
    mediaQuery.removeEventListener('change', handleSystemThemeChange);
  };
};
