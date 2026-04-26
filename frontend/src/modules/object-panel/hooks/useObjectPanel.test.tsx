/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.test.tsx
 *
 * Covers key behaviors for the multi-tab object panel system.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectPanelStateProvider, objectPanelId } from '@/core/contexts/ObjectPanelStateContext';
import type { TabGroupState } from '@ui/dockable/tabGroupTypes';

// Mock dockable panel context (replaces the old useDockablePanelState mock).
const mockFocusPanel = vi.fn();
let mockTabGroups: TabGroupState = {
  right: { tabs: [], activeTab: null },
  bottom: { tabs: [], activeTab: null },
  floating: [],
};
vi.mock('@ui/dockable', () => ({
  useDockablePanelContext: () => ({
    tabGroups: mockTabGroups,
    focusPanel: mockFocusPanel,
  }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: 'test-cluster',
    selectedClusterName: 'test',
  }),
}));

vi.mock('@ui/dockable/useDockablePanelState', () => ({
  clearPanelState: vi.fn(),
  handoffLayoutBeforeClose: vi.fn(),
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
    mockTabGroups = {
      right: { tabs: [], activeTab: null },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    };
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
    const pod = { kind: 'Pod', group: '', version: 'v1', name: 'api', namespace: 'default' };

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
    const pod = { kind: 'Pod', group: '', version: 'v1', name: 'api', namespace: 'default' };

    act(() => {
      hookResult.openWithObject(pod);
    });

    act(() => {
      hookResult.openWithObject(pod);
    });

    // Opening the same object twice should not create a second panel entry.
    expect(hookResult.openPanels.size).toBe(1);
  });

  it('focuses a newly opened panel after it joins a dockable tab group', async () => {
    const pod = { kind: 'Pod', group: '', version: 'v1', name: 'api', namespace: 'default' };
    const enrichedPod = {
      ...pod,
      clusterId: 'test-cluster',
      clusterName: 'test',
    };
    const panelId = objectPanelId(enrichedPod);

    await act(async () => {
      hookResult.openWithObject(pod);
      await Promise.resolve();
    });

    expect(mockFocusPanel).not.toHaveBeenCalled();

    mockTabGroups = {
      right: { tabs: [panelId], activeTab: panelId },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    };

    await act(async () => {
      root.render(<WrappedTestComponent />);
      await Promise.resolve();
    });

    expect(mockFocusPanel).toHaveBeenCalledWith(panelId);
  });

  it('closes all panels via close()', () => {
    const resource = {
      kind: 'ConfigMap',
      group: '',
      version: 'v1',
      name: 'settings',
      namespace: 'default',
    };

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
    const resource = {
      kind: 'Secret',
      group: '',
      version: 'v1',
      name: 'credentials',
      namespace: 'default',
    };

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

  // Runtime defense for the kind-only-objects bug. The audit test
  // (openWithObjectAudit.test.ts) covers literal call sites; this guard
  // covers programmatic constructions (helpers, mappers, destructure-and-
  // rebuild) that the literal walker can't see. See assertObjectRefHasGVK in
  // src/types/view-state.ts.
  describe('kind-only-objects runtime guard', () => {
    it('throws when openWithObject receives a ref with kind but no version', () => {
      // The shape of bug we want to catch: a future helper builds a ref
      // from raw catalog data and forgets to thread group/version. This
      // ref would slip past the literal-walker audit because it isn't a
      // literal call site.
      const brokenRef = {
        kind: 'DBInstance',
        name: 'primary',
        namespace: 'default',
      };

      expect(() => {
        act(() => {
          hookResult.openWithObject(brokenRef);
        });
      }).toThrow(/missing apiVersion/);
      expect(hookResult.openPanels.size).toBe(0);
    });

    it('throws with a hint pointing to the fix helpers', () => {
      const brokenRef = { kind: 'Rollout', name: 'canary' };

      expect(() => {
        act(() => {
          hookResult.openWithObject(brokenRef);
        });
      }).toThrow(/resolveBuiltinGroupVersion|parseApiVersion/);
    });

    it('exempts synthetic kinds (HelmRelease) that have no real GVK', () => {
      // HelmRelease is the panel's synthetic name for a Helm CLI release.
      // It is not a Kubernetes resource and never resolves through
      // discovery. The guard must not block it.
      const helmRelease = { kind: 'HelmRelease', name: 'demo', namespace: 'default' };

      expect(() => {
        act(() => {
          hookResult.openWithObject(helmRelease);
        });
      }).not.toThrow();
      expect(hookResult.openPanels.size).toBe(1);
    });

    it('accepts a fully-qualified GVK ref (built-in core resource)', () => {
      const pod = {
        kind: 'Pod',
        group: '',
        version: 'v1',
        name: 'api',
        namespace: 'default',
      };

      expect(() => {
        act(() => {
          hookResult.openWithObject(pod);
        });
      }).not.toThrow();
      expect(hookResult.openPanels.size).toBe(1);
    });

    it('accepts a fully-qualified GVK ref (CRD with group)', () => {
      // The exact shape that would have triggered the original
      // kind-only-objects bug if version were missing — now valid.
      const dbInstance = {
        kind: 'DBInstance',
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
        name: 'primary',
        namespace: 'default',
      };

      expect(() => {
        act(() => {
          hookResult.openWithObject(dbInstance);
        });
      }).not.toThrow();
      expect(hookResult.openPanels.size).toBe(1);
    });
  });
});
