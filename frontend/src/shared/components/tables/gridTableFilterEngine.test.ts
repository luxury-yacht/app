import {
  ALL_MULTISELECT_FILTER,
  NONE_MULTISELECT_FILTER,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';
import {
  applyGridTableFilters,
  buildGridTableFilterOptions,
  resolveGridTableFilterAccessors,
} from '@shared/components/tables/gridTableFilterEngine';
import { describe, expect, it } from 'vitest';

interface Row {
  id: string;
  clusterId: string;
  clusterName: string;
  kind: string;
  namespace: string | null;
  name: string;
  description: string;
}

const rows: Row[] = [
  {
    id: '1',
    clusterId: 'cluster-a',
    clusterName: 'alpha',
    kind: 'Deployment',
    namespace: 'default',
    name: 'frontend',
    description: 'web app',
  },
  {
    id: '2',
    clusterId: 'cluster-a',
    clusterName: 'alpha',
    kind: 'Pod',
    namespace: 'default',
    name: 'frontend-1',
    description: 'pod instance',
  },
  {
    id: '3',
    clusterId: 'cluster-b',
    clusterName: 'beta',
    kind: 'Deployment',
    namespace: 'platform',
    name: 'gateway',
    description: 'edge',
  },
  {
    id: '4',
    clusterId: 'cluster-b',
    clusterName: 'beta',
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
  kinds: ALL_MULTISELECT_FILTER,
  namespaces: ALL_MULTISELECT_FILTER,
  clusters: ALL_MULTISELECT_FILTER,
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

  it('builds labeled cluster options and filters locally by cluster ID', () => {
    const clusterAccessors = resolveGridTableFilterAccessors({
      accessors: {
        getCluster: (row) => row.clusterId,
      },
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });
    const options = buildGridTableFilterOptions({
      filteringEnabled: true,
      options: {
        clusters: [
          { value: 'cluster-a', label: 'alpha' },
          { value: 'cluster-b', label: 'beta' },
        ],
      },
      data: rows,
      accessors: clusterAccessors,
      defaultGetKind,
      defaultGetNamespace,
    });

    expect(options.clusters).toEqual([
      { value: 'cluster-a', label: 'alpha' },
      { value: 'cluster-b', label: 'beta' },
    ]);

    const filtered = applyGridTableFilters({
      filteringEnabled: true,
      data: rows,
      activeFilters: {
        ...defaultState,
        clusters: { mode: 'some', values: ['cluster-b'] },
      },
      accessors: clusterAccessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    expect(filtered.map((row) => row.id)).toEqual(['3', '4']);

    const caseVariantFiltered = applyGridTableFilters({
      filteringEnabled: true,
      data: rows,
      activeFilters: {
        ...defaultState,
        clusters: { mode: 'some', values: ['CLUSTER-B'] },
      },
      accessors: clusterAccessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });
    expect(caseVariantFiltered).toEqual([]);
  });

  it('returns empty option lists when filtering is disabled', () => {
    const options = buildGridTableFilterOptions({
      filteringEnabled: false,
      options: {
        searchPlaceholder: 'Find resources',
      },
      data: rows,
      accessors,
      defaultGetKind,
      defaultGetNamespace,
    });

    expect(options.searchPlaceholder).toBe('Find resources');
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
        namespaces: { mode: 'some', values: [''] },
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
        kinds: { mode: 'some', values: ['Pod'] },
        namespaces: { mode: 'some', values: ['default'] },
      },
      accessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    expect(filtered).toBe(rows);
  });

  it('returns no local rows when any structural multiselect is explicitly none', () => {
    const filtered = applyGridTableFilters({
      filteringEnabled: true,
      data: rows,
      activeFilters: {
        ...defaultState,
        kinds: NONE_MULTISELECT_FILTER,
      },
      accessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    expect(filtered).toEqual([]);
  });
});
