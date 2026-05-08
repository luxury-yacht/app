/**
 * frontend/src/core/contexts/AppearanceModeContext.tsx
 *
 * Handles light, dark, and system appearance modes with persistence and backend sync.
 * Applies the resolved light/dark mode to the document and listens for system changes.
 * Also listens for mode change events from the application menu.
 */
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { eventBus } from '@/core/events';
import { getAppearanceModePreference, type AppearanceMode } from '@/core/settings/appPreferences';

type ResolvedAppearanceMode = 'light' | 'dark';

interface AppearanceModeContextType {
  mode: AppearanceMode;
  resolvedMode: ResolvedAppearanceMode;
}

const AppearanceModeContext = createContext<AppearanceModeContextType | undefined>(undefined);

export const useAppearanceMode = () => {
  const context = useContext(AppearanceModeContext);
  if (!context) {
    throw new Error('useAppearanceMode must be used within AppearanceModeProvider');
  }
  return context;
};

interface AppearanceModeProviderProps {
  children: ReactNode;
}

export const AppearanceModeProvider: React.FC<AppearanceModeProviderProps> = ({ children }) => {
  const [mode, setMode] = useState<AppearanceMode>(() => getAppearanceModePreference());

  const detectSystemAppearanceMode = (): ResolvedAppearanceMode => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return isDark ? 'dark' : 'light';
    }
    return 'light';
  };

  // Resolve the current effective mode from the document attribute set by the FOUC script.
  const getInitialResolvedMode = (): ResolvedAppearanceMode => {
    const attr = document.documentElement.getAttribute('data-appearance-mode');
    return attr === 'dark' ? 'dark' : 'light';
  };

  const [resolvedMode, setResolvedMode] = useState<ResolvedAppearanceMode>(getInitialResolvedMode);

  const applyResolvedMode = (next: ResolvedAppearanceMode) => {
    document.documentElement.setAttribute('data-appearance-mode', next);
    document.documentElement.className = next;
    setResolvedMode((prev) => {
      if (prev !== next) {
        // Emit after state update via microtask so subscribers see the new value.
        queueMicrotask(() => {
          eventBus.emit('settings:appearance-mode-resolved', next);
        });
      }
      return next;
    });
  };

  useEffect(() => {
    const preference = getAppearanceModePreference();
    const initialMode = preference === 'system' ? detectSystemAppearanceMode() : preference;

    applyResolvedMode(initialMode);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemModeChange = (e: MediaQueryListEvent) => {
      const currentPreference = getAppearanceModePreference();
      if (currentPreference === 'system') {
        const newMode = e.matches ? 'dark' : 'light';
        applyResolvedMode(newMode);
      }
    };

    mediaQuery.addEventListener('change', handleSystemModeChange);

    const applyModePreference = (nextMode: AppearanceMode) => {
      const resolved =
        nextMode === 'system' ? detectSystemAppearanceMode() : (nextMode as ResolvedAppearanceMode);
      applyResolvedMode(resolved);
      setMode(nextMode);
    };

    const unsubscribeAppearanceMode = eventBus.on('settings:appearance-mode', applyModePreference);

    const handleBackendAppearanceModeChanged = () => {
      window.location.reload();
    };

    const runtime = window.runtime;
    runtime?.EventsOn?.('appearance-mode-changed', handleBackendAppearanceModeChanged);

    // Cleanup function
    return () => {
      mediaQuery.removeEventListener('change', handleSystemModeChange);
      unsubscribeAppearanceMode();

      runtime?.EventsOff?.('appearance-mode-changed');
    };
  }, []);

  return (
    <AppearanceModeContext.Provider value={{ mode, resolvedMode }}>
      {children}
    </AppearanceModeContext.Provider>
  );
};
