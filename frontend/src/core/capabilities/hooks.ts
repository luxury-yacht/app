/**
 * frontend/src/core/capabilities/hooks.ts
 *
 * Hooks for evaluating and accessing capability states.
 * Provides the `useCapabilities` hook for synchronizing capability states
 * and the `useCapabilityDiagnostics` hook for accessing diagnostics information.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { CapabilityDescriptor, CapabilityState } from './types';
import { normalizeDescriptor } from './utils';
import {
  getPermissionKey,
  subscribeDiagnostics,
  getPermissionQueryDiagnosticsSnapshot,
} from './permissionStore';
import { useUserPermissions } from './bootstrap';
import type { PermissionQueryDiagnostics } from './permissionTypes';

// ---------------------------------------------------------------------------
// QueryPermissions RPC (local wrapper)
// ---------------------------------------------------------------------------
// Locally-typed wrapper for the QueryPermissions Wails endpoint. Uses the
// same runtime call path as generated Wails bindings (window.go.backend.App).
// Mirrors the pattern in permissionStore.ts.

interface QueryPayloadItem {
  id: string;
  clusterId: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
}

interface QueryResponseResult {
  id: string;
  clusterId: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
  allowed: boolean;
  source: string;
  reason: string;
  error: string;
}

interface QueryPermissionsResponse {
  results: QueryResponseResult[];
}

declare const window: {
  go: Record<string, Record<string, Record<string, (...args: any[]) => any>>>;
};

function callQueryPermissions(queries: QueryPayloadItem[]): Promise<QueryPermissionsResponse> {
  return window['go']['backend']['App']['QueryPermissions'](queries);
}

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

  // Hook-local storage for named-resource query results.
  const namedResultsRef = useRef<Map<string, CapabilityState>>(new Map());
  const [namedResultsVersion, setNamedResultsVersion] = useState(0);

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

  // Query named-resource descriptors directly via QueryPermissions RPC.
  useEffect(() => {
    if (!enabled || namedDescriptors.length === 0) {
      return;
    }

    const payload: QueryPayloadItem[] = namedDescriptors.map((d) => ({
      id: d.id,
      clusterId: d.clusterId ?? '',
      resourceKind: d.resourceKind,
      verb: d.verb,
      namespace: d.namespace ?? '',
      subresource: d.subresource ?? '',
      name: d.name ?? '',
    }));

    // Mark named descriptors as pending while the query is in-flight.
    const nextPending = new Map(namedResultsRef.current);
    for (const d of namedDescriptors) {
      const existing = nextPending.get(d.id);
      if (!existing || existing.status === 'idle') {
        nextPending.set(d.id, { allowed: false, pending: true, status: 'loading' });
      }
    }
    namedResultsRef.current = nextPending;
    setNamedResultsVersion((v) => v + 1);

    callQueryPermissions(payload)
      .then((response) => {
        const nextMap = new Map(namedResultsRef.current);
        for (const r of response.results) {
          if (!r.name) continue;
          const isError = r.source === 'error' || !!r.error;
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
        for (const d of namedDescriptors) {
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
  }, [enabled, force, namedDescriptors, ttlMs, refreshKey]);

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
        descriptor.clusterId ?? null
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
