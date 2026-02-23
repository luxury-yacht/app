/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.test.tsx
 */

import ReactDOM from 'react-dom/client';
import { createContext } from 'react';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { requestObjectPanelTab } from '@modules/object-panel/objectPanelTabRequests';

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
  capabilityOverrides?: Record<string, CapabilityState>;
  logPermission?: { allowed: boolean; pending: boolean };
  scopedDomain?: { data: unknown; status: string; error: string | null };
};

const {
  detailsTabPropsRef,
  restartModalPropsRef,
  deleteModalPropsRef,
  logViewerPropsRef,
  shellTabPropsRef,
  eventsTabPropsRef,
  yamlTabPropsRef,
  manifestTabPropsRef,
  valuesTabPropsRef,
} = vi.hoisted(() => ({
  detailsTabPropsRef: { current: null as any },
  restartModalPropsRef: { current: null as any },
  deleteModalPropsRef: { current: null as any },
  logViewerPropsRef: { current: null as any },
  shellTabPropsRef: { current: null as any },
  eventsTabPropsRef: { current: null as any },
  yamlTabPropsRef: { current: null as any },
  manifestTabPropsRef: { current: null as any },
  valuesTabPropsRef: { current: null as any },
}));

const mockClosePanel = vi.fn();
const mockUseCapabilities = vi.fn();
const mockUseUserPermission = vi.fn();
const mockEvaluateNamespacePermissions = vi.fn();
const mockUseRefreshScopedDomain = vi.fn();
const mockUseRefreshWatcher = vi.fn();
const mockUseShortcut = vi.fn();
const mockUseKeyboardNavigationScope = vi.fn();

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
  RestartWorkload: vi.fn().mockResolvedValue(undefined),
  DeletePod: vi.fn().mockResolvedValue(undefined),
  DeleteHelmRelease: vi.fn().mockResolvedValue(undefined),
  DeleteResource: vi.fn().mockResolvedValue(undefined),
  ScaleWorkload: vi.fn().mockResolvedValue(undefined),
};

const defaultClusterId = 'alpha:ctx';

// Mock useObjectPanelState to provide closePanel
vi.mock('@/core/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelState: () => ({
    closePanel: mockClosePanel,
    openPanels: new Map(),
    showObjectPanel: true,
    onRowClick: vi.fn(),
    onCloseObjectPanel: vi.fn(),
    setShowObjectPanel: vi.fn(),
    hydrateClusterMeta: vi.fn((d: any) => d),
  }),
}));

