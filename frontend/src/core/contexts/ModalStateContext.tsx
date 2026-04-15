/**
 * frontend/src/core/contexts/ModalStateContext.tsx
 *
 * Manages modal state for Settings, About, and diff viewer dialogs.
 * Provides context for whether each modal is open or closed,
 * along with functions to update their states.
 */
import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { eventBus } from '@/core/events';
import type { ObjectDiffOpenRequest } from '@shared/components/diff/objectDiffSelection';

interface ModalStateContextType {
  isSettingsOpen: boolean;
  isAboutOpen: boolean;
  isObjectDiffOpen: boolean;
  objectDiffOpenRequest: ObjectDiffOpenRequest | null;
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
  openObjectDiff: (request?: { left?: ObjectDiffOpenRequest['left'] }) => void;
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
  const [objectDiffOpenRequest, setObjectDiffOpenRequest] = useState<ObjectDiffOpenRequest | null>(
    null
  );
  const [showAppLogs, setShowAppLogs] = useState(false);

  const toggleAppLogs = useCallback(() => {
    setShowAppLogs((prev) => !prev);
  }, []);

  const openObjectDiff = useCallback((request?: { left?: ObjectDiffOpenRequest['left'] }) => {
    setObjectDiffOpenRequest((prev) => ({
      requestId: (prev?.requestId ?? 0) + 1,
      left: request?.left ?? null,
    }));
    setIsObjectDiffOpen(true);
  }, []);

  React.useEffect(() => {
    return eventBus.on('view:open-object-diff', (request) => {
      setObjectDiffOpenRequest(request);
      setIsObjectDiffOpen(true);
    });
  }, []);

  const value = useMemo(
    () => ({
      isSettingsOpen,
      isAboutOpen,
      isObjectDiffOpen,
      objectDiffOpenRequest,
      showAppLogs,
      setIsSettingsOpen,
      setIsAboutOpen,
      setIsObjectDiffOpen,
      openObjectDiff,
      setShowAppLogs,
      toggleAppLogs,
    }),
    [
      isSettingsOpen,
      isAboutOpen,
      isObjectDiffOpen,
      objectDiffOpenRequest,
      showAppLogs,
      openObjectDiff,
      toggleAppLogs,
    ]
  );

  return <ModalStateContext.Provider value={value}>{children}</ModalStateContext.Provider>;
};
