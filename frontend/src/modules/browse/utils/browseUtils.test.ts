import { describe, expect, it } from 'vitest';

import type { CanonicalRowTestOverrides, CatalogItem } from '@/core/refresh/types';
import { normalizeCatalogScope, reconcileByUID } from './browseUtils';

const makeItem = (overrides: CanonicalRowTestOverrides<CatalogItem>): CatalogItem => {
  const { ref, ...row } = overrides;
  return {
    ref: {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      resource: 'pods',
      namespace: 'team-a',
      name: 'example',
      uid: 'uid-1',
      ...ref,
    },
    resourceVersion: '1',
    creationTimestamp: '2026-01-01T00:00:00Z',
    scope: 'Namespace',
    ...row,
  };
};

describe('reconcileByUID', () => {
  it('reuses existing item references when resource versions are unchanged', () => {
    const current = [
      makeItem({ ref: { uid: 'uid-1', name: 'one' } }),
      makeItem({ ref: { uid: 'uid-2', name: 'two' } }),
    ];
    const incoming = [
      makeItem({ ref: { uid: 'uid-1', name: 'one' } }),
      makeItem({ ref: { uid: 'uid-2', name: 'two' } }),
    ];

    const result = reconcileByUID(current, incoming);

    expect(result.changed).toBe(false);
    expect(result.nextItems).toBe(current);
  });

  it('returns a new list when an item resource version changed', () => {
    const current = [makeItem({ ref: { uid: 'uid-1', name: 'one' }, resourceVersion: '1' })];
    const incoming = [makeItem({ ref: { uid: 'uid-1', name: 'one' }, resourceVersion: '2' })];

    const result = reconcileByUID(current, incoming);

    expect(result.changed).toBe(true);
    expect(result.nextItems).not.toBe(current);
    expect(result.nextItems[0]).toEqual(incoming[0]);
  });

  it('does not hide derived action-fact changes when the object resource version is unchanged', () => {
    const current = [
      makeItem({
        ref: { uid: 'uid-1', name: 'one' },
        resourceVersion: '1',
        actionFacts: { hpaManaged: false },
      }),
    ];
    const incoming = [
      makeItem({
        ref: { uid: 'uid-1', name: 'one' },
        resourceVersion: '1',
        actionFacts: { hpaManaged: true },
      }),
    ];

    const result = reconcileByUID(current, incoming);

    expect(result.changed).toBe(true);
    expect(result.nextItems[0]).toBe(incoming[0]);
    expect(result.nextItems[0].ref).toBe(current[0].ref);
  });

  it('reflects deletions in full replacement snapshots', () => {
    const current = [
      makeItem({ ref: { uid: 'uid-1' } }),
      makeItem({ ref: { uid: 'uid-2', name: 'two' } }),
    ];
    const incoming = [makeItem({ ref: { uid: 'uid-1' } })];

    const result = reconcileByUID(current, incoming);

    expect(result.changed).toBe(true);
    expect(result.nextItems).toHaveLength(1);
    expect(result.nextItems[0]).toBe(current[0]);
  });
});

describe('normalizeCatalogScope', () => {
  it('preserves an explicit match-none query through normalization', () => {
    expect(
      normalizeCatalogScope(
        'limit=50&matchNone=true&resourceScope=cluster&namespace=cluster',
        50,
        [],
        'cluster-a'
      )
    ).toBe('cluster-a|limit=50&matchNone=true&resourceScope=cluster&namespace=cluster');
  });
});
