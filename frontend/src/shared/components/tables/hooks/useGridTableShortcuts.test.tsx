/**
 * frontend/src/shared/components/tables/hooks/useGridTableShortcuts.test.tsx
 *
 * Test suite for useGridTableShortcuts.
 * Covers key behaviors and edge cases for useGridTableShortcuts.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTableShortcuts } from '@shared/components/tables/hooks/useGridTableShortcuts';

// Capture useShortcuts args so we can verify the registered shortcut keys and options.
const capturedShortcuts: { shortcuts: any[]; options: any } = { shortcuts: [], options: undefined };

vi.mock('@ui/shortcuts', () => ({
  useShortcuts: (shortcuts: any[], options: any) => {
    capturedShortcuts.shortcuts = shortcuts;
    capturedShortcuts.options = options;
  },
}));

describe('useGridTableShortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const renderHook = async (
    shortcutsActive: boolean,
    pushShortcutContext: () => void,
    popShortcutContext: () => void
  ) => {
    const getPageSizeRef = { current: 10 };
    const noop = () => false;

    const HookHarness: React.FC<{ active: boolean }> = ({ active }) => {
      useGridTableShortcuts({
        shortcutsActive: active,
        enableContextMenu: false,
        onOpenFocusedRow: noop,
        onOpenContextMenu: noop,
        moveSelectionByDelta: () => false,
        jumpToIndex: () => false,
        getPageSizeRef,
        tableDataLength: 25,
        pushShortcutContext,
        popShortcutContext,
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

  it('pushes and pops context only when shortcutsActive changes', async () => {
    const pushShortcutContext = vi.fn();
    const popShortcutContext = vi.fn();

    const { rerender } = await renderHook(false, pushShortcutContext, popShortcutContext);
    expect(pushShortcutContext).not.toHaveBeenCalled();
    expect(popShortcutContext).not.toHaveBeenCalled();

    await rerender(true);
    expect(pushShortcutContext).toHaveBeenCalledTimes(1);
    expect(popShortcutContext).not.toHaveBeenCalled();

    await rerender(true);
    expect(pushShortcutContext).toHaveBeenCalledTimes(1);
    expect(popShortcutContext).not.toHaveBeenCalled();

    await rerender(false);
    expect(popShortcutContext).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    // Cleanup should not pop again after explicit deactivation.
    expect(popShortcutContext).toHaveBeenCalledTimes(1);
  });

  it('pops context on unmount when shortcuts remain active', async () => {
    const pushShortcutContext = vi.fn();
    const popShortcutContext = vi.fn();

    await renderHook(true, pushShortcutContext, popShortcutContext);
    expect(pushShortcutContext).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    expect(popShortcutContext).toHaveBeenCalledTimes(1);
  });

  it('registers all expected shortcut keys with correct options', async () => {
    await renderHook(true, vi.fn(), vi.fn());

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
        view: 'list',
        priority: 400,
        whenTabActive: 'gridtable',
      })
    );
  });

  it('wires moveSelectionByDelta and jumpToIndex to navigation shortcuts', async () => {
    const moveSelectionByDelta = vi.fn(() => true);
    const jumpToIndex = vi.fn(() => true);
    const getPageSizeRef = { current: 15 };

    const Harness: React.FC = () => {
      useGridTableShortcuts({
        shortcutsActive: true,
        enableContextMenu: false,
        onOpenFocusedRow: () => false,
        onOpenContextMenu: () => false,
        moveSelectionByDelta,
        jumpToIndex,
        getPageSizeRef,
        tableDataLength: 50,
        pushShortcutContext: vi.fn(),
        popShortcutContext: vi.fn(),
        isContextMenuVisible: false,
      });
      return null;
    };

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    const findShortcut = (key: string) => capturedShortcuts.shortcuts.find((s) => s.key === key);

    // ArrowDown calls moveSelectionByDelta(1).
    findShortcut('ArrowDown')!.handler();
    expect(moveSelectionByDelta).toHaveBeenCalledWith(1);

    // ArrowUp calls moveSelectionByDelta(-1).
    findShortcut('ArrowUp')!.handler();
    expect(moveSelectionByDelta).toHaveBeenCalledWith(-1);

    // PageDown uses the page size ref.
    findShortcut('PageDown')!.handler();
    expect(moveSelectionByDelta).toHaveBeenCalledWith(15);

    // Home jumps to index 0.
    findShortcut('Home')!.handler();
    expect(jumpToIndex).toHaveBeenCalledWith(0);

    // End jumps to the last index (tableDataLength - 1).
    findShortcut('End')!.handler();
    expect(jumpToIndex).toHaveBeenCalledWith(49);
  });

  it('disables Shift+F10 context menu shortcut when enableContextMenu is false', async () => {
    await renderHook(true, vi.fn(), vi.fn());

    const f10 = capturedShortcuts.shortcuts.find((s) => s.key === 'F10');
    expect(f10).toBeDefined();
    expect(f10!.enabled).toBe(false);
  });
});
