/**
 * frontend/src/components/dockable/useDockablePanelState.test.tsx
 *
 * Test suite for useDockablePanelState.
 * Covers key behaviors and edge cases for useDockablePanelState.
 */

import { vi } from 'vitest';

const setLogsPanelVisible = vi.fn();

vi.mock('../../../wailsjs/go/backend/App', () => ({
  __esModule: true,
  SetLogsPanelVisible: (...args: unknown[]) => setLogsPanelVisible(...args),
}));

vi.mock('../../../wailsjs/go/backend/App.js', () => ({
  __esModule: true,
  SetLogsPanelVisible: (...args: unknown[]) => setLogsPanelVisible(...args),
}));

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  useDockablePanelState,
  getAllPanelStates,
  restorePanelStates,
} from './useDockablePanelState';
import { DockablePanelProvider } from './DockablePanelProvider';

type HookResult = ReturnType<typeof useDockablePanelState>;

interface HookHarness {
  get current(): HookResult;
  update: (updater: (state: HookResult) => void | Promise<void>) => Promise<void>;
  rerender: () => Promise<void>;
  unmount: () => Promise<void>;
}

const renderHook = async (panelId: string): Promise<HookHarness> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const result: { current?: HookResult } = {};

  const HookConsumer: React.FC<{ id: string }> = ({ id }) => {
    result.current = useDockablePanelState(id);
    return null;
  };

  await act(async () => {
    root.render(
      <DockablePanelProvider>
        <HookConsumer id={panelId} />
      </DockablePanelProvider>
    );
    await Promise.resolve();
  });

  return {
    get current() {
      if (!result.current) {
        throw new Error('Hook result is not initialized');
      }
      return result.current;
    },
    update: async (updater) => {
      await act(async () => {
        await updater(result.current!);
        await Promise.resolve();
      });
    },
    rerender: async () => {
      await act(async () => {
        root.render(
          <DockablePanelProvider>
            <HookConsumer id={panelId} />
          </DockablePanelProvider>
        );
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useDockablePanelState', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (window as any).go = {
      backend: {
        App: {
          SetLogsPanelVisible: (...args: unknown[]) => setLogsPanelVisible(...args),
        },
      },
    };
  });

  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  afterEach(() => {
    setLogsPanelVisible.mockReset();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
    (window as any).go = {
      backend: {
        App: {
          SetLogsPanelVisible: (...args: unknown[]) => setLogsPanelVisible(...args),
        },
      },
    };
  });

  it('initializes panel state with provided defaults', async () => {
    const hook = await renderHook('dockable-init');

    expect(hook.current.isInitialized).toBe(false);
    expect(hook.current.position).toBe('right');
    expect(hook.current.isOpen).toBe(false);

    await hook.update((state) =>
      state.initialize({
        position: 'bottom',
        size: { width: 420, height: 260 },
        floatingPosition: { x: 110, y: 160 },
        isOpen: false,
      })
    );

    expect(hook.current.isInitialized).toBe(true);
    expect(hook.current.position).toBe('bottom');
    expect(hook.current.size.height).toBe(260);
    expect(hook.current.floatingPosition).toEqual({ x: 110, y: 160 });
    expect(hook.current.isOpen).toBe(false);

    await hook.unmount();
  });

  it('updates size according to the active docking position', async () => {
    const hook = await renderHook('dockable-size');

    await hook.update((state) => state.setPosition('right'));
    await hook.update((state) => state.setSize({ width: 420, height: 999 }));

    expect(hook.current.rightSize).toEqual({ width: 420, height: 300 });
    expect(hook.current.size.width).toBe(420);

    await hook.update((state) => state.setPosition('bottom'));
    await hook.update((state) => state.setSize({ width: 999, height: 310 }));

    expect(hook.current.bottomSize).toEqual({ width: 400, height: 310 });
    expect(hook.current.size.height).toBe(310);

    await hook.unmount();
  });

  it('clamps floating position within viewport bounds', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });

    const hook = await renderHook('dockable-floating');

    await hook.update((state) => state.setPosition('floating'));
    await hook.update((state) => state.setFloatingPosition({ x: -40, y: -10 }));

    expect(hook.current.floatingPosition.x).toBeGreaterThanOrEqual(0);
    expect(hook.current.floatingPosition.y).toBeGreaterThanOrEqual(0);

    await hook.update((state) => state.setFloatingPosition({ x: 2000, y: 2000 }));
    // Default floating size is 600x400, so max top-left in an 800x600 viewport is 200x200.
    expect(hook.current.floatingPosition.x).toBeLessThanOrEqual(200);
    expect(hook.current.floatingPosition.y).toBeLessThanOrEqual(200);

    await hook.unmount();
  });

  it('notifies backend visibility when toggling the app-logs panel', async () => {
    const hook = await renderHook('app-logs');

    await hook.update(async (state) => {
      state.setOpen(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hook.current.isOpen).toBe(true);

    await hook.update(async (state) => {
      state.toggle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hook.current.isOpen).toBe(false);

    await hook.unmount();
  });

  it('raises z-index on focus and resets to defaults', async () => {
    const hook = await renderHook('dockable-focus');

    const initialZ = hook.current.zIndex;
    await hook.update((state) => state.focus());
    expect(hook.current.zIndex).toBeGreaterThan(initialZ);

    await hook.update((state) => state.setPosition('bottom'));
    await hook.update((state) => state.setOpen(true));
    await hook.update((state) => state.reset());

    expect(hook.current.position).toBe('right');
    expect(hook.current.isOpen).toBe(false);

    await hook.unmount();
  });

  it('tracks panel states globally via getAllPanelStates and restorePanelStates', async () => {
    const hook = await renderHook('dockable-global');

    await hook.update((state) => state.setPosition('bottom'));
    await hook.update((state) => state.setSize({ width: 420, height: 260 }));

    const snapshot = getAllPanelStates();
    expect(snapshot['dockable-global'].position).toBe('bottom');
    expect(snapshot['dockable-global'].bottomSize.height).toBe(260);

    await act(async () => {
      restorePanelStates({
        'dockable-global': {
          ...snapshot['dockable-global'],
          position: 'floating',
          floatingPosition: { x: 200, y: 180 },
        },
      });
    });

    await hook.rerender();
    expect(hook.current.position).toBe('floating');
    expect(hook.current.floatingPosition).toEqual({ x: 200, y: 180 });

    await hook.unmount();
  });
});
