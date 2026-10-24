/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.test.tsx
 *
 * The panel's object-details lease and its derived state through the real
 * data broker, refresh orchestrator, store, and auto-refresh preference,
 * inside the app shell. Only the backend boundary is faked
 * (test-utils/appState). Doorbell refetches, the 10 s backstop, and hidden
 * panels are covered by objectDetailsDoorbell.test.tsx.
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScopedDomainState } from '@/core/refresh/store';
import type { ObjectDetailsSnapshotPayload } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { streamKey } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { useObjectPanelRefresh } from './useObjectPanelRefresh';

const app = installAppStateHarness();

type RefreshResult = ReturnType<typeof useObjectPanelRefresh>;

let refresh: RefreshResult | null = null;

function DetailsProbe({ detailScope }: Readonly<{ detailScope: string | null }>) {
  refresh = useObjectPanelRefresh({ detailScope, isOpen: true, resourceDeleted: false });
  return null;
}

const current = (): RefreshResult => {
  if (!refresh) {
    throw new Error('expected the details hook to render');
  }
  return refresh;
};

describe('useObjectPanelRefresh', () => {
  let dev: TestCluster;
  let view: MountedApp;
  let detailScope: string;

  const start = async () => {
    refresh = null;
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    detailScope =
      app.object(dev, {
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'team-a',
        name: 'api',
      }).scopes.detailScope ?? '';
    view = await app.render(null);
  };

  // backend object-details for the Deployment, as the snapshot API serves it.
  const serveDetails = (overrides: Partial<ObjectDetailsSnapshotPayload> = {}) => {
    app.snapshots.serve('object-details', detailScope, {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      ...objectDetailOf('deployment', { desiredReplicas: 3 }),
      ...overrides,
    } as ObjectDetailsSnapshotPayload);
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  const detailReads = () =>
    app.snapshots.reads('object-details').filter((read) => read.scope === detailScope);

  it('reads the details when shown and exposes them with their deletion metadata', async () => {
    await start();
    const deletion = {
      deletionTimestamp: '2026-08-09T12:34:56Z',
      finalizers: ['example.com/cleanup'],
    };
    serveDetails({ deletion });

    await view.show(<DetailsProbe detailScope={detailScope} />);

    expect(detailReads()).not.toEqual([]);
    expect(current().detail).toMatchObject({
      detailType: 'deployment',
      details: { desiredReplicas: 3 },
    });
    expect(current().deletion).toEqual(deletion);
    expect(current().detailsLoading).toBe(false);
    expect(current().detailsError).toBeNull();
  });

  it('keeps the cached details when the panel unmounts', async () => {
    vi.useFakeTimers();
    await start();
    serveDetails();
    await view.show(<DetailsProbe detailScope={detailScope} />);

    view.clear();
    // Past the stream's unsubscribe debounce, when a released lease stops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(app.streams.active()).not.toContain(streamKey('object-details', detailScope));
    // A cluster-switch round trip repaints from this cache; only closing the
    // panel frees it (ObjectPanelStateContext closePanel).
    expect(getScopedDomainState('object-details', detailScope).data).toMatchObject({
      details: { desiredReplicas: 3 },
    });
  });

  it('reads the details again on a user refresh', async () => {
    await start();
    serveDetails();
    await view.show(<DetailsProbe detailScope={detailScope} />);
    serveDetails(objectDetailOf('deployment', { desiredReplicas: 5 }));
    const readsBefore = detailReads().length;

    await act(async () => {
      await current().fetchResourceDetails('user');
    });
    await app.settle();

    expect(detailReads().length).toBeGreaterThan(readsBefore);
    expect(current().detail).toMatchObject({ details: { desiredReplicas: 5 } });
  });

  it('surfaces a detail read failure', async () => {
    await start();
    app.snapshots.fail(
      'object-details',
      detailScope,
      makeErrorStatus('InternalError', 'details unavailable')
    );

    await view.show(<DetailsProbe detailScope={detailScope} />);

    expect(current().detail).toBeNull();
    expect(current().detailsError).toMatchObject({
      kind: 'backend',
      status: { reason: 'InternalError', message: 'details unavailable' },
    });
    // An unexpected backend failure is also raised to the user.
    expect(
      app.errors
        .take((record) => record.kinds.includes('toast'))
        .map(({ error }) => (error instanceof Error ? error.message : String(error)))
    ).toEqual(['details unavailable']);
  });

  it('keeps the fetch helper inert without an object scope', async () => {
    await start();
    await view.show(<DetailsProbe detailScope={null} />);

    await act(async () => {
      await current().fetchResourceDetails('user');
    });

    expect(app.snapshots.reads('object-details')).toEqual([]);
    expect(current().detail).toBeNull();
  });

  it('shows no passive loading and reads nothing while auto-refresh is paused', async () => {
    app.preferences({ autoRefreshEnabled: false });
    await start();
    serveDetails();

    await view.show(<DetailsProbe detailScope={detailScope} />);

    expect(current().detailsLoading).toBe(false);
    expect(app.snapshots.reads('object-details')).toEqual([]);
  });
});
