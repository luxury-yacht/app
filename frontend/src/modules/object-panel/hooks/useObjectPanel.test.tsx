/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.test.tsx
 *
 * Test suite for useObjectPanel.
 * Covers key behaviors and edge cases for useObjectPanel.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectPanelStateProvider } from '@/core/contexts/ObjectPanelStateContext';

const setOpenMock = vi.fn();

type MockPanelState = ReturnType<typeof createPanelState>;

const createPanelState = () => {
  const state = {
    position: 'right' as const,
    floatingSize: { width: 600, height: 400 },
    rightSize: { width: 400, height: 300 },
    bottomSize: { width: 400, height: 300 },
    floatingPosition: { x: 0, y: 0 },
    isOpen: false,
    isInitialized: true,
    zIndex: 1,
    initialize: vi.fn(),
    setOpen: vi.fn((open: boolean) => {
      state.isOpen = open;
      setOpenMock(open);
    }),
    setPosition: vi.fn(),
    setSize: vi.fn(),
    getCurrentSize: vi.fn(() => ({ width: 400, height: 300 })),
  };
  return state;
};

let panelState: MockPanelState = createPanelState();
const mockUseDockablePanelState = vi.fn(() => panelState);

vi.mock('@components/dockable', () => ({
  useDockablePanelState: mockUseDockablePanelState,
}));

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('useObjectPanel', () => {
  type UseObjectPanelExports = typeof import('./useObjectPanel');
  let useObjectPanel: UseObjectPanelExports['useObjectPanel'];
  let closeObjectPanelGlobal: UseObjectPanelExports['closeObjectPanelGlobal'];
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let hookResult: ReturnType<UseObjectPanelExports['useObjectPanel']>;

  function TestComponent() {
    hookResult = useObjectPanel!();
    return null;
  }

  function WrappedTestComponent() {
    return (
      <ObjectPanelStateProvider>
        <TestComponent />
      </ObjectPanelStateProvider>
    );
  }

  beforeAll(async () => {
    ({ useObjectPanel, closeObjectPanelGlobal } = await import('./useObjectPanel'));
  });

  function renderHookComponent() {
    act(() => {
      root.render(<WrappedTestComponent />);
    });
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    setOpenMock.mockClear();
    panelState = createPanelState();
    mockUseDockablePanelState.mockImplementation(() => panelState);
    if (!useObjectPanel || !closeObjectPanelGlobal) {
      throw new Error('Object panel hooks failed to load');
    }
    renderHookComponent();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('opens the panel with object details and records history', async () => {
    const pod = { kind: 'Pod', name: 'api', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(pod);
    });

    expect(setOpenMock).toHaveBeenCalledWith(true);
    expect(hookResult.isOpen).toBe(true);
    expect(hookResult.objectData).toEqual(pod);
    expect(hookResult.navigationHistory).toEqual([pod]);
    expect(hookResult.navigationIndex).toBe(0);
  });

  it('navigates backward through the object history', async () => {
    const first = { kind: 'Deployment', name: 'api', namespace: 'default' };
    const second = { kind: 'Pod', name: 'api-123', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(first);
    });

    act(() => {
      hookResult.openWithObject(second);
    });

    expect(hookResult.navigationHistory).toEqual([first, second]);
    expect(hookResult.navigationIndex).toBe(1);

    act(() => {
      hookResult.navigate(0);
    });

    expect(hookResult.objectData).toEqual(first);
    expect(hookResult.navigationIndex).toBe(0);
  });

  it('closes the panel and clears stored state', async () => {
    const resource = { kind: 'ConfigMap', name: 'settings', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(resource);
    });

    act(() => {
      hookResult.close();
    });

    expect(setOpenMock).toHaveBeenLastCalledWith(false);
    expect(hookResult.isOpen).toBe(false);
    expect(hookResult.objectData).toBeNull();
    expect(hookResult.navigationHistory).toEqual([]);
    expect(hookResult.navigationIndex).toBe(-1);
  });

  it('closeObjectPanelGlobal closes the panel', async () => {
    const resource = { kind: 'Secret', name: 'credentials', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(resource);
    });

    expect(hookResult.objectData).toEqual(resource);

    act(() => {
      closeObjectPanelGlobal();
    });

    expect(hookResult.objectData).toBeNull();
    expect(hookResult.navigationHistory).toEqual([]);
  });
});
