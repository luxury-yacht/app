/**
 * frontend/src/core/capabilities/store.test.ts
 *
 * Test suite for store.
 * Covers key behaviors and edge cases for store.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wailsjs/go/backend/App', () => ({
  EvaluateCapabilities: vi.fn(),
}));

import { EvaluateCapabilities } from '@wailsjs/go/backend/App';

import {
  requestCapabilities,
  resetCapabilityStore,
  __flushPending,
  __getPendingRequestCount,
  ensureCapabilityEntries,
  getCapabilityDiagnosticsSnapshot,
  getEntry,
  getStoreVersion,
  snapshotEntries,
  subscribe,
  subscribeDiagnostics,
} from './store';
import { createCapabilityKey, normalizeDescriptor } from './utils';

const EvaluateCapabilitiesMock = vi.mocked(EvaluateCapabilities);

const descriptor = normalizeDescriptor({
  id: 'update',
  verb: 'update',
  resourceKind: 'Deployment',
  namespace: 'default',
  name: 'demo',
});

describe('capability store', () => {
  beforeEach(() => {
    resetCapabilityStore();
    EvaluateCapabilitiesMock.mockReset();
    vi.useRealTimers();
  });

  it('evaluates capabilities and stores successful results', async () => {
    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: true,
        deniedReason: '',
        evaluationError: '',
        error: '',
      },
    ]);

    requestCapabilities([descriptor], { ttlMs: 0 });
    await __flushPending();

    expect(EvaluateCapabilitiesMock).toHaveBeenCalledTimes(1);

    const key = createCapabilityKey(descriptor);
    const entry = getEntry(key);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('ready');
    expect(entry?.result?.allowed).toBe(true);
    expect(entry?.error).toBeNull();
    expect(entry?.lastFetched).toBeDefined();
  });

  it('respects ttl and avoids unnecessary re-fetches', async () => {
    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: true,
        deniedReason: '',
        evaluationError: '',
        error: '',
      },
    ]);

    requestCapabilities([descriptor], { ttlMs: 60_000 });
    await __flushPending();
    expect(EvaluateCapabilitiesMock).toHaveBeenCalledTimes(1);

    EvaluateCapabilitiesMock.mockClear();
    requestCapabilities([descriptor], { ttlMs: 60_000 });
    await __flushPending();
    expect(EvaluateCapabilitiesMock).not.toHaveBeenCalled();

    requestCapabilities([descriptor], { ttlMs: 60_000, force: true });
    await __flushPending();
    expect(EvaluateCapabilitiesMock).toHaveBeenCalledTimes(1);
  });

  it('propagates backend errors into entry state', async () => {
    EvaluateCapabilitiesMock.mockRejectedValue(new Error('cluster unreachable'));

    requestCapabilities([descriptor], { ttlMs: 0 });
    await __flushPending();

    const key = createCapabilityKey(descriptor);
    const entry = getEntry(key);
    expect(entry?.status).toBe('error');
    expect(entry?.error).toContain('cluster unreachable');
  });

  it('marks entries as error when responses are missing', async () => {
    EvaluateCapabilitiesMock.mockResolvedValue([]);

    requestCapabilities([descriptor], { ttlMs: 0 });
    await __flushPending();

    const key = createCapabilityKey(descriptor);
    const entry = getEntry(key);
    expect(entry?.status).toBe('error');
    expect(entry?.error).toContain('capability response missing');
  });

  it('captures denied reason when capability evaluation disallows an action', async () => {
    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: false,
        deniedReason: 'RBAC: updates forbidden',
        evaluationError: '',
        error: '',
      },
    ]);

    requestCapabilities([descriptor], { ttlMs: 0 });
    await __flushPending();

    const key = createCapabilityKey(descriptor);
    const entry = getEntry(key);
    expect(entry?.status).toBe('ready');
    expect(entry?.result?.allowed).toBe(false);
    expect(entry?.result?.deniedReason).toBe('RBAC: updates forbidden');
    expect(entry?.error).toBeNull();
  });

  it('records diagnostics for namespace batches', async () => {
    let resolveEval: ((value: unknown) => void) | undefined;
    EvaluateCapabilitiesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEval = resolve;
        }) as Promise<any>
    );

    requestCapabilities([descriptor], { ttlMs: 0 });

    await Promise.resolve();

    const pendingSnapshot = getCapabilityDiagnosticsSnapshot();
    expect(pendingSnapshot.length).toBeGreaterThan(0);
    expect(pendingSnapshot[0].namespace).toBe('default');
    expect(pendingSnapshot[0].inFlightCount).toBe(1);

    resolveEval?.([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: true,
        deniedReason: '',
        evaluationError: '',
        error: '',
      },
    ]);

    await __flushPending();

    const completedSnapshot = getCapabilityDiagnosticsSnapshot();
    expect(completedSnapshot[0].pendingCount).toBe(0);
    expect(completedSnapshot[0].inFlightCount).toBe(0);
    expect(completedSnapshot[0].lastResult).toBe('success');
    expect(completedSnapshot[0].totalChecks).toBe(1);
  });

  it('tracks consecutive failures in diagnostics', async () => {
    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: false,
        deniedReason: '',
        evaluationError: '',
        error: 'forbidden',
      },
    ]);

    requestCapabilities([descriptor], { ttlMs: 0 });
    await __flushPending();

    let snapshot = getCapabilityDiagnosticsSnapshot();
    expect(snapshot[0].lastResult).toBe('error');
    expect(snapshot[0].consecutiveFailureCount).toBe(1);

    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: false,
        deniedReason: '',
        evaluationError: '',
        error: 'still forbidden',
      },
    ]);

    requestCapabilities([descriptor], { ttlMs: 0, force: true });
    await __flushPending();

    snapshot = getCapabilityDiagnosticsSnapshot();
    expect(snapshot[0].consecutiveFailureCount).toBe(2);
    expect(snapshot[0].lastError).toContain('still forbidden');
  });

  it('notifies subscribers only when new entries are created', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    const initialVersion = getStoreVersion();
    ensureCapabilityEntries([descriptor]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStoreVersion()).toBeGreaterThan(initialVersion);

    listener.mockClear();
    ensureCapabilityEntries([descriptor]);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('provides stable snapshots with cached placeholders', () => {
    const normalized = normalizeDescriptor({
      id: 'namespace:pods:list:dev',
      resourceKind: 'Pod',
      verb: 'list',
      namespace: 'dev',
    });
    ensureCapabilityEntries([normalized]);
    const descriptorMap = new Map([[createCapabilityKey(normalized), normalized]]);

    const [existingEntry, missingPlaceholder] = snapshotEntries(
      [createCapabilityKey(normalized), 'missing-capability'],
      descriptorMap
    );

    expect(existingEntry.request.id).toBe('namespace:pods:list:dev');
    expect(existingEntry.status).toBe('idle');

    expect(missingPlaceholder.key).toBe('missing-capability');
    expect(missingPlaceholder.request.id).toBe('missing-capability');
    expect(missingPlaceholder.status).toBe('idle');

    const [, cachedPlaceholder] = snapshotEntries(
      [createCapabilityKey(normalized), 'missing-capability'],
      descriptorMap
    );
    expect(cachedPlaceholder).toBe(missingPlaceholder);

    const [fallbackPlaceholder] = snapshotEntries(['no-descriptor'], new Map());
    expect(fallbackPlaceholder.request.id).toBe('no-descriptor');
  });

  it('avoids duplicate queues while pending and respects ttl expiry', async () => {
    vi.useFakeTimers();
    const start = new Date('2025-01-01T00:00:00Z').valueOf();
    vi.setSystemTime(start);

    let resolveEval: ((value: unknown) => void) | undefined;
    EvaluateCapabilitiesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEval = resolve;
        }) as Promise<any>
    );

    requestCapabilities([descriptor], { ttlMs: 60_000 });
    expect(__getPendingRequestCount()).toBe(1);

    requestCapabilities([descriptor], { ttlMs: 60_000 });
    expect(__getPendingRequestCount()).toBe(1);

    await Promise.resolve();

    resolveEval?.([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: true,
        deniedReason: '',
        evaluationError: '',
        error: '',
      },
    ]);
    await __flushPending();

    expect(__getPendingRequestCount()).toBe(0);

    EvaluateCapabilitiesMock.mockClear();
    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: true,
        deniedReason: '',
        evaluationError: '',
        error: '',
      },
    ]);

    vi.setSystemTime(start + 30_000);
    requestCapabilities([descriptor], { ttlMs: 60_000 });
    await __flushPending();
    expect(EvaluateCapabilitiesMock).not.toHaveBeenCalled();

    vi.setSystemTime(start + 120_000);
    requestCapabilities([descriptor], { ttlMs: 60_000 });
    await __flushPending();
    expect(EvaluateCapabilitiesMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('uses cluster diagnostics bucket when namespace is absent', async () => {
    const clusterDescriptor = normalizeDescriptor({
      id: 'cluster:nodes:list',
      resourceKind: 'Node',
      verb: 'list',
    });

    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: clusterDescriptor.id,
        verb: clusterDescriptor.verb,
        resourceKind: clusterDescriptor.resourceKind,
        namespace: undefined,
        name: undefined,
        subresource: undefined,
        allowed: true,
        deniedReason: '',
        evaluationError: '',
        error: '',
      },
    ]);

    requestCapabilities([clusterDescriptor], { ttlMs: 0 });
    await __flushPending();

    const snapshot = getCapabilityDiagnosticsSnapshot();
    const clusterEntry = snapshot.find((entry) => entry.key === '__cluster__');
    expect(clusterEntry).toBeDefined();
    expect(clusterEntry?.namespace).toBeUndefined();
    expect(clusterEntry?.totalChecks).toBe(1);
  });

  it('records evaluation errors in diagnostics summaries', async () => {
    EvaluateCapabilitiesMock.mockResolvedValue([
      {
        id: 'update',
        verb: 'update',
        resourceKind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        subresource: undefined,
        allowed: false,
        deniedReason: '',
        evaluationError: 'api-server timeout',
        error: '',
      },
    ]);

    requestCapabilities([descriptor], { ttlMs: 0 });
    await __flushPending();

    const snapshot = getCapabilityDiagnosticsSnapshot();
    expect(snapshot[0].lastError).toContain('api-server timeout');
    expect(snapshot[0].lastResult).toBe('error');
  });

  it('resets the store and schedules diagnostics notification without queueMicrotask', async () => {
    const originalQueueMicrotask = global.queueMicrotask;
    const diagnosticsListener = vi.fn();
    const unsubscribeDiagnostics = subscribeDiagnostics(diagnosticsListener);

    (global as any).queueMicrotask = undefined;

    resetCapabilityStore();
    await Promise.resolve();

    expect(diagnosticsListener).toHaveBeenCalled();

    unsubscribeDiagnostics();
    (global as any).queueMicrotask = originalQueueMicrotask;
  });
});
