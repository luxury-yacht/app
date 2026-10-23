/**
 * frontend/src/test-utils/appState/harness.backendState.test.tsx
 *
 * The faked backend changes the way the real one does mid-test: a cluster's
 * lifecycle, auth, and health move in the backend's workspace state and reach
 * the app as its events, so a later workspace answer (a tab switch) keeps
 * them; a permission check the cluster cannot evaluate comes back as the
 * backend's error result; an unreachable refresh server fails telemetry
 * reads; and a test can hold a refresh lease the way a view does.
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryPermissions } from '@/core/backend-api';
import { backend } from '@/core/backend-api/models';
import { clusterWorkspaceStore } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { fetchTelemetrySummary } from '@/core/refresh/client';
import {
  makePodSnapshotPayload,
  makeTelemetrySummary,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import { installAppStateHarness } from './harness';

const app = installAppStateHarness();

afterEach(() => {
  vi.useRealTimers();
});

const clusterState = (clusterId: string) =>
  clusterWorkspaceStore.getSnapshot().clusters.get(clusterId);

describe('a cluster state the backend changes', () => {
  it('reaches the app and survives the next workspace answer', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    const stg = app.cluster({
      name: 'dev',
      context: 'beta',
      health: backend.ClusterHealthState.ClusterHealthDegraded,
    });
    app.namespaces(dev, ['default']);
    app.namespaces(stg, ['default']);
    const view = await app.render(null);
    expect(clusterState(stg.clusterId)?.health).toBe('degraded');

    await app.setClusterState(stg, {
      lifecycle: backend.ClusterLifecycleState.ClusterStateLoading,
      auth: { state: 'invalid', reason: 'Token expired', summary: 'The SSO session expired.' },
      health: backend.ClusterHealthState.ClusterHealthHealthy,
    });
    const changed = {
      lifecycle: 'loading',
      health: 'healthy',
      auth: expect.objectContaining({ hasError: true, reason: 'Token expired' }),
    };
    expect(clusterState(stg.clusterId)).toMatchObject(changed);

    // Switching tabs answers with the backend's workspace state.
    await view.selectCluster(stg);

    expect(clusterState(stg.clusterId)).toMatchObject(changed);
    expect(clusterState(dev.clusterId)).toMatchObject({ lifecycle: 'ready', health: 'healthy' });
  });

  it('clears the failure when the cluster’s credentials recover', async () => {
    const dev = app.cluster({
      name: 'dev',
      context: 'alpha',
      auth: { state: 'invalid', reason: 'Token expired' },
    });
    app.namespaces(dev, ['default']);
    await app.render(null);
    expect(clusterState(dev.clusterId)?.auth.hasError).toBe(true);

    await app.setClusterState(dev, { auth: { state: 'valid' } });

    expect(clusterState(dev.clusterId)?.auth).toMatchObject({ hasError: false, reason: '' });
  });
});

describe('a permission check the cluster cannot evaluate', () => {
  it('comes back as the backend’s error result, not as a denial', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    const inactive = `cluster dependency resolution failed: cluster ${dev.clusterId} not active`;
    app.permissions((query) => (query.namespace === 'team-b' ? { error: inactive } : true));
    const check = (namespace: string) => ({
      id: namespace,
      clusterId: dev.clusterId,
      resourceKind: 'Deployment',
      verb: 'delete',
      namespace,
    });

    const response = await QueryPermissions([check('team-a'), check('team-b')]);

    expect(response?.results).toEqual([
      expect.objectContaining({ id: 'team-a', allowed: true, source: 'ssrr' }),
      expect.objectContaining({ id: 'team-b', allowed: false, source: 'error', error: inactive }),
    ]);
  });
});

describe('an unreachable refresh server', () => {
  it('fails telemetry reads until it answers again', async () => {
    app.snapshots.failTelemetry();

    await expect(fetchTelemetrySummary()).rejects.toThrow();

    app.snapshots.telemetry(makeTelemetrySummary());
    await expect(fetchTelemetrySummary()).resolves.toMatchObject({ snapshots: [] });
  });
});

describe('a lease the test holds', () => {
  it('keeps the scope’s stream open, as a view does, until released', async () => {
    vi.useFakeTimers();
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    const scope = buildRefreshScope('pods', {
      clusterId: dev.clusterId,
      selector: { kind: 'namespace', namespace: 'team-a' },
    });
    app.snapshots.serve('pods', scope, makePodSnapshotPayload({ clusterId: dev.clusterId }));
    const view = await app.render(null);
    const podStreams = () => app.streams.active().filter((stream) => stream.startsWith('pods '));

    const release = await view.lease({ domain: 'pods', scope });
    expect(podStreams()).toEqual([`pods ${scope}`]);

    await release();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(podStreams()).toEqual([]);
  });
});
