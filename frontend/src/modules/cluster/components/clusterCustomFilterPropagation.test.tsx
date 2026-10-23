/**
 * frontend/src/modules/cluster/components/clusterCustomFilterPropagation.test.tsx
 *
 * Choosing a Kind in the cluster Custom Resources view's filter bar re-queries
 * the catalog for that kind: the Kind options come from the catalog's kinds,
 * and the user's choice reaches the next catalog query in the visible cluster.
 * Runs in the full app, navigated through the sidebar, with the real filter
 * persistence and catalog query, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { parseRefreshScope } from '@/core/refresh/scopeSelector';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

describe('ClusterViewCustom kind filter', () => {
  it('re-queries the catalog for the Kind the user chooses', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    app.startScreen(dev);
    // The user keeps the sidebar's Extensions group open.
    app.preferences({ sidebarClusterExtensionsExpanded: true });
    // The backend's custom-resource catalog: two cluster-scoped kinds, no objects yet.
    app.snapshots.answer(({ domain }) =>
      domain === 'catalog'
        ? makeCatalogSnapshotPayload({
            clusterId: dev.clusterId,
            clusterName: dev.clusterName,
            kinds: [
              { kind: 'DBCluster', namespaced: false },
              { kind: 'Widget', namespaced: false },
            ],
          })
        : undefined
    );
    const view = await app.mountApp();
    await view.goTo({ clusterView: 'custom' });
    // The kinds each page query of the view's catalog listing asks for.
    const kindQueries = () =>
      app.snapshots
        .reads('catalog')
        .map((read) => parseRefreshScope('catalog', read.scope))
        .filter((scope) => scope.clusterId === dev.clusterId)
        .map((scope) => new URLSearchParams(scope.query))
        .filter((query) => query.get('customOnly') === 'true' && query.has('sort'))
        .map((query) => query.getAll('kind'));
    expect(kindQueries().slice(-1)).toEqual([[]]);

    const kindFilter = requireValue(
      view.container.querySelector<HTMLElement>('[data-gridtable-filter-role="kind"]'),
      'expected the Kind filter'
    );
    await click(
      requireValue(
        kindFilter.querySelector<HTMLButtonElement>('button.dropdown-trigger'),
        'expected the Kind dropdown'
      )
    );
    await click(
      requireValue(
        document.body.querySelector<HTMLButtonElement>('button[aria-label="Select only Widget"]'),
        'expected the Widget option’s Only action'
      )
    );

    expect(kindQueries().slice(-1)).toEqual([['Widget']]);
  });
});
