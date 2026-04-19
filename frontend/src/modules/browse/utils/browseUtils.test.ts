import { describe, expect, it } from 'vitest';

import type { CatalogItem } from '@/core/refresh/types';
import { reconcileByUID } from './browseUtils';

const makeItem = (overrides: Partial<CatalogItem>): CatalogItem => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  kind: 'Pod',
  group: '',
  version: 'v1',
  resource: 'pods',
  namespace: 'team-a',
  name: 'example',
  uid: 'uid-1',
  resourceVersion: '1',
  creationTimestamp: '2026-01-01T00:00:00Z',
  scope: 'Namespace',
  ...overrides,
});

describe('reconcileByUID', () => {
  it('reuses existing item references when resource versions are unchanged', () => {
    const current = [
      makeItem({ uid: 'uid-1', name: 'one' }),
      makeItem({ uid: 'uid-2', name: 'two' }),
    ];
    const incoming = [
      makeItem({ uid: 'uid-1', name: 'one' }),
      makeItem({ uid: 'uid-2', name: 'two' }),
    ];

    const result = reconcileByUID(current, incoming);

    expect(result.changed).toBe(false);
    expect(result.nextItems).toBe(current);
  });

  it('returns a new list when an item resource version changed', () => {
    const current = [makeItem({ uid: 'uid-1', name: 'one', resourceVersion: '1' })];
    const incoming = [makeItem({ uid: 'uid-1', name: 'one', resourceVersion: '2' })];

    const result = reconcileByUID(current, incoming);

    expect(result.changed).toBe(true);
    expect(result.nextItems).not.toBe(current);
    expect(result.nextItems[0]).toEqual(incoming[0]);
  });

  it('reflects deletions in full replacement snapshots', () => {
    const current = [makeItem({ uid: 'uid-1' }), makeItem({ uid: 'uid-2', name: 'two' })];
    const incoming = [makeItem({ uid: 'uid-1' })];

    const result = reconcileByUID(current, incoming);

    expect(result.changed).toBe(true);
    expect(result.nextItems).toHaveLength(1);
    expect(result.nextItems[0]).toBe(current[0]);
  });
});
