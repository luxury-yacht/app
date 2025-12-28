/**
 * frontend/src/shared/components/tables/useGridTableFilters.test.tsx
 *
 * Test suite for useGridTableFilters.
 * Covers key behaviors and edge cases for useGridTableFilters.
 */

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTableFilters } from '@shared/components/tables/useGridTableFilters';
import type {
  GridTableFilterConfig,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';

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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
    defaultGetClusterId: (row: Row) => row.clusterId,
    defaultGetClusterName: (row: Row) => row.clusterName,
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
    expect(result?.resolvedFilterOptions.clusters).toEqual([]);
  });

  it('filters rows using uncontrolled state change handlers', async () => {
    const filters: GridTableFilterConfig<Row> = {
      enabled: true,
      initial: {
        search: 'front',
        kinds: ['Deployment'],
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
      result?.handleFilterSearchChange({ target: { value: '' } } as any);
    });
    await flush();

    result = getResult();
    expect(result?.activeFilters.search).toBe('');

    await act(async () => {
      result?.handleFilterNamespacesChange(['platform']);
    });
    await flush();

    result = getResult();
    expect(result?.activeFilters.namespaces).toEqual(['platform']);
    expect(result?.tableData.map((row) => row.id)).toEqual(['3']);

    await act(async () => {
      result?.handleFilterReset();
      await Promise.resolve();
    });

    result = getResult();
    expect(result?.activeFilters).toEqual({ search: '', kinds: [], namespaces: [], clusters: [] });
    expect(result?.tableData.length).toBe(rows.length);
  });

  it('honours controlled filter state and invokes onChange callbacks', async () => {
    const onChange = vi.fn();
    const controlledValue: GridTableFilterState = {
      search: '',
      kinds: ['configmap'],
      namespaces: [''],
      clusters: ['beta:ctx'],
    };

    const { getResult } = await renderHook({
      enabled: true,
      value: controlledValue,
      onChange,
    });

    let result = getResult();
    expect(result?.tableData.map((row) => row.id)).toEqual(['4']);

    await act(async () => {
      result?.handleFilterSearchChange({ target: { value: 'gateway' } } as any);
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledWith({
      search: 'gateway',
      kinds: ['configmap'],
      namespaces: [''],
      clusters: ['beta:ctx'],
    });

    result = getResult();
    expect(result?.activeFilters).toEqual(controlledValue);
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
    expect(result?.resolvedFilterOptions.clusters.map((opt) => opt.label)).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('filters rows by cluster selection', async () => {
    const { getResult } = await renderHook({
      enabled: true,
      initial: { clusters: ['beta:ctx'] },
    });

    const result = getResult();
    expect(result?.tableData.map((row) => row.id)).toEqual(['3', '4']);
  });
});
