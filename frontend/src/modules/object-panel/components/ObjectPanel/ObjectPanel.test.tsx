/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.test.tsx
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { requestObjectPanelTab } from '@modules/object-panel/objectPanelTabRequests';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { act, createContext, useSyncExternalStore } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { requireValue } from '@/test-utils/requireValue';

interface DetailsTabCapture {
  onAfterDelete: () => void;
  onAfterAction: () => void;
  detailModel: {
    activeDetail: unknown;
    containerSection: unknown;
    dataSection: unknown;
    roleRules?: unknown;
    desiredScaleReplicas: number;
    activePodNames: unknown;
  };
}

type CapabilityState = {
  allowed: boolean;
  pending: boolean;
  reason?: string;
};

type PanelTestOptions = {
  kind: string;
  name: string;
  namespace?: string;
  clusterId?: string;
  group?: string;
  version?: string;
  capabilityOverrides?: Record<string, CapabilityState>;
  logPermission?: { allowed: boolean; pending: boolean };
  scopedDomain?: { data: unknown; status: string; error: string | null };
};

const {
  detailsTabPropsRef,
  logViewerPropsRef,
  shellTabPropsRef,
  eventsTabPropsRef,
  yamlTabPropsRef,
  manifestTabPropsRef,
  valuesTabPropsRef,
} = vi.hoisted(() => ({
  detailsTabPropsRef: { current: null as DetailsTabCapture | null },
  logViewerPropsRef: { current: null as unknown },
  shellTabPropsRef: { current: null as unknown },
  eventsTabPropsRef: { current: null as unknown },
  yamlTabPropsRef: { current: null as unknown },
  manifestTabPropsRef: { current: null as unknown },
  valuesTabPropsRef: { current: null as unknown },
}));

const getDetailsTabProps = () =>
  requireValue(detailsTabPropsRef.current, 'expected DetailsTab props in ObjectPanel.test.tsx');

const mockClosePanel = vi.fn();
const mockUseCapabilities = vi.fn();
const mockUseUserPermission = vi.fn();
const mockQueryNamespacePermissions = vi.fn();
const mockUseRefreshScopedDomain = vi.fn();
const mockUseRefreshWatcher = vi.fn();
const mockUseShortcut = vi.fn();

const mockRefreshOrchestrator = {
  setScopedDomainEnabled: vi.fn(),
  resetScopedDomain: vi.fn(),
  stopStreamingDomain: vi.fn(),
  fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
  updateContext: vi.fn(),
};

const mockRefreshManager = {
  register: vi.fn(),
  unregister: vi.fn(),
};

const mockErrorHandler = {
  handle: vi.fn(),
};

const mockApp = {
  RunObjectAction: vi.fn().mockResolvedValue({}),
};

const defaultClusterId = 'alpha:ctx';

// Shared, reactive active-tab store mirroring the real two-context split:
// setObjectPanelActiveTab (on the state context) writes, useObjectPanelActiveTab
// (a separate subscription) reads, and a write re-renders the consuming
// ObjectPanel — matching the real provider's tab-change behavior.
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
    closePanel: mockClosePanel,
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

