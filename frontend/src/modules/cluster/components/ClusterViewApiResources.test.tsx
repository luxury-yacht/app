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
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { ClusterAPIResourceEntry, ClusterAPIResourcesSnapshot } from '@/core/refresh/types';
import { useNavigateToView } from '@/shared/hooks/useNavigateToView';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let navigateToView: ReturnType<typeof useNavigateToView>['navigateToView'] | undefined;

function NavigateProbe() {
  navigateToView = useNavigateToView().navigateToView;
  return null;
}

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

/**
 * `anchor` is what the cluster answers a read that asks for a definition's row
 * (a "show in list"); other reads carry no anchor and get none back.
 */
const start = async (
  rows: () => ClusterAPIResourceEntry[] = kinds,
  anchor?: ClusterAPIResourcesSnapshot['anchor']
) => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['payments']);
  app.startScreen(dev);
  app.serveTable(dev, 'cluster-api-resources', ({ scope }) => ({
    rows: rows(),
    ...(anchor && scope.includes('anchor.name=') ? { anchor } : {}),
  }));
  view = await app.mountApp(<NavigateProbe />);
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

  // "Show in list" on a CustomResourceDefinition (Alt+click in Browse, or from
  // its panel) lands here, on the custom kind the definition defines.
  it('focuses the kind a CustomResourceDefinition defines when asked to show it in its list', async () => {
    await start();
    await view.goTo({ clusterView: 'overview' });

    await act(async () => {
      requireValue(
        navigateToView,
        'mounted navigation hook'
      )({
        ...certificatesDefinition,
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        uid: 'definition-uid',
      });
    });
    await app.settle();

    expect(view.owners().viewState?.activeClusterTab).toBe('api-resources');
    expect(rowOf('certificates').getAttribute('data-row-focused')).toBe('true');
    expect(rowOf('deployments').getAttribute('data-row-focused')).toBeNull();
  });

  // Right after connecting, the table is served before the cluster's
  // CustomResourceDefinitions have been read: rows have no Type and no
  // definition yet. Showing a definition in its list must still find its kind.
  it("focuses a definition's kind before kinds are known to be custom", async () => {
    await start(() => kinds().map(({ definition: _definition, ...row }) => ({ ...row, type: '' })));
    await view.goTo({ clusterView: 'overview' });

    await act(async () => {
      requireValue(
        navigateToView,
        'mounted navigation hook'
      )({
        ...certificatesDefinition,
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
      });
    });
    await app.settle();

    expect(rowOf('certificates').getAttribute('data-row-focused')).toBe('true');
  });

  // A definition's kind can be on the cluster but hidden by the table's own
  // filters (Type = Built-in, say). That is this table's to explain: the user
  // stays here and is told the filters hide it, not sent to Browse.
  it('says the filters hide a definition’s kind instead of handing it to Browse', async () => {
    await start(() => kinds().slice(0, 1), { found: false, rank: -1, reason: 'filtered' });
    await view.goTo({ clusterView: 'overview' });

    await act(async () => {
      requireValue(
        navigateToView,
        'mounted navigation hook'
      )({
        ...certificatesDefinition,
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
      });
    });
    await app.settle();
    await app.settle();

    expect(view.owners().viewState?.activeClusterTab).toBe('api-resources');
    const reports = app.errors
      .take((record) => record.context?.source === 'resource-grid-anchor')
      .map((record) => (record.error as Error).message);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('filters');
  });

  // The first discovery can fail outright: the identity may not be allowed to
  // read the cluster's API discovery, or the API server may be failing. The
  // table must say what happened rather than look like it is still loading,
  // and must load once a discovery succeeds.
  describe('when the first discovery fails', () => {
    const failDiscovery = (reason: 'Forbidden' | 'InternalError', message: string) =>
      app.snapshots.respond((request) =>
        request.domain === 'cluster-api-resources'
          ? statusResponse(makeErrorStatus(reason, message))
          : undefined
      );

    const discoverySucceeds = async () => {
      app.snapshots.respond(null);
      await act(async () => {
        app.streams.ring(
          'cluster-api-resources',
          buildRefreshScope('cluster-api-resources', {
            clusterId: dev.clusterId,
            selector: CLUSTER_SELECTOR,
          }),
          'catalog',
          'v1'
        );
        // Signals apply after the stream's 150 ms coalescing window
        // (resourceStreamManager.ts UPDATE_COALESCE_MS).
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      await app.settle();
    };

    it('says the identity lacks permission when discovery is denied', async () => {
      failDiscovery('Forbidden', 'API discovery failed: discovery is forbidden');
      await start();

      expect(view.container.textContent).toContain('Insufficient permissions');
      expect(view.container.querySelectorAll('.gridtable-row')).toHaveLength(0);

      await discoverySucceeds();
      expect(rowOf('deployments')).toBeDefined();
      expect(view.container.textContent).not.toContain('Insufficient permissions');
    });

    it('reports any other failure with its reason', async () => {
      failDiscovery('InternalError', 'API discovery failed: the server is unavailable');
      await start();

      expect(view.container.querySelectorAll('.gridtable-row')).toHaveLength(0);
      const reports = app.errors.take(() => true).map((record) => (record.error as Error).message);
      expect(reports.some((message) => message.includes('the server is unavailable'))).toBe(true);

      await discoverySucceeds();
      expect(rowOf('deployments')).toBeDefined();
    });
  });

  // API Resources replaced the CRDs view. A favorite saved there still opens:
  // on API Resources, showing custom kinds, with the search and order saved.
  it('opens a favorite saved on the retired CRDs view as custom kinds in its saved order', async () => {
    app.backend.answer('GetFavorites', () => [
      {
        id: 'fav-crds',
        name: 'cert-manager definitions',
        clusterSelection: '',
        viewType: 'cluster',
        view: 'crds',
        namespace: '',
        filters: {
          search: 'cert-manager',
          kinds: { mode: 'all' },
          namespaces: { mode: 'all' },
          clusters: { mode: 'all' },
          includeMetadata: false,
        },
        tableState: { sortColumn: 'scope', sortDirection: 'desc', columnVisibility: {} },
        order: 0,
      },
    ]);
    await start();
    await view.goTo({ clusterView: 'overview' });

    await click(
      requireValue(
        view.container.querySelector<HTMLButtonElement>('button[aria-label="Favorites"]'),
        'the Favorites trigger'
      )
    );
    await click(
      requireValue(
        Array.from(
          view.container.querySelectorAll<HTMLElement>('.fav-dropdown-anchor [role="menuitem"]')
        ).find((row) => row.textContent?.includes('cert-manager definitions')),
        'the saved favorite'
      )
    );

    // A query's search applies after the 250 ms pause-in-typing wait
    // (useCursorPageSession.ts useQuerySearch).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await app.settle();

    expect(view.owners().viewState?.activeClusterTab).toBe('api-resources');
    const reads = app.snapshots.reads('cluster-api-resources');
    const asked = new URLSearchParams(reads[reads.length - 1]?.scope.split('?')[1]);
    expect(asked.getAll('facet.types')).toEqual(['Custom']);
    expect(asked.get('search')).toBe('cert-manager');
    expect(asked.get('sort')).toBe('scope');
    expect(asked.get('sortDirection')).toBe('desc');
  });
});
