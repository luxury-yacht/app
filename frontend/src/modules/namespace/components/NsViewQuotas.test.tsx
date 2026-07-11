/**
 * frontend/src/modules/namespace/components/NsViewQuotas.test.tsx
 *
 * Test suite for NsViewQuotas.
 * Covers key behaviors and edge cases for NsViewQuotas.
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

import NsViewQuotas, { type QuotaData } from '@modules/namespace/components/NsViewQuotas';

type CapturedGridTableProps = GridTableProps<QuotaData> & {
  getCustomContextMenuItems: NonNullable<GridTableProps<QuotaData>['getCustomContextMenuItems']>;
};
type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

const {
  gridTablePropsRef,
  confirmationPropsRef,
  openWithObjectMock,
  runObjectActionMock,
  permissionState,
  errorHandlerMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as unknown as CapturedGridTableProps },
  confirmationPropsRef: { current: null as unknown as ConfirmationProps },
  openWithObjectMock: vi.fn(),
  runObjectActionMock: vi.fn().mockResolvedValue(undefined),
  permissionState: new Map<
    string,
    { allowed: boolean; pending: boolean; reason?: string; error?: string }
  >(),
  errorHandlerMock: { handle: vi.fn() },
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
  useTableSort: (data: QuotaData[]) => ({
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
  DeleteIcon: () => <span>delete</span>,
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, action: string, namespace: string) =>
    `${kind}:${action}:${namespace}`,
  useUserPermissions: () => permissionState,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

describe('NsViewQuotas', () => {
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
    permissionState.clear();
    errorHandlerMock.handle.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseQuota = (overrides: Partial<QuotaData> = {}): QuotaData => ({
    kind: 'ResourceQuota',
    name: 'rq-default',
    namespace: 'team-a',
    clusterId: 'alpha:ctx',
    hard: {
      'requests.cpu': '2',
      'requests.memory': '2147483648',
      pods: '10',
    },
    used: {
      'requests.cpu': '1',
      'requests.memory': '1073741824',
    },
    age: '1h',
    ...overrides,
  });

  const renderQuotaView = async (
    overrides: Partial<React.ComponentProps<typeof NsViewQuotas>> = {}
  ) => {
    await act(async () => {
      root.render(<NsViewQuotas namespace="team-a" showNamespaceColumn={true} {...overrides} />);
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  const getColumn = (key: string) =>
    gridTablePropsRef.current.columns.find((column) => column.key === key);

  it('opens quota resources through context menu', async () => {
    permissionState.set('ResourceQuota:delete:team-a', { allowed: true, pending: false });
    const entry = baseQuota();
    const props = await renderQuotaView();

    const items = props.getCustomContextMenuItems(entry, 'name');
    const openItem = items.find((item) => item.actionId === OBJECT_ACTION_IDS.viewDetails);
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ResourceQuota',
        name: 'rq-default',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
      })
    );
  });

  it('uses canonical object identity for row keys', async () => {
    const entry = baseQuota();
    const props = await renderQuotaView();

    expect(props.keyExtractor(entry, 0)).toBe('alpha:ctx|/v1/ResourceQuota/team-a/rq-default');
  });

  it('omits Resources, Status, and Scope columns', async () => {
    await renderQuotaView();
    expect(getColumn('resources')).toBeUndefined();
    expect(getColumn('status')).toBeUndefined();
    expect(getColumn('scope')).toBeUndefined();
  });

  it('shows delete option, confirms and handles backend success', async () => {
    permissionState.set('ResourceQuota:delete:team-a', { allowed: true, pending: false });
    const entry = baseQuota();
    const props = await renderQuotaView();

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
        group: '',
        version: 'v1',
        kind: 'ResourceQuota',
        namespace: 'team-a',
        name: 'rq-default',
      },
    });
  });

  it('handles delete failure with errorHandler', async () => {
    runObjectActionMock.mockRejectedValueOnce(new Error('boom'));
    permissionState.set('ResourceQuota:delete:team-a', { allowed: true, pending: false });

    const entry = baseQuota();
    const props = await renderQuotaView();
    const deleteItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item) => item.label === 'Delete');
    expect(deleteItem).toBeTruthy();

    act(() => {
      deleteItem?.onClick?.();
    });

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'ResourceQuota',
      name: 'rq-default',
    });
  });

  it('provides disabled delete menu entry when capability is pending', async () => {
    permissionState.set('ResourceQuota:delete:team-a', {
      allowed: true,
      pending: true,
      reason: 'Checking…',
    });

    const props = await renderQuotaView();
    const deleteItem = props
      .getCustomContextMenuItems(baseQuota(), 'name')
      .find((item) => item.label === 'Delete');

    expect(deleteItem).toBeUndefined();
  });

  it('includes a namespace column when enabled', async () => {
    await renderQuotaView({ showNamespaceColumn: true });
    expect(getColumn('namespace')).toBeTruthy();
  });
});
