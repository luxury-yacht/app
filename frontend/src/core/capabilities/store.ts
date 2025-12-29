/**
 * frontend/src/core/capabilities/store.ts
 *
 * Hooks for evaluating and accessing capability states.
 * Provides the `useCapabilities` hook for synchronizing capability states
 * and the `useCapabilityDiagnostics` hook for accessing diagnostics information.
 */

import { EvaluateCapabilities } from '@wailsjs/go/backend/App';
import type { capabilities } from '@wailsjs/go/models';

import type {
  CapabilityEntry,
  CapabilityNamespaceDiagnostics,
  CapabilityResult,
  NormalizedCapabilityDescriptor,
} from './types';
import { createCapabilityKey, createPlaceholderEntry, descriptorsMatch } from './utils';

export interface CapabilityRequestOptions {
  ttlMs?: number;
  force?: boolean;
}

type Listener = () => void;

const entries = new Map<string, CapabilityEntry>();
const listeners = new Set<Listener>();
const placeholderCache = new Map<string, CapabilityEntry>();

const diagnosticsListeners = new Set<Listener>();
const namespaceDiagnostics = new Map<string, CapabilityNamespaceDiagnostics>();
let diagnosticsSnapshotCache: CapabilityNamespaceDiagnostics[] = [];
let diagnosticsSnapshotDirty = true;
let diagnosticsNotifyScheduled = false;

let pendingRequests = new Map<string, NormalizedCapabilityDescriptor>();
let pendingFlush: Promise<void> | null = null;
let version = 0;

const DIAGNOSTICS_CLUSTER_KEY = '__cluster__';
// Keep capability batches small enough to avoid long-running Wails callbacks.
const MAX_CAPABILITY_BATCH = 80;

