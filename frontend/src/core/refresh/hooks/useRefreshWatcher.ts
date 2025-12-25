/**
 * frontend/src/core/refresh/hooks/useRefreshWatcher.ts
 *
 * Hook to subscribe to refresh events for a refresher.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useRefreshManagerContext } from '../contexts/RefreshManagerContext';
import type { RefresherState } from '../RefreshManager';
import type { RefresherName } from '../refresherTypes';
import { eventBus } from '@/core/events';

interface UseRefreshWatcherOptions {
  /**
   * Name of the refresher to watch
   */
  refresherName: RefresherName | null;

  /**
   * Callback when refresh is triggered
   */
  onRefresh: (isManual: boolean, signal: AbortSignal) => void | Promise<void>;

  /**
   * Whether to enable watching
   */
  enabled?: boolean;

  /**
   * Dependencies that trigger re-subscription
   */
  dependencies?: any[];
}

/**
 * Hook for components to watch and respond to refresh events
 */
export const useRefreshWatcher = (options: UseRefreshWatcherOptions) => {
  const { refresherName, onRefresh, enabled = true, dependencies = [] } = options;
  const { manager } = useRefreshManagerContext();
  const [state, setState] = useState<RefresherState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const dependenciesSignature = useMemo(() => JSON.stringify(dependencies), [dependencies]);

  // Track the latest callback to avoid stale closures
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  // Wrapped callback that manages refreshing state
  const handleRefresh = useCallback(async (isManual: boolean, signal: AbortSignal) => {
    setIsRefreshing(true);
    try {
      await callbackRef.current(isManual, signal);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Subscribe to refresh events
  useEffect(() => {
    // Unsubscribe previous subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    // Only subscribe if enabled
    if (!enabled || !refresherName) {
      setState(null);
      return;
    }

    // Function to subscribe
    const subscribe = () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      if (!refresherName) {
        return;
      }
      unsubscribeRef.current = manager.subscribe(refresherName, handleRefresh);
    };

    // Subscribe initially
    subscribe();

    const updateState = () => {
      if (!refresherName) {
        setState(null);
        return;
      }
      const newState = manager.getState(refresherName);
      setState(newState);
    };

    updateState();

    // Re-subscribe when the refresher is registered
    const unsubRegistered = eventBus.on('refresh:registered', ({ name }) => {
      if (refresherName && name === refresherName) {
        subscribe();
        updateState();
      }
    });

    const unsubStateChange = eventBus.on('refresh:state-change', ({ name, state: newState }) => {
      if (name === refresherName) {
        setState(newState ?? null);
      }
    });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      unsubRegistered();
      unsubStateChange();
    };
  }, [manager, refresherName, enabled, handleRefresh, dependenciesSignature]);

  // Manual refresh trigger
  const triggerRefresh = useCallback(async () => {
    if (!refresherName) {
      return;
    }
    await manager.triggerManualRefresh(refresherName);
  }, [manager, refresherName]);

  return {
    state,
    isRefreshing,
    triggerRefresh,
  };
};
