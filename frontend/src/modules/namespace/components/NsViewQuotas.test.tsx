/**
 * frontend/src/modules/namespace/components/NsViewQuotas.test.tsx
 *
 * Test suite for NsViewQuotas.
 * Covers key behaviors and edge cases for NsViewQuotas.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import NsViewQuotas, { type QuotaData } from '@modules/namespace/components/NsViewQuotas';

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
  permissionState: new Map<
    string,
    { allowed: boolean; pending: boolean; reason?: string; error?: string }
  >(),
  errorHandlerMock: { handle: vi.fn() },
}));

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

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    onSortChange: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], clusters: [] },
    setFilters: vi.fn(),
    isNamespaceScoped: true,
    resetState: vi.fn(),
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

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

describe('NsViewQuotas', () => {
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

  const baseQuota = (overrides: Partial<QuotaData> = {}): QuotaData => ({
    kind: 'ResourceQuota',
    name: 'rq-default',
    namespace: 'team-a',
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
    rows: QuotaData[] = [baseQuota()],
    overrides: Partial<React.ComponentProps<typeof NsViewQuotas>> = {}
  ) => {
    await act(async () => {
      root.render(
        <NsViewQuotas
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

  it('opens quota resources through context menu', async () => {
    permissionState.set('ResourceQuota:delete:team-a', { allowed: true, pending: false });
    const entry = baseQuota();
    const props = await renderQuotaView([entry]);

    const items = props.getCustomContextMenuItems(entry, 'name');
    const openItem = items.find((item: any) => item.label === 'Open');
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'ResourceQuota',
      name: 'rq-default',
      namespace: 'team-a',
    });
  });

  it('omits Resources, Status, and Scope columns', async () => {
    await renderQuotaView([baseQuota()]);
    expect(getColumn('resources')).toBeUndefined();
    expect(getColumn('status')).toBeUndefined();
    expect(getColumn('scope')).toBeUndefined();
  });

  it('shows delete option, confirms and handles backend success', async () => {
    permissionState.set('ResourceQuota:delete:team-a', { allowed: true, pending: false });
    const entry = baseQuota();
    const props = await renderQuotaView([entry]);

    const deleteItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item: any) => item.label === 'Delete');
    expect(deleteItem).toBeTruthy();

    act(() => {
      deleteItem?.onClick?.();
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(true);

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });
    expect(deleteResourceMock).toHaveBeenCalledWith('ResourceQuota', 'team-a', 'rq-default');
  });

  it('handles delete failure with errorHandler', async () => {
    deleteResourceMock.mockRejectedValueOnce(new Error('boom'));
    permissionState.set('ResourceQuota:delete:team-a', { allowed: true, pending: false });

    const entry = baseQuota();
    const props = await renderQuotaView([entry]);
    const deleteItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item: any) => item.label === 'Delete');
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
      .find((item: any) => item.label === 'Delete');

    expect(deleteItem).toBeUndefined();
  });

  it('includes a namespace column when enabled', async () => {
    await renderQuotaView(undefined, { showNamespaceColumn: true });
    expect(getColumn('namespace')).toBeTruthy();
  });
});
