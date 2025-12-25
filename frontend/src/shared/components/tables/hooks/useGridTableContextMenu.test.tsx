/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenu.test.tsx
 *
 * Test suite for useGridTableContextMenu.
 * Covers key behaviors and edge cases for useGridTableContextMenu.
 */

import React, { forwardRef, useImperativeHandle } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import {
  useGridTableContextMenu,
  type GridTableContextMenuState,
} from '@shared/components/tables/hooks/useGridTableContextMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SampleRow = { id: string; name: string };

const columns: GridColumnDefinition<SampleRow>[] = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    render: (row) => row.name,
  },
  {
    key: 'id',
    header: 'ID',
    render: (row) => row.id,
  },
];

const buildMouseEvent = (
  overrides?: Partial<
    Pick<React.MouseEvent, 'ctrlKey' | 'metaKey' | 'target' | 'clientX' | 'clientY'>
  >
): React.MouseEvent =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clientX: overrides?.clientX ?? 12,
    clientY: overrides?.clientY ?? 24,
    ctrlKey: overrides?.ctrlKey ?? false,
    metaKey: overrides?.metaKey ?? false,
    target: overrides?.target,
  }) as unknown as React.MouseEvent;

interface HarnessHandle {
  openCellMenu: (opts?: { enable?: boolean }) => boolean;
  openCellMenuViaKeyboard: (element?: HTMLElement) => boolean;
  openWrapperMenu: (opts?: { enable?: boolean; classList?: string[] }) => boolean;
  getContextMenu: () => GridTableContextMenuState<SampleRow> | null;
  close: () => void;
}

interface HarnessProps {
  enableContextMenu?: boolean;
  wrapperItems?: ContextMenuItem[];
}

const Harness = forwardRef<HarnessHandle, HarnessProps>(
  ({ enableContextMenu = true, wrapperItems }, ref) => {
    const contextMenu = useGridTableContextMenu<SampleRow>({
      enableContextMenu,
      columns,
      getCustomContextMenuItems: (item, columnKey) => [
        { label: `Inspect ${columnKey}`, onClick: vi.fn() },
        { label: `Select ${item.name}`, onClick: vi.fn() },
      ],
      getContextMenuItems: (columnKey, item, source) => {
        if (source === 'empty') {
          return wrapperItems ?? [];
        }
        return item
          ? [{ label: `Sort ${columnKey}`, onClick: vi.fn() }]
          : [{ label: 'noop', onClick: vi.fn() }];
      },
      onSort: vi.fn(),
    });

    useImperativeHandle(
      ref,
      () => ({
        openCellMenu(opts) {
          const event = buildMouseEvent({ ctrlKey: opts?.enable === false });
          return contextMenu.openCellContextMenu(event, 'name', { id: '1', name: 'Row 1' });
        },
        openCellMenuViaKeyboard(element?: HTMLElement) {
          return contextMenu.openCellContextMenuFromKeyboard(
            'name',
            { id: '1', name: 'Row 1' },
            element
          );
        },
        openWrapperMenu(opts) {
          const target = document.createElement('div');
          target.classList.add('gridtable-wrapper');
          opts?.classList?.forEach((cls) => target.classList.add(cls));
          const event = buildMouseEvent({
            ctrlKey: opts?.enable === false,
            clientX: 16,
            clientY: 18,
            target,
          });
          return contextMenu.openWrapperContextMenu(event);
        },
        getContextMenu: () => contextMenu.contextMenu,
        close: () => contextMenu.closeContextMenu(),
      }),
      [contextMenu]
    );

    return null;
  }
);

const renderHarness = async (props?: HarnessProps) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const ref = React.createRef<HarnessHandle>();

  await act(async () => {
    root.render(<Harness ref={ref} {...props} />);
  });

  return {
    getHandle() {
      if (!ref.current) {
        throw new Error('Harness not mounted');
      }
      return ref.current;
    },
    async rerender(nextProps: HarnessProps) {
      await act(async () => {
        root.render(<Harness ref={ref} {...nextProps} />);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useGridTableContextMenu', () => {
  it('stores cell context menu state when enabled', async () => {
    const harness = await renderHarness();
    await act(async () => {
      harness.getHandle().openCellMenu();
    });

    const menu = harness.getHandle().getContextMenu();
    expect(menu).not.toBeNull();
    expect(menu!.source).toBe('cell');
    expect(menu!.columnKey).toBe('name');

    await act(async () => {
      harness.getHandle().close();
    });
    expect(harness.getHandle().getContextMenu()).toBeNull();

    await harness.unmount();
  });

  it('ignores cell context menu when modifiers are held', async () => {
    const harness = await renderHarness();
    await act(async () => {
      harness.getHandle().openCellMenu({ enable: false });
    });

    expect(harness.getHandle().getContextMenu()).toBeNull();
    await harness.unmount();
  });

  it('does not open wrapper menu when no empty-area items are provided', async () => {
    const harness = await renderHarness();
    await act(async () => {
      const opened = harness.getHandle().openWrapperMenu();
      expect(opened).toBe(false);
    });
    expect(harness.getHandle().getContextMenu()).toBeNull();
    await harness.unmount();
  });

  it('opens wrapper menu only when outside rows and returns override items', async () => {
    const wrapperItems: ContextMenuItem[] = [{ label: 'Wrapper Action', onClick: vi.fn() }];
    const harness = await renderHarness({ wrapperItems });
    await act(async () => {
      harness.getHandle().openWrapperMenu();
    });

    const menu = harness.getHandle().getContextMenu();
    expect(menu).not.toBeNull();
    expect(menu!.source).toBe('empty');
    expect(menu!.itemsOverride).toEqual(wrapperItems);

    await harness.unmount();
  });

  it('supports keyboard-triggered cell context menus with anchor positioning', async () => {
    const harness = await renderHarness();
    const anchor = document.createElement('div');
    anchor.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 30,
        height: 40,
      }) as DOMRect;

    await act(async () => {
      const opened = harness.getHandle().openCellMenuViaKeyboard(anchor);
      expect(opened).toBe(true);
    });

    const menu = harness.getHandle().getContextMenu();
    expect(menu).not.toBeNull();
    expect(menu!.position.x).toBeCloseTo(50);
    expect(menu!.position.y).toBeCloseTo(40);

    await harness.unmount();
  });
});
