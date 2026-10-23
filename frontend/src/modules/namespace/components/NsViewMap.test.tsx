/**
 * frontend/src/modules/namespace/components/NsViewMap.test.tsx
 *
 * The namespace Map view reads the namespace's object map in the visible
 * cluster through the real refresh lease: loading before the first map, the
 * failure without one, the rendered map, opening a mapped object's panel with
 * full identity, and no further reads once the user leaves the view. Runs in
 * the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState). The graph renderer is stubbed to reach its payload
 * and navigation callbacks.
 */

import {
  buildNamespaceObjectMapScope,
  OBJECT_MAP_MAX_NODES,
} from '@modules/object-map/objectMapScope';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { type SnapshotRequest, snapshotResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

type ObjectMapProps = {
  payload: ObjectMapSnapshotPayload;
  onOpenPanel?: (ref: ObjectMapReference) => void;
};

const objectMapProps = vi.hoisted(() => ({ current: null as ObjectMapProps | null }));

vi.mock('@modules/object-map/ObjectMap', () => ({
  default: (props: ObjectMapProps) => {
    objectMapProps.current = props;
    return <div data-testid="object-map" />;
  },
}));

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const deployment = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'team-a',
  name: 'web',
};

const mapScope = () =>
  requireValue(
    buildNamespaceObjectMapScope(dev.clusterId, 'team-a', { maxNodes: OBJECT_MAP_MAX_NODES }),
    'expected the team-a map scope'
  );

/** backend/refresh/snapshot/object_map.go: the namespace's map, holding one Deployment. */
const mapPayload = (): ObjectMapSnapshotPayload => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  seed: { clusterId: dev.clusterId, group: '', version: 'v1', kind: 'Namespace', name: 'team-a' },
  nodes: [
    {
      id: 'web',
      depth: 0,
      ref: { clusterId: dev.clusterId, resource: 'deployments', uid: 'web-uid', ...deployment },
    },
  ],
  edges: [],
  maxNodes: OBJECT_MAP_MAX_NODES,
  truncated: false,
});

const mapReads = () => app.snapshots.reads('object-map').map((read) => read.scope);
const text = () => view.container.textContent ?? '';
const renderedMap = () => view.container.querySelector('[data-testid="object-map"]');

const openMap = async () => {
  app.startScreen(dev);
  view = await app.mountApp();
  await view.goTo({ namespace: 'team-a', view: 'map' });
};

/** Parks every map read until the returned release answers it. */
const holdMapReads = () => {
  const parked: Array<() => void> = [];
  app.snapshots.respond(({ domain, scope }: SnapshotRequest) => {
    if (domain !== 'object-map') {
      return undefined;
    }
    return new Promise<Response>((resolve) => {
      parked.push(() =>
        resolve(snapshotResponse({ domain, scope, version: 1, payload: mapPayload() }))
      );
    });
  });
  return async () => {
    app.snapshots.respond(null);
    await act(async () => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });
    await app.settle();
  };
};

beforeEach(() => {
  objectMapProps.current = null;
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NsViewMap', () => {
  it('shows loading, not the empty state, until the namespace’s first map arrives', async () => {
    const release = holdMapReads();
    await openMap();

    expect(mapReads()).toContain(mapScope());
    expect(text()).toContain('Loading namespace map');
    expect(text()).not.toContain('No data yet');

    await release();

    expect(renderedMap()).not.toBeNull();
    expect(objectMapProps.current?.payload.nodes?.map((node) => node.ref.name)).toEqual(['web']);
    expect(text()).not.toContain('Loading namespace map');
  });

  it('shows and reports a failed map read when no map has loaded', async () => {
    app.snapshots.fail(
      'object-map',
      mapScope(),
      makeErrorStatus('InternalError', 'unable to build object map')
    );
    await openMap();

    expect(text()).toContain('unable to build object map');
    expect(text()).not.toContain('No data yet');
    expect(renderedMap()).toBeNull();
    // The refresh layer reports the failed read to the user once.
    expect(
      app.errors
        .take((record) => record.context?.domain === 'object-map')
        .map(({ kinds, context }) => ({ kinds, scope: context?.scope }))
    ).toEqual([{ kinds: ['toast'], scope: mapScope() }]);
  });

  it('opens a mapped object’s panel with full identity in the visible cluster', async () => {
    app.snapshots.serve('object-map', mapScope(), mapPayload());
    app.servePanel(dev, deployment);
    // backend/autoscaling_details.go IsWorkloadHPAManaged: the Deployment panel asks; no HPA.
    app.backend.answer('IsWorkloadHPAManaged', () => false);
    await openMap();
    const map = requireValue(objectMapProps.current, 'expected the rendered map');
    const node = requireValue(map.payload.nodes?.[0], 'expected the mapped Deployment');

    await act(async () => {
      map.onOpenPanel?.(node.ref);
    });
    await app.settle();

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...deployment },
    ]);
  });

  it('keeps refreshing the map while shown and stops once the user leaves', async () => {
    vi.useFakeTimers();
    app.snapshots.serve('object-map', mapScope(), mapPayload());
    await openMap();
    const shownReads = mapReads().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(mapReads().length).toBeGreaterThan(shownReads);

    await view.goTo({ clusterView: 'overview' });
    const leftReads = mapReads().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(mapReads().length).toBe(leftReads);
  });
});
