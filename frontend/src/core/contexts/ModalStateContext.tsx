/**
 * frontend/src/core/contexts/ModalStateContext.tsx
 *
 * Manages modal state for Settings, About, diff viewer, and create resource dialogs.
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
  isCreateResourceOpen: boolean;
  /**
   * Application Logs Panel visibility. App-global (not per-cluster):
   * Application Logs are the application's own log output, not workspace
   * content tied to a cluster, so the panel behaves like a tool window
   * that follows the user across cluster switches. Mirrors the existing
   * `isSettingsOpen` / `showDiagnostics` pattern for non-cluster panels.
   */
  showAppLogsPanel: boolean;

  setIsSettingsOpen: (open: boolean) => void;
  setIsAboutOpen: (open: boolean) => void;
  setIsObjectDiffOpen: (open: boolean) => void;
  setIsCreateResourceOpen: (open: boolean) => void;
  openObjectDiff: (request?: { left?: ObjectDiffOpenRequest['left'] }) => void;
  setShowAppLogsPanel: (open: boolean) => void;
  toggleAppLogsPanel: () => void;
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
  const [isCreateResourceOpen, setIsCreateResourceOpen] = useState(false);
  const [showAppLogsPanel, setShowAppLogsPanel] = useState(false);

  const toggleAppLogsPanel = useCallback(() => {
    setShowAppLogsPanel((prev) => !prev);
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
      isCreateResourceOpen,
      showAppLogsPanel,
      setIsSettingsOpen,
      setIsAboutOpen,
      setIsObjectDiffOpen,
      setIsCreateResourceOpen,
      openObjectDiff,
      setShowAppLogsPanel,
      toggleAppLogsPanel,
    }),
    [
      isSettingsOpen,
      isAboutOpen,
      isObjectDiffOpen,
      objectDiffOpenRequest,
      isCreateResourceOpen,
      showAppLogsPanel,
      openObjectDiff,
      toggleAppLogsPanel,
    ]
  );

  return <ModalStateContext.Provider value={value}>{children}</ModalStateContext.Provider>;
};
