/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenu.test.tsx
 *
 * Test suite for useGridTableContextMenu.
 * Covers key behaviors and edge cases for useGridTableContextMenu.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  type GridTableContextMenuState,
  useGridTableContextMenu,
} from '@shared/components/tables/hooks/useGridTableContextMenu';
import React, { act, useImperativeHandle } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

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
  getContextMenu: () => GridTableContextMenuState<SampleRow> | null;
  close: () => void;
}

interface HarnessProps {
  enableContextMenu?: boolean;
}

const Harness = ({
  enableContextMenu = true,
  ref,
}: HarnessProps & { ref?: React.Ref<HarnessHandle> }) => {
  const contextMenu = useGridTableContextMenu<SampleRow>({
    enableContextMenu,
    columns,
    getCustomContextMenuItems: (item, columnKey) => [
      { label: `Inspect ${columnKey}`, onClick: vi.fn() },
      { label: `Select ${item.name}`, onClick: vi.fn() },
    ],
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
      getContextMenu: () => contextMenu.contextMenu,
      close: () => contextMenu.closeContextMenu(),
    }),
    [contextMenu]
  );

  return null;
};

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
    expect(
      requireValue(menu, 'expected test value in useGridTableContextMenu.test.tsx').columnKey
    ).toBe('name');

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
    expect(
      requireValue(menu, 'expected test value in useGridTableContextMenu.test.tsx').position.x
    ).toBeCloseTo(50);
    expect(
      requireValue(menu, 'expected test value in useGridTableContextMenu.test.tsx').position.y
    ).toBeCloseTo(40);

    await harness.unmount();
  });
});
