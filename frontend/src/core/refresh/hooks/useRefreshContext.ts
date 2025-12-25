/**
 * frontend/src/core/refresh/hooks/useRefreshContext.ts
 *
 * Hook for updating refresh context state.
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
