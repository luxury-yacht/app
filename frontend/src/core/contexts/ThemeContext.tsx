/**
 * frontend/src/core/contexts/ThemeContext.tsx
 *
 * Handles light, dark, and system themes with persistence and backend sync.
 * Applies theme to document and listens for system changes.
 * Also listens for theme change events from the application menu.
 */
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { eventBus } from '@/core/events';
import { getThemePreference } from '@/core/settings/appPreferences';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
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
  const [theme, setTheme] = useState<Theme>(() => getThemePreference());

  // Helper to detect system theme
  const detectSystemTheme = (): 'light' | 'dark' => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return isDark ? 'dark' : 'light';
    }
    return 'light';
  };

  // Resolve the current effective theme from the document attribute set by the FOUC script.
  const getInitialResolvedTheme = (): 'light' | 'dark' => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' ? 'dark' : 'light';
  };

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(getInitialResolvedTheme);

  // Apply theme to document and update resolved state.
  const applyTheme = (next: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.className = next;
    setResolvedTheme((prev) => {
      if (prev !== next) {
        // Emit after state update via microtask so subscribers see the new value.
        queueMicrotask(() => eventBus.emit('settings:theme-resolved', next));
      }
      return next;
    });
  };

  // Initialize theme
  useEffect(() => {
    const preference = getThemePreference();
    const initialTheme = preference === 'system' ? detectSystemTheme() : preference;

    // Apply the theme immediately for first paint.
    applyTheme(initialTheme);

    // Add listener for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      const currentPreference = getThemePreference();
      if (currentPreference === 'system') {
        const newTheme = e.matches ? 'dark' : 'light';
        applyTheme(newTheme);
      }
    };

    // Use addEventListener (modern approach)
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    const unsubscribeTheme = eventBus.on('settings:theme', (nextTheme) => {
      const resolved =
        nextTheme === 'system' ? detectSystemTheme() : (nextTheme as 'light' | 'dark');
      applyTheme(resolved);
      setTheme(nextTheme as Theme);
    });

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
      unsubscribeTheme();

      runtime?.EventsOff?.('theme-changed');
    };
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme }}>{children}</ThemeContext.Provider>;
};
