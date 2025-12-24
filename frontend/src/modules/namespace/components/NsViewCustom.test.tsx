import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NsViewCustom, { type CustomResourceData } from '@modules/namespace/components/NsViewCustom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));

const gridTableMock = vi.fn();
const modalProps: { current: any } = { current: null };
const openWithObjectMock = vi.fn();
const sortHandlerMock = vi.fn();
const useTableSortMock = vi.fn();
const useShortNamesMock = vi.fn();
const deleteResourceMock = vi.fn();

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: (props: any) => {
    gridTableMock(props);
    return <div data-testid="grid-table" />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: { enabled: true },
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: any) => {
    modalProps.current = props;
    return <div data-testid="confirmation-modal" />;
  },
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: unknown[]) => useTableSortMock(...args),
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
  useShortNames: () => useShortNamesMock(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeleteResource: (...args: unknown[]) => deleteResourceMock(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

const baseResource: CustomResourceData = {
  kind: 'CronJob',
  name: 'nightly-cleanup',
  namespace: 'ops',
  age: '10m',
  labels: { team: 'platform' },
  annotations: { owner: 'ops' },
};

describe('NsViewCustom', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    gridTableMock.mockReset();
    openWithObjectMock.mockReset();
    sortHandlerMock.mockReset();
    deleteResourceMock.mockReset();
    modalProps.current = null;
    useTableSortMock.mockImplementation((data: CustomResourceData[]) => ({
      sortedData: data,
      sortConfig: { key: 'name', direction: 'asc' },
      handleSort: sortHandlerMock,
    }));
    useShortNamesMock.mockReturnValue(false);
    errorHandlerMock.handle.mockClear();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  type NsViewCustomProps = React.ComponentProps<typeof NsViewCustom>;

  const renderComponent = async (props: Partial<NsViewCustomProps> = {}) => {
    const mergedProps: NsViewCustomProps = {
      namespace: 'team-a',
      data: [],
      loading: false,
      loaded: false,
      showNamespaceColumn: false,
      ...props,
    };

    await act(async () => {
      root.render(<NsViewCustom {...mergedProps} />);
      await Promise.resolve();
    });
  };

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('renders GridTable with context menu actions and opens the object panel', async () => {
    await renderComponent({ data: [baseResource], loaded: true, showNamespaceColumn: true });

    expect(gridTableMock).toHaveBeenCalled();

    const gridProps = gridTableMock.mock.calls[0][0];
    expect(gridProps.data).toEqual([baseResource]);
    expect(gridProps.keyExtractor(baseResource)).toBe('ops/CronJob/nightly-cleanup');
    gridProps.onSort?.('name');
    expect(sortHandlerMock).toHaveBeenCalledWith('name');

    const contextItems = gridProps.getCustomContextMenuItems(baseResource, 'kind');
    expect(contextItems[0].label).toBe('Open');
    contextItems[0].onClick();
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CronJob',
        name: 'nightly-cleanup',
        namespace: 'ops',
        age: '10m',
        labels: { team: 'platform' },
        annotations: { owner: 'ops' },
      })
    );

    await act(async () => {
      contextItems[2].onClick();
      await Promise.resolve();
    });
    expect(modalProps.current?.isOpen).toBe(true);
    expect(modalProps.current?.title).toContain('Delete CronJob');
  });

  it('confirms deletion and calls DeleteResource with resolved data', async () => {
    deleteResourceMock.mockResolvedValue(undefined);

    await renderComponent({ data: [baseResource], loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(baseResource, 'kind');
    await act(async () => {
      contextItems[2].onClick();
      await Promise.resolve();
    });
    expect(modalProps.current?.isOpen).toBe(true);

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(deleteResourceMock).toHaveBeenCalledWith('CronJob', 'ops', 'nightly-cleanup');
    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  it('handles delete failure with errorHandler and reverts modal state', async () => {
    deleteResourceMock.mockRejectedValue(new Error('failure'));

    await renderComponent({ data: [baseResource], loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    await act(async () => {
      gridProps.getCustomContextMenuItems(baseResource, 'kind')[2].onClick();
      await Promise.resolve();
    });

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(deleteResourceMock).toHaveBeenCalled();
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'CronJob',
      name: 'nightly-cleanup',
    });

    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  it('adjusts column sizing when short names are enabled', async () => {
    useShortNamesMock.mockReturnValue(true);

    await renderComponent({
      data: [
        {
          ...baseResource,
          kind: undefined,
          kindAlias: 'CR',
        },
      ],
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];

    const generatedKey = gridProps.keyExtractor({
      name: 'svc',
      namespace: 'tools',
      kindAlias: 'CR',
    } as CustomResourceData);
    expect(generatedKey).toBe('tools/CR/svc');
  });
});
