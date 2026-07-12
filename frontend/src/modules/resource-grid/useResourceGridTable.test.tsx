/**
 * frontend/src/modules/resource-grid/useResourceGridTable.test.tsx
 *
 * Verifies resource-grid hooks publish the canonical row key through the
 * shared GridTable binding instead of requiring each view to thread it again.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { NamespaceContext } from '@modules/namespace/contexts/NamespaceContext';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ResourceGridTableResult, ResourceGridTableRow } from './resourceGridTableTypes';
import {
  useNamespaceResourceGridTable,
  useObjectPanelResourceGridTable,
} from './useResourceGridTable';

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: 'alpha:ctx',
    selectedKubeconfig: 'mock-path:mock-context',
    selectedClusterName: 'alpha',
  }),
}));

vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: () => ({
    item: {
      type: 'toggle',
      id: 'favorite',
      icon: null,
      active: false,
      onClick: () => undefined,
      title: 'Save as favorite',
    },
    modal: null,
  }),
}));

interface TestRow extends ResourceGridTableRow {
  kind: string;
  name: string;
  namespace: string;
  clusterId: string;
}

const columns: GridColumnDefinition<TestRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (resourceRow) => resourceRow.name,
  },
  {
    key: 'age',
    header: 'Age',
    render: (resourceRow) => resourceRow.name,
  },
];

const row: TestRow = {
  kind: 'Pod',
  name: 'api',
  namespace: 'team-a',
  clusterId: 'alpha:ctx',
};

const renderObjectPanelGrid = (
  props: Partial<Parameters<typeof useObjectPanelResourceGridTable<TestRow>>[0]> = {}
) => {
  const result: { current: ResourceGridTableResult<TestRow> | undefined } = { current: undefined };

  const Probe: React.FC = () => {
    result.current = useObjectPanelResourceGridTable<TestRow>({
      viewId: 'test-grid',
      tableMode: 'Local Complete',
      clusterIdentity: 'alpha:ctx',
      data: [row],
      columns,
      ...props,
    });
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  act(() => {
    root.render(<Probe />);
  });

  if (!result.current) {
    throw new Error('resource grid hook did not render');
  }
  act(() => {
    root.unmount();
  });
  container.remove();
  return result.current;
};

const renderNamespaceGrid = (
  overrides: Partial<Parameters<typeof useNamespaceResourceGridTable<TestRow>>[0]> = {}
) => {
  const result: { current: ResourceGridTableResult<TestRow> | undefined } = { current: undefined };
  const onTableStateChange = vi.fn();

  const Probe: React.FC = () => {
    // Mirror production: the query-backed/bounded wrapper owns persistence and
    // passes it as persistenceOverride. The base hook no longer owns a fallback.
    const persistence = useGridTablePersistence<TestRow>({
      viewId: 'namespace-pods',
      clusterIdentity: 'alpha:ctx',
      namespace: null,
      isNamespaceScoped: false,
      columns,
      data: [row],
      keyExtractor: (item) => item.name,
      filterOptions: { isNamespaceScoped: false },
    });
    result.current = useNamespaceResourceGridTable<TestRow>({
      viewId: 'namespace-pods',
      tableMode: 'Query Backed Dynamic',
      namespace: ALL_NAMESPACES_SCOPE,
      data: [row],
      columns,
      keyExtractor: (item) => item.name,
      showNamespaceFilters: true,
      filterOptionOverrides: {
        namespaces: ['team-a'],
      },
      onTableStateChange,
      persistenceOverride: persistence,
      ...overrides,
    });
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(
      <NamespaceContext.Provider
        value={{
          namespaces: [
            {
              name: 'All Namespaces',
              scope: ALL_NAMESPACES_SCOPE,
              status: '',
              details: '',
              age: '',
              hasWorkloads: true,
              workloadsUnknown: false,
              resourceVersion: '',
              isSynthetic: true,
            },
            {
              name: 'team-a',
              scope: 'team-a',
              status: '',
              details: '',
              age: '',
              hasWorkloads: true,
              workloadsUnknown: false,
              resourceVersion: '',
            },
            {
              name: 'team-b',
              scope: 'team-b',
              status: '',
              details: '',
              age: '',
              hasWorkloads: true,
              workloadsUnknown: false,
              resourceVersion: '',
            },
          ],
          selectedNamespace: ALL_NAMESPACES_SCOPE,
          selectedNamespaceClusterId: 'alpha:ctx',
          namespaceLoading: false,
          namespacesPermissionDenied: false,
          namespaceRefreshing: false,
          namespaceReady: true,
          setSelectedNamespace: () => undefined,
          loadNamespaces: async () => undefined,
          refreshNamespaces: async () => undefined,
          getClusterNamespace: () => undefined,
        }}
      >
        <Probe />
      </NamespaceContext.Provider>
    );
  });

  if (!result.current) {
    throw new Error('namespace resource grid hook did not render');
  }

  return {
    result,
    onTableStateChange,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useObjectPanelResourceGridTable', () => {
  it('publishes the default canonical object key on gridTableProps', () => {
    const result = renderObjectPanelGrid();

    expect(result.gridTableProps.keyExtractor(row, 0)).toBe('alpha:ctx|/v1/Pod/team-a/api');
  });

  it('publishes a supplied key extractor on gridTableProps', () => {
    const keyExtractor = vi.fn((item: TestRow) => `custom:${item.name}`);
    const result = renderObjectPanelGrid({ keyExtractor });

    expect(result.gridTableProps.keyExtractor(row, 0)).toBe('custom:api');
    expect(keyExtractor).toHaveBeenCalledWith(row, 0);
  });
});

describe('useNamespaceResourceGridTable', () => {
  it('keeps all namespace options selected when the namespace dropdown selects all', () => {
    const harness = renderNamespaceGrid();

    expect(harness.result.current?.gridTableProps.filters?.options?.namespaces).toEqual([
      'team-a',
      'team-b',
    ]);

    act(() => {
      harness.result.current?.gridTableProps.filters?.onChange?.({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: ['team-a', 'team-b'],
      });
    });

    expect(harness.result.current?.gridTableProps.filters?.value?.namespaces).toEqual([
      'team-a',
      'team-b',
    ]);
    expect(harness.onTableStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ namespaces: [] }),
      })
    );

    act(() => {
      harness.result.current?.gridTableProps.filters?.onChange?.({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: [],
      });
    });

    expect(harness.result.current?.gridTableProps.filters?.value?.namespaces).toEqual([]);

    harness.cleanup();
  });

  it('keeps the static kind vocabulary when query facets collapse to the selected kind', () => {
    // Backend facets are computed post-kind-filter: with kind "Secret" selected
    // the facets shrink to ['Secret']. The static per-view list must win or the
    // dropdown collapses and other kinds become unselectable.
    const harness = renderNamespaceGrid({
      availableKinds: ['ConfigMap', 'Secret'],
      showKindDropdown: true,
      filterOptionOverrides: {
        kinds: ['Secret'],
        namespaces: ['team-a'],
      },
    });

    expect(harness.result.current?.gridTableProps.filters?.options?.kinds).toEqual([
      'ConfigMap',
      'Secret',
    ]);

    harness.cleanup();
  });

  it('publishes the default sort key and direction before any user sort', () => {
    const harness = renderNamespaceGrid({
      defaultSort: { key: 'age', direction: 'desc' },
    });

    expect(harness.result.current?.gridTableProps.sortConfig).toEqual({
      key: 'age',
      direction: 'desc',
    });
    expect(harness.onTableStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sortConfig: expect.objectContaining({ key: 'age', direction: 'desc' }),
      })
    );

    harness.cleanup();
  });

  it('marks Local Partial tables as bounded local windows', () => {
    const harness = renderNamespaceGrid({
      tableMode: 'Local Partial',
      filterOptionOverrides: undefined,
    });

    expect(harness.result.current?.gridTableProps.filters?.options).toMatchObject({
      searchBehavior: 'local',
      kindDropdownBulkActions: false,
    });
    expect(harness.result.current?.gridTableProps.filters?.options?.partialDataLabel).toContain(
      'visible dataset'
    );

    harness.cleanup();
  });
});
