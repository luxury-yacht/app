import { useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTableHeaderActions } from '@shared/components/tables/hooks/useGridTableHeaderActions';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

vi.mock('@shared/components/ContextMenu', () => ({
  default: ({
    items,
    onClose,
  }: {
    items: Array<{
      label?: string;
      divider?: boolean;
      disabled?: boolean;
      onClick?: () => void;
    }>;
    onClose: () => void;
  }) => (
    <div role="menu">
      {items.map((item, index) =>
        item.divider ? (
          <div key={index} data-testid="divider" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        )
      )}
      <button type="button" data-testid="close-menu" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

interface TestRow {
  name: string;
  status: string;
  kind: string;
}

const columns: GridColumnDefinition<TestRow>[] = [
  { key: 'status', header: 'Status', sortable: true, render: (row) => row.status },
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.name },
  { key: 'kind', header: 'Kind', sortable: false, render: (row) => row.kind },
];

interface HarnessProps {
  lockedColumns: Set<string>;
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null };
  onSort?: (key: string, targetDirection?: 'asc' | 'desc' | null) => void;
  applyVisibilityChanges?: (mutator: (next: Record<string, boolean>) => boolean) => void;
  onRefState?: (value: boolean) => void;
}

const HeaderActionsHarness: React.FC<HarnessProps> = ({
  lockedColumns,
  sortConfig,
  onSort,
  applyVisibilityChanges = vi.fn(),
  onRefState,
}) => {
  const contextMenuActiveRef = useRef(false);
  const { renderSortIndicator, handleHeaderClick, handleHeaderContextMenu, headerContextMenuNode } =
    useGridTableHeaderActions<TestRow>({
      columns,
      lockedColumns,
      sortConfig,
      onSort,
      applyVisibilityChanges,
      contextMenuActiveRef,
    });

  onRefState?.(contextMenuActiveRef.current);

  return (
    <>
      <button type="button" data-testid="sort-status" onClick={() => handleHeaderClick(columns[0])}>
        Sort status
      </button>
      <button
        type="button"
        data-testid="open-status-menu"
        onContextMenu={(event) => handleHeaderContextMenu(event, 'status')}
      >
        Open status menu
      </button>
      <button
        type="button"
        data-testid="open-kind-menu"
        onContextMenu={(event) => handleHeaderContextMenu(event, 'kind')}
      >
        Open kind menu
      </button>
      <span data-testid="status-sort-indicator">{renderSortIndicator('status')}</span>
      {headerContextMenuNode}
    </>
  );
};

describe('useGridTableHeaderActions', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
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

  it('handles header sort clicks and renders the active sort indicator', async () => {
    const onSort = vi.fn();
    await act(async () => {
      root.render(
        <HeaderActionsHarness
          lockedColumns={new Set(['name', 'kind'])}
          sortConfig={{ key: 'status', direction: 'asc' }}
          onSort={onSort}
        />
      );
    });

    expect(container.querySelector('[data-testid="status-sort-indicator"]')?.textContent).toBe('↑');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="sort-status"]')?.click();
    });

    expect(onSort).toHaveBeenCalledWith('status');
  });

  it('builds sort and hide actions for sortable hideable headers', async () => {
    const onSort = vi.fn();
    let visibility: Record<string, boolean> = {};
    const applyVisibilityChanges = vi.fn((mutator: (next: Record<string, boolean>) => boolean) => {
      const next = { ...visibility };
      if (mutator(next)) {
        visibility = next;
      }
    });

    await act(async () => {
      root.render(
        <HeaderActionsHarness
          lockedColumns={new Set(['name', 'kind'])}
          onSort={onSort}
          applyVisibilityChanges={applyVisibilityChanges}
        />
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="open-status-menu"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));
    });

    const labels = Array.from(container.querySelectorAll('[role="menuitem"]')).map((item) =>
      item.textContent?.trim()
    );
    expect(labels).toEqual(['Sort Ascending', 'Sort Descending', 'Clear Sort', 'Hide Column']);
    expect(container.querySelectorAll('[data-testid="divider"]')).toHaveLength(1);

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Sort Descending')
        ?.click();
    });
    expect(onSort).toHaveBeenCalledWith('status', 'desc');

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Hide Column')
        ?.click();
    });
    expect(visibility).toEqual({ status: false });
  });

  it('shows no actions for locked non-sortable headers and clears active menu state on close', async () => {
    const refStates: boolean[] = [];
    await act(async () => {
      root.render(
        <HeaderActionsHarness
          lockedColumns={new Set(['name', 'kind'])}
          onRefState={(value) => refStates.push(value)}
        />
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="open-kind-menu"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));
    });

    const onlyItem = container.querySelector<HTMLButtonElement>('[role="menuitem"]');
    expect(onlyItem?.textContent).toBe('No Actions');
    expect(onlyItem?.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="close-menu"]')?.click();
    });
    await act(async () => {
      root.render(
        <HeaderActionsHarness
          lockedColumns={new Set(['name', 'kind'])}
          onRefState={(value) => refStates.push(value)}
        />
      );
    });

    expect(refStates).toContain(true);
    expect(refStates[refStates.length - 1]).toBe(false);
  });
});
