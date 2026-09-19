import { act, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { refreshOrchestrator } from '@/core/refresh';
import { clusterReadiness } from '@/core/refresh/clusterReadiness';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { getScopedDomainStates, resetAllScopedDomainStates } from '@/core/refresh/store';
import { resourceStreamManager } from '@/core/refresh/streaming/resourceStreamManager';
import type { CatalogItem } from '@/core/refresh/types';
import { setAppPreferencesForTesting } from '@/core/settings/appPreferences';
import NsViewCustom, { NsViewArgoCD } from '@/modules/namespace/components/NsViewCustom';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@/shared/components/tables/gridTableFilterState';
import {
  buildGridTableStorageKey,
  computeClusterHash,
  setGridTablePersistenceCacheForTesting,
} from '@/shared/components/tables/persistence/gridTablePersistence';
import { requireValue } from '@/test-utils/requireValue';
import { KeyboardProvider } from '@/ui/shortcuts/context';
import BrowseView from '../components/BrowseView';

const { fetchSnapshot, hydrateRows } = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  hydrateRows: vi.fn().mockResolvedValue([]),
}));

// Replace backend reads and Wails transport, retaining the production stream
// registration, protocol, store, query hooks, and membership/hydration merge.
vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot,
  setMetricsActive: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/core/data-access', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readHydratedCustomCatalogRows: hydrateRows,
}));

// Supply shell selection/navigation without replacing the views, persistence,
// table adapters, table renderer, catalog hooks, or production domain registration.
const TestClusterContext = createContext('cluster-a');
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => {
    const clusterId = useContext(TestClusterContext);
    return {
      selectedClusterId: clusterId,
      selectedClusterIds: [clusterId],
      selectedClusterName: clusterId,
    };
  },
}));
vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({ setSelectedNamespace: vi.fn() }),
}));
vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    onNamespaceSelect: vi.fn(),
    setActiveNamespaceTab: vi.fn(),
    setViewType: vi.fn(),
  }),
}));
vi.mock('@core/contexts/SidebarStateContext', () => ({
  useSidebarState: () => ({ setSidebarSelection: vi.fn() }),
}));
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));
vi.mock('@shared/hooks/useObjectActionController', () => ({
  useObjectActionController: () => ({ getMenuItems: vi.fn(), modals: null }),
}));
vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: () => ({ type: 'toggle', id: 'favorite', active: false, onClick: vi.fn() }),
}));
vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],
    addFavorite: vi.fn(),
    updateFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
  }),
}));

const namespaces = ['argocd'];
const externalSecretType = {
  group: 'external-secrets.io',
  version: 'v1',
  kind: 'ExternalSecret',
  resource: 'externalsecrets',
};

