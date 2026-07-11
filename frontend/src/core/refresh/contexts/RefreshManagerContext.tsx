/**
 * frontend/src/core/refresh/contexts/RefreshManagerContext.tsx
 *
 * Context and provider for RefreshManagerContext.
 * Defines shared state and accessors for the core layer.
 */

import type React from 'react';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { eventBus } from '@/core/events';
import { refreshManager } from '../RefreshManager';

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
