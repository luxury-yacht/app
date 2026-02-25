/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.test.tsx
 *
 * Covers key behaviors for the multi-tab object panel system.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectPanelStateProvider } from '@/core/contexts/ObjectPanelStateContext';

// Mock dockable panel context (replaces the old useDockablePanelState mock).
const mockFocusPanel = vi.fn();
vi.mock('@ui/dockable', () => ({
  useDockablePanelContext: () => ({
    tabGroups: {
      right: { tabs: [], activeTab: null },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    },
    focusPanel: mockFocusPanel,
  }),
}));

// Mock tab group state helper used by the hook to find existing panels.
vi.mock('@ui/dockable/tabGroupState', () => ({
  getGroupForPanel: () => null,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: 'test-cluster',
    selectedClusterName: 'test',
  }),
}));

vi.mock('@ui/dockable/useDockablePanelState', () => ({
  clearPanelState: vi.fn(),
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

  /**
   * Wraps the test component with ObjectPanelStateProvider so that
   * useObjectPanelState() is available. Note: we intentionally do NOT
   * wrap with CurrentObjectPanelContext, so objectData will be null
   * (matching the "outside an ObjectPanel tree" scenario).
   */
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
    mockFocusPanel.mockClear();
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

  it('opens the panel with object details', () => {
    const pod = { kind: 'Pod', name: 'api', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(pod);
    });

    // objectData is null because we are outside a CurrentObjectPanelContext tree.
    expect(hookResult.objectData).toBeNull();
    expect(hookResult.isOpen).toBe(true);
    expect(hookResult.openPanels.size).toBe(1);

    // Verify the stored object has enriched cluster metadata.
    const entries = Array.from(hookResult.openPanels.values());
    expect(entries[0]).toEqual({
      ...pod,
      clusterId: 'test-cluster',
      clusterName: 'test',
    });
  });

  it('activates existing tab instead of duplicating', () => {
    const pod = { kind: 'Pod', name: 'api', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(pod);
    });

    act(() => {
      hookResult.openWithObject(pod);
    });

    // Opening the same object twice should not create a second panel entry.
    expect(hookResult.openPanels.size).toBe(1);
  });

  it('closes all panels via close()', () => {
    const resource = { kind: 'ConfigMap', name: 'settings', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(resource);
    });

    expect(hookResult.isOpen).toBe(true);

    act(() => {
      hookResult.close();
    });

    // Without CurrentObjectPanelContext, close() falls through to onCloseObjectPanel
    // which clears all panels.
    expect(hookResult.isOpen).toBe(false);
    expect(hookResult.openPanels.size).toBe(0);
  });

  it('closeObjectPanelGlobal closes all panels', () => {
    const resource = { kind: 'Secret', name: 'credentials', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(resource);
    });

    expect(hookResult.openPanels.size).toBe(1);

    act(() => {
      closeObjectPanelGlobal();
    });

    expect(hookResult.openPanels.size).toBe(0);
    expect(hookResult.isOpen).toBe(false);
  });
});
