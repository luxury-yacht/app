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
        jumpToIndex: () => false,
        getPageSizeRef,
        tableDataLength: 25,
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
    await renderHook(true);

    const f10 = capturedShortcuts.shortcuts.find((s) => s.key === 'F10');
    expect(f10).toBeDefined();
    expect(f10!.enabled).toBe(false);
  });
});
