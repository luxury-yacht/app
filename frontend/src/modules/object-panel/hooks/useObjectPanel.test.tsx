/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.test.tsx
 *
 * Covers key behaviors for the multi-tab object panel system.
 */

import {
  ObjectPanelStateProvider,
  objectPanelId,
  useObjectPanelActiveTabs,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
import type { TabGroupState } from '@ui/dockable/tabGroupTypes';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

// Mock dockable panel context (replaces the old useDockablePanelState mock).
const mockFocusPanel = vi.fn();
const mockRequestGroupMove = vi.fn(() => true);
const mockReportError = vi.hoisted(() => vi.fn());
let mockDefaultObjectPanelPosition: 'right' | 'bottom' | 'floating' = 'right';
let mockTabGroups: TabGroupState = {
  right: { tabs: [], activeTab: null },
  bottom: { tabs: [], activeTab: null },
  floating: [],
};
vi.mock('@ui/dockable', () => ({
  useDockablePanelContext: () => ({
    tabGroups: mockTabGroups,
    focusPanel: mockFocusPanel,
    requestGroupMove: mockRequestGroupMove,
  }),
}));

vi.mock('@/core/settings/appPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/settings/appPreferences')>()),
  getDefaultObjectPanelPosition: () => mockDefaultObjectPanelPosition,
}));

const kubeconfigMocks = vi.hoisted(() => ({
  selectedClusterId: 'test-cluster',
  selectedClusterName: 'test',
  selectedClusterIds: ['test-cluster', 'other-cluster'],
  selectedKubeconfigs: ['/kube/test-cluster', '/kube/other-cluster'],
  setActiveKubeconfig: vi.fn(),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: kubeconfigMocks.selectedClusterId,
    selectedClusterName: kubeconfigMocks.selectedClusterName,
    selectedClusterIds: kubeconfigMocks.selectedClusterIds,
    selectedKubeconfigs: kubeconfigMocks.selectedKubeconfigs,
    setActiveKubeconfig: kubeconfigMocks.setActiveKubeconfig,
    getClusterMeta: (selection: string) => {
      const id = selection.replace('/kube/', '');
      return { id, name: id === 'test-cluster' ? 'test' : 'other' };
    },
  }),
}));

vi.mock('@ui/dockable/useDockablePanelState', () => ({
  clearPanelState: vi.fn(),
  handoffLayoutBeforeClose: vi.fn(),
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: mockReportError,
}));

