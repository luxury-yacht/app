import { describe, expect, it, beforeEach } from 'vitest';
import { computeClusterHash } from '@shared/components/tables/persistence/gridTablePersistence';
import {
  runGridTableGC,
  computeClusterHashes,
} from '@shared/components/tables/persistence/gridTablePersistenceGC';
import { resetGridTableViewRegistryForTests } from '@shared/components/tables/persistence/gridTableViewRegistry';

const makeStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

describe('gridTablePersistenceGC', () => {
  const storage = makeStorage();

  beforeEach(() => {
    storage.clear();
    resetGridTableViewRegistryForTests(['cluster-nodes', 'namespace-pods']);
  });

  it('drops entries with unknown view ids or cluster hashes', async () => {
    const clusterHash = await computeClusterHash('path:context');
    storage.setItem(`gridtable:v1:${clusterHash}:cluster-nodes`, '{"version":1}');
    storage.setItem(`gridtable:v1:${clusterHash}:unknown-view`, '{"version":1}');
    storage.setItem('gridtable:v1:abc123:namespace-pods:team-a', '{"version":1}');
    storage.setItem('not-gridtable:key', 'value');

    const result = runGridTableGC({
      storage,
      activeClusterHashes: [clusterHash],
    });

    expect(result.removed).toEqual(
      expect.arrayContaining([
        `gridtable:v1:${clusterHash}:unknown-view`,
        'gridtable:v1:abc123:namespace-pods:team-a',
        'not-gridtable:key',
      ])
    );
    expect(result.kept).toEqual([`gridtable:v1:${clusterHash}:cluster-nodes`]);
  });

  it('computes hashes for cluster identities', async () => {
    const hashes = await computeClusterHashes(['path:ctx', 'path:ctx', 'other:ctx']);
    expect(hashes.length).toBe(2);
    expect(hashes[0]).not.toBe('');
  });
});
