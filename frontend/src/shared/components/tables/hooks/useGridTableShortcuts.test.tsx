/**
 * frontend/src/shared/components/tables/hooks/useGridTableShortcuts.test.tsx
 *
 * Test suite for useGridTableShortcuts.
 * Covers key behaviors and edge cases for useGridTableShortcuts.
 */

import { useGridTableShortcuts } from '@shared/components/tables/hooks/useGridTableShortcuts';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type UseShortcutsContract = typeof import('@ui/shortcuts').useShortcuts;
type CapturedShortcut = Parameters<UseShortcutsContract>[0][number];
type CapturedShortcutOptions = NonNullable<Parameters<UseShortcutsContract>[1]>;

// Capture useShortcuts args so we can verify the registered shortcut keys and options.
const capturedShortcuts: {
  shortcuts: CapturedShortcut[];
  options: CapturedShortcutOptions | undefined;
} = {
  shortcuts: [],
  options: undefined,
};

const isMacPlatformMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('@ui/shortcuts', () => ({
  useShortcuts: (shortcuts: CapturedShortcut[], options: CapturedShortcutOptions) => {
    capturedShortcuts.shortcuts = shortcuts;
    capturedShortcuts.options = options;
  },
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: () => isMacPlatformMock(),
}));

describe('useGridTableShortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    isMacPlatformMock.mockReturnValue(false);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const renderHook = async (shortcutsActive: boolean) => {
    const getPageSizeRef = { current: 10 };
    const noop = () => false;

    const HookHarness: React.FC<{ active: boolean }> = ({ active }) => {
      useGridTableShortcuts({
        shortcutsActive: active,
        enableContextMenu: false,
        onOpenFocusedRow: noop,
        onOpenContextMenu: noop,
        moveSelectionByDelta: () => false,
        moveRow: () => false,
        jumpToStart: () => false,
        jumpToEnd: () => false,
        getPageSizeRef,
        isContextMenuVisible: false,
      });
      return null;
    };

    await act(async () => {
      root.render(<HookHarness active={shortcutsActive} />);
      await Promise.resolve();
    });

    const rerender = async (nextActive: boolean) => {
      await act(async () => {
        root.render(<HookHarness active={nextActive} />);
        await Promise.resolve();
      });
    };

    return { rerender };
  };

  it('updates the shared enabled flag when shortcutsActive changes', async () => {
    const { rerender } = await renderHook(false);
    expect(capturedShortcuts.options).toEqual(expect.objectContaining({ enabled: false }));
    await rerender(true);
    expect(capturedShortcuts.options).toEqual(expect.objectContaining({ enabled: true }));
  });

  it('registers all expected shortcut keys with correct options', async () => {
    await renderHook(true);

    const keys = capturedShortcuts.shortcuts.map((s) => s.key);
    expect(keys).toContain('ArrowDown');
    expect(keys).toContain('ArrowUp');
    expect(keys).toContain('PageDown');
    expect(keys).toContain('PageUp');
    expect(keys).toContain('Home');
    expect(keys).toContain('End');
    expect(keys).toContain('Enter');
    expect(keys).toContain(' ');
    expect(keys).toContain('F10');

    // Verify common options passed to useShortcuts.
    expect(capturedShortcuts.options).toEqual(
      expect.objectContaining({
        enabled: true,
        priority: 400,
      })
    );
  });

  it.each([true, false])(
    'gives Space only the row expand toggle while Enter still opens (rows expand: %s)',
    async (rowsExpand) => {
      const onOpenFocusedRow = vi.fn(() => true);
      const onToggleFocusedRow = vi.fn(() => true);
      const Harness: React.FC = () => {
        useGridTableShortcuts({
          shortcutsActive: true,
          enableContextMenu: false,
          onOpenFocusedRow,
          onToggleFocusedRow: rowsExpand ? onToggleFocusedRow : undefined,
          onOpenContextMenu: () => false,
          moveSelectionByDelta: () => false,
          moveRow: () => false,
          jumpToStart: () => false,
          jumpToEnd: () => false,
          getPageSizeRef: { current: 10 },
          isContextMenuVisible: false,
        });
        return null;
      };

      await act(async () => {
        root.render(<Harness />);
        await Promise.resolve();
      });

      requireValue(
        capturedShortcuts.shortcuts.find((s) => s.key === 'Enter'),
        'Enter shortcut'
      ).handler();
      const space = requireValue(
        capturedShortcuts.shortcuts.find((s) => s.key === ' '),
        'Space shortcut'
      );
      space.handler();

      expect(onOpenFocusedRow).toHaveBeenCalledTimes(1);
      // Without an expand toggle Space is switched off (and so absent from help),
      // never borrowing Enter's open action.
      expect(space.enabled).toBe(rowsExpand);
      expect(onToggleFocusedRow).toHaveBeenCalledTimes(rowsExpand ? 1 : 0);
    }
  );

  it('wires row moves, paging, Home/End and the expanded-table skips to their keys', async () => {
    const moveRow = vi.fn(() => true);
    const moveSelectionByDelta = vi.fn(() => true);
    const jumpToStart = vi.fn(() => true);
    const jumpToEnd = vi.fn(() => true);
    const moveParentRow = vi.fn(() => true);
    const getPageSizeRef = { current: 15 };

    const Harness: React.FC = () => {
      useGridTableShortcuts({
        shortcutsActive: true,
        enableContextMenu: false,
        onOpenFocusedRow: () => false,
        onOpenContextMenu: () => false,
        moveRow,
        moveSelectionByDelta,
        jumpToStart,
        jumpToEnd,
        moveParentRow,
        getPageSizeRef,
        isContextMenuVisible: false,
      });
      return null;
    };

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    const run = (key: string, alt = false) =>
      requireValue(
        capturedShortcuts.shortcuts.find((s) => s.key === key && Boolean(s.modifiers?.alt) === alt),
        `${alt ? 'Alt+' : ''}${key} shortcut`
      ).handler();

    run('ArrowDown');
    run('ArrowUp');
    expect(moveRow.mock.calls).toEqual([[1], [-1]]);
    // Paging stays a page of this table's rows.
    run('PageDown');
    expect(moveSelectionByDelta).toHaveBeenCalledWith(15);
    run('Home');
    run('End');
    expect(jumpToStart).toHaveBeenCalledTimes(1);
    expect(jumpToEnd).toHaveBeenCalledTimes(1);
    run('ArrowDown', true);
    run('ArrowUp', true);
    expect(moveParentRow.mock.calls).toEqual([[1], [-1]]);
  });

  it('disables Shift+F10 context menu shortcut when enableContextMenu is false', async () => {
    await renderHook(true);

    const f10 = capturedShortcuts.shortcuts.find((s) => s.key === 'F10');
    expect(f10).toBeDefined();
    expect(requireValue(f10, 'expected test value in useGridTableShortcuts.test.tsx').enabled).toBe(
      false
    );
  });

  const renderWithPagination = async (pagination: {
    onPagePrevious?: () => void;
    onPageNext?: () => void;
    canPagePrevious?: boolean;
    canPageNext?: boolean;
  }) => {
    const Harness: React.FC = () => {
      useGridTableShortcuts({
        shortcutsActive: true,
        enableContextMenu: false,
        onOpenFocusedRow: () => false,
        onOpenContextMenu: () => false,
        moveSelectionByDelta: () => false,
        moveRow: () => false,
        jumpToStart: () => false,
        jumpToEnd: () => false,
        getPageSizeRef: { current: 10 },
        isContextMenuVisible: false,
        ...pagination,
      });
      return null;
    };

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    return {
      findShortcut: (key: string) => capturedShortcuts.shortcuts.find((s) => s.key === key),
    };
  };

  it('pages with Ctrl+ArrowLeft/ArrowRight on non-macOS when pagination is possible', async () => {
    const onPagePrevious = vi.fn();
    const onPageNext = vi.fn();
    const { findShortcut } = await renderWithPagination({
      onPagePrevious,
      onPageNext,
      canPagePrevious: true,
      canPageNext: true,
    });

    expect(
      requireValue(
        findShortcut('ArrowLeft'),
        'expected test value in useGridTableShortcuts.test.tsx'
      ).handler()
    ).toBe(true);
    expect(findShortcut('ArrowLeft')?.modifiers).toEqual({ ctrl: true });
    expect(onPagePrevious).toHaveBeenCalledTimes(1);

    expect(
      requireValue(
        findShortcut('ArrowRight'),
        'expected test value in useGridTableShortcuts.test.tsx'
      ).handler()
    ).toBe(true);
    expect(findShortcut('ArrowRight')?.modifiers).toEqual({ ctrl: true });
    expect(onPageNext).toHaveBeenCalledTimes(1);
  });

  it('pages with Command+ArrowLeft/ArrowRight on macOS when pagination is possible', async () => {
    isMacPlatformMock.mockReturnValue(true);
    const { findShortcut } = await renderWithPagination({
      onPagePrevious: vi.fn(),
      onPageNext: vi.fn(),
      canPagePrevious: true,
      canPageNext: true,
    });

    expect(findShortcut('ArrowLeft')?.modifiers).toEqual({ meta: true });
    expect(findShortcut('ArrowRight')?.modifiers).toEqual({ meta: true });
  });

  it('leaves modified ArrowLeft/ArrowRight unhandled at page boundaries', async () => {
    const onPagePrevious = vi.fn();
    const onPageNext = vi.fn();
    const { findShortcut } = await renderWithPagination({
      onPagePrevious,
      onPageNext,
      canPagePrevious: false,
      canPageNext: false,
    });

    expect(
      requireValue(
        findShortcut('ArrowLeft'),
        'expected test value in useGridTableShortcuts.test.tsx'
      ).handler()
    ).toBe(false);
    expect(
      requireValue(
        findShortcut('ArrowRight'),
        'expected test value in useGridTableShortcuts.test.tsx'
      ).handler()
    ).toBe(false);
    expect(onPagePrevious).not.toHaveBeenCalled();
    expect(onPageNext).not.toHaveBeenCalled();
  });

  it('does not claim modified ArrowLeft/ArrowRight for tables without pagination', async () => {
    const { findShortcut } = await renderWithPagination({});

    expect(
      requireValue(
        findShortcut('ArrowLeft'),
        'expected test value in useGridTableShortcuts.test.tsx'
      ).enabled
    ).toBe(false);
    expect(
      requireValue(
        findShortcut('ArrowRight'),
        'expected test value in useGridTableShortcuts.test.tsx'
      ).enabled
    ).toBe(false);
  });
});
