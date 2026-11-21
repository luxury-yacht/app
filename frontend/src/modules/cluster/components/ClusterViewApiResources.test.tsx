/**
 * frontend/src/modules/cluster/components/ClusterViewApiResources.test.tsx
 *
 * The cluster API Resources view lists every kind the cluster serves, built-in
 * and custom, from the backend's cluster-api-resources query. A built-in kind
 * opens the kind panel (it is a description of a kind, never an object panel);
 * a custom kind opens its CustomResourceDefinition with complete identity.
 * Runs in the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { ClusterAPIResourceEntry } from '@/core/refresh/types';
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

const certificatesDefinition: ObjectIdentity = {
  group: 'apiextensions.k8s.io',
  version: 'v1',
  kind: 'CustomResourceDefinition',
  namespace: '',
  name: 'certificates.cert-manager.io',
};

const kinds = (): ClusterAPIResourceEntry[] => [
  {
    clusterId: dev.clusterId,
    kind: 'Deployment',
    group: 'apps',
    version: 'v1',
    apiVersion: 'apps/v1',
    versions: ['v1'],
    resource: 'deployments',
    scope: 'Namespaced',
    shortNames: ['deploy'],
    verbs: ['get', 'list'],
    categories: ['all'],
    type: 'Built-in',
  },
  {
    clusterId: dev.clusterId,
    kind: 'Certificate',
    group: 'cert-manager.io',
    version: 'v1',
    apiVersion: 'cert-manager.io/v1',
    versions: ['v1'],
    resource: 'certificates',
    scope: 'Namespaced',
    shortNames: ['cert', 'certs'],
    verbs: ['get', 'list'],
    categories: [],
    type: 'Custom',
    definition: {
      ...certificatesDefinition,
      clusterId: dev.clusterId,
      resource: 'customresourcedefinitions',
    },
  },
];

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['payments']);
  app.startScreen(dev);
  app.serveTable(dev, 'cluster-api-resources', { rows: kinds() });
  view = await app.mountApp();
  await view.goTo({ clusterView: 'api-resources' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

const nameLink = (name: string) =>
  requireValue(
    Array.from(rowOf(name).querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === name
    ),
    `expected the ${name} name link`
  );

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

describe('ClusterViewApiResources', () => {
  it('describes each kind with its short names, API version, scope, and type', async () => {
    await start();

    const cells = (name: string) =>
      Array.from(rowOf(name).querySelectorAll<HTMLElement>('.grid-cell')).map((cell) =>
        cell.textContent?.trim()
      );
    expect(cells('deployments')).toEqual(
      expect.arrayContaining(['deployments', 'deploy', 'apps/v1', 'Namespaced', 'Built-in'])
    );
    expect(cells('certificates')).toEqual(
      expect.arrayContaining(['certificates', 'cert, certs', 'cert-manager.io/v1', 'Custom'])
    );
  });

  it('opens the kind panel for a built-in kind', async () => {
    await start();

    await click(nameLink('deployments'));

    expect(view.openPanels()).toEqual([
      {
        targetType: 'api-resource',
        clusterId: dev.clusterId,
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        resource: 'deployments',
      },
    ]);
  });

  it('opens the CustomResourceDefinition of a custom kind with complete identity', async () => {
    await start();
    app.servePanel(dev, certificatesDefinition);

    await click(nameLink('certificates'));

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...certificatesDefinition },
    ]);
  });
});
