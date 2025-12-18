/**
 * ModalStateContext
 *
 * Manages modal state for Settings and About dialogs.
 * Split from ViewStateContext to reduce re-render scope.
 */
import React, { createContext, useContext, useState, useMemo } from 'react';

interface ModalStateContextType {
  isSettingsOpen: boolean;
  isAboutOpen: boolean;

  setIsSettingsOpen: (open: boolean) => void;
  setIsAboutOpen: (open: boolean) => void;
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

  const value = useMemo(
    () => ({
      isSettingsOpen,
      isAboutOpen,
      setIsSettingsOpen,
      setIsAboutOpen,
    }),
    [isSettingsOpen, isAboutOpen]
  );

  return <ModalStateContext.Provider value={value}>{children}</ModalStateContext.Provider>;
};
