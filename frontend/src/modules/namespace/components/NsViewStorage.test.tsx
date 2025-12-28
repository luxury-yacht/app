/**
 * frontend/src/modules/namespace/components/NsViewStorage.test.tsx
 *
 * Test suite for NsViewStorage.
 * Covers key behaviors and edge cases for NsViewStorage.
 */

import ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import NsViewStorage, { type StorageData } from '@modules/namespace/components/NsViewStorage';

const {
  gridTablePropsRef,
  confirmationPropsRef,
  openWithObjectMock,
  deleteResourceMock,
  errorHandlerMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as any },
  confirmationPropsRef: { current: null as any },
  openWithObjectMock: vi.fn(),
  deleteResourceMock: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

describe('NsViewStorage', () => {
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
    status: 'Bound',
    capacity: '10Gi',
    storageClass: 'fast-ssd',
    age: '4h',
    ...overrides,
  });

  const renderStorageView = async (
    rows: StorageData[] = [baseStorage()],
    overrides: Partial<React.ComponentProps<typeof NsViewStorage>> = {}
  ) => {
    await act(async () => {
      root.render(
        <NsViewStorage
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

  const getColumn = (key: string) => {
    const props = gridTablePropsRef.current;
    return props?.columns?.find((column: any) => column.key === key);
  };

  it('invokes object panel for resource actions', async () => {
    const entry = baseStorage();
    const props = await renderStorageView([entry]);

    const menu = props.getCustomContextMenuItems(entry, 'name');
    const openItem = menu.find((item: any) => item.label === 'Open');
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'PersistentVolumeClaim',
      name: 'pvc-data',
      namespace: 'team-a',
    });
  });

  it('exposes delete action and calls backend on confirmation', async () => {
    const entry = baseStorage();
    const props = await renderStorageView([entry]);

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
    expect(deleteResourceMock).toHaveBeenCalledWith('PersistentVolumeClaim', 'team-a', 'pvc-data');
  });

  it('navigates to storage class when storage column is activated', async () => {
    const entry = baseStorage();
    const props = await renderStorageView([entry]);

    const storageColumn = props.columns.find((column: any) => column.key === 'storageClass');
    expect(storageColumn).toBeTruthy();

    const renderedCell = storageColumn.render(entry);
    expect(renderedCell.props.className).toContain('storage-class-link');

    act(() => {
      renderedCell.props.onClick({ stopPropagation: () => {} });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'StorageClass',
      name: 'fast-ssd',
    });
  });

  it('applies status and capacity classes based on resource state', async () => {
    const pending = baseStorage({ status: 'Pending', capacity: '' });
    const failed = baseStorage({ status: 'Failed', capacity: undefined });
    await renderStorageView([pending, failed], { showNamespaceColumn: true });

    const statusColumn = getColumn('status');
    expect(statusColumn).toBeTruthy();
    const capacityColumn = getColumn('capacity');
    expect(capacityColumn).toBeTruthy();

    const pendingStatus = statusColumn.render(pending);
    const failedStatus = statusColumn.render(failed);
    expect(renderOutputToText(pendingStatus)).toContain('Pending');
    expect(pendingStatus.props.className).toContain('pending');
    expect(failedStatus.props.className).toContain('error');

    const capacityFilled = capacityColumn.render(baseStorage());
    expect(capacityFilled.props.className).toContain('capacity');

    const noCapacity = capacityColumn.render(pending);
    expect(typeof noCapacity).toBe('string');
  });

  it('renders default storage class when absent without triggering navigation', async () => {
    const entry = baseStorage({ storageClass: undefined });
    await renderStorageView([entry]);
    const storageColumn = getColumn('storageClass');
    const renderedCell = storageColumn.render(entry);

    expect(renderOutputToText(renderedCell)).toContain('default');
    expect(renderedCell.props.className).toContain('default-class');

    act(() => {
      renderedCell.props.onClick?.({ stopPropagation: () => {} });
    });
    expect(openWithObjectMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'StorageClass' })
    );
  });

  it('handles delete failure with errorHandler', async () => {
    deleteResourceMock.mockRejectedValueOnce(new Error('boom'));
    const entry = baseStorage();
    const props = await renderStorageView([entry]);
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
      kind: 'PersistentVolumeClaim',
      name: 'pvc-data',
    });
  });
});
