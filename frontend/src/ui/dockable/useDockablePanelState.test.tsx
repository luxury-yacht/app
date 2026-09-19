/**
 * frontend/src/components/dockable/useDockablePanelState.test.tsx
 *
 * Test suite for useDockablePanelState.
 * Covers key behaviors and edge cases for useDockablePanelState.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: vi.fn(() => ({
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
  })),
}));

import { DockablePanelProvider } from './DockablePanelProvider';
import { createPanelLayoutStore } from './panelLayoutStore';
import { PanelLayoutStoreContext } from './panelLayoutStoreContext';
import {
  getAllPanelStates,
  restorePanelStates,
  useDockablePanelState,
} from './useDockablePanelState';

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
        await updater(
          requireValue(result.current, 'expected test value in useDockablePanelState.test.tsx')
        );
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
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it.each(['store', 'panel'] as const)(
    'uses the current %s layout in every render after an identity switch',
    async (change) => {
      const first = createPanelLayoutStore();
      const second = createPanelLayoutStore();
      first.updateState('first', { position: 'right', isOpen: true });
      first.updateState('second', { position: 'bottom', isOpen: false });
      second.updateState('first', { position: 'bottom', isOpen: false });
      const snapshots: Array<{ visit: string; position: string; isOpen: boolean }> = [];
      const Probe = ({ visit, panelId }: { visit: string; panelId: string }) => {
        const state = useDockablePanelState(panelId);
        snapshots.push({ visit, position: state.position, isOpen: state.isOpen });
        return null;
      };
      const container = document.createElement('div');
      const root = ReactDOM.createRoot(container);
      try {
        await act(async () =>
          root.render(
            <PanelLayoutStoreContext value={first}>
              <Probe visit="first" panelId="first" />
            </PanelLayoutStoreContext>
          )
        );
        await act(async () =>
          root.render(
            <PanelLayoutStoreContext value={change === 'store' ? second : first}>
              <Probe visit="second" panelId={change === 'panel' ? 'second' : 'first'} />
            </PanelLayoutStoreContext>
          )
        );
        expect(snapshots.filter((snapshot) => snapshot.visit === 'second')).not.toHaveLength(0);
        expect(
          snapshots
            .filter((snapshot) => snapshot.visit === 'second')
            .every((snapshot) => snapshot.position === 'bottom' && !snapshot.isOpen)
        ).toBe(true);
      } finally {
        await act(async () => root.unmount());
      }
    }
  );

  it('initializes panel state with provided defaults', async () => {
    const hook = await renderHook('dockable-init');

    expect(hook.current.isInitialized).toBe(false);
    expect(hook.current.position).toBe('right');
    expect(hook.current.isOpen).toBe(false);

    await hook.update((state) =>
      state.initialize({
        position: 'bottom',
        size: { width: 420, height: 260 },
        isOpen: false,
      })
    );

    expect(hook.current.isInitialized).toBe(true);
    expect(hook.current.position).toBe('bottom');
    expect(hook.current.size.height).toBe(260);
    expect(hook.current.isOpen).toBe(false);

    await hook.unmount();
  });

  it('does not recreate a closed panel layout during a render before unmount', async () => {
    const store = createPanelLayoutStore();
    store.updateState('closing', { isOpen: true, isInitialized: true, position: 'bottom' });
    const Probe = () => {
      useDockablePanelState('closing');
      return null;
    };
    const root = ReactDOM.createRoot(document.createElement('div'));
    const render = () =>
      root.render(
        <PanelLayoutStoreContext value={store}>
          <Probe />
        </PanelLayoutStoreContext>
      );
    try {
      await act(async () => render());
      await act(async () => {
        store.clearPanelState('closing');
        render();
      });
      expect(store.getState('closing')).toBeUndefined();
      await act(async () => root.render(null));
      await act(async () => render());
      expect(store.getState('closing')).toMatchObject({
        isOpen: false,
        isInitialized: false,
        position: 'right',
      });
    } finally {
      await act(async () => root.unmount());
    }
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

  it('toggles panel open state', async () => {
    const hook = await renderHook('dockable-toggle');

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
          position: 'right',
        },
      });
    });

    await hook.rerender();
    expect(hook.current.position).toBe('right');

    await hook.unmount();
  });
});
