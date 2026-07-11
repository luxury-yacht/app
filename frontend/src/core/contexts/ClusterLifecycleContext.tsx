/**
 * frontend/src/core/contexts/ClusterLifecycleContext.tsx
 *
 * React context that subscribes to backend `cluster:lifecycle` events and
 * provides per-cluster lifecycle state to the component tree.
 * Hydrates from the backend on mount, then keeps state in sync via Wails
 * runtime events. Cleans up entries when clusters are deselected.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readAllClusterLifecycleStates, requestAppState } from '@/core/app-state-access';
import { eventBus } from '@/core/events';
import { type ClusterLifecycleState, parseClusterLifecycleState } from './clusterLifecycleState';

// ---------- Types ----------

interface ClusterLifecycleContextType {
  /** Current lifecycle state, or undefined when the cluster is not tracked. */
  getClusterState: (clusterId: string) => ClusterLifecycleState | undefined;
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

export const useOptionalClusterLifecycle = (): ClusterLifecycleContextType | undefined =>
  useContext(ClusterLifecycleContext);

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
    const runtime = window.runtime;
    // Clusters whose state arrived via a LIVE event. Hydration backfills the
    // rest — and must backfill eventBus consumers too (clusterReadiness,
    // capability hooks), or the refresh layer stays split-brained from the UI
    // map when the relay misses events (mount gaps): the UI shows "loading"
    // while held fetches are never re-dispatched and readiness wedges.
    const eventDelivered = new Set<string>();

    // 1. Subscribe to live events.
    const handleLifecycleEvent = (...args: unknown[]) => {
      const payload = args[0] as
        | { clusterId?: string; state?: string; previousState?: string }
        | undefined;
      if (!active || !payload?.clusterId) {
        return;
      }
      // Close the union at the boundary: transitions carrying an unknown state
      // (version skew) are dropped — the previous state stays authoritative,
      // and the dropped event does NOT count as "delivered" so hydration can
      // still backfill this cluster.
      const state = parseClusterLifecycleState(payload.state);
      if (!state) {
        return;
      }
      const clusterId = payload.clusterId;
      eventDelivered.add(clusterId);
      eventBus.emit('cluster:lifecycle', { clusterId, state });
      setStates((prev) => {
        // Identity-stable on no-op events: consumers key derived scope lists on
        // getClusterState identity, and a fresh Map per redundant event re-runs
        // their reconciliation effects on every heartbeat.
        if (prev.get(clusterId) === state) {
          return prev;
        }
        const next = new Map(prev);
        next.set(clusterId, state);
        return next;
      });
    };

    const dispose = runtime?.EventsOn?.('cluster:lifecycle', handleLifecycleEvent);

    // 2. Hydrate current state from backend. Events that arrive between the RPC
    //    and its resolution are handled by the subscription above. We merge
    //    hydrated state with any events already received so newer events win.
    void requestAppState<Record<string, string> | null>({
      resource: 'cluster-lifecycle-states',
      read: readAllClusterLifecycleStates,
    }).then((result: Record<string, string> | null) => {
      if (active && result) {
        // Normalize at the boundary; entries with an unknown state are dropped
        // (warned once by the parser) rather than stored or relayed.
        const hydrated: Array<[string, ClusterLifecycleState]> = [];
        for (const [clusterId, raw] of Object.entries(result)) {
          const state = parseClusterLifecycleState(raw);
          if (clusterId && state) {
            hydrated.push([clusterId, state]);
          }
        }
        setStates((prev) => {
          const merged = new Map(hydrated);
          // Events received after the RPC was sent take precedence.
          prev.forEach((state, id) => {
            merged.set(id, state);
          });
          return merged;
        });
        // Backfill eventBus consumers for clusters the relay hasn't spoken
        // for. Everything the UI map learns, the refresh layer must learn.
        hydrated.forEach(([clusterId, state]) => {
          if (eventDelivered.has(clusterId)) {
            return;
          }
          eventBus.emit('cluster:lifecycle', { clusterId, state });
        });
      }
    });

    return () => {
      active = false;
      if (typeof dispose === 'function') {
        dispose();
      }
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
    (clusterId: string): ClusterLifecycleState | undefined => {
      return states.get(clusterId);
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
