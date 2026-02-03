/**
 * frontend/src/modules/namespace/components/NsViewConfig.test.tsx
 *
 * Test suite for NsViewConfig.
 * Covers key behaviors and edge cases for NsViewConfig.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const objectPanelMock = vi.hoisted(() => ({
  openWithObject: vi.fn(),
}));

const sortHookMock = vi.hoisted(() => ({
  sortedData: [] as any[],
  sortConfig: { columnKey: 'name', direction: 'asc' as const },
  handleSort: vi.fn(),
}));

const shortNamesMock = vi.hoisted(() => ({
  useShortNames: vi.fn(() => false),
}));

const permissionMapMock = vi.hoisted(() => ({
  map: new Map<string, { allowed: boolean; pending: boolean }>(),
}));

const deleteResourceMock = vi.hoisted(() => ({
  DeleteResource: vi.fn(),
}));

const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const getPermissionKeyMock = vi.hoisted(() => ({
  getPermissionKey: vi.fn(
    (kind: string, verb: string, namespace: string) => `${kind}:${verb}:${namespace}`
  ),
}));

const gridTablePropsRef: { current: any } = { current: null };
const modalPropsRef: { current: any } = { current: null };

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => objectPanelMock,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown) => ({
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
    filters: { search: '', kinds: [], namespaces: [] },
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
  default: (props: unknown) => {
    gridTablePropsRef.current = props;
    return <div data-testid="grid-table" />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: 'virtual',
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: unknown) => {
    modalPropsRef.current = props;
    const { isOpen } = props as { isOpen: boolean };
    if (!isOpen) {
      return null;
    }
    return (
      <div data-testid="confirmation-modal">
        <button onClick={() => (props as any).onConfirm?.()}>Confirm</button>
        <button onClick={() => (props as any).onCancel?.()}>Cancel</button>
      </div>
    );
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeleteResource: deleteResourceMock.DeleteResource,
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: getPermissionKeyMock.getPermissionKey,
  useUserPermissions: () => permissionMapMock.map,
}));

vi.mock('@shared/components/icons/MenuIcons', () => ({
  OpenIcon: () => <span>open</span>,
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
      gridTablePropsRef.current = null;
      modalPropsRef.current = null;
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
    deleteResourceMock.DeleteResource.mockReset();
    getPermissionKeyMock.getPermissionKey.mockClear();
    gridTablePropsRef.current = null;
    modalPropsRef.current = null;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('includes delete context menu when permission allows and confirms deletion', async () => {
    permissionMapMock.map = new Map([
      ['ConfigMap:delete:default', { allowed: true, pending: false }],
    ]);
    deleteResourceMock.DeleteResource.mockResolvedValue(undefined);

    const module = await import('./NsViewConfig');
    const ConfigView = module.default;

    const { unmount } = await createRoot(
      <ConfigView namespace="team-a" data={sampleData} loaded loading={false} showNamespaceColumn />
    );

    expect(gridTablePropsRef.current).toBeTruthy();
    const { columns, getCustomContextMenuItems, onSort } = gridTablePropsRef.current;
    expect(columns.map((col: any) => col.key)).toContain('namespace');

    const resource = sampleData[0];

    columns.forEach((col: any) => {
      if (typeof col.sortValue === 'function') {
        col.sortValue(resource);
      }
      if (typeof col.render === 'function') {
        const element = col.render(resource) as any;
        if (element && element.props) {
          element.props.onClick?.({ stopPropagation() {} } as any);
          element.props.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() } as any);
        }
      }
    });

    const menuItems = getCustomContextMenuItems(resource, 'name');
    expect(menuItems.map((item: any) => item.label)).toContain('Delete');
    act(() => {
      menuItems[0].onClick();
    });
    expect(objectPanelMock.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: resource.kind,
        name: resource.name,
        namespace: resource.namespace,
        clusterId: 'alpha:ctx',
      })
    );

    const deleteAction = menuItems.find((item: any) => item.label === 'Delete');
    await act(async () => {
      deleteAction.onClick();
    });

    expect(modalPropsRef.current?.isOpen).toBe(true);

    await act(async () => {
      modalPropsRef.current.onConfirm();
    });

    expect(deleteResourceMock.DeleteResource).toHaveBeenCalledWith(
      'alpha:ctx',
      'ConfigMap',
      'default',
      'app-config'
    );

    onSort('name', 'desc');

    await unmount();
  });

  it('suppresses delete option when permission is denied and handles deletion errors', async () => {
    shortNamesMock.useShortNames.mockReturnValue(true);
    const permissionMap = new Map<string, { allowed: boolean; pending: boolean }>();
    permissionMap.set('ConfigMap:delete:default', { allowed: false, pending: false });
    permissionMapMock.map = permissionMap;
    deleteResourceMock.DeleteResource.mockRejectedValue(new Error('boom'));
    errorHandlerMock.handle.mockClear();

    const module = await import('./NsViewConfig');
    const ConfigView = module.default;

    const { unmount } = await createRoot(
      <ConfigView namespace="team-a" data={sampleData} loading={false} loaded showNamespaceColumn />
    );

    const { getCustomContextMenuItems } = gridTablePropsRef.current;
    const menuItems = getCustomContextMenuItems(sampleData[0], 'name');
    expect(menuItems.map((item: any) => item.label)).not.toContain('Delete');

    // Manually trigger delete confirmation state to exercise error branch
    permissionMap.set('ConfigMap:delete:default', { allowed: true, pending: false });
    const menuWithDelete = getCustomContextMenuItems(sampleData[0], 'name');
    const deleteAction = menuWithDelete.find((item: any) => item.label === 'Delete');

    await act(async () => {
      deleteAction.onClick();
    });

    await act(async () => {
      modalPropsRef.current.onConfirm();
    });

    expect(deleteResourceMock.DeleteResource).toHaveBeenCalledTimes(1);
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
      <ConfigView
        namespace="team-a"
        data={sampleData}
        loaded
        loading={false}
        showNamespaceColumn={false}
      />
    );

    const { columns, getCustomContextMenuItems } = gridTablePropsRef.current;
    expect(columns.map((col: any) => col.key)).not.toContain('namespace');

    const menuItems = getCustomContextMenuItems(sampleData[0], 'name');
    expect(menuItems.map((item: any) => item.label)).not.toContain('Delete');

    await act(async () => {
      modalPropsRef.current?.onConfirm?.();
    });

    await unmount();
  });
});
