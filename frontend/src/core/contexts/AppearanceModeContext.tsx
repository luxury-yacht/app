/**
 * frontend/src/core/contexts/AppearanceModeContext.tsx
 *
 * Handles light, dark, and system appearance modes with persisted preferences.
 * Applies the resolved light/dark mode to the document and listens for system changes.
 * Also listens for mode changes from the frontend settings event bus.
 */
import type React from 'react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { desktopRuntimeAvailable, onBroadcastEvent } from '@/core/desktop-runtime';
import { eventBus } from '@/core/events';
import {
  type AppearanceMode,
  applyBroadcastAppearanceModePreference,
  getAppearanceModePreference,
} from '@/core/settings/appPreferences';
import { applyAppearanceOverrides } from '@/utils/appearanceMode';

type ResolvedAppearanceMode = 'light' | 'dark';

interface AppearanceModeContextType {
  mode: AppearanceMode;
  resolvedMode: ResolvedAppearanceMode;
}

const AppearanceModeContext = createContext<AppearanceModeContextType | undefined>(undefined);

const detectSystemAppearanceMode = (): ResolvedAppearanceMode => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? 'dark' : 'light';
  }
  return 'light';
};

const getInitialResolvedMode = (): ResolvedAppearanceMode => {
  const attr = document.documentElement.dataset.appearanceMode;
  return attr === 'dark' ? 'dark' : 'light';
};

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

  const [resolvedMode, setResolvedMode] = useState<ResolvedAppearanceMode>(getInitialResolvedMode);

  const applyResolvedMode = useCallback((next: ResolvedAppearanceMode) => {
    document.documentElement.dataset.appearanceMode = next;
    document.documentElement.className = next;
    applyAppearanceOverrides(next);
    setResolvedMode((prev) => {
      if (prev !== next) {
        // Emit after state update via microtask so subscribers see the new value.
        queueMicrotask(() => {
          eventBus.emit('settings:appearance-mode-resolved', next);
        });
      }
      return next;
    });
  }, []);

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
    const unsubscribeBroadcast = desktopRuntimeAvailable()
      ? onBroadcastEvent('settings:appearance-mode-changed', ({ mode: nextMode }) => {
          applyBroadcastAppearanceModePreference(nextMode);
        })
      : () => undefined;

    // Cleanup function
    return () => {
      mediaQuery.removeEventListener('change', handleSystemModeChange);
      unsubscribeAppearanceMode();
      unsubscribeBroadcast();
    };
  }, [applyResolvedMode]);

  return (
    <AppearanceModeContext.Provider value={{ mode, resolvedMode }}>
      {children}
    </AppearanceModeContext.Provider>
  );
};
