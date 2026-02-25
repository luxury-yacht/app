/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistence.test.ts
 *
 * Test suite for gridTablePersistence.
 * Covers key behaviors and edge cases for gridTablePersistence.
 */

import { describe, expect, it } from 'vitest';
import type {
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import {
  buildGridTableStorageKey,
  buildPersistedStateForSave,
  prunePersistedState,
} from './gridTablePersistence';

type Row = { id: string };

const sampleColumns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.id },
  { key: 'status', header: 'Status', render: (row) => row.id },
  { key: 'age', header: 'Age', render: (row) => row.id },
];

const sampleRows: Row[] = [{ id: 'row-1' }, { id: 'row-2' }, { id: 'row-3' }];

const sampleWidthState: ColumnWidthState = {
  width: 200,
  unit: 'px',
  autoWidth: false,
  source: 'user',
  updatedAt: Date.now(),
};

describe('gridTablePersistence', () => {
  it('builds a composite key with encoded segments', () => {
    const key = buildGridTableStorageKey({
      clusterHash: 'abc123',
      viewId: 'namespace-workloads:pods',
      namespace: 'team-a',
    });
    expect(key).toBe('gridtable:v1:abc123:namespace-workloads%3Apods:team-a');
  });

  it('produces different keys for different cluster hashes', () => {
    const keyA = buildGridTableStorageKey({
      clusterHash: 'cluster-a-hash',
      viewId: 'namespace-pods',
      namespace: 'default',
    });
    const keyB = buildGridTableStorageKey({
      clusterHash: 'cluster-b-hash',
      viewId: 'namespace-pods',
      namespace: 'default',
    });
    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);
    // Both keys contain their respective cluster hash.
    expect(keyA).toContain('cluster-a-hash');
    expect(keyB).toContain('cluster-b-hash');
  });

  it('prunes persisted state against current columns, filters, and rows', () => {
    const pruned = prunePersistedState(
      {
        version: 1,
        columnVisibility: { name: false, status: true, missing: false, age: false },
        columnWidths: {
          name: sampleWidthState,
          status: sampleWidthState,
          missing: sampleWidthState,
        },
        sort: { key: 'missing', direction: 'asc' },
        filters: {
          search: ' pods ',
          kinds: ['Pod', 'Deployment'],
          namespaces: ['team-a', 'team-b'],
        },
      },
      {
        columns: sampleColumns,
        rows: sampleRows,
        keyExtractor: (row) => row.id,
        filterOptions: {
          kinds: ['Pod'],
          namespaces: ['team-a'],
          isNamespaceScoped: true,
        },
      }
    );

    expect(pruned?.columnVisibility).toEqual({ status: true });
    expect(pruned?.columnWidths).toEqual({ name: sampleWidthState, status: sampleWidthState });
    expect(pruned?.sort).toBeUndefined();
    expect(pruned?.filters).toEqual({
      search: 'pods',
      kinds: ['Pod'],
      namespaces: [],
    });
  });

  it('builds a persisted state for saving with pruning and namespace filter stripping', () => {
    const state = buildPersistedStateForSave({
      columns: sampleColumns,
      rows: sampleRows,
      keyExtractor: (row) => row.id,
      columnVisibility: { status: false, extra: true },
      columnWidths: { status: sampleWidthState, orphan: sampleWidthState },
      sort: { key: 'name', direction: 'asc' },
      filters: { search: 'abc', kinds: ['Pod'], namespaces: ['team-a'] },
      filterOptions: { isNamespaceScoped: true },
    });

    expect(state).toEqual({
      version: 1,
      columnVisibility: { status: false },
      columnWidths: { status: sampleWidthState },
      sort: { key: 'name', direction: 'asc' },
      filters: { search: 'abc', kinds: ['Pod'], namespaces: [] },
    });
  });
});
