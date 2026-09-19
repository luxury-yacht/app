/**
 * frontend/src/core/refresh/hooks/useRefreshWatcher.ts
 *
 * React hook for useRefreshWatcher.
 * Encapsulates state and side effects for the core layer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '@/core/events';
import { useRefreshManagerContext } from '../contexts/RefreshManagerContext';
import type { RefresherState } from '../RefreshManager';
import type { RefresherName } from '../refresherTypes';

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
  dependencies?: unknown[];
}

/**
 * Hook for components to watch and respond to refresh events
 */
export const useRefreshWatcher = (options: UseRefreshWatcherOptions) => {
  const { refresherName, onRefresh, enabled = true, dependencies = [] } = options;
  const { manager } = useRefreshManagerContext();
  const [state, setState] = useState<RefresherState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const dependenciesSignature = useMemo(() => JSON.stringify(dependencies), [dependencies]);

  // Track the latest callback to avoid stale closures
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    void dependenciesSignature;
    setIsRefreshing(false);
    if (!enabled || !refresherName) {
      setState(null);
      return;
    }

    let unsubscribe = () => {};
    const subscribe = () => {
      unsubscribe();
      setIsRefreshing(false);
      let active = true;
      let pending = 0;
      const dispose = manager.subscribe(refresherName, async (isManual, signal) => {
        if (!active) return;
        pending++;
        setIsRefreshing(true);
        try {
          await callbackRef.current(isManual, signal);
        } finally {
          pending--;
          // A timeout or scope change can detach a callback before it settles.
          if (active) setIsRefreshing(pending > 0);
        }
      });
      unsubscribe = () => {
        active = false;
        dispose();
      };
    };
    const updateState = () => setState(manager.getState(refresherName));
    subscribe();
    updateState();

    const unsubRegistered = eventBus.on('refresh:registered', ({ name }) => {
      if (name === refresherName) {
        subscribe();
        updateState();
      }
    });
    const unsubStateChange = eventBus.on('refresh:state-change', ({ name, state: newState }) => {
      if (name === refresherName) setState(newState ?? null);
    });
    return () => {
      unsubscribe();
      unsubRegistered();
      unsubStateChange();
    };
  }, [manager, refresherName, enabled, dependenciesSignature]);

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
