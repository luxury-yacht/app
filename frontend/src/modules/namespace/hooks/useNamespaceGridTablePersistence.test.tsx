/**
 * frontend/src/modules/namespace/hooks/useNamespaceGridTablePersistence.test.tsx
 *
 * Regression test: verifies isNamespaceScoped is NOT duplicated into filterOptions.
 * useGridTablePersistence merges isNamespaceScoped into filterOptions internally,
 * so the wrapper must not inject it a second time.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type Row = { name: string };
type GridPersistenceParams = Parameters<
  typeof import('@shared/components/tables/persistence/useGridTablePersistence').useGridTablePersistence<Row>
>[0];
type NamespaceFilterOptions = Parameters<
  typeof import('./useNamespaceGridTablePersistence').useNamespaceGridTablePersistence<Row>
>[0]['filterOptions'];

// Capture the params passed to useGridTablePersistence.
const capturedParams: GridPersistenceParams[] = [];

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'test-cluster' }),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: (params: GridPersistenceParams) => {
    capturedParams.push(params);
    return {
      sortConfig: null,
      setSortConfig: vi.fn(),
      columnWidths: null,
      setColumnWidths: vi.fn(),
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
      setFilters: vi.fn(),
      hydrated: true,
      storageKey: 'mock-key',
      resetState: vi.fn(),
    };
  },
}));

// Import after mocks are set up.
const { useNamespaceGridTablePersistence } = await import('./useNamespaceGridTablePersistence');

describe('useNamespaceGridTablePersistence', () => {
  const columns: GridColumnDefinition<Row>[] = [
    { key: 'name', header: 'Name', render: (row) => row.name },
  ];
  const data = [{ name: 'a' }];
  const keyExtractor = (row: { name: string }) => row.name;

  beforeEach(() => {
    capturedParams.length = 0;
  });

  const Harness: React.FC<{
    namespace: string;
    filterOptions?: NamespaceFilterOptions;
  }> = ({ namespace, filterOptions }) => {
    useNamespaceGridTablePersistence({
      viewId: 'test-view',
      namespace,
      columns,
      data,
      keyExtractor,
      filterOptions,
    });
    return null;
  };

  it('does not inject isNamespaceScoped into filterOptions', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<Harness namespace="team-a" filterOptions={{ kinds: ['Pod'] }} />);
    });

    // The last captured call to useGridTablePersistence should have
    // isNamespaceScoped as a top-level param, NOT inside filterOptions.
    const lastParams = requireValue(
      capturedParams[capturedParams.length - 1],
      'expected captured persistence params'
    );
    expect(lastParams.isNamespaceScoped).toBe(true);
    expect(lastParams.filterOptions).toEqual({ kinds: ['Pod'] });
    // Crucially, filterOptions must not contain isNamespaceScoped.
    expect(lastParams.filterOptions).not.toHaveProperty('isNamespaceScoped');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('passes undefined filterOptions through when caller omits it', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<Harness namespace="namespace:all" />);
    });

    const lastParams = requireValue(
      capturedParams[capturedParams.length - 1],
      'expected captured persistence params'
    );
    expect(lastParams.isNamespaceScoped).toBe(false);
    expect(lastParams.filterOptions).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
