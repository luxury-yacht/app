import { describe, expect, it } from 'vitest';

import { getResourceStreamDomainDescriptor } from './resourceStreamDomains';
import {
  applyResourceRowUpdates,
  mergeSnapshotRows,
  type ResourceStreamRowCollection,
} from './resourceStreamRows';

type TestRow = {
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  details?: string;
};

const namespaceConfigCollection = getResourceStreamDomainDescriptor('namespace-config')
  .collection as ResourceStreamRowCollection<TestRow, { clusterId: string; resources: TestRow[] }>;

describe('resource stream row helpers', () => {
  it('deletes rows by the descriptor update identity', () => {
    const clusterARow = {
      clusterId: 'cluster-a',
      namespace: 'default',
      kind: 'ConfigMap',
      name: 'settings',
    };
    const clusterBRow = {
      clusterId: 'cluster-b',
      namespace: 'default',
      kind: 'ConfigMap',
      name: 'settings',
    };

    const nextRows = applyResourceRowUpdates(
      [clusterARow, clusterBRow],
      [
        {
          type: 'DELETED',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'ConfigMap',
          name: 'settings',
        },
      ],
      'cluster-a',
      namespaceConfigCollection,
      false
    );

    expect(nextRows).toEqual([clusterBRow]);
  });

  it('reuses unchanged row objects and replaces changed rows', () => {
    const existingRow = {
      clusterId: 'cluster-a',
      namespace: 'default',
      kind: 'ConfigMap',
      name: 'settings',
      details: 'old',
    };
    const existingRows = [existingRow];

    const unchangedRows = applyResourceRowUpdates(
      existingRows,
      [
        {
          type: 'MODIFIED',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'ConfigMap',
          name: 'settings',
          row: { ...existingRow },
        },
      ],
      'cluster-a',
      namespaceConfigCollection,
      false
    );

    expect(unchangedRows).toBe(existingRows);
    expect(unchangedRows[0]).toBe(existingRow);

    const changedRows = applyResourceRowUpdates(
      existingRows,
      [
        {
          type: 'MODIFIED',
          clusterId: 'cluster-a',
          namespace: 'default',
          kind: 'ConfigMap',
          name: 'settings',
          row: { ...existingRow, details: 'new' },
        },
      ],
      'cluster-a',
      namespaceConfigCollection,
      false
    );

    expect(changedRows).not.toBe(unchangedRows);
    expect(changedRows[0]).not.toBe(existingRow);
    expect(changedRows[0].details).toBe('new');
  });

  it('replaces snapshot rows only for the target cluster', () => {
    const clusterARow = {
      clusterId: 'cluster-a',
      namespace: 'default',
      kind: 'ConfigMap',
      name: 'settings',
      details: 'old',
    };
    const clusterBRow = {
      clusterId: 'cluster-b',
      namespace: 'default',
      kind: 'ConfigMap',
      name: 'settings',
      details: 'background',
    };

    const nextRows = mergeSnapshotRows(
      [clusterARow, clusterBRow],
      [{ ...clusterARow, details: 'new' }],
      'cluster-a',
      namespaceConfigCollection
    );

    expect(nextRows).toHaveLength(2);
    expect(nextRows.find((row) => row.clusterId === 'cluster-b')).toBe(clusterBRow);
    expect(nextRows.find((row) => row.clusterId === 'cluster-a')?.details).toBe('new');
  });
});
