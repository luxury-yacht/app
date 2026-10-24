/**
 * frontend/src/modules/namespace/components/NsViewEvents.test.tsx
 *
 * The namespace Events view lists the namespace's Events from the backend's
 * namespace-events query in the visible cluster, opens an Event in its panel
 * with full identity, opens an Event's involved object from the row menu, and
 * under All Namespaces lists every namespace's Events with a namespace link to
 * the involved object's namespace. The shared event columns and involved-object
 * resolution are covered once in ClusterViewEvents.test.tsx and
 * shared/events/eventGridModel.test.ts. Runs in the full app, navigated through
 * the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NamespaceEventSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const podIdentity = (name: string, namespace = 'team-a') => ({
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace,
  name,
});

const eventIdentity = (name: string, namespace = 'team-a') => ({
  group: '',
  version: 'v1',
  kind: 'Event',
  namespace,
  name,
});

/**
 * An Event row as backend/refresh/snapshot/namespace_events.go projects it,
 * with the openable link to its involved Pod.
 */
const event = (pod: string, namespace = 'team-a'): NamespaceEventSummary => ({
  ref: {
    clusterId: dev.clusterId,
    resource: 'events',
    uid: `${pod}-event-uid`,
    ...eventIdentity(`${pod}.17f`, namespace),
  },
  resourceVersion: '1',
  objectKind: 'Pod',
  objectName: pod,
  objectNamespace: namespace,
  objectUid: `${pod}-uid`,
  involvedObject: {
    ref: { clusterId: dev.clusterId, resource: 'pods', ...podIdentity(pod, namespace) },
  },
  type: 'Warning',
  source: 'kubelet',
  reason: 'FailedScheduling',
  object: `Pod/${pod}`,
  message: 'Insufficient CPU',
  age: '1m',
  ageTimestamp: Date.now() - 60_000,
});

const start = async (rows: NamespaceEventSummary[]) => {
  app.startScreen(dev);
  app.serveTable(dev, 'namespace-events', { rows });
  view = await app.mountApp();
  await view.goTo({ namespace: 'team-a', view: 'events' });
};

const rowTexts = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).map(
    (row) => row.textContent
  );

const rowOf = (text: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(text)
    ),
    `expected the ${text} row`
  );

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();

const activate = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await app.settle();
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
});

describe('NsViewEvents', () => {
  it('lists the namespace’s Events from the backend query in the visible cluster', async () => {
    await start([event('api')]);

    expect(rowTexts()).toEqual([expect.stringContaining('FailedScheduling')]);
    const read = requireValue(
      app.snapshots.reads('namespace-events').slice(-1)[0],
      'expected a namespace-events read'
    );
    expect(read.scope.startsWith(`${dev.clusterId}|namespace:team-a`)).toBe(true);
  });

  it('opens the focused Event itself in its panel with full identity on Enter', async () => {
    app.servePanel(dev, eventIdentity('api.17f'));
    await start([event('api')]);
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the Events table'
    );

    await activate(() => table.focus());
    await activate(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...eventIdentity('api.17f') },
    ]);
  });

  it('opens an Event’s involved object with full identity from its row menu', async () => {
    app.servePanel(dev, podIdentity('api'));
    await start([event('api')]);
    const cell = requireValue(
      rowOf('FailedScheduling').querySelector<HTMLElement>('.grid-cell'),
      'expected a cell in the Event row'
    );
    await activate(() => {
      cell.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    });
    const viewPod = requireValue(
      menuItems().find((item) => menuLabel(item) === 'View Pod'),
      'expected the View Pod item'
    );

    await activate(() => viewPod.click());

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...podIdentity('api') },
    ]);
  });

  it('lists every namespace’s Events under All Namespaces and opens an involved object’s namespace in Events', async () => {
    await start([event('api'), event('db', 'team-b')]);
    await view.goTo({ namespace: 'namespace:all', view: 'events' });
    expect(rowTexts()).toEqual([
      expect.stringMatching(/api.*team-a/),
      expect.stringMatching(/db.*team-b/),
    ]);
    expect(
      app.snapshots
        .reads('namespace-events')
        .some((read) => read.scope.startsWith(`${dev.clusterId}|namespace:all`))
    ).toBe(true);

    const namespaceLink = requireValue(
      Array.from(rowOf('db').querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'team-b'
      ),
      'expected the db Event’s namespace link'
    );
    await activate(() => namespaceLink.click());

    const owners = view.owners();
    expect(owners.namespace.selectedNamespace).toBe('team-b');
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('events');
  });
});
