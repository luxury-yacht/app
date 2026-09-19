/**
 * frontend/src/core/capabilities/hooks.ts
 *
 * Hooks for evaluating and accessing capability states.
 * Provides the `useCapabilities` hook for synchronizing capability states
 * and the `useCapabilityDiagnostics` hook for accessing diagnostics information.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useOptionalClusterLifecycle } from '@/core/contexts/ClusterLifecycleContext';
import { isClusterOperationalState } from '@/core/contexts/clusterLifecycleState';
import { eventBus } from '@/core/events';
import { useStableSelectedValue } from '@/shared/hooks/useStableSelectedValue';
import {
  capabilityStateFromError,
  capabilityStateFromPermission,
  capabilityStateFromResult,
} from './capabilityState';
import { type QueryPayloadItem, queryPermissions } from './permissionRead';
import {
  getPermissionKey,
  getPermissionQueryDiagnosticsSnapshot,
  getUserPermissionMap,
  subscribeDiagnostics,
  subscribeUserPermissions,
} from './permissionStore';
import type {
  PermissionMap,
  PermissionQueryDiagnostics,
  PermissionStatus,
} from './permissionTypes';
import type {
  CapabilityDescriptor,
  CapabilityState,
  NormalizedCapabilityDescriptor,
} from './types';
import { normalizeDescriptor } from './utils';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseCapabilitiesOptions {
  enabled?: boolean;
  refreshKey?: unknown;
}

export interface UseCapabilitiesResult {
  loading: boolean;
  ready: boolean;
  getState: (id: string) => CapabilityState;
  isAllowed: (id: string) => boolean;
}

// ---------------------------------------------------------------------------
// Permission map hooks
// ---------------------------------------------------------------------------

/** Subscribes to the permission store and returns the current permission map. */
export const useUserPermissions = (): PermissionMap =>
  useSyncExternalStore(subscribeUserPermissions, getUserPermissionMap, getUserPermissionMap);

/** Returns the permission status for a single resource/verb, if known. */
export const useUserPermission = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null,
  clusterId?: string | null,
  group?: string | null,
  version?: string | null
): PermissionStatus | undefined => {
  const map = useUserPermissions();
  const key = getPermissionKey(
    resourceKind,
    verb,
    namespace,
    subresource,
    clusterId,
    group,
    version
  );
  return map.get(key);
};

// ---------------------------------------------------------------------------
// useCapabilities hook
// ---------------------------------------------------------------------------

// Descriptors are normalized with a fixed field order. Include the full identity
// so a reused action ID cannot carry a previous object's permission state.
const namedCapabilityKey = (descriptor: NormalizedCapabilityDescriptor): string =>
  JSON.stringify(descriptor);

// Missing cluster identity is a producer error; never send an unscoped query.
const buildNamedPermissionPayload = (
  descriptors: NormalizedCapabilityDescriptor[]
): QueryPayloadItem[] => {
  const payload: QueryPayloadItem[] = [];
  for (const d of descriptors) {
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
  return payload;
};

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
  const { refreshKey } = options;
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

  const namedAdmission = useMemo(() => {
    const waiting: NormalizedCapabilityDescriptor[] = [];
    const queryable: NormalizedCapabilityDescriptor[] = [];
    for (const descriptor of namedDescriptors) {
      const isWaiting =
        descriptor.clusterId &&
        clusterLifecycle !== undefined &&
        !isClusterOperationalState(clusterLifecycle.getClusterState(descriptor.clusterId));
      (isWaiting ? waiting : queryable).push(descriptor);
    }
    return { waiting, queryable };
  }, [clusterLifecycle, namedDescriptors]);
  // Auth progress republishes lifecycle context without changing request admission.
  // Keep each query alive until its descriptor membership or readiness changes.
  const waitingForReadyNamedDescriptors = useStableSelectedValue(namedAdmission.waiting);
  const queryableNamedDescriptors = useStableSelectedValue(namedAdmission.queryable);

  const updateNamedResults = useCallback(
    (update: (results: Map<string, CapabilityState>) => void) => {
      const next = new Map<string, CapabilityState>();
      for (const descriptor of namedDescriptors) {
        const key = namedCapabilityKey(descriptor);
        const existing = namedResultsRef.current.get(key);
        if (existing) {
          next.set(key, existing);
        }
      }
      update(next);
      namedResultsRef.current = next;
      setNamedResultsVersion((version) => version + 1);
    },
    [namedDescriptors]
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
      if (isClusterOperationalState(payload.state) && clusterIds.has(payload.clusterId)) {
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

    updateNamedResults((results) => {
      for (const descriptor of waitingForReadyNamedDescriptors) {
        results.set(namedCapabilityKey(descriptor), {
          allowed: false,
          pending: true,
          status: 'loading',
          reason: 'Cluster is not ready',
        });
      }
    });
  }, [enabled, waitingForReadyNamedDescriptors, updateNamedResults]);

  // Query named-resource descriptors directly via QueryPermissions RPC.
  useEffect(() => {
    void refreshKey;
    void retryVersion;
    if (!enabled || queryableNamedDescriptors.length === 0) {
      return;
    }

    const payload = buildNamedPermissionPayload(queryableNamedDescriptors);
    if (payload.length === 0) {
      return;
    }

    // Mark named descriptors as pending while the query is in-flight.
    updateNamedResults((results) => {
      for (const descriptor of queryableNamedDescriptors) {
        const existing = results.get(namedCapabilityKey(descriptor));
        if (!existing || existing.status === 'idle') {
          results.set(namedCapabilityKey(descriptor), {
            allowed: false,
            pending: true,
            status: 'loading',
          });
        }
      }
    });

    let cancelled = false;
    queryPermissions(payload)
      .then((response) => {
        if (cancelled) {
          return;
        }
        const responseById = new Map(response.results.map((result) => [result.id, result]));
        updateNamedResults((results) => {
          for (const descriptor of queryableNamedDescriptors) {
            const result = responseById.get(descriptor.id);
            if (result?.name) {
              results.set(namedCapabilityKey(descriptor), capabilityStateFromResult(result));
            }
          }
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const reason = String(error);
        updateNamedResults((results) => {
          for (const descriptor of queryableNamedDescriptors) {
            results.set(namedCapabilityKey(descriptor), capabilityStateFromError(reason));
          }
        });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, queryableNamedDescriptors, refreshKey, retryVersion, updateNamedResults]);

  // Build the unified state map from both sources.
  const stateById = useMemo(() => {
    void namedResultsVersion;
    const map = new Map<string, CapabilityState>();
    if (!enabled) {
      return map;
    }

    // Process all descriptors, checking namedResultsRef first, then the global permission map.
    normalizedDescriptors.forEach((descriptor) => {
      // Check hook-local named results first.
      const namedState = namedResultsRef.current.get(namedCapabilityKey(descriptor));
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
      map.set(descriptor.id, capabilityStateFromPermission(permissionMap.get(permissionKey)));
    });

    return map;
    // namedResultsVersion triggers recomputation when named results update.
  }, [enabled, normalizedDescriptors, permissionMap, namedResultsVersion]);

  const loading =
    enabled &&
    normalizedDescriptors.some((descriptor) => {
      const state = stateById.get(descriptor.id);
      return state ? state.pending : true;
    });

  const ready = enabled && normalizedDescriptors.length > 0 && !loading;

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

  return {
    loading,
    ready,
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
