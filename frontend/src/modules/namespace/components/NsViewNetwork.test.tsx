/**
 * frontend/src/modules/namespace/components/NsViewNetwork.test.tsx
 *
 * Test suite for NsViewNetwork.
 * Covers key behaviors and edge cases for NsViewNetwork.
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

import NsViewNetwork, { type NetworkData } from '@modules/namespace/components/NsViewNetwork';

type CapturedGridTableProps = GridTableProps<NetworkData> & {
  getCustomContextMenuItems: NonNullable<GridTableProps<NetworkData>['getCustomContextMenuItems']>;
};
type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

const {
  gridTablePropsRef,
  confirmationPropsRef,
  openWithObjectMock,
  runObjectActionMock,
  permissionState,
  errorHandlerMock,
  requestRefreshDomainStateMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as unknown as CapturedGridTableProps },
  confirmationPropsRef: { current: null as unknown as ConfirmationProps },
  openWithObjectMock: vi.fn(),
  runObjectActionMock: vi.fn().mockResolvedValue(undefined),
  permissionState: new Map<string, { allowed: boolean; pending: boolean }>(),
  errorHandlerMock: { handle: vi.fn() },
  requestRefreshDomainStateMock: vi.fn(),
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
  useTableSort: (data: NetworkData[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

// Single-namespace network tables are query-backed now, so the table renders the typed query rows.
// Mock the typed-query data path (and its readiness gates) so the query can settle in tests.
vi.mock('@/core/data-access', () => ({
  requestRefreshDomainState: (...args: unknown[]) => requestRefreshDomainStateMock(...args),
  useScopedRefreshDomainLifecycle: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: () => ({
    status: 'ready',
    data: { rows: [] },
    stats: null,
    version: 1,
    checksum: '',
    lastUpdated: 1,
    droppedAutoRefreshes: 0,
  }),
  refreshManager: { triggerManualRefresh: vi.fn() },
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    storageKey: 'gridtable:v1:cluster-a:namespace-network',
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: {
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
      includeMetadata: false,
    },
    setFilters: vi.fn(),
    pageSize: null,
    setPageSize: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
  }),
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
  getPermissionKey: (kind: string, action: string, namespace: string) =>
    `${kind}:${action}:${namespace}`,
  useUserPermissions: () => permissionState,
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => {
  const state = { columnWidths: {} as NonNullable<CapturedGridTableProps['columnWidths']> };
  return {
    useNamespaceGridTablePersistence: () => ({
      sortConfig: { key: 'name', direction: 'asc' },
      onSortChange: vi.fn(),
      columnWidths: state.columnWidths,
      setColumnWidths: (next: NonNullable<CapturedGridTableProps['columnWidths']>) => {
        state.columnWidths = next;
        if (gridTablePropsRef.current) {
          gridTablePropsRef.current = { ...gridTablePropsRef.current, columnWidths: next };
        }
      },
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
      setFilters: vi.fn(),
      isNamespaceScoped: true,
      resetState: vi.fn(),
    }),
  };
});

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

describe('NsViewNetwork', () => {
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
    requestRefreshDomainStateMock.mockReset();
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [],
          total: 0,
          totalIsExact: true,
          namespaces: ['team-a', 'team-b'],
          kinds: ['Ingress'],
          facetsExact: true,
        },
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseNetwork = (overrides: Partial<NetworkData> = {}): NetworkData => ({
    kind: 'Ingress',
    kindAlias: 'Ingress',
    name: 'web-gateway',
    namespace: 'team-a',
    clusterId: 'alpha:ctx',
    details: 'Hosts: web.example.com',
    age: '3h',
    ...overrides,
  });

  const renderNetworkView = async (
    overrides: Partial<React.ComponentProps<typeof NsViewNetwork>> = {}
  ) => {
    await act(async () => {
      root.render(<NsViewNetwork namespace="team-a" showNamespaceColumn={true} {...overrides} />);
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  const getColumn = (key: string) =>
    requireValue(
      gridTablePropsRef.current.columns.find((column) => column.key === key),
      `expected the network ${key} column`
    );

  it('opens object panel through context menu', async () => {
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const entry = baseNetwork();
    // Query-backed single-namespace table: feed the typed query the row so it renders in the table.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [entry],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Ingress'],
          facetsExact: true,
        },
      },
    });
    const props = await renderNetworkView();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toHaveLength(1);
    const menu = props.getCustomContextMenuItems(entry, 'name');
    const openItem = menu.find((item) => item.actionId === OBJECT_ACTION_IDS.viewDetails);
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Ingress',
        name: 'web-gateway',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it.each([
    ['Ingress', 'networking.k8s.io', 'v1'],
    ['Service', '', 'v1'],
    ['EndpointSlice', 'discovery.k8s.io', 'v1'],
  ])('opens the Map from %s context menu', async (kind, group, version) => {
    const entry = baseNetwork({
      kind,
      kindAlias: kind,
      name: `${kind.toLowerCase()}-object`,
    });
    const props = await renderNetworkView();

    const menu = props.getCustomContextMenuItems(entry, 'name');
    const objectMapItem = menu.find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap);
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind,
        name: `${kind.toLowerCase()}-object`,
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group,
        version,
      }),
      { initialTab: 'map' }
    );
  });

  it('gates delete option on permissions and confirms deletion', async () => {
    const entry = baseNetwork();
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const props = await renderNetworkView();

    const menu = props.getCustomContextMenuItems(entry, 'name');
    const deleteItem = menu.find((item) => item.label === 'Delete');
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
        group: 'networking.k8s.io',
        version: 'v1',
        kind: 'Ingress',
        namespace: 'team-a',
        name: 'web-gateway',
      },
    });
  });

  it('hides delete action while permission is pending', async () => {
    const entry = baseNetwork();
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: true });
    const props = await renderNetworkView();

    const menu = props.getCustomContextMenuItems(entry, 'name');
    const deleteItem = menu.find((item) => item.label === 'Delete');
    expect(deleteItem).toBeUndefined();
  });

  it('omits delete option entirely when permission is denied', async () => {
    const entry = baseNetwork();
    // Simulate denied capability by not registering key
    const props = await renderNetworkView();
    const menu = props.getCustomContextMenuItems(entry, 'name');
    const deleteItem = menu.find((item) => item.label === 'Delete');
    expect(deleteItem).toBeUndefined();
  });

  it('renders details column with styling when text present', async () => {
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const entry = baseNetwork({ details: 'Hosts: example.com' });
    await renderNetworkView();
    const detailsColumn = getColumn('details');
    const rendered = requireReactElement<{ className?: string }>(
      detailsColumn.render(entry),
      'expected the network details cell element'
    );
    expect(renderOutputToText(rendered)).toContain('Hosts: example.com');
    expect(rendered.props.className).toContain('network-details');
  });

  it('handles delete failure with errorHandler', async () => {
    runObjectActionMock.mockRejectedValueOnce(new Error('boom'));
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const entry = baseNetwork();
    const props = await renderNetworkView();
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
      kind: 'Ingress',
      name: 'web-gateway',
    });
  });
});
