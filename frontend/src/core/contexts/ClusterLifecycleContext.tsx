/**
 * frontend/src/core/contexts/ClusterLifecycleContext.tsx
 *
 * React context that subscribes to backend `cluster:lifecycle` events and
 * provides per-cluster lifecycle state to the component tree.
 * Hydrates from the backend on mount, then keeps state in sync via Wails
 * runtime events. Cleans up entries when clusters are deselected.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

// ---------- Types ----------

export type ClusterLifecycleState =
  | 'connecting'
  | 'auth_failed'
  | 'connected'
  | 'loading'
  | 'loading_slow'
  | 'ready'
  | 'disconnected'
  | 'reconnecting'
  | '';

interface ClusterLifecycleContextType {
  getClusterState: (clusterId: string) => ClusterLifecycleState;
  isClusterReady: (clusterId: string) => boolean;
}

// ---------- Context ----------

const ClusterLifecycleContext = createContext<ClusterLifecycleContextType | undefined>(undefined);

// ---------- Hook ----------

export const useClusterLifecycle = (): ClusterLifecycleContextType => {
  const context = useContext(ClusterLifecycleContext);
  if (!context) {
    throw new Error('useClusterLifecycle must be used within ClusterLifecycleProvider');
  }
  return context;
};

// ---------- Provider ----------

interface ClusterLifecycleProviderProps {
  children: React.ReactNode;
}

export const ClusterLifecycleProvider: React.FC<ClusterLifecycleProviderProps> = ({ children }) => {
  const [states, setStates] = useState<Map<string, ClusterLifecycleState>>(() => new Map());
  const { selectedClusterIds } = useKubeconfig();

  // Subscribe to lifecycle events FIRST, then hydrate. This ensures any events
  // emitted between the hydration RPC call and its response aren't lost.
  useEffect(() => {
    let active = true;
    const runtime = (window as any).runtime;

    // 1. Subscribe to live events.
    const handleLifecycleEvent = (...args: unknown[]) => {
      const payload = args[0] as
        | { clusterId?: string; state?: string; previousState?: string }
        | undefined;
      if (!active || !payload?.clusterId || !payload.state) {
        return;
      }
      setStates((prev) => {
        const next = new Map(prev);
        next.set(payload.clusterId!, payload.state as ClusterLifecycleState);
        return next;
      });
    };

    const dispose = runtime?.EventsOn?.('cluster:lifecycle', handleLifecycleEvent);

    // 2. Hydrate current state from backend. Events that arrive between the RPC
    //    and its resolution are handled by the subscription above. We merge
    //    hydrated state with any events already received so newer events win.
    const runtimeApp = (window as any)?.go?.backend?.App;
    if (runtimeApp?.GetAllClusterLifecycleStates) {
      runtimeApp.GetAllClusterLifecycleStates().then((result: Record<string, string> | null) => {
        if (active && result) {
          setStates((prev) => {
            const merged = new Map(Object.entries(result) as [string, ClusterLifecycleState][]);
            // Events received after the RPC was sent take precedence.
            prev.forEach((state, id) => merged.set(id, state));
            return merged;
          });
        }
      });
    }

    return () => {
      active = false;
      if (typeof dispose === 'function') dispose();
    };
  }, []);

  // Clean up entries when clusters are removed from selectedClusterIds.
  useEffect(() => {
    setStates((prev) => {
      const selectedSet = new Set(selectedClusterIds);
      let changed = false;
      const next = new Map<string, ClusterLifecycleState>();

      for (const [id, state] of prev) {
        if (selectedSet.has(id)) {
          next.set(id, state);
        } else {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [selectedClusterIds]);

  // ---------- Accessors ----------

  const getClusterState = useCallback(
    (clusterId: string): ClusterLifecycleState => {
      return states.get(clusterId) || '';
    },
    [states]
  );

  const isClusterReady = useCallback(
    (clusterId: string): boolean => {
      return states.get(clusterId) === 'ready';
    },
    [states]
  );

  // ---------- Context value ----------

  const value = useMemo<ClusterLifecycleContextType>(
    () => ({
      getClusterState,
      isClusterReady,
    }),
    [getClusterState, isClusterReady]
  );

  return (
    <ClusterLifecycleContext.Provider value={value}>{children}</ClusterLifecycleContext.Provider>
  );
};
