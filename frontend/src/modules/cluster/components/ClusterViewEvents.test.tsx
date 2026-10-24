/**
 * frontend/src/modules/cluster/components/ClusterViewEvents.test.tsx
 *
 * The cluster Events view: it queries the visible cluster's events newest
 * first by default, opens the Event itself from Enter on its row or its Kind
 * badge, opens the involved object from the Object Name link (resolving a
 * custom resource's object through the catalog by UID when the Event carries
 * no apiVersion, and opening nothing when that lookup fails), and opens
 * nothing from a pointer click on the row. Every panel opens with complete
 * object identity in the visible cluster. Runs in the full app, navigated
 * through the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { objectcatalog } from '@/core/backend-api/models';
import type { ClusterEventEntry } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const eventIdentity: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Event',
  namespace: 'team-a',
  name: 'api.17f',
};
const pod: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'team-a',
  name: 'api',
};
const database: ObjectIdentity = {
  group: 'db.example.io',
  version: 'v1',
  kind: 'Database',
  namespace: 'team-a',
  name: 'primary',
};

/**
 * An Event row as backend/refresh/snapshot/cluster_events.go projects it: an
 * openable involved-object link when the Event names an apiVersion.
 */
const podEvent = (): ClusterEventEntry => ({
  ref: {
    ...eventIdentity,
    clusterId: dev.clusterId,
    resource: 'events',
    uid: 'event-uid',
  },
  resourceVersion: '1',
  objectKind: 'Pod',
  objectName: 'api',
  objectNamespace: 'team-a',
  objectUid: 'pod-uid',
  involvedObject: {
    ref: { ...pod, clusterId: dev.clusterId, resource: 'pods', uid: 'pod-uid' },
  },
  type: 'Warning',
  source: 'kubelet',
  reason: 'BackOff',
  object: 'Pod/api',
  message: 'Back-off restarting failed container',
  age: '1m',
  ageTimestamp: 123,
});

/** The backend sends only a display link when the Event names no apiVersion. */
const databaseEvent = (): ClusterEventEntry => ({
  ...podEvent(),
  objectKind: 'Database',
  objectName: 'primary',
  objectUid: 'database-uid',
  object: 'Database/primary',
  involvedObject: {
    display: {
      clusterId: dev.clusterId,
      kind: 'Database',
      namespace: 'team-a',
      name: 'primary',
      uid: 'database-uid',
    },
  },
});

const start = async (event: () => ClusterEventEntry = podEvent) => {
  app.serveTable(dev, 'cluster-events', { rows: [event()] });
  view = await app.mountApp();
  await view.goTo({ clusterView: 'events' });
};

const eventRow = () =>
  requireValue(
    view.container.querySelector<HTMLElement>('.gridtable-row'),
    'expected the event row'
  );

const cellOf = (column: string) =>
  requireValue(
    eventRow().querySelector<HTMLElement>(`.grid-cell[data-column="${column}"]`),
    `expected the ${column} cell`
  );

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const clickObjectName = () =>
  click(requireValue(cellOf('objectName').querySelector('button'), 'expected the object link'));

const opened = (identity: ObjectIdentity) => ({
  ...identity,
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
});

describe('ClusterViewEvents', () => {
  it('lists the visible cluster’s events from a query sorted newest first by default', async () => {
    await start();

    expect(eventRow().textContent).toContain('Back-off restarting failed container');
    const read = requireValue(
      app.snapshots.reads('cluster-events').slice(-1)[0],
      'expected a cluster-events read'
    );
    expect(read.scope.startsWith(`${dev.clusterId}|`)).toBe(true);
    // Last Seen ascending is newest first: age grows with time since the event.
    expect(read.scope).toContain('sort=age&sortDirection=asc');
  });

  it('opens the Event from Enter on the focused row and from its Kind badge', async () => {
    app.servePanel(dev, eventIdentity);
    await start();
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the events table'
    );

    await act(async () => table.focus());
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();
    expect(view.openPanels()).toEqual([opened(eventIdentity)]);

    await act(async () => view.owners().objectPanels.onCloseObjectPanel());
    await app.settle();
    await click(requireValue(cellOf('kind').querySelector('button'), 'expected the Kind badge'));
    expect(view.openPanels()).toEqual([opened(eventIdentity)]);
  });

  it('opens the involved object from the Object Name link', async () => {
    app.servePanel(dev, pod);
    await start();

    await clickObjectName();

    expect(view.openPanels()).toEqual([opened(pod)]);
  });

  it('resolves a custom resource’s involved object by UID when the Event names no apiVersion', async () => {
    app.servePanel(dev, database);
    // The catalog's summary of the object
    // (backend/resource_gateway_catalog.go FindCatalogObjectByUID).
    app.backend.answer('FindCatalogObjectByUID', () => ({
      ref: { ...database, clusterId: dev.clusterId, resource: 'databases', uid: 'database-uid' },
      resourceVersion: '1',
      creationTimestamp: '',
      scope: objectcatalog.Scope.ScopeNamespace,
    }));
    await start(databaseEvent);

    await clickObjectName();

    expect(app.backend.calls('FindCatalogObjectByUID')).toEqual([[dev.clusterId, 'database-uid']]);
    expect(view.openPanels()).toEqual([opened(database)]);
  });

  it('opens nothing when the catalog cannot resolve the involved object', async () => {
    app.backend.answer('FindCatalogObjectByUID', () => {
      throw new Error('catalog unavailable');
    });
    await start(databaseEvent);

    await clickObjectName();

    expect(view.openPanels()).toEqual([]);
  });

  it('opens no panel from a pointer click on the row', async () => {
    await start();

    await click(cellOf('message'));

    expect(view.openPanels()).toEqual([]);
  });
});
