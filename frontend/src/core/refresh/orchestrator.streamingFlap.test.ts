/**
 * frontend/src/core/refresh/orchestrator.streamingFlap.test.ts
 *
 * Streaming-start lifecycle of a leased scope, driven through the real
 * orchestrator, domain registrations, store, and resource stream manager over
 * the app-state harness's fake sockets and snapshot server
 * (test-utils/appState).
 *
 * Regression: the mount-time lease flap must not kill a streaming scope's
 * first start. Observed live (restricted cluster, every first visit to a
 * streaming view): mount enabled the scope and began its stream start; a
 * transient disable cancelled the start in flight; the immediate re-enable
 * found that start still pending and did not start its own; the cancelled
 * start then died silently, leaving the view 'initialising' until a fallback
 * poll, or forever. A start that completes cancelled while its scope is
 * enabled again restarts the stream and runs the initial reconciliation read;
 * one that completes while the scope stays released stays torn down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushRefreshWork,
  installAppStateHarness,
  markClusterReady,
  setAutoRefresh,
} from '@/test-utils/appState/harness';
import { snapshotResponse, streamKey } from '@/test-utils/appState/transport';
import { testScope } from '@/test-utils/refreshScope';
import { refreshOrchestrator } from './orchestrator';
import { makeNamespaceConfigSnapshotPayload } from './refreshContractTestBuilders';
import { getScopedDomainState } from './store';
import { resourceStreamManager } from './streaming/resourceStreamManager';

const DOMAIN = 'namespace-storage' as const;

const app = installAppStateHarness({ streams: 'manual' });

const scopeFor = (clusterId: string) => testScope(clusterId, 'namespace:flap-ns');

const readsOf = (scope: string): number =>
  app.snapshots.reads(DOMAIN).filter((read) => read.scope === scope).length;

const subscriptionRequests = (scope: string) =>
  app.streams
    .requests()
    .filter((frame) => frame.domain === DOMAIN && frame.clusterId === scope.split('|')[0]);

const settle = async () => {
  await flushRefreshWork();
  await vi.advanceTimersByTimeAsync(0);
  await flushRefreshWork();
};

beforeEach(() => {
  vi.useFakeTimers();
  setAutoRefresh(true);
  let version = 0;
  app.snapshots.respond(({ domain, scope }) => {
    version += 1;
    return snapshotResponse({
      domain,
      scope,
      version,
      payload: makeNamespaceConfigSnapshotPayload(),
    });
  });
});

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe('streaming start under the mount-time lease flap', () => {
  it('ends subscribed and loaded when the scope is re-enabled while its first start completes', async () => {
    markClusterReady('flap-a');
    const scope = scopeFor('flap-a');
    const start = vi.spyOn(resourceStreamManager, 'start');
    try {
      refreshOrchestrator.acquireScopedDomainLease(DOMAIN, scope);
      // One turn: the first start has run and its completion is still queued.
      await Promise.resolve();
      expect(start).toHaveBeenCalledTimes(1);
      refreshOrchestrator.releaseScopedDomainLease(DOMAIN, scope);
      refreshOrchestrator.acquireScopedDomainLease(DOMAIN, scope);
      await settle();
      await vi.advanceTimersByTimeAsync(1_000);

      // The cancelled start was replaced by a fresh one that stayed subscribed.
      expect(start).toHaveBeenCalledTimes(2);
      expect(app.streams.active()).toContain(streamKey(DOMAIN, scope));
      // The initial reconciliation read ran, so the scope left 'initialising'
      // now rather than at a fallback poll.
      expect(readsOf(scope)).toBe(1);
      expect(getScopedDomainState(DOMAIN, scope).status).toBe('ready');
      refreshOrchestrator.releaseScopedDomainLease(DOMAIN, scope);
    } finally {
      start.mockRestore();
    }
  });

  it('stays torn down when the scope is still released as its start completes', async () => {
    markClusterReady('flap-b');
    const scope = scopeFor('flap-b');
    const start = vi.spyOn(resourceStreamManager, 'start');
    try {
      refreshOrchestrator.acquireScopedDomainLease(DOMAIN, scope);
      await Promise.resolve();
      refreshOrchestrator.releaseScopedDomainLease(DOMAIN, scope);
      await settle();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(start).toHaveBeenCalledTimes(1);
      expect(app.streams.active()).not.toContain(streamKey(DOMAIN, scope));
      expect(readsOf(scope)).toBe(0);
      expect(getScopedDomainState(DOMAIN, scope)).toMatchObject({ data: null, error: null });
    } finally {
      start.mockRestore();
    }
  });
});

describe('query-only demand', () => {
  it('starts one live source without reading a bounded snapshot', async () => {
    markClusterReady('query-a');
    const scope = scopeFor('query-a');

    refreshOrchestrator.acquireScopedDomainLease(DOMAIN, scope, { demand: 'query' });
    await settle();

    expect(app.streams.active()).toEqual([streamKey(DOMAIN, scope)]);
    expect(readsOf(scope)).toBe(0);
    refreshOrchestrator.releaseScopedDomainLease(DOMAIN, scope, { demand: 'query' });
  });

  it('reads the bounded snapshot once snapshot demand joins the live source', async () => {
    markClusterReady('query-b');
    const scope = scopeFor('query-b');
    refreshOrchestrator.acquireScopedDomainLease(DOMAIN, scope, { demand: 'query' });
    await settle();
    expect(readsOf(scope)).toBe(0);
    const subscribed = subscriptionRequests(scope).length;

    refreshOrchestrator.acquireScopedDomainLease(DOMAIN, scope, { demand: 'snapshot' });
    await settle();

    expect(readsOf(scope)).toBe(1);
    // The new demand shares the running subscription.
    expect(subscriptionRequests(scope)).toHaveLength(subscribed);
    refreshOrchestrator.releaseScopedDomainLease(DOMAIN, scope, { demand: 'snapshot' });
    refreshOrchestrator.releaseScopedDomainLease(DOMAIN, scope, { demand: 'query' });
  });

  // Query consumers refetch their page when the acknowledged-stream version
  // moves; it moves on the transition to healthy, not on every delivery.
  it('advances the acknowledged-stream version once per healthy transition', async () => {
    markClusterReady('query-c');
    const scope = scopeFor('query-c');
    refreshOrchestrator.acquireScopedDomainLease(DOMAIN, scope, { demand: 'query' });
    await settle();
    expect(getScopedDomainState(DOMAIN, scope).streamAcknowledgedVersion).toBeUndefined();

    app.streams.acknowledge(DOMAIN, scope);
    await settle();
    expect(getScopedDomainState(DOMAIN, scope).streamAcknowledgedVersion).toBe(1);

    app.streams.ring(DOMAIN, scope, 'object', 'v2');
    await settle();
    expect(getScopedDomainState(DOMAIN, scope).streamAcknowledgedVersion).toBe(1);
    refreshOrchestrator.releaseScopedDomainLease(DOMAIN, scope, { demand: 'query' });
  });
});
