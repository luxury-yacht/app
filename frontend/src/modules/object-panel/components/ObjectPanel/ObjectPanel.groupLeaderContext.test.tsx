/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.groupLeaderContext.test.tsx
 *
 * Regression test for tab-grouped object panels. The dockable tab-group
 * LEADER renders every tab's content inside its own React subtree
 * (DockablePanel captures non-leader children and the leader mounts them),
 * so React context resolves against the leader's tree. ObjectPanel must
 * therefore ship its CurrentObjectPanelContext.Provider INSIDE the children
 * it hands to DockablePanel — otherwise a pod tab grouped under a workload
 * leader reads the WORKLOAD's objectData (wrong group/version → wrong
 * permission keys → gated actions vanish from the pod's actions menu).
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { act, createContext, useContext, useSyncExternalStore } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { capturedChildrenRef, probedObjectDataRef, mockUseCapabilities, mockRefreshOrchestrator } =
  vi.hoisted(() => ({
    capturedChildrenRef: { current: null as React.ReactNode },
    probedObjectDataRef: { current: undefined as unknown },
    mockUseCapabilities: vi.fn(() => ({
      getState: () => ({ allowed: true, pending: false }),
    })),
    mockRefreshOrchestrator: {
      setScopedDomainEnabled: vi.fn(),
      resetScopedDomain: vi.fn(),
      stopStreamingDomain: vi.fn(),
      fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
      updateContext: vi.fn(),
    },
  }));

// Shared, reactive active-tab store mirroring the real two-context split:
// setObjectPanelActiveTab writes, useObjectPanelActiveTab reads reactively.
const tabStore = vi.hoisted(() => {
  let tabs = new Map<string, string>();
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => tabs,
    set: (panelId: string, tab: string) => {
      if (tabs.get(panelId) === tab) {
        return;
      }
      const next = new Map(tabs);
      next.set(panelId, tab);
      tabs = next;
      listeners.forEach((listener) => {
        listener();
      });
    },
    reset: () => {
      tabs = new Map();
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
});

vi.mock('@modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelState: () => ({
    closePanel: vi.fn(),
    openPanels: new Map(),
    showObjectPanel: true,
    onRowClick: vi.fn(),
    onCloseObjectPanel: vi.fn(),
    setShowObjectPanel: vi.fn(),
    hydrateClusterMeta: vi.fn((d: unknown) => d),
    setObjectPanelActiveTab: tabStore.set,
  }),
  useObjectPanelActiveTab: (panelId: string) =>
    useSyncExternalStore(tabStore.subscribe, tabStore.getSnapshot).get(panelId),
}));

// Teleporting DockablePanel: capture children (exactly what the real panel
// does for the group-content registry) and render NOTHING in this subtree —
// the test mounts the captured children under a different panel's provider,
// simulating the group-leader render path.
vi.mock('@ui/dockable', () => ({
  DockablePanel: ({ children }: { children: React.ReactNode }) => {
    capturedChildrenRef.current = children;
    return null;
  },
  useDockablePanelContext: () => ({
    tabGroups: {
      right: { tabs: [], activeTab: null },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    },
    switchTab: vi.fn(),
    getPreferredOpenGroupKey: () => 'right',
  }),
}));

vi.mock('@ui/dockable/tabGroupState', () => ({
  getGroupForPanel: () => null,
  getGroupTabs: () => null,
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  CurrentObjectPanelContext: createContext({ objectData: null, panelId: null }),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: () => null,
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Details/DetailsTab', () => ({
  // The probe stands in for any content (Overview/ActionsMenu/PodsTab) that
  // reads the per-panel context while mounted in the leader's subtree.
  default: () => <ContextProbe />,
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Logs/LogViewer', () => ({
  default: () => null,
}));
vi.mock('@modules/object-panel/components/ObjectPanel/Shell/ShellTab', () => ({
  default: () => null,
}));
vi.mock('@modules/object-panel/components/ObjectPanel/Events/EventsTab', () => ({
  default: () => null,
}));
vi.mock('@modules/object-panel/components/ObjectPanel/Yaml/YamlTab', () => ({
  default: () => null,
}));
vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ManifestTab', () => ({
  default: () => null,
}));
vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ValuesTab', () => ({
  default: () => null,
}));

vi.mock('@/core/refresh/hooks/useRefreshWatcher', () => ({
  useRefreshWatcher: vi.fn(),
}));
vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: () => ({ data: null, status: 'idle', error: null }),
  resetScopedDomainState: vi.fn(),
}));
vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
}));
vi.mock('@/core/refresh', () => ({
  refreshManager: { register: vi.fn(), unregister: vi.fn() },
  refreshOrchestrator: mockRefreshOrchestrator,
}));

vi.mock('@/core/capabilities', () => ({
  useCapabilities: () => mockUseCapabilities(),
  useUserPermission: () => ({ allowed: true, pending: false }),
  queryNamespacePermissions: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useShortcuts: vi.fn(),
  useSearchShortcutTarget: () => undefined,
  useKeyboardSurface: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: vi.fn().mockResolvedValue({}),
}));
vi.mock('@wailsjs/go/models', () => ({ types: {} }));
vi.mock('@utils/errorHandler', () => ({ errorHandler: { handle: vi.fn() } }));

import { CurrentObjectPanelContext } from '@modules/object-panel/hooks/useObjectPanel';
import ObjectPanel from './ObjectPanel';

const ContextProbe = () => {
  const { objectData } = useContext(CurrentObjectPanelContext);
  probedObjectDataRef.current = objectData;
  return null;
};

const POD_REF: ObjectPanelRef = {
  kind: 'Pod',
  name: 'api-123',
  namespace: 'argo-sandbox',
  clusterId: 'cluster-1',
  group: '',
  version: 'v1',
};

const WORKLOAD_REF: ObjectPanelRef = {
  kind: 'Deployment',
  name: 'api',
  namespace: 'argo-sandbox',
  clusterId: 'cluster-1',
  group: 'apps',
  version: 'v1',
};

// Renders the captured (teleported) children, the way a group leader does.
const LeaderHost = () => <>{capturedChildrenRef.current}</>;

describe('ObjectPanel content under a tab-group leader', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    capturedChildrenRef.current = null;
    probedObjectDataRef.current = undefined;
    tabStore.reset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it("provides the panel's OWN objectData to content rendered by another panel's leader", async () => {
    // Mount the pod panel: its DockablePanel captures the children without
    // rendering them (non-leader tab).
    await act(async () => {
      root.render(
        <ObjectPanel panelId="obj:cluster-1:/v1/pod:argo-sandbox:api-123" objectRef={POD_REF} />
      );
      await Promise.resolve();
    });
    expect(capturedChildrenRef.current).toBeTruthy();

    // Now mount the captured content under the LEADER's provider — exactly
    // what DockablePanel's group leader does for non-leader tabs.
    await act(async () => {
      root.render(
        <>
          <ObjectPanel panelId="obj:cluster-1:/v1/pod:argo-sandbox:api-123" objectRef={POD_REF} />
          <CurrentObjectPanelContext.Provider
            value={{
              objectData: WORKLOAD_REF,
              panelId: 'obj:cluster-1:apps/v1/deployment:argo-sandbox:api',
            }}
          >
            <LeaderHost />
          </CurrentObjectPanelContext.Provider>
        </>
      );
      await Promise.resolve();
    });

    // The probe lives inside the pod panel's Details content. It must see
    // the POD's objectData — not the workload leader's.
    expect(probedObjectDataRef.current).toMatchObject({
      kind: 'Pod',
      name: 'api-123',
      group: '',
      version: 'v1',
    });
  });
});
