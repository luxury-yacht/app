/**
 * frontend/src/modules/namespace/components/NsViewRBAC.test.tsx
 *
 * Test suite for NsViewRBAC.
 * Covers key behaviors and edge cases for NsViewRBAC.
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

import NsViewRBAC, { type RBACData } from '@modules/namespace/components/NsViewRBAC';

type CapturedGridTableProps = GridTableProps<RBACData> & {
  getCustomContextMenuItems: NonNullable<GridTableProps<RBACData>['getCustomContextMenuItems']>;
};
type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

const { gridTablePropsRef, confirmationPropsRef, openWithObjectMock, runObjectActionMock } =
  vi.hoisted(() => ({
    gridTablePropsRef: { current: null as unknown as CapturedGridTableProps },
    confirmationPropsRef: { current: null as unknown as ConfirmationProps },
    openWithObjectMock: vi.fn(),
    runObjectActionMock: vi.fn().mockResolvedValue(undefined),
  }));

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

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: CapturedGridTableProps) => {
      gridTablePropsRef.current = props;
      return (
        <table data-testid="grid-table">
          <tbody>
            {withStableListKeys(props.data, (row) => JSON.stringify(row)).map(
              ({ key, value: row }) => (
                <tr key={key}>
                  <td>{row.name}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      );
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: (props: ConfirmationProps) => {
    confirmationPropsRef.current = props;
    return null;
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: (...args: unknown[]) => runObjectActionMock(...args),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: RBACData[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    onSortChange: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    isNamespaceScoped: true,
    resetState: vi.fn(),
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@shared/components/icons/SharedIcons', () => ({
  DiffIcon: () => <span>diff</span>,
  OpenIcon: () => <span>open</span>,
  ObjectMapIcon: () => <span>map</span>,
  DeleteIcon: () => <span>delete</span>,
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () =>
    new Map([
      ['Role:delete', { allowed: true, pending: false }],
      ['RoleBinding:delete', { allowed: true, pending: false }],
      ['ServiceAccount:delete', { allowed: true, pending: false }],
    ]),
  getPermissionKey: (kind: string, action: string) => `${kind}:${action}`,
}));

describe('NsViewRBAC', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    confirmationPropsRef.current = null as unknown as ConfirmationProps;
    openWithObjectMock.mockReset();
    runObjectActionMock.mockReset();
    runObjectActionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseRBAC = (overrides: Partial<RBACData> = {}): RBACData => ({
    kind: 'Role',
    name: 'view',
    namespace: 'team-a',
    clusterId: 'alpha:ctx',
    rulesCount: 3,
    age: '5h',
    ...overrides,
  });

  const renderRBACView = async (options: { stats?: unknown; namespace?: string } = {}) => {
    await act(async () => {
      root.render(
        <NsViewRBAC namespace={options.namespace ?? 'team-a'} showNamespaceColumn={true} />
      );
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  it('provides open action for RBAC rows', async () => {
    const entry = baseRBAC();
    const props = await renderRBACView();
    const openItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item) => item.actionId === OBJECT_ACTION_IDS.viewDetails);
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Role',
        name: 'view',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('deletes RBAC entries on confirmation', async () => {
    const entry = baseRBAC();
    const props = await renderRBACView();

    const deleteItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item) => item.label === 'Delete');
    expect(deleteItem).toBeTruthy();

    act(() => {
      deleteItem?.onClick?.();
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(true);

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(runObjectActionMock).toHaveBeenCalledWith({
      action: 'delete',
      target: {
        clusterId: 'alpha:ctx',
        group: 'rbac.authorization.k8s.io',
        version: 'v1',
        kind: 'Role',
        namespace: 'team-a',
        name: 'view',
      },
    });
  });

  it('opens the Map for ServiceAccount rows', async () => {
    const entry = baseRBAC({ kind: 'ServiceAccount', name: 'builder' });
    const props = await renderRBACView();
    const objectMapItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap);
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ServiceAccount',
        name: 'builder',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
  });
});
