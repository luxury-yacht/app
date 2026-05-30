/**
 * frontend/src/core/capabilities/hooks.ts
 *
 * Hooks for evaluating and accessing capability states.
 * Provides the `useCapabilities` hook for synchronizing capability states
 * and the `useCapabilityDiagnostics` hook for accessing diagnostics information.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { eventBus } from '@/core/events';
import { useOptionalClusterLifecycle } from '@/core/contexts/ClusterLifecycleContext';

import type { CapabilityDescriptor, CapabilityState } from './types';
import { normalizeDescriptor } from './utils';
import {
  getPermissionKey,
  subscribeDiagnostics,
  getPermissionQueryDiagnosticsSnapshot,
} from './permissionStore';
import { useUserPermissions } from './bootstrap';
import type { PermissionQueryDiagnostics } from './permissionTypes';
import {
  getPermissionResultErrorMessage,
  isTransientClusterInactivePermissionError,
  isTransientPermissionResultError,
} from './transientPermissionErrors';
import { queryPermissions, type QueryPayloadItem } from './permissionRead';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseCapabilitiesOptions {
  enabled?: boolean;
  ttlMs?: number;
  refreshKey?: unknown;
  force?: boolean;
}

export interface UseCapabilitiesResult {
  entries: CapabilityDescriptor[];
  byId: Map<string, CapabilityDescriptor>;
  loading: boolean;
  ready: boolean;
  refetch: () => void;
  getEntry: (id: string) => CapabilityDescriptor | undefined;
  getState: (id: string) => CapabilityState;
  isAllowed: (id: string) => boolean;
}

// ---------------------------------------------------------------------------
// useCapabilities hook
// ---------------------------------------------------------------------------

/**
 * Hook that evaluates a set of capability descriptors and keeps their state in sync.
 * Consumers receive stable references suitable for memoisation in the UI.
 *
 * Descriptors with a `name` field are queried directly via the QueryPermissions
 * RPC and stored hook-locally. Descriptors without `name` are resolved from the
 * global permission map (populated by queryNamespacePermissions elsewhere).
 */
