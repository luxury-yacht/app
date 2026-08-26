/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistence.test.ts
 *
 * Test suite for gridTablePersistence.
 * Covers key behaviors and edge cases for gridTablePersistence.
 */

import { createCustomMetadataColumnDefinition } from '@shared/components/tables/customMetadataColumns';
import type {
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGridTableStorageKey,
  buildPersistedStateForSave,
  computeClusterHash,
  prunePersistedState,
} from './gridTablePersistence';

type Row = { id: string };

const sampleColumns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, hideable: false, render: (row) => row.id },
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('hashes Unicode cluster identities by code point in the crypto fallback', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(computeClusterHash('cluster-😀')).resolves.toBe('a3649d57d06a');
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
          clusters: ['cluster-a', 'cluster-b'],
          queryFacets: {
            apiGroups: ['apps', 'batch'],
            resourceScopes: ['Namespace'],
          },
          caseSensitive: false,
          includeMetadata: false,
        },
        pageSize: 250,
      },
      {
        columns: sampleColumns,
        rows: sampleRows,
        keyExtractor: (row) => row.id,
        filterOptions: {
          kinds: ['Pod'],
          namespaces: ['team-a'],
          clusters: ['CLUSTER-B'],
          queryFacets: {
            apiGroups: ['apps'],
            resourceScopes: ['Namespace'],
          },
          isNamespaceScoped: true,
        },
        pageSizeOptions: [25, 50, 100, 250],
      }
    );

    expect(pruned?.columnVisibility).toEqual({ status: true, age: false });
    expect(pruned?.columnWidths).toEqual({ name: sampleWidthState, status: sampleWidthState });
    expect(pruned?.sort).toBeUndefined();
    expect(pruned?.filters).toEqual({
      search: 'pods',
      kinds: { mode: 'some', values: ['Pod'] },
      namespaces: { mode: 'all' },
      clusters: { mode: 'all' },
      queryFacets: {
        apiGroups: { mode: 'some', values: ['apps'] },
        resourceScopes: { mode: 'some', values: ['Namespace'] },
      },
      caseSensitive: false,
      includeMetadata: false,
    });
    expect(pruned?.pageSize).toBe(250);
  });

  it('drops persisted page sizes outside the current table options', () => {
    const pruned = prunePersistedState(
      {
        version: 1,
        pageSize: 2000,
      },
      {
        columns: sampleColumns,
        rows: sampleRows,
        keyExtractor: (row) => row.id,
        pageSizeOptions: [25, 50, 100, 250],
      }
    );

    expect(pruned).toBeNull();
  });

  it('drops persisted sort keys that no longer map to a current sortable column', () => {
    const pruned = prunePersistedState(
      {
        version: 1,
        sort: { key: 'ageTimestamp', direction: 'desc' },
      },
      {
        columns: sampleColumns,
        rows: sampleRows,
        keyExtractor: (row) => row.id,
      }
    );

    expect(pruned?.sort).toBeUndefined();
  });

  it('keeps persisted sort keys for columns that are sortable by default', () => {
    const pruned = prunePersistedState(
      {
        version: 1,
        sort: { key: 'status', direction: 'desc' },
      },
      {
        columns: sampleColumns,
        rows: sampleRows,
        keyExtractor: (row) => row.id,
      }
    );

    expect(pruned?.sort).toEqual({ key: 'status', direction: 'desc' });

    const state = buildPersistedStateForSave({
      columns: sampleColumns,
      rows: sampleRows,
      keyExtractor: (row) => row.id,
      sort: { key: 'status', direction: 'asc' },
    });

    expect(state?.sort).toEqual({ key: 'status', direction: 'asc' });
  });

  it('builds a persisted state for saving with pruning and namespace filter stripping', () => {
    const state = buildPersistedStateForSave({
      columns: sampleColumns,
      rows: sampleRows,
      keyExtractor: (row) => row.id,
      columnVisibility: { status: false, extra: true },
      columnOrder: ['age', 'name', 'status'],
      columnWidths: { status: sampleWidthState, orphan: sampleWidthState },
      sort: { key: 'name', direction: 'asc' },
      filters: {
        search: 'abc',
        kinds: { mode: 'some', values: ['Pod'] },
        namespaces: { mode: 'some', values: ['team-a'] },
        clusters: { mode: 'some', values: ['cluster-a'] },
        caseSensitive: false,
        includeMetadata: false,
      },
      filterOptions: { isNamespaceScoped: true },
      pageSize: 100,
      pageSizeOptions: [25, 50, 100, 250],
    });

    expect(state).toEqual({
      version: 3,
      columnVisibility: { status: false },
      columnOrder: ['age', 'name', 'status'],
      columnWidths: { status: sampleWidthState },
      sort: { key: 'name', direction: 'asc' },
      filters: {
        search: 'abc',
        kinds: { mode: 'some', values: ['Pod'] },
        namespaces: { mode: 'all' },
        clusters: { mode: 'some', values: ['cluster-a'] },
        caseSensitive: false,
        includeMetadata: false,
      },
      pageSize: 100,
    });
  });

  it('preserves non-default toggles and cluster-scoped namespace filters when saving and pruning', () => {
    const filters = {
      search: '',
      kinds: { mode: 'all' as const },
      namespaces: { mode: 'some' as const, values: [''] },
      clusters: { mode: 'all' as const },
      caseSensitive: false,
      includeMetadata: true,
    };

    const state = buildPersistedStateForSave({
      columns: sampleColumns,
      rows: sampleRows,
      keyExtractor: (row) => row.id,
      filters,
      filterOptions: { isNamespaceScoped: false },
    });

    expect(state).toEqual({
      version: 3,
      filters,
    });

    const pruned = prunePersistedState(
      {
        version: 2,
        filters,
      },
      {
        columns: sampleColumns,
        rows: sampleRows,
        keyExtractor: (row) => row.id,
        filterOptions: { isNamespaceScoped: false },
      }
    );

    expect(pruned?.filters).toEqual(filters);
  });

  it('reconciles persisted order with the current column declaration', () => {
    const pruned = prunePersistedState(
      {
        version: 3,
        columnOrder: ['age', 'removed', 'name'],
      },
      { columns: sampleColumns }
    );

    expect(pruned?.columnOrder).toEqual(['age', 'name', 'status']);
  });

  it('restores custom definitions before pruning their presentation state', () => {
    const ownerColumn = createCustomMetadataColumnDefinition({
      source: 'label',
      metadataKey: 'app.kubernetes.io/owner',
      header: 'Owner',
    });

    const pruned = prunePersistedState(
      {
        version: 3,
        customColumns: [ownerColumn],
        columnVisibility: { [ownerColumn.key]: false },
        columnOrder: ['name', ownerColumn.key, 'status', 'age'],
        columnWidths: { [ownerColumn.key]: sampleWidthState },
      },
      { columns: sampleColumns }
    );

    expect(pruned).toEqual({
      version: 3,
      customColumns: [ownerColumn],
      columnVisibility: { [ownerColumn.key]: false },
      columnOrder: ['name', ownerColumn.key, 'status', 'age'],
      columnWidths: { [ownerColumn.key]: sampleWidthState },
    });
  });

  it('saves custom definitions even when every presentation setting is at its default', () => {
    const ownerColumn = createCustomMetadataColumnDefinition({
      source: 'annotation',
      metadataKey: 'example.com/owner',
      header: 'Owner',
    });

    const state = buildPersistedStateForSave({
      columns: sampleColumns,
      customColumns: [ownerColumn],
    });

    expect(state).toEqual({ version: 3, customColumns: [ownerColumn] });
  });
});
