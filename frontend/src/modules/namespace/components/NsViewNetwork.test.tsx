/**
 * frontend/src/modules/namespace/components/NsViewNetwork.test.tsx
 *
 * What the namespace Network view shows beyond the aggregated namespace table
 * it shares with Config (covered in NsViewConfig.test.tsx): each object's
 * backend detail segments from the namespace-network query split by slot into
 * the Context, Network, and Summary columns, sorting offered only where the
 * backend can sort, and a linked class segment that opens its object in a
 * panel with full identity. Segment rendering itself is covered in
 * shared/components/tables/detailSegmentsColumn.test.tsx. Runs in the full
 * app, navigated through the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NamespaceNetworkSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const ingress = (name: string): NamespaceNetworkSummary => ({
  ref: {
    clusterId: dev.clusterId,
    group: 'networking.k8s.io',
    version: 'v1',
    kind: 'Ingress',
    resource: 'ingresses',
    namespace: 'team-a',
    name,
    uid: `${name}-uid`,
  },
  details: [
    {
      slot: 'reference',
      label: 'Class',
      value: 'nginx',
      link: {
        ref: {
          clusterId: dev.clusterId,
          group: 'networking.k8s.io',
          version: 'v1',
          kind: 'IngressClass',
          resource: 'ingressclasses',
          name: 'nginx',
        },
      },
    },
    {
      slot: 'address',
      label: 'Hosts',
      value: 'web.example.com +1',
      search: 'web.example.com, api.example.com',
    },
    { slot: 'counts', label: 'Rules', value: '2' },
  ],
  age: '3h',
});

const start = async (rows: NamespaceNetworkSummary[]) => {
  app.startScreen(dev);
  app.serveTable(dev, 'namespace-network', { rows });
  view = await app.mountApp();
  await view.goTo({ namespace: 'team-a', view: 'network' });
};

const cellOf = (name: string, column: string) => {
  const row = requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((candidate) =>
      candidate.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );
  return requireValue(
    row.querySelector<HTMLElement>(`.grid-cell[data-column="${column}"]`),
    `expected the ${column} cell of ${name}`
  );
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
});

describe('NsViewNetwork', () => {
  it('splits each object’s details into the Context, Network, and Summary columns by slot', async () => {
    await start([ingress('web-gateway')]);

    // The export text is the cell's flattened data (what a table export writes).
    const exported = (column: string) =>
      cellOf('web-gateway', column)
        .querySelector<HTMLElement>('[data-gridtable-export-text]')
        ?.getAttribute('data-gridtable-export-text');
    expect(['context', 'network', 'summary'].map(exported)).toEqual([
      'Class: nginx',
      'Hosts: web.example.com +1',
      'Rules: 2',
    ]);
  });

  it('offers sorting by Context and Network but not by Summary, which the backend cannot sort', async () => {
    await start([ingress('web-gateway')]);

    // The backend sorts context and network by slot text and has no summary
    // sort (backend/refresh/snapshot/static_table_query.go networkTableQueryAdapter).
    const sortControls = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.grid-cell-header button[aria-label]'),
      (button) => button.getAttribute('aria-label')
    );
    expect(sortControls).toEqual(expect.arrayContaining(['Sort by Context', 'Sort by Network']));
    expect(sortControls).not.toContain('Sort by Summary');
  });

  it('opens a linked class segment’s object in its panel with full identity', async () => {
    app.servePanel(dev, {
      group: 'networking.k8s.io',
      version: 'v1',
      kind: 'IngressClass',
      namespace: '',
      name: 'nginx',
    });
    await start([ingress('web-gateway')]);
    const classLink = requireValue(
      cellOf('web-gateway', 'context').querySelector<HTMLButtonElement>('button'),
      'expected the class link'
    );

    await act(async () => classLink.click());
    await app.settle();

    expect(view.openPanels()).toEqual([
      {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        group: 'networking.k8s.io',
        version: 'v1',
        kind: 'IngressClass',
        namespace: '',
        name: 'nginx',
      },
    ]);
  });
});
