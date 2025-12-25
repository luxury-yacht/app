/**
 * frontend/src/core/refresh/contexts/RefreshManagerContext.tsx
 *
 * Context provider for the refresh manager and visibility handling.
 */
import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { refreshManager } from '../RefreshManager';
import { eventBus } from '@/core/events';

interface RefreshManagerContextType {
  manager: typeof refreshManager;
}

const RefreshManagerContext = createContext<RefreshManagerContextType | undefined>(undefined);

export const useRefreshManagerContext = () => {
  const context = useContext(RefreshManagerContext);
  if (!context) {
    throw new Error('useRefreshManagerContext must be used within RefreshManagerProvider');
  }
  return context;
};

interface RefreshManagerProviderProps {
  children: ReactNode;
}

/**
 * RefreshManagerProvider - Provides RefreshManager to the app and keeps context synchronized
 */
export const RefreshManagerProvider: React.FC<RefreshManagerProviderProps> = ({ children }) => {
  // Handle Page Visibility API
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        refreshManager.pause();
        eventBus.emit('app:visibility-hidden');
      } else {
        refreshManager.resume();
        eventBus.emit('app:visibility-visible');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const contextValue = {
    manager: refreshManager,
  };

  return (
    <RefreshManagerContext.Provider value={contextValue}>{children}</RefreshManagerContext.Provider>
  );
};
