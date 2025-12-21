import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTableShortcuts } from '@shared/components/tables/hooks/useGridTableShortcuts';

vi.mock('@ui/shortcuts', () => ({
  useShortcuts: () => {},
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
});
