import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { refreshOrchestrator } from '@/core/refresh';
import { clusterReadiness } from '@/core/refresh/clusterReadiness';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { CLUSTER_REFRESHERS } from '@/core/refresh/refresherTypes';
import { getScopedDomainStates, resetAllScopedDomainStates } from '@/core/refresh/store';
import { resourceStreamManager } from '@/core/refresh/streaming/resourceStreamManager';
import type { CatalogItem } from '@/core/refresh/types';
import { setAppPreferencesForTesting } from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import { useBrowseCatalog } from './useBrowseCatalog';
import { useHydratedCustomCatalogRows } from './useHydratedCustomCatalogRows';

const { fetchSnapshot, hydrateRows } = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  hydrateRows: vi.fn().mockResolvedValue([]),
}));

// Replace only the backend boundaries. Keep the stream protocol, store,
// orchestrator, query hook and membership/hydration merge real.
vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot,
  setMetricsActive: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/core/data-access', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readHydratedCustomCatalogRows: hydrateRows,
}));

const namespaces = ['argocd'];
const filters = { search: '', kinds: [], namespaces: [] };

function CatalogRows({ clusterId }: { clusterId: string }) {
  const catalog = useBrowseCatalog({
    enabled: true,
    clusterId,
    pinnedNamespaces: namespaces,
    customOnly: true,
    filters,
    pageLimit: 50,
    diagnosticLabel: 'catalog freshness regression',
  });
  const rows = useHydratedCustomCatalogRows(clusterId, catalog.items);
  return (
    <output data-cluster={clusterId}>
      {JSON.stringify({ rows: rows.map((row) => row.ref.name), total: catalog.totalCount })}
    </output>
  );
}

it('reconciles visible custom rows and counts from a catalog signal while isolating other clusters', async () => {
  setAppPreferencesForTesting({ autoRefreshEnabled: true });
  clusterReadiness.resetForTests();
  resetAllScopedDomainStates('catalog');
  const item = (clusterId: string): CatalogItem => ({
    ref: {
      clusterId,
      group: 'external-secrets.io',
      version: 'v1',
      kind: 'ExternalSecret',
      resource: 'externalsecrets',
      namespace: 'argocd',
      name: 'argocd-saml',
      uid: `${clusterId}-uid`,
    },
    resourceVersion: '1',
    scope: 'Namespace',
    creationTimestamp: '2026-01-01T00:00:00Z',
  });
  const backendRows = new Map([
    ['cluster-a', [item('cluster-a')]],
    ['cluster-b', [item('cluster-b')]],
  ]);
  let version = 0;
  fetchSnapshot.mockImplementation(async (_domain, options) => {
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
          kinds: [{ kind: 'ExternalSecret', namespaced: true }],
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
  refreshOrchestrator.registerDomain({
    domain: 'catalog',
    refresherName: CLUSTER_REFRESHERS.browse,
    category: 'cluster',
    streaming: {
      start: async (scope) => {
        await resourceStreamManager.start('catalog', scope);
        return () => resourceStreamManager.stop('catalog', scope);
      },
      stop: (scope, options) => resourceStreamManager.stop('catalog', scope, options?.reset),
      refreshOnce: (scope) => resourceStreamManager.refreshOnce('catalog', scope),
      pauseRefresherWhenStreaming: true,
    },
  });
  refreshOrchestrator.updateContext({
    currentView: 'namespace',
    activeNamespaceView: 'custom',
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
  const state = (clusterId: string) =>
    JSON.parse(container.querySelector(`[data-cluster="${clusterId}"]`)?.textContent ?? '{}');
  try {
    await act(async () =>
      root.render(
        <>
          <CatalogRows clusterId="cluster-a" />
          <CatalogRows clusterId="cluster-b" />
        </>
      )
    );
    await vi.waitFor(() => expect(state('cluster-a')).toEqual({ rows: ['argocd-saml'], total: 1 }));
    expect(state('cluster-b')).toEqual({ rows: ['argocd-saml'], total: 1 });
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
      (scope) => scope.startsWith('cluster-a|') && scope.includes('limit=50')
    );
    expect(pageScope).toBeDefined();
    expect(
      resourceStreamManager.isHealthy('catalog', requireValue(pageScope, 'catalog page scope'))
    ).toBe(true);
    backendRows.set('cluster-a', []);
    await act(async () => {
      resourceStreamManager.handleMessage({
        clusterId: 'cluster-a',
        domain: 'catalog',
        scope: '',
        source: 'catalog',
        version: 'catalog:deleted',
        signal: 'changed',
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await vi.waitFor(() => expect(state('cluster-a')).toEqual({ rows: [], total: 0 }));
    expect(state('cluster-b')).toEqual({ rows: ['argocd-saml'], total: 1 });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, '__wailsJSONStreamFactory');
    resetAllScopedDomainStates('catalog');
    clusterReadiness.resetForTests();
  }
});
