/**
 * frontend/src/modules/namespace/components/NsViewRBAC.test.tsx
 *
 * Test suite for NsViewRBAC.
 * Covers key behaviors and edge cases for NsViewRBAC.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import NsViewRBAC, { type RBACData } from '@modules/namespace/components/NsViewRBAC';

const { gridTablePropsRef, confirmationPropsRef, openWithObjectMock, deleteResourceMock } =
  vi.hoisted(() => ({
    gridTablePropsRef: { current: null as any },
    confirmationPropsRef: { current: null as any },
    openWithObjectMock: vi.fn(),
    deleteResourceMock: vi.fn().mockResolvedValue(undefined),
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
  OpenIcon: () => <span>open</span>,
  DeleteIcon: () => <span>delete</span>,
}));

describe('NsViewRBAC', () => {
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseRBAC = (overrides: Partial<RBACData> = {}): RBACData => ({
    kind: 'Role',
    name: 'view',
    namespace: 'team-a',
    clusterId: 'alpha:ctx',
    rulesCount: 3,
    age: '5h',
    ...overrides,
  });

  const renderRBACView = async (rows: RBACData[] = [baseRBAC()]) => {
    await act(async () => {
      root.render(
        <NsViewRBAC
          namespace="team-a"
          data={rows}
          loading={false}
          loaded={true}
          showNamespaceColumn={true}
        />
      );
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  it('provides open action for RBAC rows', async () => {
    const entry = baseRBAC();
    const props = await renderRBACView([entry]);
    const openItem = props
      .getCustomContextMenuItems(entry, 'name')
      .find((item: any) => item.label === 'Open');
    expect(openItem).toBeTruthy();

    act(() => {
      openItem?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Role',
        name: 'view',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('deletes RBAC entries on confirmation', async () => {
    const entry = baseRBAC();
    const props = await renderRBACView([entry]);

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

    expect(deleteResourceMock).toHaveBeenCalledWith('alpha:ctx', 'Role', 'team-a', 'view');
  });
});
