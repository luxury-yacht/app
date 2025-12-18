import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
    filters: { search: '', kinds: [], namespaces: [] },
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

  it('formats resource quota memory values and usage strings', async () => {
    permissionState.set('ResourceQuota:delete:team-a', { allowed: true, pending: false });
    const quota = baseQuota();
    await renderQuotaView([quota]);

    const resourcesColumn = getColumn('resources');
    expect(resourcesColumn).toBeTruthy();

    const rendered = renderOutputToText(resourcesColumn.render(quota));
    expect(rendered).toContain('CPU: 2');
    expect(rendered).toContain('Memory: 2.0Gi');
    expect(rendered).toContain('Pods: 10');

    const statusColumn = getColumn('status');
    const status = renderOutputToText(statusColumn.render(quota));
    expect(status).toContain('CPU: 1/2');
    expect(status).toContain('Mem: 1.0Gi/2.0Gi');
  });

  it('renders LimitRange and PodDisruptionBudget rows with specialised formatting', async () => {
    const limitRange = baseQuota({
      kind: 'LimitRange',
      name: 'limits',
      limits: [{ type: 'Container' }],
    });
    const pdb = baseQuota({
      kind: 'PodDisruptionBudget',
      name: 'pdb',
      minAvailable: 1,
      used: undefined,
      hard: undefined,
    });

    await renderQuotaView([limitRange, pdb]);
    const resourcesColumn = getColumn('resources');

    const limitMarkup = renderOutputToText(resourcesColumn.render(limitRange));
    expect(limitMarkup).toContain('Container');
    expect(limitMarkup).toContain('class="limit-type"');

    const pdbMarkup = renderOutputToText(resourcesColumn.render(pdb));
    expect(pdbMarkup).toContain('Min Available: 1');
    expect(pdbMarkup).toContain('class="pdb-policy"');
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
