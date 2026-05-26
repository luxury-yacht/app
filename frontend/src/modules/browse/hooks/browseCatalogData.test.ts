import { describe, expect, it } from 'vitest';

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

const makePayload = (overrides: Partial<CatalogSnapshotPayload>): CatalogSnapshotPayload => ({
  clusterId: 'cluster-1',
  clusterName: 'Cluster 1',
  items: [],
  continue: '',
  total: 0,
  resourceCount: 0,
  kinds: [],
  namespaces: [],
  batchIndex: 0,
  batchSize: 0,
  totalBatches: 1,
  isFinal: true,
  ...overrides,
});

describe('browseCatalogData', () => {
  it('plans base, metadata, and page scopes for pinned namespace Browse', () => {
    const plan = buildBrowseCatalogPlan({
      clusterId: 'cluster-1',
      clusterScopedOnly: false,
      pinnedNamespaces: ['default'],
      filters: { search: 'api', kinds: ['Pod'], namespaces: [] },
      availableNamespaces: ['default', 'kube-system'],
      pageLimit: 200,
    });

    expect(plan.catalogScope).toBe('cluster-1|limit=200&search=api&kind=Pod&namespace=default');
    expect(plan.metadataScope).toBe('cluster-1|limit=1&namespace=default');
    expect(plan.metadataUsesActiveScope).toBe(false);
    expect(plan.namespacesToQuery).toEqual(['default']);
    expect(
      buildBrowseCatalogPageScope(
        plan,
        {
          clusterId: 'cluster-1',
          filters: { search: 'api', kinds: ['Pod'], namespaces: [] },
          pageLimit: 200,
          pinnedNamespaces: ['default'],
        },
        '200'
      )
    ).toBe('cluster-1|limit=200&search=api&kind=Pod&namespace=default&continue=200');
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

  it('applies page snapshots as append-only pagination', () => {
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

    expect(next.items.map((item) => item.name)).toEqual(['pod-a', 'pod-b']);
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
      isNamespaceScoped: false,
    });

    expect(
      deriveBrowseFilterOptions({
        payload,
        clusterScopedOnly: true,
        isNamespaceScoped: false,
      }).kinds
    ).toEqual(['Node']);
  });
});