// Mock dockable to provide both DockablePanel and useDockablePanelContext
vi.mock('@ui/dockable', () => ({
  DockablePanel: ({
    children,
    panelRef,
  }: {
    children: React.ReactNode;
    panelRef?: React.Ref<HTMLDivElement>;
  }) => (
    <div ref={panelRef}>
      <div data-testid="dockable-body">{children}</div>
    </div>
  ),
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

// Mock tabGroupState helpers
vi.mock('@ui/dockable/tabGroupState', () => ({
  getGroupForPanel: () => null,
  getGroupTabs: () => null,
}));

// Mock CurrentObjectPanelContext from useObjectPanel
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  CurrentObjectPanelContext: createContext({ objectData: null, panelId: null }),
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Details/DetailsTab', () => ({
  default: (props: DetailsTabCapture) => {
    detailsTabPropsRef.current = props;
    return <div data-testid="details-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Logs/LogViewer', () => ({
  default: (props: unknown) => {
    logViewerPropsRef.current = props;
    return <div data-testid="logs-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Shell/ShellTab', () => ({
  default: (props: unknown) => {
    shellTabPropsRef.current = props;
    return <div data-testid="shell-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Events/EventsTab', () => ({
  default: (props: unknown) => {
    eventsTabPropsRef.current = props;
    return <div data-testid="events-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Yaml/YamlTab', () => ({
  default: (props: unknown) => {
    yamlTabPropsRef.current = props;
    return <div data-testid="yaml-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ManifestTab', () => ({
  default: (props: unknown) => {
    manifestTabPropsRef.current = props;
    return <div data-testid="manifest-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ValuesTab', () => ({
  default: (props: unknown) => {
    valuesTabPropsRef.current = props;
    return <div data-testid="values-tab" />;
  },
}));

vi.mock('@/core/refresh/hooks/useRefreshWatcher', () => ({
  useRefreshWatcher: (config: unknown) => {
    mockUseRefreshWatcher(config);
  },
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: (...args: unknown[]) => mockUseRefreshScopedDomain(...args),
  resetScopedDomainState: vi.fn(),
}));

vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
}));

vi.mock('@/core/refresh', () => ({
  refreshManager: mockRefreshManager,
  refreshOrchestrator: mockRefreshOrchestrator,
}));

vi.mock('@/core/capabilities', () => ({
  useCapabilities: (...args: unknown[]) => mockUseCapabilities(...(args as [])),
  useUserPermission: (...args: unknown[]) => mockUseUserPermission(...(args as [])),
  queryNamespacePermissions: (...args: unknown[]) => mockQueryNamespacePermissions(...(args as [])),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => mockUseShortcut(...(args as [])),
  useShortcuts: vi.fn(),
  useSearchShortcutTarget: () => undefined,
  useKeyboardSurface: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => mockApp);

vi.mock('@wailsjs/go/models', () => ({
  types: {},
}));

vi.mock('@utils/errorHandler', () => ({ errorHandler: mockErrorHandler }));

interface RenderContext {
  container: HTMLDivElement;
  root: ReactDOM.Root;
}

let capabilityStateMap: Record<string, CapabilityState>;
let currentLogPermission: { allowed: boolean; pending: boolean };
let currentScopedDomain: { data: unknown; status: string; error: string | null };
let ObjectPanel: typeof import('./ObjectPanel').default;

mockUseCapabilities.mockImplementation(() => ({
  getState: (id: string) => capabilityStateMap[id] ?? { allowed: true, pending: false },
}));

mockUseUserPermission.mockImplementation(() => currentLogPermission);
mockUseRefreshScopedDomain.mockImplementation(() => currentScopedDomain);

beforeAll(() => {
  return import('./ObjectPanel').then((module) => {
    ObjectPanel = module.default;
  });
});

describe('ObjectPanel tab availability', () => {
  let ctx: RenderContext;

  beforeEach(() => {
    capabilityStateMap = {};
    currentLogPermission = { allowed: true, pending: false };
    currentScopedDomain = { data: null, status: 'idle', error: null };
    detailsTabPropsRef.current = null;
    logViewerPropsRef.current = null;
    shellTabPropsRef.current = null;
    eventsTabPropsRef.current = null;
    yamlTabPropsRef.current = null;
    manifestTabPropsRef.current = null;
    valuesTabPropsRef.current = null;

    mockApp.RunObjectAction.mockReset();
    mockApp.RunObjectAction.mockResolvedValue({});

    mockRefreshOrchestrator.fetchScopedDomain.mockResolvedValue(undefined);

    mockUseRefreshWatcher.mockClear();
    mockClosePanel.mockReset();
    tabStore.reset();

    ctx = {} as RenderContext;
    ctx.container = document.createElement('div');
    document.body.appendChild(ctx.container);
    ctx.root = ReactDOM.createRoot(ctx.container);
  });

  afterEach(() => {
    act(() => {
      ctx.root.unmount();
    });
    ctx.container.remove();
    vi.clearAllMocks();
  });

  /**
   * Helper to build a panelId matching the format used by objectPanelId():
   * obj:{clusterId}:{kind}:{namespace}:{name}
   */
  function buildPanelId(
    clusterId: string,
    kind: string,
    namespace?: string,
    name?: string
  ): string {
    return `obj:${clusterId}:${kind.toLowerCase()}:${namespace ?? '_'}:${name ?? ''}`;
  }

  const renderObjectPanel = async (options: PanelTestOptions) => {
    const clusterId = options.clusterId ?? defaultClusterId;
    const panelId = buildPanelId(clusterId, options.kind, options.namespace, options.name);
    const builtinGVK = resolveBuiltinGroupVersion(options.kind);
    const objectRef: ObjectPanelRef = {
      kind: options.kind,
      name: options.name,
      namespace: options.namespace,
      kindAlias: options.kind,
      clusterId,
      group: options.group ?? builtinGVK?.group ?? '',
      version: options.version ?? builtinGVK?.version ?? '',
    };

    capabilityStateMap = options.capabilityOverrides ?? {};
    currentLogPermission = options.logPermission ?? { allowed: true, pending: false };
    currentScopedDomain = options.scopedDomain ?? { data: null, status: 'idle', error: null };

    await act(async () => {
      ctx.root.render(<ObjectPanel panelId={panelId} objectRef={objectRef} />);
      await Promise.resolve();
    });
  };

  const getTabLabels = () =>
    Array.from(ctx.container.querySelectorAll('.tab-strip .tab-item')).map((button) =>
      button.textContent?.trim()
    );

  const getTabButton = (label: string) =>
    Array.from(ctx.container.querySelectorAll<HTMLButtonElement>('.tab-strip .tab-item')).find(
      (button) => button.textContent?.trim() === label
    );

  it('hides the logs tab when log access is denied', async () => {
    capabilityStateMap = {
      'view-logs': { allowed: false, pending: false },
    };

    currentLogPermission = { allowed: false, pending: false };

    await renderObjectPanel({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
      capabilityOverrides: capabilityStateMap,
      logPermission: currentLogPermission,
    });

    const labels = getTabLabels();
    expect(labels).not.toContain('Logs');
    expect(labels).toContain('Details');
    expect(labels).toContain('Events');
    expect(labels).toContain('YAML');
  });

  it('shows manifest and values for Helm releases while hiding events and YAML', async () => {
    await renderObjectPanel({
      kind: 'HelmRelease',
      name: 'my-app',
      namespace: 'team-a',
    });

    const labels = getTabLabels();
    expect(labels).toContain('Details');
    expect(labels).toContain('Manifest');
    expect(labels).toContain('Values');
    expect(labels).not.toContain('Events');
    expect(labels).not.toContain('YAML');
  });

  it('registers refreshers and wires refresh watcher for active detail scope', async () => {
    await renderObjectPanel({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
      scopedDomain: { data: { details: {} }, status: 'idle', error: null },
    });

    const detailScope = buildClusterScope(defaultClusterId, 'team-a:/v1:pod:api');
    // Refresher names are panel-scoped (kind + panelId) so simultaneously-open
    // same-kind panels register distinct refreshers.
    const refresherName = `object-pod:${buildPanelId(defaultClusterId, 'Pod', 'team-a', 'api')}`;

    expect(mockRefreshManager.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: refresherName, interval: 2000 })
    );
    expect(mockUseRefreshWatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        refresherName,
        enabled: true,
      })
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-details',
      detailScope,
      expect.objectContaining({ isManual: false })
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-details',
      detailScope,
      true,
      { preserveState: true }
    );

    await act(async () => {
      ctx.root.unmount();
    });

    expect(mockRefreshManager.unregister).toHaveBeenCalledWith(refresherName);
    // Tier 1 responsiveness: unmount disables refreshing but preserves
    // the cached snapshot so a remount (cluster switch round-trip)
    // renders instantly. Eviction now lives in
    // ObjectPanelStateContext.closePanel, not in the unmount destructor.
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-details',
      detailScope,
      false,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.resetScopedDomain).not.toHaveBeenCalledWith(
      'object-details',
      detailScope
    );
  });

  it('closes the panel after a delete via onAfterDelete', async () => {
    // Action execution + modals now live in the shared controller (ActionsMenu);
    // ObjectPanel only wires the lifecycle callbacks it hands to DetailsTab.
    await renderObjectPanel({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
    });

    const detailsProps = getDetailsTabProps();
    expect(detailsProps).toBeTruthy();

    act(() => {
      detailsProps.onAfterDelete();
    });

    expect(mockClosePanel).toHaveBeenCalled();
  });

  it('refetches details after a mutating action via onAfterAction', async () => {
    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      group: 'apps',
      version: 'v1',
      scopedDomain: { data: { details: {} }, status: 'idle', error: null },
    });

    const detailsProps = getDetailsTabProps();
    expect(detailsProps).toBeTruthy();

    await act(async () => {
      detailsProps.onAfterAction();
      await Promise.resolve();
    });

    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-details',
      buildClusterScope(defaultClusterId, 'team-a:apps/v1:deployment:api'),
      expect.objectContaining({ isManual: true })
    );
  });

  it('renders log viewer props when the Logs tab is selected', async () => {
    await renderObjectPanel({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
    });

    expect(logViewerPropsRef.current).toBeNull();
    const logsButton = getTabButton('Logs');
    await act(async () => {
      logsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(logViewerPropsRef.current).toMatchObject({
      namespace: 'team-a',
      resourceName: 'api',
      resourceKind: 'pod',
      isActive: true,
      clusterId: defaultClusterId,
    });
  });

  it('applies a pre-mount tab request so shell opens as the active tab', async () => {
    const panelId = buildPanelId(defaultClusterId, 'Pod', 'team-a', 'api');
    requestObjectPanelTab(panelId, 'shell');

    await renderObjectPanel({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
    });

    const shellButton = getTabButton('Shell');
    expect(shellButton).toBeTruthy();
    expect(shellButton?.classList.contains('tab-item--active')).toBe(true);
  });

  it('activates events tab content and passes through object data', async () => {
    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
    });

    const eventsButton = getTabButton('Events');
    await act(async () => {
      eventsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(eventsTabPropsRef.current).toMatchObject({
      objectData: expect.objectContaining({ kind: 'Deployment', name: 'api' }),
      isActive: true,
    });
  });

  it('passes capability state to the YAML tab when selected', async () => {
    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      capabilityOverrides: {
        'edit-yaml': { allowed: false, pending: false, reason: 'forbidden' },
      },
    });

    const yamlButton = getTabButton('YAML');
    await act(async () => {
      yamlButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(yamlTabPropsRef.current).toMatchObject({
      scope: buildClusterScope(defaultClusterId, 'team-a:apps/v1:deployment:api'),
      canEdit: false,
      editDisabledReason: 'forbidden',
      isActive: true,
    });
  });

  it('suppresses events and YAML tabs for event resources', async () => {
    await renderObjectPanel({
      kind: 'Event',
      name: 'warning-123',
      namespace: 'team-a',
    });

    const labels = getTabLabels();
    expect(labels).toContain('Details');
    expect(labels).not.toContain('Logs');
    expect(labels).not.toContain('Events');
    expect(labels).not.toContain('YAML');
  });

  it('supplies Helm scopes to manifest and values tabs', async () => {
    await renderObjectPanel({
      kind: 'HelmRelease',
      name: 'my-app',
      namespace: 'team-a',
    });

    const manifestButton = getTabButton('Manifest');
    await act(async () => {
      manifestButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(manifestTabPropsRef.current).toMatchObject({
      scope: buildClusterScope(defaultClusterId, 'team-a:my-app'),
      isActive: true,
    });

    const valuesButton = getTabButton('Values');
    await act(async () => {
      valuesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(valuesTabPropsRef.current).toMatchObject({
      scope: buildClusterScope(defaultClusterId, 'team-a:my-app'),
      isActive: true,
    });
  });

  it('evaluates namespace permissions whenever a namespace is present', async () => {
    await renderObjectPanel({
      kind: 'Pod',
      name: 'api',
      namespace: ' Team-A ',
    });

    expect(mockQueryNamespacePermissions).toHaveBeenCalledWith('Team-A', defaultClusterId);
  });

  it('skips namespace evaluation when the object has no namespace', async () => {
    await renderObjectPanel({
      kind: 'Namespace',
      name: 'platform',
      namespace: undefined,
    });

    expect(mockQueryNamespacePermissions).not.toHaveBeenCalled();
  });

  const detailMappingCases = [
    ['DaemonSet', { desiredNumberScheduled: 1 }],
    ['ReplicaSet', { replicas: '1/1' }],
    ['StatefulSet', { replicas: 2 }],
    ['Job', { completions: 1 }],
    ['CronJob', { schedule: '* * * * *' }],
    ['ConfigMap', { data: { key: 'value' } }],
    ['Secret', { type: 'Opaque' }],
    ['Service', { selector: {} }],
    ['Ingress', { rules: [] }],
    ['NetworkPolicy', { policyTypes: [] }],
    ['EndpointSlice', { slices: [] }],
    ['StorageClass', { provisioner: 'kubernetes.io/aws-ebs' }],
    ['ServiceAccount', { secrets: [] }],
    ['Role', { rules: [] }],
    ['RoleBinding', { subjects: [] }],
    ['ClusterRole', { rules: [] }],
    ['ClusterRoleBinding', { subjects: [] }],
    ['HorizontalPodAutoscaler', { currentReplicas: 1 }],
    ['PodDisruptionBudget', { selector: {} }],
    ['ResourceQuota', { hard: {} }],
    ['LimitRange', { limits: [] }],
    ['PersistentVolume', { capacity: {} }],
    ['PersistentVolumeClaim', { status: 'Bound' }],
    ['Namespace', { status: 'Active' }],
    ['IngressClass', { controller: 'example' }],
    ['CustomResourceDefinition', { metadata: { name: 'demo' } }],
    ['MutatingWebhookConfiguration', { webhooks: [] }],
    ['ValidatingWebhookConfiguration', { webhooks: [] }],
  ] as const;

  it.each(
    detailMappingCases
  )('exposes the detail payload as the active detail for %s resources', async (kind, detailsPayload) => {
    await renderObjectPanel({
      kind,
      name: 'resource',
      namespace: 'team-a',
      scopedDomain: {
        data: { details: detailsPayload },
        status: 'ready',
        error: null,
      },
    });

    expect(getDetailsTabProps().detailModel.activeDetail).toEqual(detailsPayload);
  });

  it('derives no typed detail sections for unknown kinds', async () => {
    await renderObjectPanel({
      kind: 'UnknownKind',
      name: 'mystery',
      namespace: 'team-a',
      scopedDomain: {
        data: { details: { value: 1 } },
        status: 'ready',
        error: null,
      },
    });

    const model = getDetailsTabProps().detailModel;
    expect(model.containerSection).toBeNull();
    expect(model.dataSection).toBeNull();
    expect(model.roleRules).toBeUndefined();
    expect(model.desiredScaleReplicas).toBe(0);
    expect(model.activePodNames).toBeNull();
  });
});
