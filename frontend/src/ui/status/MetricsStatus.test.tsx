/**
 * frontend/src/ui/status/MetricsStatus.test.tsx
 *
 * The header metrics indicator reads the visible cluster's overview metrics:
 * it is inactive until they arrive, healthy when they are fresh, and amber
 * (degraded) with the reason when the backend disabled metrics collection,
 * never a stuck "collecting"; its popover ages the last collection from the
 * seconds-based collectedAt and shows no age for a zero-time one. Runs in the
 * full app over the faked backend (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeClusterOverviewSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;
let dev: TestCluster;

const indicator = () =>
  requireValue(
    view.container.querySelector<HTMLElement>('[role="button"][aria-label^="Metrics:"]'),
    'expected the metrics indicator'
  );
const severity = () =>
  indicator().querySelector('.status-indicator-dot')?.getAttribute('data-status');

/** Opens the indicator's popover from the keyboard and returns its text. */
const popoverText = async () => {
  await act(async () => {
    indicator().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });
  await app.settle();
  return requireValue(
    document.getElementById(indicator().getAttribute('aria-controls') ?? ''),
    'expected the metrics popover'
  ).textContent;
};

/** The visible cluster's overview reports these metrics. */
const start = async (metrics: ClusterOverviewMetrics) => {
  app.snapshots.serve(
    'cluster-overview',
    buildClusterRefreshScope('cluster-overview', dev.clusterId),
    makeClusterOverviewSnapshotPayload({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      metrics,
    })
  );
  view = await app.mountApp();
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MetricsStatus', () => {
  it('is inactive until the overview’s metrics arrive', async () => {
    // The overview read stays in flight until the app abandons it.
    app.snapshots.respond((request) =>
      request.domain === 'cluster-overview'
        ? new Promise<Response>((_resolve, reject) => {
            request.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
        : undefined
    );
    view = await app.mountApp();

    expect(severity()).toBe('inactive');
    expect(indicator().getAttribute('aria-label')).toBe('Metrics: Awaiting metrics data...');
  });

  it('is healthy when metrics are fresh', async () => {
    await start({ stale: false, successCount: 3, failureCount: 0 });

    expect(severity()).toBe('healthy');
  });

  it('shows amber with the reason, not a stuck collection, when metrics are disabled', async () => {
    // A disabled poller (no metrics permission, or no metrics-server) is a
    // restriction, not an app fault.
    await start({
      disabled: true,
      lastError: 'Insufficient permissions for Metrics API',
      stale: true,
      successCount: 0,
      failureCount: 0,
    });

    expect(severity()).toBe('degraded');
    expect(indicator().getAttribute('aria-label')).toBe(
      'Metrics: Insufficient permissions for Metrics API'
    );
  });

  it('ages the last collection from the seconds-based collectedAt', async () => {
    // collectedAt is Unix seconds; read as milliseconds it would age from 1970.
    const collectedAt = Date.parse('2026-09-30T12:00:00Z') / 1000;
    await start({ stale: false, successCount: 3, failureCount: 0, collectedAt });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:04Z'));

    expect(await popoverText()).toMatch(/collected 4s ago/);
  });

  it('shows no collection age for a zero-time collectedAt', async () => {
    // Older backends serialized Go's zero time instead of omitting it; that is
    // "never collected", not a collection decades ago.
    await start({ stale: false, successCount: 3, failureCount: 0, collectedAt: -62135596800 });

    expect(await popoverText()).not.toMatch(/collected/i);
  });
});
