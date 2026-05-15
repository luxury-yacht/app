import { describe, expect, it } from 'vitest';

import {
  applyGridTableFilters,
  buildGridTableFilterOptions,
  resolveGridTableFilterAccessors,
} from '@shared/components/tables/gridTableFilterEngine';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';

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
  it('resolves default accessors when custom accessors are omitted', () => {
    expect(accessors.getKind?.(rows[0])).toBe('Deployment');
    expect(accessors.getNamespace?.(rows[0])).toBe('default');
    expect(accessors.getSearchText?.(rows[0])).toEqual(['frontend', 'web app']);
  });

  it('builds sorted unique filter options from rows', () => {
    const options = buildGridTableFilterOptions({
      filteringEnabled: true,
      data: rows,
      accessors,
      defaultGetKind,
      defaultGetNamespace,
    });

    expect(options.kinds.map((option) => option.label)).toEqual(['ConfigMap', 'Deployment', 'Pod']);
    expect(options.namespaces.map((option) => option.label)).toEqual(['default', 'platform']);
  });

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

  it('filters by kind, namespace, and search text', () => {
    const filtered = applyGridTableFilters({
      filteringEnabled: true,
      data: rows,
      activeFilters: {
        ...defaultState,
        search: 'front',
        kinds: ['deployment'],
        namespaces: ['default'],
      },
      accessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    expect(filtered.map((row) => row.id)).toEqual(['1']);
  });

  it('treats null and em-dash namespaces as cluster-scoped for filtering', () => {
    const clusterScopedAccessors = resolveGridTableFilterAccessors({
      accessors: {
        getNamespace: (row) => (row.namespace == null ? '—' : row.namespace),
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

  it('applies case-sensitive search only when requested', () => {
    const insensitive = applyGridTableFilters({
      filteringEnabled: true,
      data: rows,
      activeFilters: {
        ...defaultState,
        search: 'Frontend',
      },
      accessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });
    const sensitive = applyGridTableFilters({
      filteringEnabled: true,
      data: rows,
      activeFilters: {
        ...defaultState,
        search: 'Frontend',
        caseSensitive: true,
      },
      accessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });

    expect(insensitive.map((row) => row.id)).toEqual(['1', '2']);
    expect(sensitive).toEqual([]);
  });
});
