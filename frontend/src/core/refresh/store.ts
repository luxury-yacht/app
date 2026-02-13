/**
 * frontend/src/core/refresh/store.ts
 *
 * State store for store.
 * Manages cached data, updates, and subscriptions for the core layer.
 */

import { useSyncExternalStore } from 'react';

import type { DomainPayloadMap, RefreshDomain } from './types';
import type { SnapshotStats } from './client';

export type DomainStatus = 'idle' | 'loading' | 'initialising' | 'updating' | 'ready' | 'error';

export interface DomainSnapshotState<TPayload> {
  status: DomainStatus;
  data: TPayload | null;
  stats: SnapshotStats | null;
  version?: number;
  checksum?: string;
  etag?: string;
  lastUpdated?: number;
  lastManualRefresh?: number;
  lastAutoRefresh?: number;
  error?: string | null;
  isManual?: boolean;
  droppedAutoRefreshes: number;
  scope?: string;
}

type DomainStateMap = {
  [K in RefreshDomain]: DomainSnapshotState<DomainPayloadMap[K]>;
};

type ScopedDomainStateMap = {
  [K in RefreshDomain]?: Record<string, DomainSnapshotState<DomainPayloadMap[K]>>;
};

type ScopedDomainEntriesMap = {
  [K in RefreshDomain]?: Array<[string, DomainSnapshotState<DomainPayloadMap[K]>]>;
};

interface RefreshStoreState {
  domains: DomainStateMap;
  scopedDomains: ScopedDomainStateMap;
  scopedDomainEntries: ScopedDomainEntriesMap;
  pendingRequests: number;
}

const createInitialDomainState = <TPayload>(): DomainSnapshotState<TPayload> => ({
  status: 'idle',
  data: null,
  stats: null,
  error: null,
  droppedAutoRefreshes: 0,
  scope: undefined,
});

const EMPTY_SCOPED_STATE: DomainSnapshotState<any> = Object.freeze({
  status: 'idle',
  data: null,
  stats: null,
  error: null,
  droppedAutoRefreshes: 0,
  scope: undefined,
}) as DomainSnapshotState<any>;

const EMPTY_SCOPED_MAP: Record<string, DomainSnapshotState<any>> = Object.freeze({});
const EMPTY_SCOPED_ENTRIES: ReadonlyArray<[string, DomainSnapshotState<any>]> = Object.freeze([]);

const state: RefreshStoreState = {
  domains: {
    // All domains are scoped and use the scopedDomains map below; these entries
    // exist for type safety and are never read at runtime for scoped domains.
    'object-maintenance': createInitialDomainState(),
    namespaces: createInitialDomainState(),
    'cluster-overview': createInitialDomainState(),
    // Scoped domains use scopedDomains map below; these entries exist for type safety.
    // They are never read for scoped domains at runtime.
    nodes: createInitialDomainState(),
    pods: createInitialDomainState(),
    'object-details': createInitialDomainState(),
    'object-events': createInitialDomainState(),
    'object-yaml': createInitialDomainState(),
    'object-helm-manifest': createInitialDomainState(),
    'object-helm-values': createInitialDomainState(),
    'object-logs': createInitialDomainState(),
    'cluster-rbac': createInitialDomainState(),
    'cluster-storage': createInitialDomainState(),
    'cluster-config': createInitialDomainState(),
    'cluster-crds': createInitialDomainState(),
    'cluster-custom': createInitialDomainState(),
    'cluster-events': createInitialDomainState(),
    catalog: createInitialDomainState(),
    'catalog-diff': createInitialDomainState(),
    'namespace-workloads': createInitialDomainState(),
    'namespace-config': createInitialDomainState(),
    'namespace-network': createInitialDomainState(),
    'namespace-rbac': createInitialDomainState(),
    'namespace-storage': createInitialDomainState(),
    'namespace-autoscaling': createInitialDomainState(),
    'namespace-quotas': createInitialDomainState(),
    'namespace-events': createInitialDomainState(),
    'namespace-custom': createInitialDomainState(),
    'namespace-helm': createInitialDomainState(),
  },
  scopedDomains: {},
  scopedDomainEntries: {},
  pendingRequests: 0,
};

const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getRefreshState = (): RefreshStoreState => state;

export const getDomainState = <K extends RefreshDomain>(
  domain: K
): DomainSnapshotState<DomainPayloadMap[K]> => state.domains[domain];

export const getScopedDomainState = <K extends RefreshDomain>(
  domain: K,
  scope: string
): DomainSnapshotState<DomainPayloadMap[K]> => {
  const domainMap = state.scopedDomains[domain] as
    | Record<string, DomainSnapshotState<DomainPayloadMap[K]>>
    | undefined;
  if (!domainMap) {
    return EMPTY_SCOPED_STATE as DomainSnapshotState<DomainPayloadMap[K]>;
  }
  return domainMap[scope] ?? (EMPTY_SCOPED_STATE as DomainSnapshotState<DomainPayloadMap[K]>);
};

