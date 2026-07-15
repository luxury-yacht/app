/**
 * frontend/src/shared/components/tables/useGridTableFilters.test.tsx
 *
 * Test suite for useGridTableFilters.
 * Covers key behaviors and edge cases for useGridTableFilters.
 */

import {
  ALL_MULTISELECT_FILTER,
  NONE_MULTISELECT_FILTER,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type {
  GridTableFilterConfig,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import { useGridTableFilters } from '@shared/components/tables/useGridTableFilters';
import type React from 'react';
import { act, useEffect } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  kind: string;
  namespace: string | null;
  name: string;
  description: string;
  clusterId: string;
  clusterName: string;
};

const rows: Row[] = [
  {
    id: '1',
    kind: 'Deployment',
    namespace: 'default',
    name: 'frontend',
    description: 'web app',
    clusterId: 'alpha:ctx',
    clusterName: 'alpha',
  },
  {
    id: '2',
    kind: 'Pod',
    namespace: 'default',
    name: 'frontend-1',
    description: 'pod instance',
    clusterId: 'alpha:ctx',
    clusterName: 'alpha',
  },
  {
    id: '3',
    kind: 'Deployment',
    namespace: 'platform',
    name: 'gateway',
    description: 'edge',
    clusterId: 'beta:ctx',
    clusterName: 'beta',
  },
  {
    id: '4',
    kind: 'ConfigMap',
    namespace: null,
    name: 'global-config',
    description: 'cluster wide',
    clusterId: 'beta:ctx',
    clusterName: 'beta',
  },
];

describe('useGridTableFilters', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const defaultAccessors = {
    defaultGetKind: (row: Row) => row.kind,
    defaultGetNamespace: (row: Row) => row.namespace,
    defaultGetSearchText: (row: Row) => [row.name, row.description],
  };

  const renderHook = async (
    filters?: GridTableFilterConfig<Row>
  ): Promise<{
    getResult: () => ReturnType<typeof useGridTableFilters<Row>> | null;
  }> => {
    const resultRef: {
      current: ReturnType<typeof useGridTableFilters<Row>> | null;
    } = { current: null };

    const HookHarness: React.FC = () => {
      const result = useGridTableFilters<Row>({
        data: rows,
        filters,
        ...defaultAccessors,
      });

      useEffect(() => {
        resultRef.current = result;
      }, [result]);

      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    return {
      getResult: () => resultRef.current,
    };
  };

  it('returns passthrough values when filtering is disabled', async () => {
    const { getResult } = await renderHook();
    const result = getResult();
    expect(result?.filteringEnabled).toBe(false);
    expect(result?.tableData).toEqual(rows);
    expect(result?.filterSignature).toBe('');
    expect(result?.resolvedFilterOptions.kinds).toEqual([]);
    expect(result?.resolvedFilterOptions.namespaces).toEqual([]);
  });

  it('filters rows using uncontrolled state change handlers', async () => {
    const filters: GridTableFilterConfig<Row> = {
      enabled: true,
      initial: {
        search: 'front',
        kinds: { mode: 'some', values: ['Deployment'] },
      },
    };

    const { getResult } = await renderHook(filters);

    let result = getResult();
    expect(result?.filteringEnabled).toBe(true);
    expect(result?.tableData.map((row) => row.id)).toEqual(['1']);

    const flush = async () => {
      await act(async () => {
        await Promise.resolve();
      });
    };

    await act(async () => {
      result?.handleFilterSearchChange('');
    });
    await flush();

    result = getResult();
    expect(result?.activeFilters.search).toBe('');

    await act(async () => {
      result?.handleFilterNamespacesChange(['platform']);
    });
    await flush();

    result = getResult();
    expect(result?.activeFilters.namespaces).toEqual({ mode: 'some', values: ['platform'] });
    expect(result?.tableData.map((row) => row.id)).toEqual(['3']);

    await act(async () => {
      result?.handleFilterNamespacesChange([]);
    });
    await flush();

    result = getResult();
    expect(result?.activeFilters.namespaces).toEqual(NONE_MULTISELECT_FILTER);
    expect(result?.tableData).toEqual([]);

    await act(async () => {
      result?.handleFilterReset();
      await Promise.resolve();
    });

    result = getResult();
    expect(result?.activeFilters).toEqual({
      search: '',
      kinds: ALL_MULTISELECT_FILTER,
      namespaces: ALL_MULTISELECT_FILTER,
      clusters: ALL_MULTISELECT_FILTER,
      caseSensitive: false,
      includeMetadata: false,
    });
    expect(result?.tableData.length).toBe(rows.length);
  });

  it('invalidates dependent Kind selections in the same query-facet change', async () => {
    const onChange = vi.fn();
    const { getResult } = await renderHook({
      enabled: true,
      value: {
        search: '',
        kinds: { mode: 'some', values: ['Deployment'] },
        namespaces: ALL_MULTISELECT_FILTER,
        clusters: ALL_MULTISELECT_FILTER,
        queryFacets: { apiGroups: { mode: 'some', values: ['apps'] } },
        caseSensitive: false,
        includeMetadata: false,
      },
      onChange,
      options: {
        searchBehavior: 'query',
        queryFacets: [
          {
            key: 'apiGroups',
            label: 'API groups',
            placeholder: 'All API groups',
            options: [],
            invalidates: ['kinds'],
          },
        ],
      },
    });

    await act(async () => {
      getResult()?.handleFilterQueryFacetChange('apiGroups', ['(core)']);
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledWith({
      search: '',
      kinds: ALL_MULTISELECT_FILTER,
      namespaces: ALL_MULTISELECT_FILTER,
      clusters: ALL_MULTISELECT_FILTER,
      queryFacets: { apiGroups: { mode: 'some', values: ['(core)'] } },
      caseSensitive: false,
      includeMetadata: false,
    });
  });

  it('honours controlled filter state and invokes onChange callbacks', async () => {
    const onChange = vi.fn();
    const controlledValue: GridTableFilterState = {
      search: '',
      kinds: { mode: 'some', values: ['configmap'] },
      namespaces: { mode: 'some', values: [''] },
      clusters: ALL_MULTISELECT_FILTER,
      caseSensitive: false,
      includeMetadata: false,
    };

    const { getResult } = await renderHook({
      enabled: true,
      value: controlledValue,
      onChange,
    });

    let result = getResult();
    expect(result?.tableData.map((row) => row.id)).toEqual(['4']);

    await act(async () => {
      result?.handleFilterSearchChange('gateway');
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledWith({
      search: 'gateway',
      kinds: { mode: 'some', values: ['configmap'] },
      namespaces: { mode: 'some', values: [''] },
      clusters: ALL_MULTISELECT_FILTER,
      caseSensitive: false,
      includeMetadata: false,
    });

    result = getResult();
    expect(result?.activeFilters).toEqual(controlledValue);
  });

  it('toggleCaseSensitive makes search case-sensitive', async () => {
    const filters: GridTableFilterConfig<Row> = {
      enabled: true,
      initial: { search: 'Frontend' },
    };

    const { getResult } = await renderHook(filters);

    // Default: case-insensitive — "Frontend" matches "frontend".
    let result = getResult();
    expect(result?.caseSensitive).toBe(false);
    expect(result?.tableData.map((r) => r.id)).toEqual(['1', '2']);

    // Toggle on case-sensitive search.
    await act(async () => {
      result?.toggleCaseSensitive();
      await Promise.resolve();
    });

    result = getResult();
    expect(result?.caseSensitive).toBe(true);
    // "Frontend" (capital F) should NOT match "frontend" (lowercase f).
    expect(result?.tableData.map((r) => r.id)).toEqual([]);

    // Toggle back off.
    await act(async () => {
      result?.toggleCaseSensitive();
      await Promise.resolve();
    });

    result = getResult();
    expect(result?.caseSensitive).toBe(false);
    expect(result?.tableData.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('does not reset user-typed search when filters.initial is a new reference with same content', async () => {
    // Regression: inline `filters={{ initial: { search: '' }, enabled: true }}`
    // creates a new object reference every render. The useEffect that applies
    // `filters.initial` must not reset user-typed state when the content is unchanged.
    const resultRef: {
      current: ReturnType<typeof useGridTableFilters<Row>> | null;
    } = { current: null };

    const Harness: React.FC<{ filters: GridTableFilterConfig<Row> }> = ({ filters }) => {
      const result = useGridTableFilters<Row>({
        data: rows,
        filters,
        ...defaultAccessors,
      });
      useEffect(() => {
        resultRef.current = result;
      }, [result]);
      return null;
    };

    // Initial render with empty initial search.
    await act(async () => {
      root.render(<Harness filters={{ enabled: true, initial: { search: '' } }} />);
      await Promise.resolve();
    });

    // User types a search term.
    await act(async () => {
      resultRef.current?.handleFilterSearchChange('gateway');
      await Promise.resolve();
    });
    expect(resultRef.current?.activeFilters.search).toBe('gateway');
    expect(resultRef.current?.tableData.map((r) => r.id)).toEqual(['3']);

    // Parent re-renders with a new `initial` object reference, same content.
    await act(async () => {
      root.render(<Harness filters={{ enabled: true, initial: { search: '' } }} />);
      await Promise.resolve();
    });

    // User's search must be preserved — not reset to empty string.
    expect(resultRef.current?.activeFilters.search).toBe('gateway');
    expect(resultRef.current?.tableData.map((r) => r.id)).toEqual(['3']);
  });

  it('reapplies filters.initial when the content actually changes', async () => {
    const resultRef: {
      current: ReturnType<typeof useGridTableFilters<Row>> | null;
    } = { current: null };

    const Harness: React.FC<{ filters: GridTableFilterConfig<Row> }> = ({ filters }) => {
      const result = useGridTableFilters<Row>({
        data: rows,
        filters,
        ...defaultAccessors,
      });
      useEffect(() => {
        resultRef.current = result;
      }, [result]);
      return null;
    };

    // Initial render with kind filter for Deployment.
    await act(async () => {
      root.render(
        <Harness
          filters={{
            enabled: true,
            initial: { kinds: { mode: 'some', values: ['Deployment'] } },
          }}
        />
      );
      await Promise.resolve();
    });
    expect(resultRef.current?.activeFilters.kinds).toEqual({
      mode: 'some',
      values: ['Deployment'],
    });
    expect(resultRef.current?.tableData.map((r) => r.id)).toEqual(['1', '3']);

    // Parent changes initial to a different kind — hook must reapply.
    await act(async () => {
      root.render(
        <Harness
          filters={{ enabled: true, initial: { kinds: { mode: 'some', values: ['Pod'] } } }}
        />
      );
      await Promise.resolve();
    });
    expect(resultRef.current?.activeFilters.kinds).toEqual({ mode: 'some', values: ['Pod'] });
    expect(resultRef.current?.tableData.map((r) => r.id)).toEqual(['2']);
  });

  it('builds filter option lists from data when options are not provided', async () => {
    const { getResult } = await renderHook({
      enabled: true,
    });

    const result = getResult();
    expect(result?.resolvedFilterOptions.kinds.map((opt) => opt.label)).toEqual([
      'ConfigMap',
      'Deployment',
      'Pod',
    ]);
    expect(result?.resolvedFilterOptions.namespaces.map((opt) => opt.label)).toEqual([
      'default',
      'platform',
    ]);
  });
});