it.each([
  {
    name: 'Argo CD',
    View: NsViewArgoCD,
    tab: 'argocd' as const,
    resourceType: {
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      resource: 'applications',
    },
  },
  {
    name: 'Namespace Custom',
    View: NsViewCustom,
    tab: 'custom' as const,
    resourceType: externalSecretType,
  },
  { name: 'Browse', View: BrowseView, tab: 'browse' as const, resourceType: externalSecretType },
])(
  '$name reconciles external changes through production registration and rendered rows',
  async ({ View, tab, resourceType }) => {
    const persistedTables = await Promise.all(
      ['cluster-a', 'cluster-b'].map(async (clusterId) => [
        requireValue(
          buildGridTableStorageKey({
            clusterHash: await computeClusterHash(clusterId),
            viewId: `namespace-${tab}`,
            namespace: '__shared__',
          }),
          'table persistence key'
        ),
        {
          version: 3,
          filters: {
            ...DEFAULT_GRID_TABLE_FILTER_STATE,
            kinds: { mode: 'some', values: [resourceType.kind] },
          },
          customColumns: [
            {
              key: 'metadata:label:revision',
              source: 'label',
              metadataKey: 'revision',
              header: 'Revision',
            },
          ],
        },
      ])
    );
    setGridTablePersistenceCacheForTesting(Object.fromEntries(persistedTables));
    setAppPreferencesForTesting({ autoRefreshEnabled: true });
    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('catalog');
    const item = (clusterId: string): CatalogItem => ({
      ref: {
        clusterId,
        ...resourceType,
        namespace: 'argocd',
        name: 'argocd-saml',
        uid: `${clusterId}-uid`,
      },
      resourceVersion: '1',
      metadata: { labels: { revision: 'before' } },
      scope: 'Namespace',
      creationTimestamp: '2026-01-01T00:00:00Z',
    });
    const backendRows = new Map([
      ['cluster-a', [item('cluster-a')]],
      ['cluster-b', [item('cluster-b')]],
    ]);
    let version = 0;
    fetchSnapshot.mockClear();
    fetchSnapshot.mockImplementation(async (domain, options) => {
      expect(domain).toBe('catalog');
      const clusterId = options.scope.split('|')[0];
      const items = backendRows.get(clusterId) ?? [];
      version += 1;
      return {
        notModified: false,
        snapshot: {
          domain: 'catalog',
          scope: options.scope,
          version,
          checksum: String(version),
          generatedAt: Date.now(),
          sequence: version,
          payload: makeCatalogSnapshotPayload({
            clusterId,
            items,
            total: items.length,
            unfilteredTotal: items.length,
            kinds: [{ kind: resourceType.kind, namespaced: true }],
            namespaces,
          }),
          stats: { itemCount: items.length, buildDurationMs: 0 },
        },
      };
    });
    const socket = {
      OPEN: 1,
      readyState: 1,
      onopen: null as (() => void) | null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: vi.fn(),
      close: vi.fn(),
    };
    Object.assign(globalThis, { __wailsJSONStreamFactory: () => socket });
    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: tab,
      selectedNamespace: 'argocd',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
      selectedClusterId: 'cluster-a',
      backgroundRefreshEnabled: true,
    });
    for (const clusterId of backendRows.keys()) {
      eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const rows = (clusterId: string) =>
      Array.from(container.querySelectorAll(`[data-cluster="${clusterId}"] [data-row-key]`));
    const rowNames = (clusterId: string) =>
      rows(clusterId).map((row) => row.querySelector('[data-column="name"]')?.textContent);
    const counts = (clusterId: string) =>
      container
        .querySelector(`[data-cluster="${clusterId}"] [data-gridtable-filter-role="result-count"]`)
        ?.textContent?.match(/\d+/g)
        ?.map(Number);
    const signalChange = async (change: string) => {
      await act(async () => {
        resourceStreamManager.handleMessage({
          clusterId: 'cluster-a',
          domain: 'catalog',
          scope: '',
          source: 'catalog',
          version: `catalog:${change}`,
          signal: 'changed',
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
    };
    try {
      await act(async () =>
        root.render(
          <KeyboardProvider>
            {['cluster-a', 'cluster-b'].map((clusterId) => (
              <TestClusterContext.Provider key={clusterId} value={clusterId}>
                <section data-cluster={clusterId}>
                  <View namespace="argocd" />
                </section>
              </TestClusterContext.Provider>
            ))}
          </KeyboardProvider>
        )
      );
      await vi.waitFor(() => expect(rowNames('cluster-a')).toEqual(['argocd-saml']));
      expect(rowNames('cluster-b')).toEqual(['argocd-saml']);
      expect(counts('cluster-a')).toEqual([1, 1]);
      await act(async () => {
        socket.onopen?.();
        resourceStreamManager.handleMessage({
          type: 'ACK',
          clusterId: 'cluster-a',
          domain: 'catalog',
          scope: '',
        });
        resourceStreamManager.handleMessage({
          type: 'ACK',
          clusterId: 'cluster-b',
          domain: 'catalog',
          scope: '',
        });
      });
      const pageScope = Object.keys(getScopedDomainStates('catalog')).find(
        (scope) => scope.startsWith('cluster-a|') && scope.includes('limit=')
      );
      expect(pageScope).toBeDefined();
      const query = new URLSearchParams(
        requireValue(pageScope, 'catalog page scope').split('|')[1]
      );
      expect(query.getAll('namespace')).toEqual(['argocd']);
      expect(query.get('resourceFamily')).toBe(tab === 'argocd' ? 'argocd' : null);
      expect(query.get('customOnly')).toBe(tab === 'browse' ? null : 'true');
      expect(
        resourceStreamManager.isHealthy('catalog', requireValue(pageScope, 'catalog page scope'))
      ).toBe(true);
      // Cluster events are external to the UI: no object action, navigation, or
      // manual refresh can optimistically repair the rows in this test.
      const created = item('cluster-a');
      created.ref = { ...created.ref, name: 'new-secret', uid: 'created-uid' };
      backendRows.set('cluster-a', [item('cluster-a'), created]);
      await signalChange('created');
      await vi.waitFor(() => expect(rowNames('cluster-a')).toEqual(['argocd-saml', 'new-secret']));
      expect(counts('cluster-a')).toEqual([2, 2]);

      const updated = {
        ...item('cluster-a'),
        resourceVersion: '2',
        metadata: { labels: { revision: 'after' } },
      };
      backendRows.set('cluster-a', [updated, created]);
      await signalChange('updated');
      await vi.waitFor(() =>
        expect(
          rows('cluster-a')[0]?.querySelector('[data-column="metadata:label:revision"]')
            ?.textContent
        ).toBe('after')
      );
      expect(
        rows('cluster-b')[0]?.querySelector('[data-column="metadata:label:revision"]')?.textContent
      ).toBe('before');

      backendRows.set('cluster-a', [created]);
      await signalChange('deleted');
      await vi.waitFor(() => expect(rowNames('cluster-a')).toEqual(['new-secret']));
      expect(counts('cluster-a')).toEqual([1, 1]);
      expect(rowNames('cluster-b')).toEqual(['argocd-saml']);
      expect(counts('cluster-b')).toEqual([1, 1]);

      backendRows.set('cluster-a', []);
      await signalChange('empty');
      await vi.waitFor(() => expect(rowNames('cluster-a')).toEqual([]));
      expect(rowNames('cluster-b')).toEqual(['argocd-saml']);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      Reflect.deleteProperty(globalThis, '__wailsJSONStreamFactory');
      resetAllScopedDomainStates('catalog');
      clusterReadiness.resetForTests();
      setGridTablePersistenceCacheForTesting({});
    }
  }
);
