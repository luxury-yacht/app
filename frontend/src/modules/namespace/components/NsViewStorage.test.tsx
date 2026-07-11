/**
 * frontend/src/modules/namespace/components/NsViewStorage.test.tsx
 *
 * Test suite for NsViewStorage.
 * Covers key behaviors and edge cases for NsViewStorage.
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

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

import NsViewStorage, { type StorageData } from '@modules/namespace/components/NsViewStorage';

type CapturedGridTableProps = GridTableProps<StorageData> & {
  getCustomContextMenuItems: NonNullable<GridTableProps<StorageData>['getCustomContextMenuItems']>;
};
type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

const {
  gridTablePropsRef,
  confirmationPropsRef,
  openWithObjectMock,
  runObjectActionMock,
  errorHandlerMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as unknown as CapturedGridTableProps },
  confirmationPropsRef: { current: null as unknown as ConfirmationProps },
  openWithObjectMock: vi.fn(),
  runObjectActionMock: vi.fn().mockResolvedValue(undefined),
  errorHandlerMock: { handle: vi.fn() },
}));

const renderOutputToText = (output: React.ReactNode): string => {
  if (typeof output === 'string') {
    return output;
  }
  if (Array.isArray(output)) {
    return output.map(renderOutputToText).join('');
  }
  if (output === null || output === undefined) {
    return '';
  }
  return renderToStaticMarkup(output);
};

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
  useTableSort: (data: StorageData[]) => ({
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

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () =>
    new Map([
      ['PersistentVolumeClaim:delete', { allowed: true, pending: false }],
      ['VolumeAttachment:delete', { allowed: true, pending: false }],
    ]),
  getPermissionKey: (kind: string, action: string) => `${kind}:${action}`,
}));

describe('NsViewStorage', () => {
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
    errorHandlerMock.handle.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseStorage = (overrides: Partial<StorageData> = {}): StorageData => ({
    kind: 'PersistentVolumeClaim',
    name: 'pvc-data',
    namespace: 'team-a',
    clusterId: 'alpha:ctx',
    status: 'Bound',
    statusState: 'Bound',
    statusPresentation: 'ready',
    capacity: '10Gi',
    storageClass: 'fast-ssd',
    age: '4h',
    ...overrides,
  });

  const renderStorageView = async (
    overrides: Partial<React.ComponentProps<typeof NsViewStorage>> = {}
  ) => {
    await act(async () => {
      root.render(<NsViewStorage namespace="team-a" showNamespaceColumn={true} {...overrides} />);
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  const getColumn = (key: string) => {
    const props = gridTablePropsRef.current;
    return requireValue(
      props.columns.find((column) => column.key === key),
      `expected the storage ${key} column`
    );
  };

  it('invokes object panel for resource actions', async () => {
    const entry = baseStorage();
    const props = await renderStorageView();

    const menu = props.getCustomContextMenuItems(entry, 'name');
    const openItem = menu.find((item) => item.actionId === OBJECT_ACTION_IDS.viewDetails);
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PersistentVolumeClaim',
        name: 'pvc-data',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
      })
    );

    const objectMapItem = menu.find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap);
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PersistentVolumeClaim',
        name: 'pvc-data',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
  });

  it('leaves the kind options to the backend-published vocabulary (no frontend list)', async () => {
    const props = await renderStorageView({ namespace: 'team-a' });
    // No query payload applies in this harness, so there is no vocabulary yet
    // (only the empty row-derived fallback): the kind options come ONLY from
    // the backend capabilities on the payload (see the NsViewWorkloads
    // end-to-end pin), never from a frontend constant.
    expect(props.filters?.options?.kinds).toEqual([]);
  });

  it('uses canonical object identity for row keys', async () => {
    const entry = baseStorage();
    const props = await renderStorageView();

    expect(props.keyExtractor(entry, 0)).toBe(
      'alpha:ctx|/v1/PersistentVolumeClaim/team-a/pvc-data'
    );
  });

  it('exposes delete action and calls backend on confirmation', async () => {
    const entry = baseStorage();
    const props = await renderStorageView();

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
        kind: 'PersistentVolumeClaim',
        namespace: 'team-a',
        name: 'pvc-data',
      },
    });
  });

  it('navigates to storage class when storage column is activated', async () => {
    const entry = baseStorage();
    const props = await renderStorageView();

    const storageColumn = requireValue(
      props.columns.find((column) => column.key === 'storageClass'),
      'expected the storage-class column'
    );

    const renderedCell = requireReactElement<{
      className?: string;
      onClick: (event: { stopPropagation: () => void }) => void;
    }>(storageColumn.render(entry), 'expected the storage-class cell element');
    expect(renderedCell.props.className).toContain('storage-class-link');

    act(() => {
      renderedCell.props.onClick({ stopPropagation: () => undefined });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'StorageClass',
        name: 'fast-ssd',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('falls back to the selected cluster for defensive rows without clusterId', async () => {
    const { clusterId: _clusterId, ...entryWithoutCluster } = baseStorage();
    const entry = entryWithoutCluster as unknown as StorageData;
    const props = await renderStorageView();

    expect(props.keyExtractor(entry, 0)).toBe(
      'cluster-a|/v1/PersistentVolumeClaim/team-a/pvc-data'
    );

    const storageColumn = requireValue(
      props.columns.find((column) => column.key === 'storageClass'),
      'expected the storage-class column'
    );
    const renderedCell = requireReactElement<{
      onClick: (event: { stopPropagation: () => void }) => void;
    }>(storageColumn.render(entry), 'expected the storage-class cell element');

    act(() => {
      renderedCell.props.onClick({ stopPropagation: () => undefined });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'StorageClass',
        name: 'fast-ssd',
        clusterId: 'cluster-a',
      })
    );
  });

  it('applies status and capacity classes based on resource state', async () => {
    const pending = baseStorage({
      status: 'Pending',
      statusState: 'Pending',
      statusPresentation: 'warning',
      capacity: '',
    });
    const failed = baseStorage({
      status: 'Lost',
      statusState: 'Lost',
      statusPresentation: 'error',
      capacity: undefined,
    });
    await renderStorageView({ showNamespaceColumn: true });

    const statusColumn = getColumn('status');
    expect(statusColumn).toBeTruthy();
    const capacityColumn = getColumn('capacity');
    expect(capacityColumn).toBeTruthy();

    const pendingStatus = requireReactElement<{ className?: string }>(
      statusColumn.render(pending),
      'expected the pending storage status element'
    );
    const failedStatus = requireReactElement<{ className?: string }>(
      statusColumn.render(failed),
      'expected the failed storage status element'
    );
    expect(renderOutputToText(pendingStatus)).toContain('Pending');
    expect(pendingStatus.props.className).toContain('warning');
    expect(failedStatus.props.className).toContain('error');

    const capacityFilled = requireReactElement<{ className?: string }>(
      capacityColumn.render(baseStorage()),
      'expected the storage capacity element'
    );
    expect(capacityFilled.props.className).toContain('capacity');

    const noCapacity = capacityColumn.render(pending);
    expect(typeof noCapacity).toBe('string');
  });

  it('renders default storage class when absent without triggering navigation', async () => {
    const entry = baseStorage({ storageClass: undefined });
    await renderStorageView();
    const storageColumn = getColumn('storageClass');
    const renderedCell = requireReactElement<{
      className?: string;
      onClick?: (event: { stopPropagation: () => void }) => void;
    }>(storageColumn.render(entry), 'expected the default storage-class cell element');

    expect(renderOutputToText(renderedCell)).toContain('default');
    expect(renderedCell.props.className).toContain('default-class');

    act(() => {
      renderedCell.props.onClick?.({ stopPropagation: () => undefined });
    });
    expect(openWithObjectMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'StorageClass' })
    );
  });

  it('handles delete failure with errorHandler', async () => {
    runObjectActionMock.mockRejectedValueOnce(new Error('boom'));
    const entry = baseStorage();
    const props = await renderStorageView();
    const deleteItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item) => item.label === 'Delete');

    act(() => {
      deleteItem?.onClick?.();
    });

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'PersistentVolumeClaim',
      name: 'pvc-data',
    });
  });
});
