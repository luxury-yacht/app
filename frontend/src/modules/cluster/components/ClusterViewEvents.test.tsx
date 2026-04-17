/**
 * frontend/src/modules/cluster/components/ClusterViewEvents.test.tsx
 *
 * Test suite for ClusterViewEvents.
 * Covers key behaviors and edge cases for ClusterViewEvents.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterViewEvents from '@modules/cluster/components/ClusterViewEvents';

const openWithObjectMock = vi.fn();

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],

    addFavorite: vi.fn(),
    updateFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
  FavoritesProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: () => ({
    type: 'toggle',
    id: 'favorite',
    icon: null,
    active: false,
    onClick: () => {},
    title: 'Save as favorite',
  }),
}));

const gridTablePropsRef: { current: any } = { current: null };

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context' }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[]) => ({
    sortedData: data,
    sortConfig: { key: 'ageTimestamp', direction: 'desc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'ageTimestamp', direction: 'desc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

const baseEvent = {
  kind: 'Event',
  name: 'test',
  namespace: 'team-a',
  type: 'Warning',
  source: 'kubelet',
  reason: 'Failed',
  object: 'Pod/foo',
  objectApiVersion: 'v1',
  message: 'Something happened',
  ageTimestamp: 123,
  clusterId: 'test-cluster',
};

describe('ClusterViewEvents', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    openWithObjectMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents data={[baseEvent]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'ageTimestamp', direction: 'desc' });
    expect(props.columnVisibility).toBe(null);
    expect(props.filters?.value).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
    });

    const key = props.keyExtractor(baseEvent, 0);
    expect(key).toContain('team-a');
    expect(props.columnWidths).toBe(null);
  });

  it('opens the involved object with group/version when object name is clicked', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents data={[baseEvent]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const objectNameColumn = props.columns.find((column: any) => column.key === 'objectName');
    expect(objectNameColumn).toBeTruthy();

    const cell = objectNameColumn.render(baseEvent);

    act(() => {
      cell.props.onClick({ altKey: false });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'foo',
        group: '',
        version: 'v1',
        clusterId: 'test-cluster',
      })
    );
  });
});