export const useCapabilities = (
  descriptors: CapabilityDescriptor[],
  options: UseCapabilitiesOptions = {}
): UseCapabilitiesResult => {
  const enabled = options.enabled ?? true;
  const { ttlMs, force, refreshKey } = options;
  const permissionMap = useUserPermissions();
  const clusterLifecycle = useOptionalClusterLifecycle();

  // Hook-local storage for named-resource query results.
  const namedResultsRef = useRef<Map<string, CapabilityState>>(new Map());
  const [namedResultsVersion, setNamedResultsVersion] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);

  const normalizedDescriptors = useMemo(
    () =>
      descriptors
        .map(normalizeDescriptor)
        .filter((descriptor) => descriptor.id && descriptor.verb && descriptor.resourceKind),
    [descriptors]
  );

  // Partition descriptors: named ones need a direct RPC, unnamed use the global map.
  const namedDescriptors = useMemo(
    () => normalizedDescriptors.filter((d) => d.name),
    [normalizedDescriptors]
  );

  const waitingForReadyNamedDescriptors = useMemo(
    () =>
      namedDescriptors.filter(
        (descriptor) =>
          descriptor.clusterId &&
          clusterLifecycle !== undefined &&
          !clusterLifecycle.isClusterReady(descriptor.clusterId)
      ),
    [clusterLifecycle, namedDescriptors]
  );

  const queryableNamedDescriptors = useMemo(
    () =>
      namedDescriptors.filter(
        (descriptor) =>
          !descriptor.clusterId ||
          clusterLifecycle === undefined ||
          clusterLifecycle.isClusterReady(descriptor.clusterId)
      ),
    [clusterLifecycle, namedDescriptors]
  );

  useEffect(() => {
    if (!enabled || namedDescriptors.length === 0) {
      return;
    }

    const clusterIds = new Set(
      namedDescriptors
        .map((descriptor) => descriptor.clusterId)
        .filter((clusterId): clusterId is string => Boolean(clusterId))
    );

    const unsubscribeSelection = eventBus.on('kubeconfig:selection-changed', () => {
      setRetryVersion((version) => version + 1);
    });
    const unsubscribeLifecycle = eventBus.on('cluster:lifecycle', (payload) => {
      if (payload.state === 'ready' && clusterIds.has(payload.clusterId)) {
        setRetryVersion((version) => version + 1);
      }
    });

    return () => {
      unsubscribeSelection();
      unsubscribeLifecycle();
    };
  }, [enabled, namedDescriptors]);

  useEffect(() => {
    if (!enabled || waitingForReadyNamedDescriptors.length === 0) {
      return;
    }

    const nextMap = new Map(namedResultsRef.current);
    for (const descriptor of waitingForReadyNamedDescriptors) {
      nextMap.set(descriptor.id, {
        allowed: false,
        pending: true,
        status: 'loading',
        reason: 'Cluster is not ready',
      });
    }
    namedResultsRef.current = nextMap;
    setNamedResultsVersion((version) => version + 1);
  }, [enabled, waitingForReadyNamedDescriptors]);

  // Query named-resource descriptors directly via QueryPermissions RPC.
  useEffect(() => {
    if (!enabled || queryableNamedDescriptors.length === 0) {
      return;
    }

    // Multi-cluster rule (AGENTS.md): every backend permission query
    // must carry a resolved clusterId. Drop descriptors that lack one
    // and warn so the upstream producer surfaces the bug, rather than
    // sending a garbage RPC the backend would reject anyway.
    const payload: QueryPayloadItem[] = [];
    for (const d of queryableNamedDescriptors) {
      if (!d.clusterId) {
        console.warn(
          `capabilities: dropping named permission query for ${d.resourceKind}/${d.name ?? ''} — clusterId is missing`,
          d
        );
        continue;
      }
      payload.push({
        id: d.id,
        clusterId: d.clusterId,
        group: d.group,
        version: d.version,
        resourceKind: d.resourceKind,
        verb: d.verb,
        namespace: d.namespace ?? '',
        subresource: d.subresource ?? '',
        name: d.name ?? '',
      });
    }
    if (payload.length === 0) {
      return;
    }

    // Mark named descriptors as pending while the query is in-flight.
    const nextPending = new Map(namedResultsRef.current);
    for (const d of queryableNamedDescriptors) {
      const existing = nextPending.get(d.id);
      if (!existing || existing.status === 'idle') {
        nextPending.set(d.id, { allowed: false, pending: true, status: 'loading' });
      }
    }
    namedResultsRef.current = nextPending;
    setNamedResultsVersion((v) => v + 1);

    queryPermissions(payload)
      .then((response) => {
        const nextMap = new Map(namedResultsRef.current);
        for (const r of response.results) {
          if (!r.name) continue;
          const isError = r.source === 'error' || !!r.error;
          if (isTransientPermissionResultError(r)) {
            nextMap.set(r.id, {
              allowed: false,
              pending: true,
              status: 'loading',
              reason: getPermissionResultErrorMessage(r),
            });
            continue;
          }
          if (isError) {
            nextMap.set(r.id, {
              allowed: false,
              pending: false,
              status: 'error',
              reason: r.error || r.reason,
            });
          } else {
            nextMap.set(r.id, {
              allowed: r.allowed,
              pending: false,
              status: 'ready',
              reason: r.reason || undefined,
            });
          }
        }
        namedResultsRef.current = nextMap;
        setNamedResultsVersion((v) => v + 1);
      })
      .catch((err) => {
        const errMsg = String(err);
        const nextMap = new Map(namedResultsRef.current);
        for (const d of queryableNamedDescriptors) {
          if (isTransientClusterInactivePermissionError(errMsg)) {
            nextMap.set(d.id, {
              allowed: false,
              pending: true,
              status: 'loading',
              reason: errMsg,
            });
            continue;
          }
          nextMap.set(d.id, {
            allowed: false,
            pending: false,
            status: 'error',
            reason: errMsg,
          });
        }
        namedResultsRef.current = nextMap;
        setNamedResultsVersion((v) => v + 1);
      });
  }, [enabled, force, queryableNamedDescriptors, ttlMs, refreshKey, retryVersion]);

  // Build the unified state map from both sources.
  const stateById = useMemo(() => {
    const map = new Map<string, CapabilityState>();
    if (!enabled) {
      return map;
    }

    // Process all descriptors, checking namedResultsRef first, then the global permission map.
    normalizedDescriptors.forEach((descriptor) => {
      // Check hook-local named results first.
      const namedState = namedResultsRef.current.get(descriptor.id);
      if (namedState) {
        map.set(descriptor.id, namedState);
        return;
      }

      // Fall back to the global permission map for unnamed descriptors.
      const permissionKey = getPermissionKey(
        descriptor.resourceKind,
        descriptor.verb,
        descriptor.namespace ?? null,
        descriptor.subresource ?? null,
        descriptor.clusterId ?? null,
        descriptor.group ?? null,
        descriptor.version ?? null
      );
      const permissionStatus = permissionMap.get(permissionKey);

      let state: CapabilityState;
      if (!permissionStatus) {
        state = {
          allowed: false,
          pending: true,
          status: 'idle',
        };
      } else if (permissionStatus.pending) {
        state = {
          allowed: false,
          pending: true,
          status: 'loading',
        };
      } else if (permissionStatus.error && !permissionStatus.allowed) {
        state = {
          allowed: false,
          pending: false,
          status: 'error',
          reason: permissionStatus.error ?? permissionStatus.reason,
        };
      } else {
        state = {
          allowed: permissionStatus.allowed,
          pending: false,
          status: 'ready',
          reason: permissionStatus.reason ?? undefined,
        };
      }

      map.set(descriptor.id, state);
    });

    return map;
    // namedResultsVersion triggers recomputation when named results update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, normalizedDescriptors, permissionMap, namedResultsVersion]);

  const loading =
    enabled &&
    normalizedDescriptors.some((descriptor) => {
      const state = stateById.get(descriptor.id);
      return state ? state.pending : true;
    });

  const ready =
    enabled &&
    normalizedDescriptors.length > 0 &&
    normalizedDescriptors.every((descriptor) => {
      const state = stateById.get(descriptor.id);
      return state ? !state.pending : false;
    });

  const getState = useCallback(
    (id: string): CapabilityState => {
      const state = stateById.get(id);
      if (state) {
        return state;
      }
      return {
        allowed: false,
        pending: true,
        status: 'idle',
      };
    },
    [stateById]
  );

  const isAllowed = useCallback((id: string) => getState(id).allowed, [getState]);

  const resultEntries: CapabilityDescriptor[] = [];
  const resultMap = useMemo(() => new Map<string, CapabilityDescriptor>(), []);

  return {
    entries: resultEntries,
    byId: resultMap,
    loading,
    ready,
    refetch: () => undefined,
    getEntry: () => undefined,
    getState,
    isAllowed,
  };
};

// ---------------------------------------------------------------------------
// useCapabilityDiagnostics hook
// ---------------------------------------------------------------------------

export const useCapabilityDiagnostics = (): PermissionQueryDiagnostics[] =>
  useSyncExternalStore(
    subscribeDiagnostics,
    getPermissionQueryDiagnosticsSnapshot,
    getPermissionQueryDiagnosticsSnapshot
  );
