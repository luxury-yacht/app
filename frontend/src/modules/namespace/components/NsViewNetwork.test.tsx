/**
 * frontend/src/modules/namespace/components/NsViewNetwork.test.tsx
 *
 * Test suite for NsViewNetwork.
 * Covers key behaviors and edge cases for NsViewNetwork.
 */

import ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import NsViewNetwork, { type NetworkData } from '@modules/namespace/components/NsViewNetwork';

const {
  gridTablePropsRef,
  confirmationPropsRef,
  openWithObjectMock,
  deleteResourceMock,
  permissionState,
  errorHandlerMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as any },
  confirmationPropsRef: { current: null as any },
  openWithObjectMock: vi.fn(),
  deleteResourceMock: vi.fn().mockResolvedValue(undefined),
  permissionState: new Map<string, { allowed: boolean; pending: boolean }>(),
  errorHandlerMock: { handle: vi.fn() },
}));

const renderOutputToText = (output: any): string => {
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

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return (
        <table data-testid="grid-table">
          <tbody>
            {props.data.map((row: any, index: number) => (
              <tr key={index}>
                <td>{row.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@components/modals/ConfirmationModal', () => ({
  default: (props: any) => {
    confirmationPropsRef.current = props;
    return null;
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeleteResource: (...args: unknown[]) => deleteResourceMock(...args),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: any) => children,
}));

vi.mock('@shared/components/icons/MenuIcons', () => ({
  DeleteIcon: () => <span>delete</span>,
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, action: string, namespace: string) =>
    `${kind}:${action}:${namespace}`,
  useUserPermissions: () => permissionState,
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => {
  const state = { columnWidths: {} as Record<string, any> };
  return {
    useNamespaceGridTablePersistence: () => ({
      sortConfig: { key: 'name', direction: 'asc' },
      onSortChange: vi.fn(),
      columnWidths: state.columnWidths,
      setColumnWidths: (next: any) => {
        state.columnWidths = next;
        if (gridTablePropsRef.current) {
          gridTablePropsRef.current = { ...gridTablePropsRef.current, columnWidths: next };
        }
      },
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: { search: '', kinds: [], namespaces: [] },
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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    confirmationPropsRef.current = null;
    openWithObjectMock.mockReset();
    deleteResourceMock.mockReset();
    permissionState.clear();
    errorHandlerMock.handle.mockClear();
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
    rows: NetworkData[] = [baseNetwork()],
    overrides: Partial<React.ComponentProps<typeof NsViewNetwork>> = {}
  ) => {
    await act(async () => {
      root.render(
        <NsViewNetwork
          namespace="team-a"
          data={rows}
          loading={false}
          loaded={true}
          showNamespaceColumn={true}
          {...overrides}
        />
      );
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  const getColumn = (key: string) =>
    gridTablePropsRef.current.columns.find((column: any) => column.key === key);

  it('opens object panel through context menu', async () => {
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const entry = baseNetwork();
    const props = await renderNetworkView([entry]);

    expect(props.data).toHaveLength(1);
    const menu = props.getCustomContextMenuItems(entry, 'name');
    const openItem = menu.find((item: any) => item.label === 'Open');
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'Ingress',
      name: 'web-gateway',
      namespace: 'team-a',
    });
  });

  it('gates delete option on permissions and confirms deletion', async () => {
    const entry = baseNetwork();
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const props = await renderNetworkView([entry]);

    const menu = props.getCustomContextMenuItems(entry, 'name');
    const deleteItem = menu.find((item: any) => item.label === 'Delete');
    expect(deleteItem).toBeTruthy();

    act(() => {
      deleteItem?.onClick?.();
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(true);

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(deleteResourceMock).toHaveBeenCalledWith(
      'alpha:ctx',
      'Ingress',
      'team-a',
      'web-gateway'
    );
  });

  it('hides delete action while permission is pending', async () => {
    const entry = baseNetwork();
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: true });
    const props = await renderNetworkView([entry]);

    const menu = props.getCustomContextMenuItems(entry, 'name');
    const deleteItem = menu.find((item: any) => item.label === 'Delete');
    expect(deleteItem).toBeUndefined();
  });

  it('omits delete option entirely when permission is denied', async () => {
    const entry = baseNetwork();
    // Simulate denied capability by not registering key
    const props = await renderNetworkView([entry]);
    const menu = props.getCustomContextMenuItems(entry, 'name');
    const deleteItem = menu.find((item: any) => item.label === 'Delete');
    expect(deleteItem).toBeUndefined();
  });

  it('renders details column with styling when text present', async () => {
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const entry = baseNetwork({ details: 'Hosts: example.com' });
    await renderNetworkView([entry]);
    const detailsColumn = getColumn('details');
    const rendered = detailsColumn.render(entry);
    expect(renderOutputToText(rendered)).toContain('Hosts: example.com');
    expect(rendered.props.className).toContain('network-details');
  });

  it('handles delete failure with errorHandler', async () => {
    deleteResourceMock.mockRejectedValueOnce(new Error('boom'));
    permissionState.set('Ingress:delete:team-a', { allowed: true, pending: false });
    const entry = baseNetwork();
    const props = await renderNetworkView([entry]);
    const deleteItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item: any) => item.label === 'Delete');

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