export const getScopedDomainStates = <K extends RefreshDomain>(
  domain: K
): Record<string, DomainSnapshotState<DomainPayloadMap[K]>> => {
  const domainMap = state.scopedDomains[domain] as
    | Record<string, DomainSnapshotState<DomainPayloadMap[K]>>
    | undefined;
  return domainMap
    ? domainMap
    : (EMPTY_SCOPED_MAP as unknown as Record<string, DomainSnapshotState<DomainPayloadMap[K]>>);
};

export const getScopedDomainEntries = <K extends RefreshDomain>(
  domain: K
): Array<[string, DomainSnapshotState<DomainPayloadMap[K]>]> => {
  const entries = state.scopedDomainEntries[domain] as
    | Array<[string, DomainSnapshotState<DomainPayloadMap[K]>]>
    | undefined;
  return entries
    ? entries
    : (EMPTY_SCOPED_ENTRIES as unknown as Array<
        [string, DomainSnapshotState<DomainPayloadMap[K]>]
      >);
};

export const setDomainState = <K extends RefreshDomain>(
  domain: K,
  updater: (
    previous: DomainSnapshotState<DomainPayloadMap[K]>
  ) => DomainSnapshotState<DomainPayloadMap[K]>
): void => {
  const previous = state.domains[domain];
  const next = updater(previous);

  if (next === previous) {
    return;
  }

  state.domains = {
    ...state.domains,
    [domain]: next,
  } as DomainStateMap;

  notify();
};

export const resetDomainState = <K extends RefreshDomain>(domain: K): void => {
  state.domains = {
    ...state.domains,
    [domain]: createInitialDomainState(),
  } as DomainStateMap;
  notify();
};

export const setScopedDomainState = <K extends RefreshDomain>(
  domain: K,
  scope: string,
  updater: (
    previous: DomainSnapshotState<DomainPayloadMap[K]>
  ) => DomainSnapshotState<DomainPayloadMap[K]>
): void => {
  const currentMap = state.scopedDomains[domain] as
    | Record<string, DomainSnapshotState<DomainPayloadMap[K]>>
    | undefined;
  const previousState = (currentMap?.[scope] ?? EMPTY_SCOPED_STATE) as DomainSnapshotState<
    DomainPayloadMap[K]
  >;
  const nextState = updater(previousState);

  if (nextState === previousState) {
    return;
  }

  const nextMap: Record<string, DomainSnapshotState<DomainPayloadMap[K]>> = {
    ...(currentMap ?? {}),
    [scope]: nextState,
  };

  state.scopedDomains = {
    ...state.scopedDomains,
    [domain]: nextMap,
  } as ScopedDomainStateMap;

  state.scopedDomainEntries = {
    ...state.scopedDomainEntries,
    [domain]: Object.entries(nextMap) as Array<[string, DomainSnapshotState<DomainPayloadMap[K]>]>,
  } as ScopedDomainEntriesMap;

  notify();
};

export const resetScopedDomainState = <K extends RefreshDomain>(domain: K, scope: string): void => {
  const currentMap = state.scopedDomains[domain] as
    | Record<string, DomainSnapshotState<DomainPayloadMap[K]>>
    | undefined;

  if (!currentMap || !(scope in currentMap)) {
    return;
  }

  const nextMap = { ...currentMap };
  delete nextMap[scope];

  if (Object.keys(nextMap).length === 0) {
    const { [domain]: _, ...rest } = state.scopedDomains;
    state.scopedDomains = rest as ScopedDomainStateMap;
    const { [domain]: __, ...restEntries } = state.scopedDomainEntries;
    state.scopedDomainEntries = restEntries as ScopedDomainEntriesMap;
  } else {
    state.scopedDomains = {
      ...state.scopedDomains,
      [domain]: nextMap,
    } as ScopedDomainStateMap;
    state.scopedDomainEntries = {
      ...state.scopedDomainEntries,
      [domain]: Object.entries(nextMap) as Array<
        [string, DomainSnapshotState<DomainPayloadMap[K]>]
      >,
    } as ScopedDomainEntriesMap;
  }

  notify();
};

export const resetAllScopedDomainStates = <K extends RefreshDomain>(domain: K): void => {
  if (!state.scopedDomains[domain]) {
    return;
  }
  const { [domain]: _, ...rest } = state.scopedDomains;
  state.scopedDomains = rest as ScopedDomainStateMap;
  const { [domain]: __, ...restEntries } = state.scopedDomainEntries;
  state.scopedDomainEntries = restEntries as ScopedDomainEntriesMap;
  notify();
};

export const markPendingRequest = (delta: number): void => {
  state.pendingRequests = Math.max(0, state.pendingRequests + delta);
  notify();
};

export const useRefreshScopedDomain = <K extends RefreshDomain>(
  domain: K,
  scope: string
): DomainSnapshotState<DomainPayloadMap[K]> =>
  useSyncExternalStore(subscribe, () => getScopedDomainState(domain, scope));

export const useRefreshScopedDomainStates = <K extends RefreshDomain>(domain: K) =>
  useSyncExternalStore(subscribe, () => getScopedDomainStates(domain));

export const useRefreshScopedDomainEntries = <K extends RefreshDomain>(domain: K) =>
  useSyncExternalStore(subscribe, () => getScopedDomainEntries(domain));

export const useRefreshState = () => useSyncExternalStore(subscribe, () => state);
