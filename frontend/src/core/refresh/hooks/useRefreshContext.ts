/**
 * frontend/src/core/refresh/hooks/useRefreshContext.ts
 *
 * React hook for useRefreshContext.
 * Encapsulates state and side effects for the core layer.
 */

import { useCallback } from 'react';
import type { RefreshContext } from '../RefreshManager';
import { refreshOrchestrator } from '../orchestrator';

/**
 * Hook to update the refresh context
 */
export const useRefreshContext = () => {
  const updateContext = useCallback((context: Partial<RefreshContext>) => {
    refreshOrchestrator.updateContext(context);
  }, []);

  return {
    updateContext,
  };
};
