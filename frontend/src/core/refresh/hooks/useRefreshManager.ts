/**
 * frontend/src/core/refresh/hooks/useRefreshManager.ts
 *
 * React hook for useRefreshManager.
 * Encapsulates state and side effects for the core layer.
 */

import { useCallback } from 'react';
import { useRefreshManagerContext } from '../contexts/RefreshManagerContext';
import type { RefreshContext, Refresher, RefresherState } from '../RefreshManager';
import type { RefresherName } from '../refresherTypes';

/**
 * Hook to interact with the RefreshManager
 */
export const useRefreshManager = () => {
  const { manager } = useRefreshManagerContext();

  const register = useCallback(
    (refresher: Refresher) => {
      manager.register(refresher);
    },
    [manager]
  );

  const unregister = useCallback(
    (name: RefresherName) => {
      manager.unregister(name);
    },
    [manager]
  );

  const triggerManualRefresh = useCallback(
    async (name: RefresherName) => {
      await manager.triggerManualRefresh(name);
    },
    [manager]
  );

  const triggerManualRefreshForContext = useCallback(
    async (context?: RefreshContext) => {
      await manager.triggerManualRefreshForContext(context);
    },
    [manager]
  );

  const pause = useCallback(
    (name?: RefresherName) => {
      manager.pause(name);
    },
    [manager]
  );

  const resume = useCallback(
    (name?: RefresherName) => {
      manager.resume(name);
    },
    [manager]
  );

  const getState = useCallback(
    (name: RefresherName): RefresherState | null => {
      return manager.getState(name);
    },
    [manager]
  );

  return {
    register,
    unregister,
    triggerManualRefresh,
    triggerManualRefreshForContext,
    pause,
    resume,
    getState,
  };
};