describe('useObjectPanel', () => {
  type UseObjectPanelExports = typeof import('./useObjectPanel');
  let useObjectPanel: UseObjectPanelExports['useObjectPanel'];
  let closeObjectPanelGlobal: UseObjectPanelExports['closeObjectPanelGlobal'];
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let hookResult: ReturnType<UseObjectPanelExports['useObjectPanel']>;
  let activeTabs = new Map<string, string>();

  function TestComponent() {
    hookResult = requireValue(useObjectPanel, 'expected test value in useObjectPanel.test.tsx')();
    activeTabs = useObjectPanelActiveTabs() as Map<string, string>;
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
    mockRequestGroupMove.mockClear();
    mockDefaultObjectPanelPosition = 'right';
    mockReportError.mockClear();
    kubeconfigMocks.selectedClusterId = 'test-cluster';
    kubeconfigMocks.selectedClusterName = 'test';
    kubeconfigMocks.setActiveKubeconfig.mockClear();
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
    const pod = {
      kind: 'Pod',
      group: '',
      version: 'v1',
      name: 'api',
      namespace: 'default',
      clusterId: 'test-cluster',
    };

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
    const pod = {
      kind: 'Pod',
      group: '',
      version: 'v1',
      name: 'api',
      namespace: 'default',
      clusterId: 'test-cluster',
    };

    act(() => {
      hookResult.openWithObject(pod);
    });

    act(() => {
      hookResult.openWithObject(pod);
    });

    // Opening the same object twice should not create a second panel entry.
    expect(hookResult.openPanels.size).toBe(1);
  });

  it('applies an initial object sub-tab in the same open transaction', () => {
    const pod = {
      kind: 'Pod',
      group: '',
      version: 'v1',
      name: 'api',
      namespace: 'default',
      clusterId: 'test-cluster',
    };
    const panelId = objectPanelId(pod);

    act(() => {
      hookResult.openWithObject(pod, { initialTab: 'events' });
    });

    expect(activeTabs.get(panelId)).toBe('events');
  });

  it('focuses an existing docked panel immediately', () => {
    const pod = {
      kind: 'Pod',
      group: '',
      version: 'v1',
      name: 'api',
      namespace: 'default',
      clusterId: 'test-cluster',
    };
    const panelId = objectPanelId(pod);
    mockTabGroups = {
      right: { tabs: [panelId], activeTab: panelId },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    };
    renderHookComponent();

    act(() => {
      hookResult.openWithObject(pod);
    });

    expect(mockFocusPanel).toHaveBeenCalledWith(panelId);
  });

  it('activates the owning cluster before opening a cross-cluster object panel', () => {
    const namespace = {
      kind: 'Namespace',
      group: '',
      version: 'v1',
      name: 'team-b',
      clusterId: 'other-cluster',
      clusterName: 'other',
    };

    act(() => {
      hookResult.openWithObject(namespace);
    });

    expect(kubeconfigMocks.setActiveKubeconfig).toHaveBeenCalledWith('/kube/other-cluster');
    expect(hookResult.openPanels.size).toBe(0);

    kubeconfigMocks.selectedClusterId = 'other-cluster';
    kubeconfigMocks.selectedClusterName = 'other';
    renderHookComponent();

    expect(Array.from(hookResult.openPanels.values())).toEqual([
      expect.objectContaining(namespace),
    ]);
  });

  it('rejects a cross-cluster open when the owning cluster is not open', () => {
    act(() => {
      hookResult.openWithObject({
        kind: 'Namespace',
        group: '',
        version: 'v1',
        name: 'missing',
        clusterId: 'unopened-cluster',
      });
    });

    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        action: 'activate-object-panel-cluster',
        clusterId: 'unopened-cluster',
      })
    );
    expect(hookResult.openPanels.size).toBe(0);
  });

  it('focuses a newly opened panel after it joins a dockable tab group', async () => {
    const pod = {
      kind: 'Pod',
      group: '',
      version: 'v1',
      name: 'api',
      namespace: 'default',
      clusterId: 'test-cluster',
    };
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

  it('floats only the new panel group when floating is the default', async () => {
    mockDefaultObjectPanelPosition = 'floating';
    const pod = {
      kind: 'Pod',
      group: '',
      version: 'v1',
      name: 'api',
      namespace: 'default',
      clusterId: 'test-cluster',
    };
    const panelId = objectPanelId({ ...pod, clusterName: 'test' });

    await act(async () => {
      hookResult.openWithObject(pod);
      await Promise.resolve();
    });
    mockTabGroups = {
      right: { tabs: ['existing-panel'], activeTab: 'existing-panel' },
      bottom: { tabs: [], activeTab: null },
      floating: [{ groupId: 'new-panel-group', tabs: [panelId], activeTab: panelId }],
    };

    await act(async () => {
      root.render(<WrappedTestComponent />);
      await Promise.resolve();
    });

    expect(mockRequestGroupMove).toHaveBeenCalledWith('new-panel-group', 'floating');
    expect(mockRequestGroupMove).not.toHaveBeenCalledWith('right', 'floating');
  });

  it('closes all panels via close()', () => {
    const resource = {
      kind: 'ConfigMap',
      group: '',
      version: 'v1',
      name: 'settings',
      namespace: 'default',
      clusterId: 'test-cluster',
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
      clusterId: 'test-cluster',
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
  // rebuild) that the literal walker can't see. See
  // assertObjectRefHasRequiredIdentity in src/types/view-state.ts.
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
        clusterId: 'test-cluster',
      };

      expect(() => {
        act(() => {
          hookResult.openWithObject(brokenRef);
        });
      }).toThrow(/missing version/);
      expect(hookResult.openPanels.size).toBe(0);
    });

    it('throws with a hint pointing to the fix helpers', () => {
      const brokenRef = { kind: 'Rollout', name: 'canary', clusterId: 'test-cluster' };

      expect(() => {
        act(() => {
          hookResult.openWithObject(brokenRef);
        });
      }).toThrow(/resolveBuiltinGroupVersion|parseApiVersion/);
    });

    it('throws when a custom resource carries version but omits group', () => {
      const brokenRef = {
        kind: 'DBInstance',
        version: 'v1alpha1',
        name: 'primary',
        namespace: 'default',
        clusterId: 'test-cluster',
      };

      expect(() => {
        act(() => {
          hookResult.openWithObject(brokenRef);
        });
      }).toThrow(/missing group/);
      expect(hookResult.openPanels.size).toBe(0);
    });

    it('requires synthetic HelmRelease refs to use canonical identity', () => {
      const helmRelease = {
        kind: 'HelmRelease',
        group: 'helm.sh',
        version: 'v3',
        name: 'demo',
        namespace: 'default',
        clusterId: 'test-cluster',
      };

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
        clusterId: 'test-cluster',
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
        clusterId: 'test-cluster',
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
