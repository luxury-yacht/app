/**
 * frontend/src/modules/namespace/components/NsViewConfig.test.tsx
 *
 * Test suite for NsViewConfig.
 * Covers key behaviors and edge cases for NsViewConfig.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';
import type { ConfigData } from './NsViewConfig';

type CapturedGridTableProps = GridTableProps<ConfigData> & {
  getCustomContextMenuItems: NonNullable<GridTableProps<ConfigData>['getCustomContextMenuItems']>;
};
type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

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

const objectPanelMock = vi.hoisted(() => ({
  openWithObject: vi.fn(),
}));

const sortHookMock = vi.hoisted(() => ({
  sortedData: [] as ConfigData[],
  sortConfig: { columnKey: 'name', direction: 'asc' as const },
  handleSort: vi.fn(),
}));

const shortNamesMock = vi.hoisted(() => ({
  useShortNames: vi.fn(() => false),
}));

const permissionMapMock = vi.hoisted(() => ({
  map: new Map<string, { allowed: boolean; pending: boolean }>(),
}));

const objectActionMock = vi.hoisted(() => ({
  RunObjectAction: vi.fn(),
}));

const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const getPermissionKeyMock = vi.hoisted(() => ({
  getPermissionKey: vi.fn(
    (kind: string, verb: string, namespace: string) => `${kind}:${verb}:${namespace}`
  ),
}));

const gridTablePropsRef: { current: CapturedGridTableProps } = {
  current: null as unknown as CapturedGridTableProps,
};
const modalPropsRef: { current: ConfirmationProps } = {
  current: null as unknown as ConfirmationProps,
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

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => objectPanelMock,
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: ConfigData[]) => ({
    sortedData: sortHookMock.sortedData.length ? sortHookMock.sortedData : data,
    sortConfig: sortHookMock.sortConfig,
    handleSort: sortHookMock.handleSort,
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
  useShortNames: () => shortNamesMock.useShortNames(),
}));

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: (props: CapturedGridTableProps) => {
    gridTablePropsRef.current = props;
    return <div data-testid="grid-table" />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: 'virtual',
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: ConfirmationProps) => {
    modalPropsRef.current = props;
    const { isOpen } = props;
    if (!isOpen) {
      return null;
    }
    return (
      <div data-testid="confirmation-modal">
        <button type="button" onClick={props.onConfirm}>
          Confirm
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    );
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: objectActionMock.RunObjectAction,
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: getPermissionKeyMock.getPermissionKey,
  useUserPermissions: () => permissionMapMock.map,
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

const createRoot = async (element: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return {
    container,
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
      modalPropsRef.current = null as unknown as ConfirmationProps;
    },
  };
};

const sampleData = [
  {
    kind: 'ConfigMap',
    kindAlias: 'cfg',
    name: 'app-config',
    namespace: 'default',
    clusterId: 'alpha:ctx',
    data: 2,
    age: '1d',
  },
];

describe('NsViewConfig ConfigViewGrid', () => {
  beforeEach(() => {
    objectPanelMock.openWithObject.mockClear();
    sortHookMock.sortedData = [];
    sortHookMock.sortConfig = { columnKey: 'name', direction: 'asc' };
    sortHookMock.handleSort.mockClear();
    shortNamesMock.useShortNames.mockReturnValue(false);
    permissionMapMock.map = new Map();
    objectActionMock.RunObjectAction.mockReset();
    getPermissionKeyMock.getPermissionKey.mockClear();
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    modalPropsRef.current = null as unknown as ConfirmationProps;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('includes delete context menu when permission allows and confirms deletion', async () => {
    permissionMapMock.map = new Map([
      ['ConfigMap:delete:default', { allowed: true, pending: false }],
    ]);
    objectActionMock.RunObjectAction.mockResolvedValue(undefined);

    const module = await import('./NsViewConfig');
    const ConfigView = module.default;

    const { unmount } = await createRoot(
      <ConfigView namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    );

    expect(gridTablePropsRef.current).toBeTruthy();
    const { columns, getCustomContextMenuItems, onSort } = gridTablePropsRef.current;
    expect(columns.map((col) => col.key)).toContain('namespace');

    const resource = sampleData[0];

    columns.forEach((col) => {
      if (typeof col.sortValue === 'function') {
        col.sortValue(resource);
      }
      if (typeof col.render === 'function') {
        const rendered = col.render(resource);
        if (React.isValidElement(rendered)) {
          const element = requireReactElement<{
            onClick?: (event: { stopPropagation: () => void }) => void;
            onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
          }>(rendered, 'expected a configuration cell element');
          element.props.onClick?.({ stopPropagation: () => undefined });
          element.props.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
        }
      }
    });

    const menuItems = getCustomContextMenuItems(resource, 'name');
    expect(menuItems.map((item) => item.actionId)).toContain(OBJECT_ACTION_IDS.viewMap);
    expect(menuItems.map((item) => item.label)).toContain('Delete');
    act(() => {
      requireValue(menuItems[0]?.onClick, 'expected the configuration open action')();
    });
    expect(objectPanelMock.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: resource.kind,
        name: resource.name,
        namespace: resource.namespace,
        clusterId: 'alpha:ctx',
      })
    );

    const objectMapAction = requireValue(
      menuItems.find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap),
      'expected the configuration object-map action'
    );
    act(() => {
      requireValue(objectMapAction.onClick, 'expected the object-map action handler')();
    });
    expect(objectPanelMock.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: resource.kind,
        name: resource.name,
        namespace: resource.namespace,
        clusterId: 'alpha:ctx',
      }),
      { initialTab: 'map' }
    );

    const deleteAction = requireValue(
      menuItems.find((item) => item.label === 'Delete'),
      'expected the configuration delete action'
    );
    await act(async () => {
      requireValue(deleteAction.onClick, 'expected the configuration delete handler')();
    });

    expect(modalPropsRef.current?.isOpen).toBe(true);

    await act(async () => {
      modalPropsRef.current.onConfirm();
    });

    expect(objectActionMock.RunObjectAction).toHaveBeenCalledWith({
      action: 'delete',
      target: {
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
        kind: 'ConfigMap',
        namespace: 'default',
        name: 'app-config',
      },
    });

    requireValue(onSort, 'expected configuration table sort handler')('name', 'desc');

    await unmount();
  });

  it('enables namespace dropdown search when rendering all-namespaces filters', async () => {
    const module = await import('./NsViewConfig');
    const ConfigView = module.default;

    const { unmount } = await createRoot(
      <ConfigView namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    );

    expect(gridTablePropsRef.current?.filters?.options?.showNamespaceDropdown).toBe(true);
    expect(gridTablePropsRef.current?.filters?.options?.namespaceDropdownSearchable).toBe(true);
    expect(gridTablePropsRef.current?.filters?.options?.namespaceDropdownBulkActions).toBe(true);

    await unmount();
  });

  it('falls back to the selected cluster when defensive rows omit clusterId', async () => {
    permissionMapMock.map = new Map([
      ['ConfigMap:delete:default', { allowed: true, pending: false }],
    ]);
    objectActionMock.RunObjectAction.mockResolvedValue(undefined);
    const { clusterId: _clusterId, ...resourceWithoutCluster } = sampleData[0];
    const defensiveResource = resourceWithoutCluster as unknown as (typeof sampleData)[number];

    const module = await import('./NsViewConfig');
    const ConfigView = module.default;

    const { unmount } = await createRoot(<ConfigView namespace="team-a" showNamespaceColumn />);

    const { getCustomContextMenuItems, keyExtractor } = gridTablePropsRef.current;
    expect(keyExtractor(defensiveResource, 0)).toBe('cluster-a|/v1/ConfigMap/default/app-config');

    const menuItems = getCustomContextMenuItems(defensiveResource, 'name');
    const openAction = requireValue(
      menuItems.find((item) => item.actionId === OBJECT_ACTION_IDS.viewDetails),
      'expected the configuration details action'
    );
    act(() => {
      requireValue(openAction.onClick, 'expected the configuration details handler')();
    });
    expect(objectPanelMock.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ConfigMap',
        name: 'app-config',
        namespace: 'default',
        clusterId: 'cluster-a',
      })
    );

    const deleteAction = requireValue(
      menuItems.find((item) => item.label === 'Delete'),
      'expected the configuration delete action'
    );
    await act(async () => {
      requireValue(deleteAction.onClick, 'expected the configuration delete handler')();
    });
    await act(async () => {
      modalPropsRef.current.onConfirm();
    });
    expect(objectActionMock.RunObjectAction).toHaveBeenCalledWith({
      action: 'delete',
      target: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'ConfigMap',
        namespace: 'default',
        name: 'app-config',
      },
    });

    await unmount();
  });

  it('suppresses delete option when permission is denied and handles deletion errors', async () => {
    shortNamesMock.useShortNames.mockReturnValue(true);
    const permissionMap = new Map<string, { allowed: boolean; pending: boolean }>();
    permissionMap.set('ConfigMap:delete:default', { allowed: false, pending: false });
    permissionMapMock.map = permissionMap;
    objectActionMock.RunObjectAction.mockRejectedValue(new Error('boom'));
    errorHandlerMock.handle.mockClear();

    const module = await import('./NsViewConfig');
    const ConfigView = module.default;

    const { unmount } = await createRoot(<ConfigView namespace="team-a" showNamespaceColumn />);

    const { getCustomContextMenuItems } = gridTablePropsRef.current;
    const menuItems = getCustomContextMenuItems(sampleData[0], 'name');
    expect(menuItems.map((item) => item.label)).not.toContain('Delete');

    // Manually trigger delete confirmation state to exercise error branch
    permissionMap.set('ConfigMap:delete:default', { allowed: true, pending: false });
    const menuWithDelete = getCustomContextMenuItems(sampleData[0], 'name');
    const deleteAction = requireValue(
      menuWithDelete.find((item) => item.label === 'Delete'),
      'expected the configuration delete action'
    );

    await act(async () => {
      requireValue(deleteAction.onClick, 'expected the configuration delete handler')();
    });

    await act(async () => {
      modalPropsRef.current.onConfirm();
    });

    expect(objectActionMock.RunObjectAction).toHaveBeenCalledTimes(1);
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'ConfigMap',
      name: 'app-config',
    });

    await unmount();
  });

  it('omits namespace column and skips delete when permission is pending', async () => {
    const permissionMap = new Map<string, { allowed: boolean; pending: boolean }>();
    permissionMap.set('ConfigMap:delete:default', { allowed: true, pending: true });
    permissionMapMock.map = permissionMap;

    const module = await import('./NsViewConfig');
    const ConfigView = module.default;

    const { unmount } = await createRoot(
      <ConfigView namespace="team-a" showNamespaceColumn={false} />
    );

    const { columns, getCustomContextMenuItems } = gridTablePropsRef.current;
    expect(columns.map((col) => col.key)).not.toContain('namespace');

    const menuItems = getCustomContextMenuItems(sampleData[0], 'name');
    expect(menuItems.map((item) => item.label)).not.toContain('Delete');

    await act(async () => {
      modalPropsRef.current?.onConfirm?.();
    });

    await unmount();
  });
});
