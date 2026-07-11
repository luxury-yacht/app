/**
 * frontend/src/modules/cluster/components/ClusterViewRBAC.test.tsx
 *
 * Test suite for ClusterViewRBAC.
 * Covers key behaviors and edge cases for ClusterViewRBAC.
 */

import ClusterViewRBAC from '@modules/cluster/components/ClusterViewRBAC';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type RBACRow = Record<string, unknown>;

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

const gridTablePropsRef: { current: GridTableProps<RBACRow> | null } = { current: null };
const openWithObjectMock = vi.hoisted(() => vi.fn());

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: GridTableProps<RBACRow>) => {
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

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, verb: string, ns?: string) => `${kind}:${verb}:${ns || ''}`,
  useUserPermissions: () => new Map(),
}));

const baseRBAC = {
  kind: 'ClusterRole',
  name: 'admin',
  clusterId: 'cluster-a',
  details: 'All permissions',
  age: '1d',
};

const getGridTableProps = () =>
  requireValue(gridTablePropsRef.current, 'expected GridTable props in ClusterViewRBAC.test.tsx');

const getContextMenuItems = (row: RBACRow) =>
  requireValue(
    getGridTableProps().getCustomContextMenuItems,
    'expected context-menu factory in ClusterViewRBAC.test.tsx'
  )(row, 'name');

describe('ClusterViewRBAC', () => {
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
      root.render(<ClusterViewRBAC />);
      await Promise.resolve();
    });

    const props = getGridTableProps();
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.filters?.value).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
    });
    expect(props.columnVisibility).toBe(null);
    expect(props.columnWidths).toBe(null);
  });

  it.each([
    ['ClusterRole', 'admin'],
    ['ClusterRoleBinding', 'admin-binding'],
  ])('opens the Map for %s rows', async (kind, name) => {
    const row = { ...baseRBAC, kind, name };

    await act(async () => {
      root.render(<ClusterViewRBAC />);
      await Promise.resolve();
    });

    const objectMapItem = getContextMenuItems(row).find(
      (item) => item.actionId === OBJECT_ACTION_IDS.viewMap
    );
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind,
        name,
        clusterId: 'cluster-a',
        group: 'rbac.authorization.k8s.io',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
  });
});
