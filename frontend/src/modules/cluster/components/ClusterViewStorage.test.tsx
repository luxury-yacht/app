/**
 * frontend/src/modules/cluster/components/ClusterViewStorage.test.tsx
 *
 * Test suite for ClusterViewStorage.
 * Covers key behaviors and edge cases for ClusterViewStorage.
 */

import ClusterViewStorage from '@modules/cluster/components/ClusterViewStorage';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

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
    onClick: () => undefined,
    title: 'Save as favorite',
  }),
}));

interface StorageRow {
  kind: string;
  name: string;
  clusterId: string;
  capacity: string;
  accessModes: string;
  status: string;
  statusState: string;
  statusPresentation: string;
  claim: string;
  storageClass: string;
  age: string;
}
const gridTablePropsRef: { current: GridTableProps<StorageRow> | null } = { current: null };
const openWithObjectMock = vi.hoisted(() => vi.fn());

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: GridTableProps<StorageRow>) => {
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
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
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

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: vi.fn(),
}));

const basePV = {
  kind: 'PersistentVolume',
  name: 'pv-1',
  clusterId: 'cluster-a',
  capacity: '10Gi',
  accessModes: 'ReadWriteOnce',
  status: 'Bound',
  statusState: 'Bound',
  statusPresentation: 'ready',
  claim: 'team-a/claim',
  storageClass: 'standard',
  age: '1d',
};

const getGridTableProps = () =>
  requireValue(
    gridTablePropsRef.current,
    'expected captured GridTable props in ClusterViewStorage.test.tsx'
  );

describe('ClusterViewStorage', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    openWithObjectMock.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(<ClusterViewStorage />);
      await Promise.resolve();
    });

    const props = getGridTableProps();
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.columnVisibility).toBe(null);
    expect(props.filters?.value).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
    });
    expect(props.columnWidths).toBe(null);
  });

  it('uses canonical object identity for row keys', async () => {
    await act(async () => {
      root.render(<ClusterViewStorage />);
      await Promise.resolve();
    });

    const props = getGridTableProps();
    expect(props.keyExtractor({ ...basePV, clusterId: 'alpha:ctx' }, 0)).toBe(
      'alpha:ctx|/v1/PersistentVolume//pv-1'
    );
  });

  it('leaves the kind options to the backend-published vocabulary (no frontend list)', async () => {
    await act(async () => {
      root.render(<ClusterViewStorage />);
      await Promise.resolve();
    });

    // No query payload applies in this harness, so there is no vocabulary yet
    // (only the empty row-derived fallback): the kind options come ONLY from
    // the backend capabilities on the payload (see the NsViewWorkloads
    // end-to-end pin), never from a frontend constant.
    const props = getGridTableProps();
    expect(props.filters?.options?.kinds).toEqual([]);
  });

  it('does not show a Kind dropdown for its single-kind resource family', async () => {
    await act(async () => {
      root.render(<ClusterViewStorage />);
      await Promise.resolve();
    });

    expect(getGridTableProps().filters?.options?.showKindDropdown).toBe(false);
  });

  it('uses backend statusPresentation for PersistentVolume status styling', async () => {
    await act(async () => {
      root.render(<ClusterViewStorage />);
      await Promise.resolve();
    });

    const statusColumn = requireValue(
      getGridTableProps().columns.find((column) => column.key === 'status'),
      'expected status column in ClusterViewStorage.test.tsx'
    );
    const cell = requireReactElement<{ className?: string }>(
      statusColumn.render({
        ...basePV,
        status: 'Released',
        statusState: 'Released',
        statusPresentation: 'warning',
      }),
      'expected status cell in ClusterViewStorage.test.tsx'
    );
    expect(cell.props.className).toBe('status-text warning');
  });

  it('opens the Map for PersistentVolume rows', async () => {
    await act(async () => {
      root.render(<ClusterViewStorage />);
      await Promise.resolve();
    });

    const props = getGridTableProps();
    const objectMapItem = requireValue(
      props.getCustomContextMenuItems,
      'expected context-menu factory in ClusterViewStorage.test.tsx'
    )(basePV, 'name').find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap);
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PersistentVolume',
        name: 'pv-1',
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
  });
});
