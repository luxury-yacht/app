/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Map/MapTab.test.tsx
 *
 * The object panel's Map tab reads its object's map through the real refresh
 * lease and store: loading before the first map, the failure without one, the
 * waiting state without a scope, and the retained map during a later read. Its
 * navigation goes to the real object-panel and view owners. MapTab takes its
 * object as a prop (MapTab.tsx:37), so it runs in provider mode inside the real
 * app shell (or a native panel window's shell); only the backend boundary is
 * faked (test-utils/appState). The graph renderer is stubbed to reach its
 * navigation callbacks.
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { type SnapshotRequest, snapshotResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import MapTab from './MapTab';

type ObjectMapNavigation = Record<
  'onOpenPanel' | 'onOpenObjectMap' | 'onNavigateView',
  ((ref: ObjectMapReference) => void) | undefined
>;

const objectMapProps = vi.hoisted(() => ({
  current: null as ObjectMapNavigation | null,
}));

vi.mock('@modules/object-map/ObjectMap', () => ({
  default: (props: ObjectMapNavigation) => {
    objectMapProps.current = props;
    return <div data-testid="object-map" />;
  },
}));

const app = installAppStateHarness();

const deployment = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'web',
};

let dev: TestCluster;
let view: MountedApp;

const panel = () => app.object(dev, deployment);
const mapScope = () => requireValue(panel().scopes.mapScope, 'expected the deployment map scope');

// backend/refresh/snapshot/object_map.go: the map seeded at the panel's object.
const mapPayload = (): ObjectMapSnapshotPayload => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  seed: { clusterId: dev.clusterId, ...deployment },
  nodes: [],
  edges: [],
  maxNodes: 250,
  truncated: false,
});

const startCluster = () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
};

const showMapTab = async ({
  isActive = true,
  scope = mapScope(),
}: {
  isActive?: boolean;
  scope?: string | null;
} = {}) => {
  await view.show(<MapTab objectData={{ ...panel().ref }} isActive={isActive} mapScope={scope} />);
};

/** Parks every map read until the returned release answers it with `payload`. */
const holdMapReads = (payload: () => ObjectMapSnapshotPayload) => {
  const parked: Array<() => void> = [];
  app.snapshots.respond(({ domain, scope }: SnapshotRequest) => {
    if (domain !== 'object-map') {
      return undefined;
    }
    return new Promise<Response>((resolve) => {
      parked.push(() =>
        resolve(snapshotResponse({ domain, scope, version: 1, payload: payload() }))
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

const mapReads = () => app.snapshots.reads('object-map').map((read) => read.scope);

const text = () => view.container.textContent ?? '';

describe('MapTab', () => {
  it.each(['version', 'group'] as const)(
    'rejects map navigation to an object missing its %s',
    async (field) => {
      startCluster();
      app.snapshots.serve('object-map', mapScope(), mapPayload());
      view = await app.render(null);
      await showMapTab();
      const viewTypeBefore = view.owners().viewState?.viewType;
      const navigation = requireValue(objectMapProps.current, 'expected the rendered map');
      const partialRef = { ...mapPayload().seed, [field]: undefined } as never;

      await act(async () => {
        navigation.onOpenPanel?.(partialRef);
        navigation.onOpenObjectMap?.(partialRef);
        navigation.onNavigateView?.(partialRef);
      });
      await app.settle();

      expect(view.openPanels()).toEqual([]);
      expect(view.owners().viewState?.viewType).toBe(viewTypeBefore);
      // Each refused reference is reported to the user once.
      expect(
        app.errors
          .take((record) => record.context?.source === 'object-map-build-ref')
          .map(({ kinds }) => kinds)
      ).toEqual([['toast'], ['toast'], ['toast']]);
    }
  );

  it('shows loading, not the empty state, until the first map arrives', async () => {
    startCluster();
    const release = holdMapReads(mapPayload);
    view = await app.render(null);
    await showMapTab();

    expect(mapReads()).toContain(mapScope());
    expect(text()).toContain('Loading object map');
    expect(text()).not.toContain('No data yet');

    await release();

    expect(view.container.querySelector('[data-testid="object-map"]')).not.toBeNull();
    expect(text()).not.toContain('Loading object map');
  });

  it('shows the read failure when no map has loaded', async () => {
    startCluster();
    app.snapshots.fail(
      'object-map',
      mapScope(),
      makeErrorStatus('InternalError', 'unable to build object map')
    );
    view = await app.render(null);
    await showMapTab();

    expect(view.container.querySelector('.map-tab__message--error')?.textContent).toBe(
      'unable to build object map'
    );
    expect(text()).not.toContain('No data yet');
    expect(view.container.querySelector('[data-testid="object-map"]')).toBeNull();
    // The refresh layer reports the failed read to the user once.
    expect(
      app.errors
        .take((record) => record.context?.domain === 'object-map')
        .map(({ kinds, context }) => ({ kinds, scope: context?.scope }))
    ).toEqual([{ kinds: ['toast'], scope: mapScope() }]);
  });

  it('waits without reading when the object has no map scope', async () => {
    startCluster();
    view = await app.render(null);
    await showMapTab({ scope: null });

    expect(text()).toContain('No data yet.');
    expect(mapReads()).toEqual([]);
  });

  it('keeps the loaded map on screen while a later read is in flight', async () => {
    startCluster();
    app.snapshots.serve('object-map', mapScope(), mapPayload());
    view = await app.render(null);
    await showMapTab();
    expect(view.container.querySelector('[data-testid="object-map"]')).not.toBeNull();

    // Returning to the tab reads the map again; that read is still in flight.
    await showMapTab({ isActive: false });
    const release = holdMapReads(mapPayload);
    const readsBefore = mapReads().length;
    await showMapTab({ isActive: true });

    expect(mapReads().length).toBeGreaterThan(readsBefore);
    expect(view.container.querySelector('[data-testid="object-map"]')).not.toBeNull();
    expect(text()).not.toContain('Loading object map');
    await release();
  });

  it('offers no workspace navigation from the map in a native panel window', async () => {
    startCluster();
    app.snapshots.serve('object-map', mapScope(), mapPayload());
    app.panelWindow(dev);
    view = await app.render(null);
    await showMapTab();

    const navigation = requireValue(objectMapProps.current, 'expected the rendered map');
    expect(navigation.onNavigateView).toBeUndefined();
    expect(navigation.onOpenPanel).toEqual(expect.any(Function));
  });
});
