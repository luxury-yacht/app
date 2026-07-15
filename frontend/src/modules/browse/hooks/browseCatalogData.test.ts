import { describe, expect, it } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import {
  acceptsCatalogSnapshotScope,
  applyCatalogBaseline,
  applyCatalogPage,
  buildBrowseCatalogPageScope,
  buildBrowseCatalogPlan,
  deriveBrowseFilterOptions,
  emptyBrowseCatalogCollection,
} from './browseCatalogData';

const makeItem = (overrides: Partial<CatalogItem>): CatalogItem => ({
  clusterId: 'cluster-1',
  clusterName: 'Cluster 1',
  kind: 'Pod',
  group: '',
  version: 'v1',
  resource: 'pods',
  namespace: 'default',
  name: 'pod-a',
  uid: 'pod-a',
  resourceVersion: '1',
  creationTimestamp: '2026-01-01T00:00:00Z',
  scope: 'Namespace',
  ...overrides,
});

const makePayload = (overrides: Partial<CatalogSnapshotPayload>): CatalogSnapshotPayload =>
  makeCatalogSnapshotPayload({
    clusterId: 'cluster-1',
    clusterName: 'Cluster 1',
    kinds: [],
    namespaces: [],
    ...overrides,
  });

describe('browseCatalogData', () => {
  it('plans base, metadata, and page scopes for pinned namespace Browse', () => {
    const plan = buildBrowseCatalogPlan({
      clusterId: 'cluster-1',
      clusterScopedOnly: false,
      pinnedNamespaces: ['default'],
      filters: {
        search: 'api',
        kinds: ['Pod'],
        namespaces: [],
        apiGroups: ['(core)', 'apps'],
      },
      availableNamespaces: ['default', 'kube-system'],
      pageLimit: 200,
    });

    expect(plan.catalogScope).toBe(
      'cluster-1|limit=200&resourceScope=namespace&search=api&kind=Pod&apiGroup=%28core%29&apiGroup=apps&namespace=default&scopeNamespace=default'
    );
    expect(plan.metadataScope).toBe(
      'cluster-1|limit=1&resourceScope=namespace&apiGroup=%28core%29&apiGroup=apps&namespace=default&scopeNamespace=default'
    );
    expect(plan.metadataUsesActiveScope).toBe(false);
    expect(plan.hasUserNamespaceScope).toBe(true);
    expect(plan.namespacesToQuery).toEqual(['default']);
    expect(
      buildBrowseCatalogPageScope(
        plan,
        {
          clusterId: 'cluster-1',
          filters: {
            search: 'api',
            kinds: ['Pod'],
            namespaces: [],
            apiGroups: ['(core)', 'apps'],
          },
          pageLimit: 200,
          pinnedNamespaces: ['default'],
        },
        '200'
      )
    ).toBe(
      'cluster-1|limit=200&resourceScope=namespace&search=api&kind=Pod&apiGroup=%28core%29&apiGroup=apps&namespace=default&scopeNamespace=default&continue=200'
    );
  });

  it('separates user namespace scope from backend namespace expansion', () => {
    const plan = buildBrowseCatalogPlan({
      clusterId: 'cluster-1',
      clusterScopedOnly: false,
      pinnedNamespaces: [],
      filters: { search: '', kinds: [], namespaces: [] },
      availableNamespaces: ['default', 'kube-system'],
      pageLimit: 200,
    });

    expect(plan.namespacesToQuery).toEqual(['default', 'kube-system']);
    expect(plan.hasUserNamespaceScope).toBe(false);
  });

  it('carries the cluster Browse boundary separately from active filters', () => {
    const plan = buildBrowseCatalogPlan({
      clusterId: 'cluster-1',
      clusterScopedOnly: true,
      pinnedNamespaces: [],
      filters: { search: '', kinds: ['Node'], namespaces: [] },
      availableNamespaces: ['default', 'kube-system'],
      pageLimit: 50,
    });

    expect(plan.catalogScope).toBe(
      'cluster-1|limit=50&resourceScope=cluster&kind=Node&namespace=cluster'
    );
    expect(plan.metadataScope).toBe('cluster-1|limit=1&resourceScope=cluster&namespace=cluster');
  });

  it('includes backend sort in catalog scopes when the sort is not the default', () => {
    const plan = buildBrowseCatalogPlan({
      clusterId: 'cluster-1',
      clusterScopedOnly: false,
      pinnedNamespaces: ['default'],
      filters: { search: '', kinds: [], namespaces: [] },
      sort: { key: 'name', direction: 'desc' },
      availableNamespaces: ['default'],
      pageLimit: 200,
    });

    expect(plan.catalogScope).toBe(
      'cluster-1|limit=200&resourceScope=namespace&sort=name&sortDirection=desc&namespace=default&scopeNamespace=default'
    );
    expect(
      buildBrowseCatalogPageScope(
        plan,
        {
          clusterId: 'cluster-1',
          filters: { search: '', kinds: [], namespaces: [] },
          sort: { key: 'name', direction: 'desc' },
          pageLimit: 200,
          pinnedNamespaces: ['default'],
        },
        'cursor'
      )
    ).toBe(
      'cluster-1|limit=200&resourceScope=namespace&sort=name&sortDirection=desc&namespace=default&scopeNamespace=default&continue=cursor'
    );
  });

  it('rejects stale pinned-namespace snapshots', () => {
    expect(
      acceptsCatalogSnapshotScope(
        'cluster-1|limit=200&namespace=kube-system',
        'cluster-1|limit=200&namespace=default',
        ['default']
      )
    ).toBe(false);
    expect(
      acceptsCatalogSnapshotScope(
        'cluster-1|limit=200&namespace=default',
        'cluster-1|limit=200&namespace=default',
        ['default']
      )
    ).toBe(true);
  });

  it('applies baseline snapshots as full replacements', () => {
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const second = makeItem({ uid: 'pod-b', name: 'pod-b' });
    const existing = applyCatalogBaseline(
      emptyBrowseCatalogCollection(),
      makePayload({ items: [first, second], continue: '2', total: 2 })
    );

    const next = applyCatalogBaseline(
      { items: existing.items, indexByUid: existing.indexByUid },
      makePayload({ items: [first], continue: '', total: 1 })
    );

    expect(next.items.map((item) => item.name)).toEqual(['pod-a']);
    expect(next.continueToken).toBeNull();
    expect(next.totalCount).toBe(1);
  });

  it('applies page snapshots as current-window replacement pagination', () => {
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const second = makeItem({ uid: 'pod-b', name: 'pod-b' });
    const existing = applyCatalogBaseline(
      emptyBrowseCatalogCollection(),
      makePayload({ items: [first], continue: '2', total: 2 })
    );

    const next = applyCatalogPage(
      { items: existing.items, indexByUid: existing.indexByUid },
      makePayload({ items: [second], continue: '', total: 2 })
    );

    expect(next.items.map((item) => item.name)).toEqual(['pod-b']);
    expect(next.continueToken).toBeNull();
    expect(next.totalCount).toBe(2);
  });

  it('derives scope-aware filter options from catalog metadata', () => {
    const payload = makePayload({
      kinds: [
        { kind: 'Deployment', namespaced: true },
        { kind: 'Node', namespaced: false },
        { kind: 'Pod', namespaced: true },
      ],
      namespaces: ['kube-system', 'default'],
      groups: ['apps', '(core)'],
    });

    expect(
      deriveBrowseFilterOptions({
        payload,
        clusterScopedOnly: false,
        isNamespaceScoped: false,
      })
    ).toEqual({
      kinds: ['Deployment', 'Pod'],
      namespaces: ['default', 'kube-system'],
      apiGroups: [
        { value: '(core)', label: 'core' },
        { value: 'apps', label: 'apps' },
      ],
      isNamespaceScoped: false,
      partialDataLabel: undefined,
    });

    expect(
      deriveBrowseFilterOptions({
        payload,
        clusterScopedOnly: true,
        isNamespaceScoped: false,
      }).kinds
    ).toEqual(['Node']);
  });

  it('derives reason-bearing degraded copy from catalog query metadata', () => {
    const payload = makePayload({
      totalIsExact: false,
      facetsExact: false,
      issues: [
        {
          kind: 'Catalog health',
          message: 'Catalog data may be stale because one resource sync failed.',
        },
      ],
    });

    const options = deriveBrowseFilterOptions({
      payload,
      clusterScopedOnly: false,
      isNamespaceScoped: false,
    });

    expect(options.partialDataLabel).toContain('Catalog health');
    expect(options.partialDataLabel).toContain('Facet options are approximate');
    expect(options.partialDataLabel).toContain('total result count is approximate');
  });
});
