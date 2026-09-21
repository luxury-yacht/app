import { ZoomProvider } from '@core/contexts/ZoomContext';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { DockablePanelLayer, DockablePanelProvider } from '@ui/dockable';
import { act, createContext, useContext, useSyncExternalStore } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { probedObjectDataRef, mockUseCapabilities, mockRefreshOrchestrator } = vi.hoisted(() => ({
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
    setObjectPanelActiveTab: (_clusterId: string, panelId: string, tab: string) =>
      tabStore.set(panelId, tab),
  }),
  useObjectPanelActiveTab: (panelId: string) =>
    useSyncExternalStore(tabStore.subscribe, tabStore.getSnapshot).get(panelId),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-1', selectedClusterIds: ['cluster-1'] }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  CurrentObjectPanelContext: createContext({ objectData: null, panelId: null }),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: () => null,
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Details/DetailsTab', () => ({
  // Exercise the context read made by object-specific content and actions.
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

vi.mock('@core/backend-api', () => ({
  RunObjectAction: vi.fn().mockResolvedValue({}),
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@core/backend-api/models', () => ({ types: {} }));
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

describe('ObjectPanel content in a group-owned slot', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
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

  it('keeps object identity from the tab owner when the group has different context', async () => {
    await act(async () => {
      root.render(
        <ZoomProvider>
          <DockablePanelProvider>
            <CurrentObjectPanelContext.Provider
              value={{ objectData: WORKLOAD_REF, panelId: 'workload' }}
            >
              <div className="content">
                <DockablePanelLayer />
              </div>
            </CurrentObjectPanelContext.Provider>
            <ObjectPanel panelId="obj:cluster-1:/v1/pod:argo-sandbox:api-123" objectRef={POD_REF} />
          </DockablePanelProvider>
        </ZoomProvider>
      );
    });
    expect(probedObjectDataRef.current).toMatchObject({
      clusterId: 'cluster-1',
      kind: 'Pod',
      name: 'api-123',
      group: '',
      version: 'v1',
    });
  });
});
