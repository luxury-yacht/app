/**
 * frontend/src/core/contexts/ModalStateContext.tsx
 *
 * Manages modal state for Settings, About, and diff viewer dialogs.
 * Provides context for whether each modal is open or closed,
 * along with functions to update their states.
 */
import React, { createContext, useContext, useState, useMemo } from 'react';

interface ModalStateContextType {
  isSettingsOpen: boolean;
  isAboutOpen: boolean;
  isObjectDiffOpen: boolean;

  setIsSettingsOpen: (open: boolean) => void;
  setIsAboutOpen: (open: boolean) => void;
  setIsObjectDiffOpen: (open: boolean) => void;
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

  const value = useMemo(
    () => ({
      isSettingsOpen,
      isAboutOpen,
      isObjectDiffOpen,
      setIsSettingsOpen,
      setIsAboutOpen,
      setIsObjectDiffOpen,
    }),
    [isSettingsOpen, isAboutOpen, isObjectDiffOpen]
  );

  return <ModalStateContext.Provider value={value}>{children}</ModalStateContext.Provider>;
};
