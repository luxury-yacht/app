import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import type {
  CapabilityDescriptor,
  CapabilityEntry,
  CapabilityNamespaceDiagnostics,
  CapabilityState,
} from './types';
import { normalizeDescriptor } from './utils';
import { getPermissionKey, useUserPermissions } from './bootstrap';
import {
  ensureCapabilityEntries,
  getCapabilityDiagnosticsSnapshot,
  requestCapabilities,
  subscribeDiagnostics,
} from './store';
import { registerAdHocCapabilities } from './bootstrap';

export interface UseCapabilitiesOptions {
  enabled?: boolean;
  ttlMs?: number;
  refreshKey?: unknown;
  force?: boolean;
}

export interface UseCapabilitiesResult {
  entries: CapabilityEntry[];
  byId: Map<string, CapabilityEntry>;
  loading: boolean;
  ready: boolean;
  refetch: () => void;
  getEntry: (id: string) => CapabilityEntry | undefined;
  getState: (id: string) => CapabilityState;
  isAllowed: (id: string) => boolean;
}

/**
 * Hook that evaluates a set of capability descriptors and keeps their state in sync.
 * Consumers receive stable references suitable for memoisation in the UI.
 */
export const useCapabilities = (
  descriptors: CapabilityDescriptor[],
  options: UseCapabilitiesOptions = {}
): UseCapabilitiesResult => {
  const enabled = options.enabled ?? true;
  const { ttlMs, force, refreshKey } = options;
  const permissionMap = useUserPermissions();
  const normalizedDescriptors = useMemo(
    () =>
      descriptors
        .map(normalizeDescriptor)
        .filter((descriptor) => descriptor.id && descriptor.verb && descriptor.resourceKind),
    [descriptors]
  );

  useEffect(() => {
    if (!enabled || normalizedDescriptors.length === 0) {
      return;
    }
    registerAdHocCapabilities(normalizedDescriptors);
    ensureCapabilityEntries(normalizedDescriptors);
    requestCapabilities(normalizedDescriptors, {
      ttlMs,
      force,
    });
  }, [enabled, force, normalizedDescriptors, ttlMs, refreshKey]);

  const stateById = useMemo(() => {
    const map = new Map<string, CapabilityState>();
    if (!enabled) {
      return map;
    }

    normalizedDescriptors.forEach((descriptor) => {
      const permissionKey = getPermissionKey(
        descriptor.resourceKind,
        descriptor.verb,
        descriptor.namespace ?? null,
        descriptor.subresource ?? null
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
          reason: permissionStatus.reason,
        };
      }

      map.set(descriptor.id, state);
    });

    return map;
  }, [enabled, normalizedDescriptors, permissionMap]);

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

  const resultEntries: CapabilityEntry[] = [];
  const resultMap = useMemo(() => new Map<string, CapabilityEntry>(), []);

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

export const useCapabilityDiagnostics = (): CapabilityNamespaceDiagnostics[] =>
  useSyncExternalStore(
    subscribeDiagnostics,
    getCapabilityDiagnosticsSnapshot,
    getCapabilityDiagnosticsSnapshot
  );
