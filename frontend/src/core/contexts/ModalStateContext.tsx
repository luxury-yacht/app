/**
 * frontend/src/core/contexts/ModalStateContext.tsx
 *
 * Manages modal state for Settings, About, diff viewer, and create resource dialogs.
 * Provides context for whether each modal is open or closed,
 * along with functions to update their states.
 */
import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';

interface ModalStateContextType {
  isSettingsOpen: boolean;
  isAboutOpen: boolean;
  isObjectDiffOpen: boolean;
  /**
   * Application-logs panel visibility. App-global (not per-cluster):
   * the app logs are the application's own log output, not workspace
   * content tied to a cluster, so the panel behaves like a tool window
   * that follows the user across cluster switches. Mirrors the existing
   * `isSettingsOpen` / `showDiagnostics` pattern for non-cluster panels.
   */
  showAppLogs: boolean;

  setIsSettingsOpen: (open: boolean) => void;
  setIsAboutOpen: (open: boolean) => void;
  setIsObjectDiffOpen: (open: boolean) => void;
  setShowAppLogs: (open: boolean) => void;
  toggleAppLogs: () => void;
}

const ModalStateContext = createContext<ModalStateContextType | undefined>(undefined);

export const useModalState = () => {
  const context = useContext(ModalStateContext);
  if (!context) {
    throw new Error('useModalState must be used within ModalStateProvider');
  }
  return context;
};

interface ModalStateProviderProps {
  children: React.ReactNode;
}

export const ModalStateProvider: React.FC<ModalStateProviderProps> = ({ children }) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isObjectDiffOpen, setIsObjectDiffOpen] = useState(false);
  const [showAppLogs, setShowAppLogs] = useState(false);

  const toggleAppLogs = useCallback(() => {
    setShowAppLogs((prev) => !prev);
  }, []);

  const value = useMemo(
    () => ({
      isSettingsOpen,
      isAboutOpen,
      isObjectDiffOpen,
      showAppLogs,
      setIsSettingsOpen,
      setIsAboutOpen,
      setIsObjectDiffOpen,
      setShowAppLogs,
      toggleAppLogs,
    }),
    [isSettingsOpen, isAboutOpen, isObjectDiffOpen, showAppLogs, toggleAppLogs]
  );

  return <ModalStateContext.Provider value={value}>{children}</ModalStateContext.Provider>;
};