// Mock dockable to provide both DockablePanel and useDockablePanelContext
vi.mock('@ui/dockable', () => ({
  DockablePanel: ({ children }: any) => (
    <div>
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

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: (props: any) => {
    if (props?.title === 'Restart Workload') {
      restartModalPropsRef.current = props;
    } else {
      deleteModalPropsRef.current = props;
    }
    return null;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Details/DetailsTab', () => ({
  default: (props: any) => {
    detailsTabPropsRef.current = props;
    return <div data-testid="details-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Logs/LogViewer', () => ({
  default: (props: any) => {
    logViewerPropsRef.current = props;
    return <div data-testid="logs-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Shell/ShellTab', () => ({
  default: (props: any) => {
    shellTabPropsRef.current = props;
    return <div data-testid="shell-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Events/EventsTab', () => ({
  default: (props: any) => {
    eventsTabPropsRef.current = props;
    return <div data-testid="events-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Yaml/YamlTab', () => ({
  default: (props: any) => {
    yamlTabPropsRef.current = props;
    return <div data-testid="yaml-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ManifestTab', () => ({
  default: (props: any) => {
    manifestTabPropsRef.current = props;
    return <div data-testid="manifest-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ValuesTab', () => ({
  default: (props: any) => {
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
  evaluateNamespacePermissions: (...args: unknown[]) =>
    mockEvaluateNamespacePermissions(...(args as [])),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => mockUseShortcut(...(args as [])),
  useShortcuts: vi.fn(),
  useSearchShortcutTarget: () => undefined,
  useKeyboardNavigationScope: (...args: unknown[]) =>
    mockUseKeyboardNavigationScope(...(args as [])),
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
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
    restartModalPropsRef.current = null;
    deleteModalPropsRef.current = null;
    logViewerPropsRef.current = null;
    shellTabPropsRef.current = null;
    eventsTabPropsRef.current = null;
    yamlTabPropsRef.current = null;
    manifestTabPropsRef.current = null;
    valuesTabPropsRef.current = null;

    mockApp.RestartWorkload.mockClear();
    mockApp.DeletePod.mockClear();
    mockApp.DeleteHelmRelease.mockClear();
    mockApp.DeleteResource.mockClear();
    mockApp.ScaleWorkload.mockClear();

    mockRefreshOrchestrator.fetchScopedDomain.mockResolvedValue(undefined);

    mockUseRefreshWatcher.mockClear();
    mockClosePanel.mockReset();

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
    const objectRef = {
      kind: options.kind,
      name: options.name,
      namespace: options.namespace,
      kindAlias: options.kind,
      clusterId,
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

    const detailScope = buildClusterScope(defaultClusterId, 'team-a:pod:api');

    expect(mockRefreshManager.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'object-pod', interval: 2000 })
    );
    expect(mockUseRefreshWatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        refresherName: 'object-pod',
        enabled: true,
      })
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-details',
      detailScope,
      expect.objectContaining({ isManual: true })
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-details',
      detailScope,
      true
    );

    await act(async () => {
      ctx.root.unmount();
    });

    expect(mockRefreshManager.unregister).toHaveBeenCalledWith('object-pod');
    expect(mockRefreshOrchestrator.resetScopedDomain).toHaveBeenCalledWith(
      'object-details',
      detailScope
    );
  });

  it('confirms deletion through modal and calls backend delete', async () => {
    await renderObjectPanel({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
    });

    const detailsProps = detailsTabPropsRef.current;
    expect(detailsProps).toBeTruthy();
    act(() => {
      detailsProps.onDeleteClick();
    });

    const modalProps = deleteModalPropsRef.current;
    expect(modalProps?.isOpen).toBe(true);

    await act(async () => {
      await modalProps.onConfirm();
    });

    expect(mockApp.DeletePod).toHaveBeenCalledWith('alpha:ctx', 'team-a', 'api');
    expect(mockClosePanel).toHaveBeenCalled();
  });

  it('scales workloads when onScaleClick is triggered', async () => {
    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      scopedDomain: { data: { details: {} }, status: 'idle', error: null },
    });

    const detailsProps = detailsTabPropsRef.current;
    expect(detailsProps).toBeTruthy();

    await act(async () => {
      await detailsProps.onScaleClick(5);
    });

    expect(mockApp.ScaleWorkload).toHaveBeenCalledWith(
      'alpha:ctx',
      'team-a',
      'api',
      'Deployment',
      5
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-details',
      buildClusterScope(defaultClusterId, 'team-a:deployment:api'),
      expect.objectContaining({ isManual: true })
    );
  });

  it('restarts workloads using canonical workload kind casing', async () => {
    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      scopedDomain: { data: { details: {} }, status: 'idle', error: null },
    });

    const detailsProps = detailsTabPropsRef.current;
    expect(detailsProps).toBeTruthy();

    act(() => {
      detailsProps.onRestartClick();
    });

    const modalProps = restartModalPropsRef.current;
    expect(modalProps?.isOpen).toBe(true);

    await act(async () => {
      await modalProps.onConfirm();
    });

    expect(mockApp.RestartWorkload).toHaveBeenCalledWith(
      'alpha:ctx',
      'team-a',
      'api',
      'Deployment'
    );
  });

  it('initialises the scale input based on desired replicas when shown', async () => {
    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      scopedDomain: {
        data: {
          details: {
            desiredReplicas: 7,
          },
        },
        status: 'ready',
        error: null,
      },
    });

    act(() => {
      detailsTabPropsRef.current.onShowScaleInput();
    });

    expect(detailsTabPropsRef.current.scaleReplicas).toBe(7);
    expect(detailsTabPropsRef.current.showScaleInput).toBe(true);
  });

  it('surfaces restart errors and reports them through the error handler', async () => {
    mockApp.RestartWorkload.mockRejectedValueOnce(new Error('restart failed'));
    const errorSpy = vi.spyOn(mockErrorHandler, 'handle');

    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      scopedDomain: { data: { details: {} }, status: 'idle', error: null },
    });

    act(() => {
      detailsTabPropsRef.current.onRestartClick();
    });
    await act(async () => {
      await restartModalPropsRef.current.onConfirm();
    });

    expect(detailsTabPropsRef.current.actionError).toBe('restart failed');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'restartResource' })
    );
    errorSpy.mockRestore();
  });

  it('deletes Helm releases via the specialised backend call', async () => {
    await renderObjectPanel({
      kind: 'HelmRelease',
      name: 'demo',
      namespace: 'helm-ns',
    });

    act(() => {
      detailsTabPropsRef.current.onDeleteClick();
    });
    await act(async () => {
      await deleteModalPropsRef.current.onConfirm();
    });

    expect(mockApp.DeleteHelmRelease).toHaveBeenCalledWith('alpha:ctx', 'helm-ns', 'demo');
  });

  it('falls back to DeleteResource for generic kinds', async () => {
    await renderObjectPanel({
      kind: 'ConfigMap',
      name: 'settings',
      namespace: 'team-a',
    });

    act(() => {
      detailsTabPropsRef.current.onDeleteClick();
    });
    await act(async () => {
      await deleteModalPropsRef.current.onConfirm();
    });

    expect(mockApp.DeleteResource).toHaveBeenCalledWith(
      'alpha:ctx',
      'ConfigMap',
      'team-a',
      'settings'
    );
  });

  it('handles scale errors and keeps the scale input visible', async () => {
    mockApp.ScaleWorkload.mockRejectedValueOnce(new Error('scale failed'));
    const errorSpy = vi.spyOn(mockErrorHandler, 'handle');

    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      scopedDomain: { data: { details: {} }, status: 'idle', error: null },
    });

    act(() => {
      detailsTabPropsRef.current.onShowScaleInput();
    });

    await act(async () => {
      await detailsTabPropsRef.current.onScaleClick(4);
    });

    expect(detailsTabPropsRef.current.actionError).toBe('scale failed');
    expect(detailsTabPropsRef.current.showScaleInput).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'scaleResource' })
    );
    errorSpy.mockRestore();
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
      scope: buildClusterScope(defaultClusterId, 'team-a:deployment:api'),
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

    expect(mockEvaluateNamespacePermissions).toHaveBeenCalledWith('Team-A', {
      clusterId: defaultClusterId,
    });
  });

  it('skips namespace evaluation when the object has no namespace', async () => {
    await renderObjectPanel({
      kind: 'Namespace',
      name: 'platform',
      namespace: undefined,
    });

    expect(mockEvaluateNamespacePermissions).not.toHaveBeenCalled();
  });

  it('ignores scale clicks without an explicit replica count', async () => {
    await renderObjectPanel({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
    });

    act(() => {
      detailsTabPropsRef.current.onScaleClick();
    });

    expect(mockApp.ScaleWorkload).not.toHaveBeenCalled();
  });

  const detailMappingCases = [
    ['DaemonSet', 'daemonSetDetails', { desiredNumberScheduled: 1 }],
    ['ReplicaSet', 'replicaSetDetails', { replicas: '1/1' }],
    ['StatefulSet', 'statefulSetDetails', { replicas: 2 }],
    ['Job', 'jobDetails', { completions: 1 }],
    ['CronJob', 'cronJobDetails', { schedule: '* * * * *' }],
    ['ConfigMap', 'configMapDetails', { data: { key: 'value' } }],
    ['Secret', 'secretDetails', { type: 'Opaque' }],
    ['Service', 'serviceDetails', { selector: {} }],
    ['Ingress', 'ingressDetails', { rules: [] }],
    ['NetworkPolicy', 'networkPolicyDetails', { policyTypes: [] }],
    ['EndpointSlice', 'endpointSliceDetails', { slices: [] }],
    ['StorageClass', 'storageClassDetails', { provisioner: 'kubernetes.io/aws-ebs' }],
    ['ServiceAccount', 'serviceAccountDetails', { secrets: [] }],
    ['Role', 'roleDetails', { rules: [] }],
    ['RoleBinding', 'roleBindingDetails', { subjects: [] }],
    ['ClusterRole', 'clusterRoleDetails', { rules: [] }],
    ['ClusterRoleBinding', 'clusterRoleBindingDetails', { subjects: [] }],
    ['HorizontalPodAutoscaler', 'hpaDetails', { currentReplicas: 1 }],
    ['PodDisruptionBudget', 'pdbDetails', { selector: {} }],
    ['ResourceQuota', 'resourceQuotaDetails', { hard: {} }],
    ['LimitRange', 'limitRangeDetails', { limits: [] }],
    ['PersistentVolume', 'pvDetails', { capacity: {} }],
    ['PersistentVolumeClaim', 'pvcDetails', { status: 'Bound' }],
    ['Namespace', 'namespaceDetails', { status: 'Active' }],
    ['IngressClass', 'ingressClassDetails', { controller: 'example' }],
    ['CustomResourceDefinition', 'crdDetails', { metadata: { name: 'demo' } }],
    ['MutatingWebhookConfiguration', 'mutatingWebhookDetails', { webhooks: [] }],
    ['ValidatingWebhookConfiguration', 'validatingWebhookDetails', { webhooks: [] }],
  ] as const;

  it.each(detailMappingCases)(
    'assigns detail payloads for %s resources to the correct property',
    async (kind, property, detailsPayload) => {
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

      expect((detailsTabPropsRef.current as Record<string, unknown>)[property]).toEqual(
        detailsPayload
      );
    }
  );

  it('falls back to empty details for unknown kinds', async () => {
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

    expect(detailsTabPropsRef.current).toMatchObject({
      podDetails: null,
      deploymentDetails: null,
    });
  });
});