const sanitizeNamespace = (value?: string | null): string | undefined => {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeNamespaceKey = (namespace?: string | null, clusterId?: string | null): string => {
  const trimmed = sanitizeNamespace(namespace);
  const namespaceKey = trimmed ? trimmed.toLowerCase() : DIAGNOSTICS_CLUSTER_KEY;
  const clusterKey = (clusterId ?? '').trim();
  if (!clusterKey) {
    return namespaceKey;
  }
  return `${clusterKey}|${namespaceKey}`;
};

const isClusterDiagnosticsKey = (key: string): boolean =>
  key === DIAGNOSTICS_CLUSTER_KEY || key.endsWith(`|${DIAGNOSTICS_CLUSTER_KEY}`);

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getStoreVersion = () => version;

const optional = (value?: string | null): string | undefined => {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const toCapabilityResult = (result: capabilities.CheckResult): CapabilityResult => ({
  id: result.id,
  verb: (result.verb ?? '').trim().toLowerCase(),
  resourceKind: (result.resourceKind ?? '').trim(),
  namespace: optional(result.namespace),
  name: optional(result.name),
  subresource: optional(result.subresource),
  allowed: Boolean(result.allowed),
  deniedReason: optional(result.deniedReason),
  evaluationError: optional(result.evaluationError),
  error: optional(result.error),
});

const notify = () => {
  version += 1;
  if (listeners.size === 0) {
    return;
  }
  for (const listener of listeners) {
    listener();
  }
};

const upsertEntry = (
  key: string,
  updater: (previous: CapabilityEntry | undefined) => CapabilityEntry
): boolean => {
  const previous = entries.get(key);
  const next = updater(previous);
  if (previous === next) {
    return false;
  }
  entries.set(key, next);
  placeholderCache.delete(key);
  return true;
};

const ensureEntry = (descriptor: NormalizedCapabilityDescriptor): boolean => {
  const key = createCapabilityKey(descriptor);
  return upsertEntry(key, (existing) => {
    if (!existing) {
      return createPlaceholderEntry(key, descriptor);
    }
    if (descriptorsMatch(existing.request, descriptor)) {
      return existing;
    }
    return {
      ...existing,
      request: descriptor,
    };
  });
};

const shouldRefreshEntry = (
  entry: CapabilityEntry,
  options: CapabilityRequestOptions,
  now: number
): boolean => {
  if (options.force) {
    return true;
  }

  if (entry.status === 'idle' || entry.status === 'error' || entry.lastFetched == null) {
    return true;
  }

  if (entry.status === 'loading') {
    return false;
  }

  if (options.ttlMs == null) {
    return false;
  }

  return now - entry.lastFetched > options.ttlMs;
};

const markEntryLoading = (key: string, descriptor: NormalizedCapabilityDescriptor): boolean =>
  upsertEntry(key, (existing) => {
    if (!existing) {
      return createPlaceholderEntry(key, descriptor);
    }

    if (
      existing.status === 'loading' &&
      existing.error === null &&
      descriptorsMatch(existing.request, descriptor)
    ) {
      return existing;
    }

    return {
      ...existing,
      status: 'loading',
      error: null,
      request: descriptor,
    };
  });

const updateEntryFromResult = (
  key: string,
  result: CapabilityResult,
  completedAt: number
): boolean =>
  upsertEntry(key, (existing) => {
    if (!existing) {
      return {
        key,
        request: {
          id: result.id,
          clusterId: result.clusterId,
          verb: result.verb,
          resourceKind: result.resourceKind,
          namespace: result.namespace,
          name: result.name,
          subresource: result.subresource,
        },
        status: result.error || result.evaluationError ? 'error' : 'ready',
        result,
        error: result.error ?? result.evaluationError ?? null,
        lastFetched: completedAt,
      };
    }

    return {
      ...existing,
      status: result.error || result.evaluationError ? 'error' : 'ready',
      result,
      error: result.error ?? result.evaluationError ?? null,
      lastFetched: completedAt,
    };
  });

const markEntryError = (key: string, message: string, completedAt: number): boolean =>
  upsertEntry(key, (existing) => {
    if (!existing) {
      return {
        key,
        request: {
          id: key,
          verb: '',
          resourceKind: '',
        },
        status: 'error',
        error: message,
        lastFetched: completedAt,
      };
    }

    if (existing.status === 'error' && existing.error === message) {
      return existing;
    }

    return {
      ...existing,
      status: 'error',
      error: message,
      lastFetched: completedAt,
    };
  });

const splitBatches = <T,>(items: T[], size: number): T[][] => {
  if (items.length === 0) {
    return [];
  }
  if (items.length <= size) {
    return [items];
  }
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

const queueFlush = () => {
  if (pendingFlush) {
    return;
  }

  pendingFlush = Promise.resolve().then(async () => {
    const batch = pendingRequests;
    pendingRequests = new Map();
    pendingFlush = null;

    if (batch.size === 0) {
      return;
    }

    const toEvaluate = Array.from(batch.entries());
    const batches = splitBatches(toEvaluate, MAX_CAPABILITY_BATCH);
    let changed = false;

    for (const chunk of batches) {
      const namespaceBuckets = new Map<
        string,
        {
          namespace?: string;
          clusterId?: string;
          keys: string[];
          descriptors: NormalizedCapabilityDescriptor[];
          startedAt: number;
        }
      >();
      const startTime = Date.now();

      const payload: capabilities.CheckRequest[] = chunk.map(([key, descriptor]) => {
        const bucketKey = normalizeNamespaceKey(descriptor.namespace, descriptor.clusterId);
        let bucket = namespaceBuckets.get(bucketKey);
        if (!bucket) {
          bucket = {
            namespace: sanitizeNamespace(descriptor.namespace),
            clusterId: descriptor.clusterId,
            keys: [],
            descriptors: [],
            startedAt: startTime,
          };
          namespaceBuckets.set(bucketKey, bucket);
        }
        bucket.keys.push(key);
        bucket.descriptors.push(descriptor);

        return {
          id: descriptor.id,
          verb: descriptor.verb,
          resourceKind: descriptor.resourceKind,
          namespace: descriptor.namespace,
          name: descriptor.name,
          subresource: descriptor.subresource,
        };
      });

      // Preserve cluster-scoped keys by reconnecting results to their original descriptors.
      const descriptorsById = new Map<string, NormalizedCapabilityDescriptor[]>();
      chunk.forEach(([, descriptor]) => {
        const idKey = descriptor.id.trim();
        const existing = descriptorsById.get(idKey);
        if (existing) {
          existing.push(descriptor);
        } else {
          descriptorsById.set(idKey, [descriptor]);
        }
      });

      beginDiagnostics(namespaceBuckets);

      let response: capabilities.CheckResult[] = [];
      let raisedError: unknown = null;

      try {
        response = await EvaluateCapabilities(payload);
      } catch (error) {
        raisedError = error;
      }

      const completionTime = Date.now();
      const resultMap = new Map<string, CapabilityResult>();
      response.forEach((item) => {
        const normalized = toCapabilityResult(item);
        const matches = descriptorsById.get(normalized.id) ?? [];
        if (matches.length === 0) {
          resultMap.set(createCapabilityKey(normalized), normalized);
          return;
        }
        matches.forEach((descriptor) => {
          const enriched: CapabilityResult = {
            ...normalized,
            clusterId: descriptor.clusterId,
          };
          resultMap.set(createCapabilityKey(enriched), enriched);
        });
      });

      if (applyResults(chunk, resultMap, raisedError, completionTime)) {
        changed = true;
      }

      completeDiagnostics(namespaceBuckets, resultMap, raisedError, completionTime);
    }

    if (changed) {
      notify();
    }
  });
};

/**
 * Ensures the store is tracking entries for each descriptor so that snapshots
 * remain stable even before the first backend call completes.
 */
export const ensureCapabilityEntries = (
  descriptors: ReadonlyArray<NormalizedCapabilityDescriptor>
): void => {
  let changed = false;
  for (const descriptor of descriptors) {
    if (ensureEntry(descriptor)) {
      changed = true;
    }
  }
  if (changed) {
    notify();
  }
};

/**
 * Enqueues capability evaluations for the supplied descriptors. Requests are
 * batched automatically to minimise backend round-trips.
 */
export const requestCapabilities = (
  descriptors: ReadonlyArray<NormalizedCapabilityDescriptor>,
  options: CapabilityRequestOptions = {}
): void => {
  if (descriptors.length === 0) {
    return;
  }

  let changed = false;
  const now = Date.now();

  for (const descriptor of descriptors) {
    if (ensureEntry(descriptor)) {
      changed = true;
    }

    const key = createCapabilityKey(descriptor);
    const entry = entries.get(key);
    if (!entry) {
      continue;
    }

    if (!shouldRefreshEntry(entry, options, now)) {
      continue;
    }

    if (markEntryLoading(key, descriptor)) {
      changed = true;
    }

    pendingRequests.set(key, descriptor);
  }

  if (changed) {
    notify();
  }

  if (pendingRequests.size > 0) {
    queueFlush();
  }
};

/**
 * Returns immutable snapshots for the supplied capability keys. A descriptor map
 * is required so we can produce stable placeholders before responses arrive.
 */
export const snapshotEntries = (
  keys: readonly string[],
  descriptorMap: ReadonlyMap<string, NormalizedCapabilityDescriptor>
): CapabilityEntry[] =>
  keys.map((key) => {
    const entry = entries.get(key);
    if (entry) {
      return entry;
    }
    const descriptor = descriptorMap.get(key);
    if (!descriptor) {
      const cachedMissing = placeholderCache.get(key);
      if (cachedMissing) {
        return cachedMissing;
      }
      const placeholder = createPlaceholderEntry(key, {
        id: key,
        verb: '',
        resourceKind: '',
      });
      placeholderCache.set(key, placeholder);
      return placeholder;
    }
    const cached = placeholderCache.get(key);
    if (cached && descriptorsMatch(cached.request, descriptor)) {
      return cached;
    }
    const placeholder = createPlaceholderEntry(key, descriptor);
    placeholderCache.set(key, placeholder);
    return placeholder;
  });

/**
 * Retrieves the current entry for a capability key.
 */
export const getEntry = (key: string): CapabilityEntry | undefined => entries.get(key);

/**
 * Number of pending requests (primarily used in tests).
 */
export const __getPendingRequestCount = (): number => pendingRequests.size;
export const __getCapabilityBatchSize = (): number => MAX_CAPABILITY_BATCH;

/**
 * Clears the capability store. Intended for use in tests.
 */
export const resetCapabilityStore = (): void => {
  entries.clear();
  pendingRequests.clear();
  pendingFlush = null;
  placeholderCache.clear();
  namespaceDiagnostics.clear();
  diagnosticsSnapshotCache = [];
  diagnosticsSnapshotDirty = true;
  scheduleDiagnosticsNotification();
  notify();
};

/**
 * Exposed to tests so they can wait for an in-flight batch to complete.
 */
export const __flushPending = async (): Promise<void> => {
  if (!pendingFlush) {
    return;
  }
  try {
    await pendingFlush;
  } catch {
    // swallow errors; they will already be surfaced via entry state.
  }
};

export type { CapabilityEntry as CapabilityStoreEntry, CapabilityResult as CapabilityStoreResult };

export const subscribeDiagnostics = (listener: Listener): (() => void) => {
  diagnosticsListeners.add(listener);
  return () => {
    diagnosticsListeners.delete(listener);
  };
};

export const getCapabilityDiagnosticsSnapshot = (): CapabilityNamespaceDiagnostics[] => {
  if (diagnosticsSnapshotDirty) {
    rebuildDiagnosticsSnapshot();
  }
  return diagnosticsSnapshotCache;
};

const ensureDiagnosticsEntry = (
  key: string,
  namespace?: string,
  clusterId?: string
): CapabilityNamespaceDiagnostics => {
  const existing = namespaceDiagnostics.get(key);
  if (existing) {
    if (namespace !== undefined && existing.namespace !== namespace) {
      existing.namespace = namespace;
      diagnosticsSnapshotDirty = true;
    }
    if (clusterId !== undefined && existing.clusterId !== clusterId) {
      existing.clusterId = clusterId;
      diagnosticsSnapshotDirty = true;
    }
    return existing;
  }
  const entry: CapabilityNamespaceDiagnostics = {
    key,
    namespace,
    clusterId,
    pendingCount: 0,
    inFlightCount: 0,
    consecutiveFailureCount: 0,
    lastDescriptors: [],
  };
  namespaceDiagnostics.set(key, entry);
  diagnosticsSnapshotDirty = true;
  return entry;
};

const rebuildDiagnosticsSnapshot = () => {
  diagnosticsSnapshotCache = Array.from(namespaceDiagnostics.values())
    .map((entry) => ({
      ...entry,
      lastDescriptors: entry.lastDescriptors.slice(),
    }))
    .sort((a, b) => {
      if (isClusterDiagnosticsKey(a.key) && !isClusterDiagnosticsKey(b.key)) {
        return -1;
      }
      if (isClusterDiagnosticsKey(b.key) && !isClusterDiagnosticsKey(a.key)) {
        return 1;
      }
      return a.key.localeCompare(b.key);
    });
  diagnosticsSnapshotDirty = false;
};

const notifyDiagnostics = () => {
  if (diagnosticsSnapshotDirty) {
    rebuildDiagnosticsSnapshot();
  }
  if (diagnosticsListeners.size === 0) {
    return;
  }
  for (const listener of diagnosticsListeners) {
    listener();
  }
};

const scheduleDiagnosticsNotification = () => {
  if (diagnosticsNotifyScheduled) {
    return;
  }
  diagnosticsNotifyScheduled = true;
  const runner = () => {
    diagnosticsNotifyScheduled = false;
    notifyDiagnostics();
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(runner);
  } else {
    Promise.resolve()
      .then(runner)
      .catch(() => {
        diagnosticsNotifyScheduled = false;
      });
  }
};

const beginDiagnostics = (
  namespaceBuckets: Map<
    string,
    {
      namespace?: string;
      clusterId?: string;
      keys: string[];
      descriptors: NormalizedCapabilityDescriptor[];
      startedAt: number;
    }
  >
) => {
  const now = Date.now();
  let changed = false;

  namespaceBuckets.forEach((bucket, key) => {
    const entry = ensureDiagnosticsEntry(key, bucket.namespace, bucket.clusterId);
    entry.pendingCount += bucket.keys.length;
    entry.inFlightCount += bucket.keys.length;
    entry.inFlightStartedAt = entry.inFlightStartedAt ?? now;
    entry.totalChecks = bucket.keys.length;
    entry.lastDescriptors = bucket.descriptors.slice();
    diagnosticsSnapshotDirty = true;
    changed = true;
  });

  if (changed) {
    scheduleDiagnosticsNotification();
  }
};

const collectResultErrors = (result: CapabilityResult | undefined): string | null => {
  if (!result) {
    return 'capability response missing';
  }
  if (result.error) {
    return result.error;
  }
  if (result.evaluationError) {
    return result.evaluationError;
  }
  return null;
};

const applyResults = (
  toEvaluate: Array<[string, NormalizedCapabilityDescriptor]>,
  resultMap: Map<string, CapabilityResult>,
  raisedError: unknown,
  completionTime: number
): boolean => {
  let changed = false;

  if (raisedError) {
    const message = raisedError instanceof Error ? raisedError.message : String(raisedError);
    for (const [key] of toEvaluate) {
      if (markEntryError(key, message, completionTime)) {
        changed = true;
      }
    }
    return changed;
  }

  for (const [key, descriptor] of toEvaluate) {
    const result = resultMap.get(key);
    if (!result) {
      if (
        markEntryError(
          key,
          `capability response missing for ${descriptor.resourceKind} ${descriptor.verb}`,
          completionTime
        )
      ) {
        changed = true;
      }
      continue;
    }

    if (updateEntryFromResult(key, result, completionTime)) {
      changed = true;
    }
  }

  return changed;
};

const completeDiagnostics = (
  namespaceBuckets: Map<
    string,
    {
      namespace?: string;
      clusterId?: string;
      keys: string[];
      descriptors: NormalizedCapabilityDescriptor[];
      startedAt: number;
    }
  >,
  resultMap: Map<string, CapabilityResult>,
  raisedError: unknown,
  completionTime: number
) => {
  if (namespaceBuckets.size === 0) {
    return;
  }

  let changed = false;
  namespaceBuckets.forEach((bucket, key) => {
    const entry = ensureDiagnosticsEntry(key, bucket.namespace, bucket.clusterId);
    const errors = new Set<string>();
    let hasError = Boolean(raisedError);

    bucket.keys.forEach((descriptorKey) => {
      const result = resultMap.get(descriptorKey);
      const error = collectResultErrors(result);
      if (error) {
        hasError = true;
        errors.add(error);
      }
    });

    entry.pendingCount = Math.max(entry.pendingCount - bucket.keys.length, 0);
    entry.inFlightCount = Math.max(entry.inFlightCount - bucket.keys.length, 0);
    const duration = Math.max(0, completionTime - bucket.startedAt);
    entry.lastRunDurationMs = duration;
    entry.lastRunCompletedAt = completionTime;
    entry.lastResult = hasError ? 'error' : 'success';
    entry.lastError = errors.size > 0 ? Array.from(errors).join('; ') : null;
    entry.consecutiveFailureCount = hasError ? entry.consecutiveFailureCount + 1 : 0;
    entry.inFlightStartedAt = entry.inFlightCount > 0 ? entry.inFlightStartedAt : undefined;
    entry.totalChecks = bucket.keys.length;
    entry.lastDescriptors = bucket.descriptors.slice();
    diagnosticsSnapshotDirty = true;
    changed = true;
  });

  if (changed) {
    scheduleDiagnosticsNotification();
  }
};
