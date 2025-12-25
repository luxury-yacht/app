/**
 * frontend/src/core/contexts/ThemeContext.tsx
 *
 * Handles light, dark, and system themes with persistence and backend sync.
 * Applies theme to document and listens for system changes.
 * Also listens for theme change events from the application menu.
 */
import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { GetThemeInfo } from '@wailsjs/go/backend/App';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // Helper to detect system theme
  const detectSystemTheme = () => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return isDark ? 'dark' : 'light';
    }
    return 'light';
  };

  // Apply theme to document
  const applyTheme = (theme: string) => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.className = theme;
  };

  // Initialize theme
  useEffect(() => {
    // Check if we have a preference in localStorage
    const savedPreference = localStorage.getItem('app-theme-preference');

    // Determine initial theme to apply
    let initialTheme: string;
    let preferenceToSave: string;

    if (savedPreference) {
      // We have a saved preference
      preferenceToSave = savedPreference;
      if (savedPreference === 'system') {
        initialTheme = detectSystemTheme();
      } else {
        initialTheme = savedPreference; // 'light' or 'dark'
      }
    } else {
      // No saved preference - default to system
      preferenceToSave = 'system';
      initialTheme = detectSystemTheme();
      localStorage.setItem('app-theme-preference', 'system');
    }

    // Apply the theme immediately
    applyTheme(initialTheme);

    // Fetch theme preference from backend (this runs whether we have localStorage or not)
    const setupTheme = async () => {
      try {
        const themeInfo = await GetThemeInfo();
        const userTheme = (themeInfo as any)?.userTheme;

        // Only update if backend has an explicit preference that differs from current
        if (userTheme && userTheme !== preferenceToSave) {
          localStorage.setItem('app-theme-preference', userTheme);

          if (userTheme === 'system') {
            const newTheme = detectSystemTheme();
            applyTheme(newTheme);
          } else {
            applyTheme(userTheme);
          }
        }
      } catch (error) {
        // Theme fetch errors are handled silently - fallback to system preference
      }
    };

    setupTheme();

    // Add listener for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      const currentPreference = localStorage.getItem('app-theme-preference');
      if (currentPreference === 'system') {
        const newTheme = e.matches ? 'dark' : 'light';
        applyTheme(newTheme);
      }
    };

    // Use addEventListener (modern approach)
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    // Listen for theme change events from menu
    const handleThemeChanged = () => {
      // Re-run theme setup when changed from menu
      window.location.reload();
    };

    const runtime = window.runtime;
    runtime?.EventsOn?.('theme-changed', handleThemeChanged);

    // Cleanup function
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);

      runtime?.EventsOff?.('theme-changed');
    };
  }, []);

  // Get current theme preference
  const theme = (localStorage.getItem('app-theme-preference') as Theme) || 'system';

  return <ThemeContext.Provider value={{ theme }}>{children}</ThemeContext.Provider>;
};
