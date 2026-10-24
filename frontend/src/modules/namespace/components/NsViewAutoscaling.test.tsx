/**
 * frontend/src/modules/namespace/components/NsViewAutoscaling.test.tsx
 *
 * What the namespace Autoscaling view shows beyond the aggregated namespace
 * table it shares with Config (covered in NsViewConfig.test.tsx): each
 * HorizontalPodAutoscaler's scale target, replica range, and current replicas
 * from the backend's namespace-autoscaling query, a scale target that opens
 * its workload in a panel with full identity, and the row menu's Map, which
 * opens the autoscaler's panel on its map. Runs in the full app, navigated
 * through the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NamespaceAutoscalingSummary } from '@/core/refresh/types';
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

const hpaIdentity: ObjectIdentity = {
  group: 'autoscaling',
  version: 'v2',
  kind: 'HorizontalPodAutoscaler',
  namespace: 'team-a',
  name: 'web',
};

// As backend/resources/hpa/streamsummary.go builds the row.
const hpa: () => NamespaceAutoscalingSummary = () => ({
  ref: {
    ...hpaIdentity,
    clusterId: dev.clusterId,
    resource: 'horizontalpodautoscalers',
    uid: 'web-uid',
  },
  target: 'Deployment/web',
  targetApiVersion: 'apps/v1',
  min: 1,
  max: 5,
  current: 2,
  age: '10m',
});

const start = async () => {
  app.startScreen(dev);
  app.serveTable(dev, 'namespace-autoscaling', { rows: [hpa()] });
  view = await app.mountApp();
  await view.goTo({ namespace: 'team-a', view: 'autoscaling' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

const cellOf = (name: string, column: string) =>
  requireValue(
    rowOf(name).querySelector<HTMLElement>(`.grid-cell[data-column="${column}"]`),
    `expected the ${column} cell of ${name}`
  );

const inCluster = (identity: ObjectIdentity) => ({
  ...identity,
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
});

describe('NsViewAutoscaling', () => {
  it('shows each autoscaler’s scale target, replica range, and current replicas', async () => {
    await start();

    expect(
      ['scaleTarget', 'replicas', 'current'].map((column) =>
        cellOf('web', column).textContent?.trim()
      )
    ).toEqual(['Deployment/web', '1/5', '2']);
  });

  it('opens an autoscaler’s scale target in its panel with full identity', async () => {
    const deployment: ObjectIdentity = {
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'team-a',
      name: 'web',
    };
    app.servePanel(dev, deployment);
    // The workload's panel asks whether an autoscaler scales it
    // (backend/autoscaling_details.go IsWorkloadHPAManaged); this one does.
    app.backend.answer('IsWorkloadHPAManaged', () => true);
    await start();
    const targetLink = requireValue(
      cellOf('web', 'scaleTarget').querySelector<HTMLButtonElement>('button'),
      'expected the scale target link'
    );

    await act(async () => targetLink.click());
    await app.settle();

    expect(view.openPanels()).toEqual([inCluster(deployment)]);
  });

  it('opens an autoscaler’s panel on its map from the row menu', async () => {
    const object = app.servePanel(dev, hpaIdentity);
    const mapScope = requireValue(object.scopes.mapScope, 'expected the autoscaler map scope');
    app.snapshots.serve('object-map', mapScope, {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      seed: { ...hpaIdentity, clusterId: dev.clusterId },
      nodes: [],
      edges: [],
      maxNodes: 250,
      truncated: false,
    });
    await start();
    const cell = requireValue(
      rowOf('web').querySelector<HTMLElement>('.grid-cell'),
      'expected a cell in the web row'
    );
    await act(async () => {
      cell.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    });
    await app.settle();
    const openMap = requireValue(
      Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item')
      ).find(
        (item) => item.querySelector('.context-menu-label')?.textContent?.trim() === 'Open Map'
      ),
      'expected the Open Map menu item'
    );

    await act(async () => openMap.click());
    await app.settle();

    expect(view.openPanels()).toEqual([inCluster(hpaIdentity)]);
    expect(app.snapshots.reads('object-map').map((read) => read.scope)).toContain(mapScope);
    expect(document.querySelector('[data-testid="map-tab"]')).not.toBeNull();
  });
});
