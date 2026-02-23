/**
 * frontend/src/modules/namespace/hooks/useNamespaceGridTablePersistence.test.tsx
 *
 * Regression test: verifies isNamespaceScoped is NOT duplicated into filterOptions.
 * useGridTablePersistence merges isNamespaceScoped into filterOptions internally,
 * so the wrapper must not inject it a second time.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

// Capture the params passed to useGridTablePersistence.
const capturedParams: any[] = [];

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'test-cluster' }),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: (params: any) => {
    capturedParams.push(params);
    return {
      sortConfig: null,
      setSortConfig: vi.fn(),
      columnWidths: null,
      setColumnWidths: vi.fn(),
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: { search: '', kinds: [], namespaces: [] },
      setFilters: vi.fn(),
      hydrated: true,
      storageKey: 'mock-key',
      resetState: vi.fn(),
    };
  },
}));

// Import after mocks are set up.
const { useNamespaceGridTablePersistence } = await import(
  './useNamespaceGridTablePersistence'
);

describe('useNamespaceGridTablePersistence', () => {
  const columns: GridColumnDefinition<{ id: string }>[] = [
    { key: 'name', header: 'Name', render: (row) => row.id },
  ];
  const data = [{ id: 'a' }];
  const keyExtractor = (row: { id: string }) => row.id;

  beforeEach(() => {
    capturedParams.length = 0;
  });

  const Harness: React.FC<{
    namespace: string;
    filterOptions?: any;
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
    const lastParams = capturedParams[capturedParams.length - 1];
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

    const lastParams = capturedParams[capturedParams.length - 1];
    expect(lastParams.isNamespaceScoped).toBe(false);
    expect(lastParams.filterOptions).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
