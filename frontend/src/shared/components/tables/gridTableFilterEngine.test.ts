import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';

import {
  applyGridTableFilters,
  buildGridTableFilterOptions,
  resolveGridTableFilterAccessors,
} from '@shared/components/tables/gridTableFilterEngine';
import { describe, expect, it } from 'vitest';

interface Row {
  id: string;
  kind: string;
  namespace: string | null;
  name: string;
  description: string;
}

const rows: Row[] = [
  { id: '1', kind: 'Deployment', namespace: 'default', name: 'frontend', description: 'web app' },
  { id: '2', kind: 'Pod', namespace: 'default', name: 'frontend-1', description: 'pod instance' },
  { id: '3', kind: 'Deployment', namespace: 'platform', name: 'gateway', description: 'edge' },
  {
    id: '4',
    kind: 'ConfigMap',
    namespace: null,
    name: 'global-config',
    description: 'cluster wide',
  },
];

const defaultGetKind = (row: Row) => row.kind;
const defaultGetNamespace = (row: Row) => row.namespace;
const defaultGetSearchText = (row: Row) => [row.name, row.description];

const defaultState: GridTableFilterState = {
  search: '',
  kinds: [],
  namespaces: [],
  caseSensitive: false,
  includeMetadata: false,
};

const accessors = resolveGridTableFilterAccessors({
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
});

describe('gridTableFilterEngine', () => {
  it('adds cluster-scoped namespace option and separator when requested', () => {
    const options = buildGridTableFilterOptions({
      filteringEnabled: true,
      options: { includeClusterScopedSyntheticNamespace: true },
      data: rows,
      accessors,
      defaultGetKind,
      defaultGetNamespace,
    });

    expect(options.namespaces.map((option) => option.value)).toEqual([
      '',
      '__namespace-separator__',
      'default',
      'platform',
    ]);
  });

  it('returns empty option lists when filtering is disabled', () => {
    const options = buildGridTableFilterOptions({
      filteringEnabled: false,
      options: {
        searchPlaceholder: 'Find resources',
        kindDropdownSearchable: true,
      },
      data: rows,
      accessors,
      defaultGetKind,
      defaultGetNamespace,
    });

    expect(options.searchPlaceholder).toBe('Find resources');
    expect(options.kindDropdownSearchable).toBe(true);
    expect(options.kinds).toEqual([]);
    expect(options.namespaces).toEqual([]);
  });

  it('does not derive query-backed filter options from the loaded page', () => {
    const options = buildGridTableFilterOptions({
      filteringEnabled: true,
      options: {
        searchBehavior: 'query',
        kinds: ['Pod'],
      },
      data: rows,
      accessors,
      defaultGetKind,
      defaultGetNamespace,
    });

    expect(options.kinds.map((option) => option.value)).toEqual(['Pod']);
    expect(options.namespaces).toEqual([]);
  });

  it('treats null and em-dash namespaces as cluster-scoped for filtering', () => {
    const clusterScopedAccessors = resolveGridTableFilterAccessors({
      accessors: {
        getNamespace: (row) =>
          row.namespace === null || row.namespace === undefined ? '—' : row.namespace,
      },
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    const filtered = applyGridTableFilters({
      filteringEnabled: true,
      data: rows,
      activeFilters: {
        ...defaultState,
        namespaces: [''],
      },
      accessors: clusterScopedAccessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    expect(filtered.map((row) => row.id)).toEqual(['4']);
  });

  it('does not locally filter query-backed rows', () => {
    const filtered = applyGridTableFilters({
      filteringEnabled: true,
      searchBehavior: 'query',
      data: rows,
      activeFilters: {
        ...defaultState,
        search: 'frontend',
        kinds: ['Pod'],
        namespaces: ['default'],
      },
      accessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    expect(filtered).toBe(rows);
  });
});
