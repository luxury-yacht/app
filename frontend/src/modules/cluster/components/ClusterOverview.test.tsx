/**
 * frontend/src/modules/cluster/components/ClusterOverview.test.tsx
 *
 * Test suite for ClusterOverview.
 * Covers key behaviors and edge cases for ClusterOverview.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { act, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import type { ClusterOverviewPayload, ClusterOverviewSnapshotPayload } from '@/core/refresh/types';
import ClusterOverview from './ClusterOverview';

const {
  mockRefreshOrchestrator,
  domainStateRef,
  kubeconfigStateRef,
  setSelectedNamespaceMock,
  setActiveNamespaceTabMock,
  setActiveClusterViewMock,
  setSidebarSelectionMock,
  navigateToClusterViewMock,
  navigateToNamespaceMock,
  getAppInfoMock,
  browserOpenURLMock,
  openWithObjectMock,
  setObjectPanelActiveTabMock,
  canResolveEventObjectReferenceMock,
  resolveEventObjectReferenceMock,
  requestGridTableFiltersMock,
} = vi.hoisted(() => {
  return {
    mockRefreshOrchestrator: {
      setScopedDomainEnabled: vi.fn(),
      fetchScopedDomain: vi.fn(() => Promise.resolve()),
      resetDomain: vi.fn(),
    },
    domainStateRef: {
      current: createDomainState('loading'),
    },
    kubeconfigStateRef: {
      current: {
        kubeconfigs: [],
        selectedKubeconfigs: ['cluster-1'],
        selectedKubeconfig: 'cluster-1',
        selectedClusterId: 'cluster-1',
        selectedClusterName: 'cluster-1',
        selectedClusterIds: ['cluster-1'],
        kubeconfigsLoading: false,
        setSelectedKubeconfigs: vi.fn(),
        setActiveKubeconfig: vi.fn(),
        getClusterMeta: vi.fn(),
        loadKubeconfigs: vi.fn(),
      },
    },
    setSelectedNamespaceMock: vi.fn(),
    setActiveNamespaceTabMock: vi.fn(),
    setActiveClusterViewMock: vi.fn(),
    setSidebarSelectionMock: vi.fn(),
    navigateToClusterViewMock: vi.fn(),
    navigateToNamespaceMock: vi.fn(),
    getAppInfoMock: vi.fn(),
    browserOpenURLMock: vi.fn(),
    openWithObjectMock: vi.fn(),
    setObjectPanelActiveTabMock: vi.fn(),
    canResolveEventObjectReferenceMock: vi.fn(() => false),
    resolveEventObjectReferenceMock: vi.fn(),
    requestGridTableFiltersMock: vi.fn(),
  };
});
let mockLifecycleState = 'ready';
let mockNamespaceReady = true;
let mockHealth: 'healthy' | 'degraded' | 'unknown' = 'healthy';
let mockAutoRefreshEnabled = true;
let mockAuthState = {
  hasError: false,
  reason: '',
  clusterName: '',
  isRecovering: false,
  secondsUntilRetry: 0,
  errorClass: '' as const,
};

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
  useRefreshScopedDomain: () => domainStateRef.current,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  __esModule: true,
  useKubeconfig: () => kubeconfigStateRef.current,
}));

vi.mock('@shared/components/tables/hooks/useGridTableExternalFilters', () => ({
  requestGridTableFilters: requestGridTableFiltersMock,
}));

vi.mock('@shared/components/ResourceBar', () => ({
  __esModule: true,
  default: ({ usage, request, limit, type }: Record<string, unknown>) => (
    <div data-testid={`resource-bar-${type}`}>
      {(usage as string | undefined) ?? '-'}|{(request as string | undefined) ?? '-'}|
      {(limit as string | undefined) ?? '-'}
    </div>
  ),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({
    content,
    children,
    disabled,
  }: {
    content: ReactNode;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <div data-testid="tooltip-wrapper">
      {children}
      {!disabled && <div data-testid="tooltip-content">{content}</div>}
    </div>
  ),
}));

vi.mock('@assets/luxury-yacht-color-vert.png', () => ({
  __esModule: true,
  default: 'luxury-yacht-color-vert.png',
}));
vi.mock('@assets/captain-k8s-color.png', () => ({
  __esModule: true,
  default: 'captain-k8s-color.png',
}));
vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  __esModule: true,
  useNamespace: () => ({
    namespaces: [],
    selectedNamespace: 'default',
    namespaceLoading: false,
    namespaceRefreshing: false,
    namespaceReady: mockNamespaceReady,
    setSelectedNamespace: setSelectedNamespaceMock,
    loadNamespaces: vi.fn(),
    refreshNamespaces: vi.fn(),
  }),
}));
vi.mock('@/core/contexts/ViewStateContext', () => ({
  __esModule: true,
  useViewState: () => ({
    viewType: 'overview',
    previousView: 'overview',
    activeNamespaceTab: 'workloads',
    activeClusterTab: null,
    isSettingsOpen: false,
    isAboutOpen: false,
    isSidebarVisible: true,
    sidebarWidth: 250,
    isResizing: false,
    sidebarSelection: { type: 'overview', value: 'overview' },
    showObjectPanel: false,
    selectedObject: null,
    navigationHistory: [],
    navigationIndex: 0,
    setViewType: vi.fn(),
    setPreviousView: vi.fn(),
    setActiveNamespaceTab: setActiveNamespaceTabMock,
    setActiveClusterView: setActiveClusterViewMock,
    setIsSettingsOpen: vi.fn(),
    setIsAboutOpen: vi.fn(),
    toggleSidebar: vi.fn(),
    setSidebarWidth: vi.fn(),
    setIsResizing: vi.fn(),
    setSidebarSelection: setSidebarSelectionMock,
    setShowObjectPanel: vi.fn(),
    setSelectedObject: vi.fn(),
    onRowClick: vi.fn(),
    onCloseObjectPanel: vi.fn(),
    onNavigate: vi.fn(),
    navigateToClusterView: navigateToClusterViewMock,
    navigateToNamespace: navigateToNamespaceMock,
    onNamespaceSelect: vi.fn(),
    onClusterObjectsClick: vi.fn(),
  }),
}));
vi.mock('@wailsjs/go/backend/App', () => ({
  __esModule: true,
  GetAppInfo: (...args: unknown[]) => getAppInfoMock(...args),
}));
vi.mock('@wailsjs/runtime/runtime', () => ({
  __esModule: true,
  BrowserOpenURL: (...args: unknown[]) => browserOpenURLMock(...args),
}));

vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({
    getClusterState: () => mockLifecycleState,
    isClusterReady: () => mockLifecycleState === 'ready',
  }),
}));

vi.mock('@/hooks/useWailsRuntimeEvents', () => ({
  useClusterHealthListener: () => ({
    getActiveClusterHealth: () => mockHealth,
  }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    close: vi.fn(),
    isOpen: false,
    openPanels: [],
    objectData: null,
  }),
}));

vi.mock('@modules/object-panel/contexts/ObjectPanelStateContext', async () => {
  const actual = await vi.importActual<
    typeof import('@modules/object-panel/contexts/ObjectPanelStateContext')
  >('@modules/object-panel/contexts/ObjectPanelStateContext');
  return {
    ...actual,
    useObjectPanelState: () => ({
      setObjectPanelActiveTab: setObjectPanelActiveTabMock,
      hydrateClusterMeta: (ref: unknown) => ref,
    }),
  };
});

vi.mock('@shared/utils/eventObjectIdentity', () => ({
  canResolveEventObjectReference: canResolveEventObjectReferenceMock,
  resolveEventObjectReference: resolveEventObjectReferenceMock,
}));

vi.mock('@/core/contexts/AuthErrorContext', () => ({
  useActiveClusterAuthState: () => mockAuthState,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => mockAutoRefreshEnabled,
}));

describe('ClusterOverview', () => {
  let cleanupRoot: (() => void) | null = null;

  beforeEach(() => {
    domainStateRef.current = createDomainState('loading');
    kubeconfigStateRef.current = {
      ...kubeconfigStateRef.current,
      selectedKubeconfigs: ['cluster-1'],
      selectedKubeconfig: 'cluster-1',
      selectedClusterId: 'cluster-1',
      selectedClusterName: 'cluster-1',
      selectedClusterIds: ['cluster-1'],
      kubeconfigsLoading: false,
    };
    vi.clearAllMocks();
    mockLifecycleState = 'ready';
    mockNamespaceReady = true;
    mockHealth = 'healthy';
    mockAutoRefreshEnabled = true;
    mockAuthState = {
      hasError: false,
      reason: '',
      clusterName: '',
      isRecovering: false,
      secondsUntilRetry: 0,
      errorClass: '' as const,
    };
    canResolveEventObjectReferenceMock.mockReturnValue(false);
    resolveEventObjectReferenceMock.mockReset();
    cleanupRoot = null;
  });

  afterEach(() => {
    if (cleanupRoot) {
      cleanupRoot();
      cleanupRoot = null;
    }
  });

  it('renders zero-value skeleton with loading message before data arrives', async () => {
    mockLifecycleState = 'loading';

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-overview',
      'cluster-1|',
      true,
      // preserveState pins the tab-switch fix: the streaming enable path
      // resets scoped state without it, blanking the overview per switch.
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    expect(container.querySelector('.cluster-overview')?.classList.contains('selectable')).toBe(
      true
    );
    expect(statValueFor(container, 'total')).toBe('—');
    expect(statValueFor(container, 'namespaces')).toBe('—');
    expect(
      container.querySelector('.cluster-overview .cluster-overview-loading-inline') ?? null
    ).toBeNull();
  });

  it('hydrates with overview data once the domain resolves', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        clusterType: 'EKS',
        clusterVersion: '1.26.3',
        cpuUsage: '400m',
        cpuRequests: '500m',
        cpuLimits: '1000m',
        cpuAllocatable: '2000m',
        memoryUsage: '2Gi',
        memoryRequests: '3Gi',
        memoryLimits: '8Gi',
        memoryAllocatable: '16Gi',
        totalNodes: 3,
        fargateNodes: 1,
        regularNodes: 2,
        ec2Nodes: 2,
        virtualNodes: 0,
        vmNodes: 0,
        totalPods: 42,
        totalContainers: 84,
        totalInitContainers: 3,
        runningPods: 40,
        succeededPods: 0,
        pendingPods: 1,
        failedPods: 1,
        readyPods: 40,
        startingPods: 1,
        failingPods: 1,
        terminatingPods: 2,
        restartedPods: 7,
        notReadyPods: 9,
        totalNamespaces: 6,
        totalDeployments: 8,
        totalStatefulSets: 2,
        totalDaemonSets: 1,
        totalCronJobs: 3,
        readyNodes: 3,
        notReadyNodes: 0,
        cordonedNodes: 0,
        recentEvents: [],
      },
    });

    rerender();
    await flushEffects();

    expect(statValueFor(container, 'total')).toBe('3');
    expect(statValueFor(container, 'namespaces')).toBe('6');
    expect(statValueFor(container, 'pods')).toBe('42');
    expect(container.textContent).toContain('EKS');
    expect(container.textContent).toContain('1.26.3');
    expect(container.textContent).not.toContain('Loading cluster overview...');
    expect(container.textContent).toContain('Pod Status');
    expect(container.textContent).toContain('Pod Signals');
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('400m of 2 cores');
    expect(container.textContent).toContain('20.0%');
    expect(container.textContent).toContain('2.0Gi of 16.0Gi');
    expect(container.textContent).toContain('12.5%');
    expect(
      container.querySelector('[data-testid="resource-utilization-tooltip-cpu"]')?.textContent
    ).toBe('Utilization0.420.0%Requests0.525.0%Limits150.0%');
    expect(
      container.querySelector('[data-testid="resource-utilization-tooltip-memory"]')?.textContent
    ).toBe('Utilization2.0Gi12.5%Requests3.0Gi18.8%Limits8.0Gi50.0%');
    expect(
      Array.from(container.querySelectorAll('.pod-status-card')).map(
        (element) => element.textContent
      )
    ).toEqual(['40ready', '1starting', '1failing', '2terminating', '7restarts', '9not ready']);
    expect(
      Array.from(container.querySelectorAll('.pod-status-card')).every(
        (element) => element.tagName === 'BUTTON'
      )
    ).toBe(true);
    expect(container.querySelector('.pod-status-card--ready')).not.toBeNull();
    expect(container.querySelector('.pod-status-card--starting')).not.toBeNull();
    expect(container.querySelector('.pod-status-card--failing')).not.toBeNull();
    expect(container.querySelector('.pod-status-card--terminating')).not.toBeNull();
    expect(container.querySelector('.pod-status-card--restarted')).not.toBeNull();
    expect(container.querySelector('.pod-status-card--not-ready')).not.toBeNull();
  });

  it('uses warning color classes for resource percentages over 100 percent', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        cpuUsage: '2500m',
        cpuRequests: '3000m',
        cpuLimits: '4000m',
        cpuAllocatable: '2000m',
        memoryUsage: '1Gi',
        memoryRequests: '1Gi',
        memoryLimits: '1Gi',
        memoryAllocatable: '2Gi',
      },
    });

    rerender();
    await flushEffects();

    expect(container.querySelector('.metric-header__percent--warning')?.textContent).toBe('125.0%');
    expect(
      Array.from(container.querySelectorAll('.resource-utilization-tooltip__percent--warning')).map(
        (element) => element.textContent
      )
    ).toEqual(['125.0%', '150.0%', '200.0%']);
  });

  it('shows loading namespaces detail until namespaces are ready', async () => {
    mockNamespaceReady = false;

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Status');
    expect(container.textContent).toContain('Loading namespaces');
  });

  it('keeps the ready label stable while overview data is refreshing', async () => {
    domainStateRef.current = createDomainState('updating', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        clusterType: 'EKS',
        clusterVersion: '1.26.3',
        totalNodes: 3,
        totalNamespaces: 6,
        totalPods: 42,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Status');
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).not.toContain('Refreshing cluster data');
  });

  it('shows auto-refresh paused when background refresh is disabled', async () => {
    mockAutoRefreshEnabled = false;

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Status');
    expect(container.textContent).toContain('Auto-refresh paused');
    expect(container.textContent).not.toContain('Ready');
  });

  it('uses only the active cluster scope even when multiple clusters are selected', async () => {
    kubeconfigStateRef.current = {
      ...kubeconfigStateRef.current,
      selectedKubeconfigs: ['cluster-1', 'cluster-2'],
      selectedClusterIds: ['cluster-1', 'cluster-2'],
      selectedClusterId: 'cluster-1',
      selectedClusterName: 'cluster-1',
    };

    const { cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-overview',
      'cluster-1|',
      true,
      // preserveState pins the tab-switch fix: the streaming enable path
      // resets scoped state without it, blanking the overview per switch.
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
  });

  it('repaints cached overview data on a cluster-tab switch without requesting a reload', async () => {
    domainStateRef.current = createDomainState('ready', {
      clusterId: 'cluster-1',
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        totalNodes: 3,
      },
    });
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    kubeconfigStateRef.current = {
      ...kubeconfigStateRef.current,
      selectedKubeconfigs: ['cluster-1', 'cluster-2'],
      selectedKubeconfig: 'cluster-2',
      selectedClusterId: 'cluster-2',
      selectedClusterName: 'cluster-2',
      selectedClusterIds: ['cluster-1', 'cluster-2'],
    };
    domainStateRef.current = createDomainState('ready', {
      clusterId: 'cluster-2',
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        totalNodes: 9,
      },
    });

    rerender();
    await flushEffects();

    expect(statValueFor(container, 'total')).toBe('9');
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
  });

  it('stays empty and paused on a new cluster tab even if overview data exists for another cluster', async () => {
    mockAutoRefreshEnabled = false;
    kubeconfigStateRef.current = {
      ...kubeconfigStateRef.current,
      selectedKubeconfigs: ['cluster-1', 'cluster-2'],
      selectedClusterIds: ['cluster-1', 'cluster-2'],
      selectedClusterId: 'cluster-1',
      selectedClusterName: 'cluster-1',
    };
    domainStateRef.current = {
      status: 'ready',
      data: {
        clusterId: 'cluster-2',
        overview: {
          ...EMPTY_OVERVIEW_DATA,
          totalNodes: 9,
          totalNamespaces: 4,
          totalPods: 99,
        },
      },
      error: null,
    };

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Auto-refresh paused');
    expect(container.textContent).not.toContain('Ready');
    expect(statValueFor(container, 'total')).toBe('0');
    expect(statValueFor(container, 'namespaces')).toBe('0');
    expect(statValueFor(container, 'pods')).toBe('0');
  });

  it('updates the overview status when auto-refresh is toggled off', async () => {
    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Ready');

    await act(async () => {
      eventBus.emit('settings:auto-refresh', false);
    });

    expect(container.textContent).toContain('Auto-refresh paused');
    expect(container.textContent).not.toContain('Ready');
  });

  it('shows EC2 and Fargate cards for EKS clusters', async () => {
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        clusterType: 'EKS',
        totalNodes: 5,
        ec2Nodes: 3,
        fargateNodes: 2,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(statValueFor(container, 'total')).toBe('5');
    expect(statValueFor(container, 'ec2')).toBe('3');
    expect(statValueFor(container, 'fargate')).toBe('2');
    // AKS-specific cards should not appear.
    expect(statValueFor(container, 'vm')).toBe('');
    expect(statValueFor(container, 'virtual')).toBe('');
  });

  it('shows VM and Virtual cards for AKS clusters', async () => {
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        clusterType: 'AKS',
        totalNodes: 4,
        vmNodes: 3,
        virtualNodes: 1,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(statValueFor(container, 'total')).toBe('4');
    expect(statValueFor(container, 'vm')).toBe('3');
    expect(statValueFor(container, 'virtual')).toBe('1');
    // EKS-specific cards should not appear.
    expect(statValueFor(container, 'ec2')).toBe('');
    expect(statValueFor(container, 'fargate')).toBe('');
  });

  it('shows only Total card for GKE clusters', async () => {
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        clusterType: 'GKE',
        totalNodes: 6,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(statValueFor(container, 'total')).toBe('6');
    // No provider-specific breakdown cards.
    expect(statValueFor(container, 'ec2')).toBe('');
    expect(statValueFor(container, 'fargate')).toBe('');
    expect(statValueFor(container, 'vm')).toBe('');
    expect(statValueFor(container, 'virtual')).toBe('');
  });

  it('renders CPU and memory usage by workload type', async () => {
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        workloadResourceUsage: {
          deployments: { cpuUsage: '250m', memoryUsage: '300.0 Mi' },
          daemonSets: { cpuUsage: '50m', memoryUsage: '100.0 Mi' },
          statefulSets: { cpuUsage: '75m', memoryUsage: '120.0 Mi' },
          jobs: { cpuUsage: '125m', memoryUsage: '256.0 Mi' },
        },
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(
      Array.from(container.querySelectorAll('.resource-usage h3')).map((heading) =>
        heading.textContent?.trim()
      )
    ).toEqual(['CPU', 'Memory']);
    expect(container.querySelectorAll('.stacked-bar--workload-usage')).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll('[data-testid^="cluster-workload-usage-cpu-"]')).map(
        (item) => item.getAttribute('data-testid')
      )
    ).toEqual([
      'cluster-workload-usage-cpu-deployment',
      'cluster-workload-usage-cpu-statefulset',
      'cluster-workload-usage-cpu-daemonset',
      'cluster-workload-usage-cpu-job',
    ]);
    expect(
      container.querySelector('[data-testid="cluster-workload-usage-cpu-deployment"]')?.textContent
    ).toContain('250m');
    expect(
      container.querySelector('[data-testid="cluster-workload-usage-cpu-daemonset"]')?.textContent
    ).toContain('50m');
    expect(
      container.querySelector('[data-testid="cluster-workload-usage-cpu-statefulset"]')?.textContent
    ).toContain('75m');
    expect(
      container.querySelector('[data-testid="cluster-workload-usage-cpu-job"]')?.textContent
    ).toContain('125m');
    expect(
      container.querySelector('[data-testid="cluster-workload-usage-memory-deployment"]')
        ?.textContent
    ).toContain('300.0 Mi');
    expect(
      container.querySelector('[data-testid="cluster-workload-usage-memory-job"]')?.textContent
    ).toContain('256.0 Mi');
  });

  it('shows an inline error while retaining the zero skeleton when permissions fail', async () => {
    mockLifecycleState = 'loading';
    domainStateRef.current = createDomainState('error', { error: 'forbidden' });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Failed to load Cluster Overview data');
    expect(container.textContent).toContain('forbidden');
    expect(statValueFor(container, 'total')).toBe('0');
    expect(container.textContent).not.toContain('Loading cluster overview...');
  });

  it('opens Cluster Attention with the matching Pod finding filters from each non-ready status', async () => {
    mockLifecycleState = 'loading';
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        startingPods: 3,
        failingPods: 2,
        terminatingPods: 1,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    for (const [status, findings] of [
      ['starting', ['pod-unhealthy']],
      ['failing', ['error-presentation']],
      ['terminating', ['pod-unhealthy']],
    ] as const) {
      const card = container.querySelector(`[data-testid="cluster-pod-status-${status}"]`);
      expect(card).not.toBeNull();

      act(() => {
        card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(requestGridTableFiltersMock).toHaveBeenLastCalledWith({
        clusterId: 'cluster-1',
        destinationViewId: 'cluster-attention',
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          kinds: { mode: 'some', values: ['Pod'] },
          queryFacets: { findings: { mode: 'some', values: [...findings] } },
        },
      });
    }

    expect(setActiveClusterViewMock).toHaveBeenCalledWith('attention');
    expect(setSidebarSelectionMock).toHaveBeenCalledWith({
      type: 'cluster',
      value: 'cluster',
    });
    expect(navigateToClusterViewMock).toHaveBeenCalledWith('cluster');
  });

  it('navigates to Cluster Attention from restart and not-ready pod cards', async () => {
    mockLifecycleState = 'loading';
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        restartedPods: 4,
        notReadyPods: 2,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    const restartedCard = container.querySelector('[data-testid="cluster-pod-status-restarted"]');
    const notReadyCard = container.querySelector('[data-testid="cluster-pod-status-not-ready"]');
    expect(restartedCard?.tagName).toBe('BUTTON');
    expect(notReadyCard?.tagName).toBe('BUTTON');

    act(() => {
      restartedCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setActiveClusterViewMock).toHaveBeenLastCalledWith('attention');
    expect(requestGridTableFiltersMock).toHaveBeenLastCalledWith({
      clusterId: 'cluster-1',
      destinationViewId: 'cluster-attention',
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        kinds: { mode: 'some', values: ['Pod'] },
        queryFacets: { findings: { mode: 'some', values: ['restarts'] } },
      },
    });

    act(() => {
      notReadyCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setActiveClusterViewMock).toHaveBeenLastCalledWith('attention');
    expect(requestGridTableFiltersMock).toHaveBeenLastCalledWith({
      clusterId: 'cluster-1',
      destinationViewId: 'cluster-attention',
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        kinds: { mode: 'some', values: ['Pod'] },
        queryFacets: {
          findings: { mode: 'some', values: ['pod-not-ready'] },
        },
      },
    });
    expect(navigateToClusterViewMock).toHaveBeenCalledWith('cluster');
  });

  it('navigates to the Workloads Pods table without an unhealthy filter from the ready item', async () => {
    mockLifecycleState = 'loading';
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        readyPods: 5,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    const readyItem = container.querySelector('[data-testid="cluster-pod-status-ready"]');
    expect(readyItem).not.toBeNull();
    expect(readyItem?.textContent).toContain('5');

    act(() => {
      readyItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setSelectedNamespaceMock).toHaveBeenCalledWith(ALL_NAMESPACES_SCOPE);
    expect(setActiveNamespaceTabMock).toHaveBeenCalledWith('workloads');
    expect(setSidebarSelectionMock).toHaveBeenCalledWith({
      type: 'namespace',
      value: ALL_NAMESPACES_SCOPE,
    });
    expect(navigateToNamespaceMock).toHaveBeenCalled();
    expect(requestGridTableFiltersMock).not.toHaveBeenCalled();
  });

  it('navigates from non-ready and cordoned node signals to Cluster Nodes', async () => {
    mockLifecycleState = 'loading';
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        totalNodes: 5,
        readyNodes: 3,
        notReadyNodes: 2,
        cordonedNodes: 1,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    const readyItem = container.querySelector('[data-testid="cluster-node-health-ready"]');
    const notReadyItem = container.querySelector('[data-testid="cluster-node-health-notReady"]');
    const cordonedItem = container.querySelector('[data-testid="cluster-node-health-cordoned"]');
    expect(readyItem?.tagName).toBe('DIV');
    expect(notReadyItem?.tagName).toBe('BUTTON');
    expect(cordonedItem?.tagName).toBe('BUTTON');

    act(() => {
      notReadyItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setActiveClusterViewMock).toHaveBeenCalledWith('nodes');
    expect(navigateToClusterViewMock).toHaveBeenCalledWith('cluster');
    expect(setSidebarSelectionMock).toHaveBeenCalledWith({ type: 'cluster', value: 'cluster' });

    act(() => {
      cordonedItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setActiveClusterViewMock).toHaveBeenCalledTimes(2);
    expect(setActiveClusterViewMock).toHaveBeenLastCalledWith('nodes');
  });

  it('opens the recent event target via the UID-aware resolver and selects the events tab', async () => {
    mockLifecycleState = 'loading';
    canResolveEventObjectReferenceMock.mockReturnValue(true);
    resolveEventObjectReferenceMock.mockResolvedValue({
      clusterId: 'cluster-1',
      clusterName: 'cluster-1',
      kind: 'Pod',
      name: 'api-7c8d9',
      namespace: 'default',
      group: '',
      version: 'v1',
    });
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        recentEvents: [
          {
            clusterId: 'cluster-1',
            clusterName: 'cluster-1',
            eventUid: 'event-1',
            reason: 'Failed',
            message: 'Back-off restarting failed container',
            timestamp: Date.now(),
            objectKind: 'Pod',
            objectName: 'api-7c8d9',
            objectNamespace: 'default',
            objectApiVersion: '',
            objectUid: 'pod-uid-1',
          },
        ],
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    const row = container.querySelector('.recent-events__row--clickable');
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe('BUTTON');

    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(resolveEventObjectReferenceMock).toHaveBeenCalledWith({
      object: 'Pod/api-7c8d9',
      objectUid: 'pod-uid-1',
      objectApiVersion: '',
      objectNamespace: 'default',
      clusterId: 'cluster-1',
      clusterName: 'cluster-1',
    });
    expect(openWithObjectMock).toHaveBeenCalledWith({
      clusterId: 'cluster-1',
      clusterName: 'cluster-1',
      kind: 'Pod',
      name: 'api-7c8d9',
      namespace: 'default',
      group: '',
      version: 'v1',
    });
    expect(setObjectPanelActiveTabMock).toHaveBeenCalledWith(
      'obj:cluster-1:/v1/pod:default:api-7c8d9',
      'events'
    );
  });

  it('renders the nodes card as permission-gated when nodes are unavailable', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        clusterType: 'Unmanaged',
        cpuUsage: '400m',
        cpuLimits: '1000m',
        memoryUsage: '2Gi',
        memoryLimits: '8Gi',
        totalPods: 42,
        totalNamespaces: 6,
        unavailableResources: ['core/nodes'],
      },
    });

    rerender();
    await flushEffects();

    // The Nodes card shows the restriction notice above its graph and dashes out
    // the node counts (the graph is never hidden). "list, watch" are the actual
    // RBAC verbs the app needs for node data — never "view", which is a
    // ClusterRole name, not a permission.
    expect(
      container.querySelector('[data-testid="cluster-nodes-permission-note"]')?.textContent
    ).toContain('Node permissions: list, watch');
    expect(container.querySelector('[data-testid="cluster-nodes-total"]')).not.toBeNull();
    expect(statValueFor(container, 'total')).toBe('—');

    // Capacity-derived values have no denominator without nodes: the usage
    // summaries drop the "of <allocatable>" part and the percentages dash out
    // (calculateResourceMetrics would silently rescale them against limits).
    expect(container.textContent).toContain('400m used');
    expect(container.textContent).toContain('2.0Gi used');
    expect(
      Array.from(container.querySelectorAll('.metric-header__percent')).map(
        (element) => element.textContent
      )
    ).toEqual(['—', '—']);

    // The warning lives in the affected card: the Resource Utilization card
    // carries a capacity notice (no page-level banner).
    expect(container.querySelector('[data-testid="overview-permission-banner"]')).toBeNull();
    const capacityChip = container.querySelector(
      '[data-testid="utilization-capacity-permission-chip"]'
    );
    expect(capacityChip?.textContent).toContain('Capacity unavailable');
    // The explanation is visible inline text in the standardized notice, not an
    // invisible title attribute or a hover-only tooltip.
    expect(capacityChip?.getAttribute('title')).toBeNull();
    expect(capacityChip?.textContent).toContain('Node permissions: list, watch');

    // Pod and namespace data still render, with no pods/namespaces warnings.
    expect(statValueFor(container, 'pods')).toBe('42');
    expect(statValueFor(container, 'namespaces')).toBe('6');
    expect(
      container.querySelector('[data-testid="utilization-requests-permission-chip"]')
    ).toBeNull();
    expect(container.querySelector('[data-testid="workloads-pods-permission-note"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="workloads-namespaces-permission-note"]')
    ).toBeNull();
  });

  it('warns inside the affected cards when pods and namespaces are hidden, keeping the nodes card', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        clusterType: 'Unmanaged',
        totalNodes: 2,
        readyNodes: 2,
        cpuUsage: '400m',
        cpuAllocatable: '2000m',
        unavailableResources: ['core/pods', 'core/namespaces'],
      },
    });

    rerender();
    await flushEffects();

    // Requests/limits derive from pods: the Resource Utilization header says so.
    const requestsChip = container.querySelector(
      '[data-testid="utilization-requests-permission-chip"]'
    );
    expect(requestsChip?.textContent).toContain('Requests and limits unavailable');
    expect(requestsChip?.getAttribute('title')).toBeNull();
    expect(requestsChip?.textContent).toContain('Pod permissions: list, watch');
    expect(requestsChip?.textContent).toContain('Only current usage is shown');

    // The Workloads card explains its hidden counts in place.
    expect(
      container.querySelector('[data-testid="workloads-pods-permission-note"]')?.textContent
    ).toContain('Pod permissions: list, watch');
    expect(
      container.querySelector('[data-testid="workloads-namespaces-permission-note"]')?.textContent
    ).toContain('Namespace permission: list');

    // Nodes remain fully rendered, including capacity-derived percentages.
    expect(container.querySelector('[data-testid="cluster-nodes-permission-note"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="utilization-capacity-permission-chip"]')
    ).toBeNull();
    expect(statValueFor(container, 'total')).toBe('2');
    expect(container.textContent).toContain('400m of 2 cores');
    expect(container.textContent).toContain('20.0%');
  });

  it('surfaces disabled metrics as an in-card notice and suppresses the transient pill', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = {
      status: 'ready',
      data: {
        overview: {
          ...EMPTY_OVERVIEW_DATA,
          clusterType: 'Unmanaged',
          totalNodes: 2,
          readyNodes: 2,
        },
        // A DisabledPoller ships disabled:true with the terminal reason.
        metrics: {
          disabled: true,
          lastError: 'Insufficient permissions for Metrics API',
          stale: true,
          successCount: 0,
          failureCount: 0,
        },
      },
      error: null,
    };

    rerender();
    await flushEffects();

    // The permanent state reads as the standardized in-card restriction notice…
    const metricsNote = container.querySelector(
      '[data-testid="utilization-metrics-permission-note"]'
    );
    expect(metricsNote?.textContent).toContain('Metrics unavailable');
    expect(metricsNote?.textContent).toContain('Insufficient permissions for Metrics API');

    // …not the transient "Collecting metrics…" header pill (which is suppressed).
    expect(container.querySelector('.metrics-warning-banner')).toBeNull();
    expect(container.textContent).not.toContain('Collecting metrics');
  });

  it('explains the utilization bar vocabulary in a collapsible legend', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        totalNodes: 1,
      },
    });

    rerender();
    await flushEffects();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="utilization-legend-toggle"]'
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="utilization-legend"]')).toBeNull();

    act(() => {
      toggle?.click();
    });

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const legend = container.querySelector('[data-testid="utilization-legend"]');
    expect(legend).not.toBeNull();
    // The striping introduced for over-limit usage must be named — it is the
    // one visual with no other in-UI explanation.
    expect(legend?.textContent).toContain('limits');
    expect(legend?.textContent).toContain('Total requests marker');
    // One row per usage color, stating the capacity percentage where the
    // color changes (single-sourced with the bar's threshold logic).
    expect(legend?.querySelectorAll('.utilization-legend__swatch--usage-normal')).toHaveLength(1);
    expect(legend?.querySelectorAll('.utilization-legend__swatch--usage-high')).toHaveLength(1);
    expect(legend?.querySelectorAll('.utilization-legend__swatch--usage-critical')).toHaveLength(1);
    expect(legend?.textContent).toContain('81');
    expect(legend?.textContent).toContain('95');

    act(() => {
      toggle?.click();
    });
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="utilization-legend"]')).toBeNull();
  });

  it('shows no permission warnings when every source is readable', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        totalNodes: 1,
      },
    });

    rerender();
    await flushEffects();

    expect(container.querySelector('[data-testid="cluster-nodes-permission-note"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="utilization-capacity-permission-chip"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="utilization-requests-permission-chip"]')
    ).toBeNull();
    expect(container.querySelector('[data-testid="workloads-pods-permission-note"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="workloads-namespaces-permission-note"]')
    ).toBeNull();
  });

  it('keeps cluster-overview disabled before data services start and suppresses the transient unavailable error', async () => {
    mockLifecycleState = 'connecting';
    domainStateRef.current = createDomainState('error', {
      error: 'no active clusters available (requested: [cluster-1])',
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-overview',
      'cluster-1|',
      false,
      // preserveState pins the tab-switch fix: the streaming enable path
      // resets scoped state without it, blanking the overview per switch.
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Failed to load Cluster Overview data');
    expect(statValueFor(container, 'total')).toBe('—');
  });
});

const EMPTY_OVERVIEW_DATA: ClusterOverviewPayload = {
  clusterType: 'EKS',
  clusterVersion: '1.27.1',
  cpuUsage: '0',
  cpuRequests: '0',
  cpuLimits: '0',
  cpuAllocatable: '0',
  memoryUsage: '0',
  memoryRequests: '0',
  memoryLimits: '0',
  memoryAllocatable: '0',
  totalNodes: 0,
  fargateNodes: 0,
  regularNodes: 0,
  ec2Nodes: 0,
  virtualNodes: 0,
  vmNodes: 0,
  totalPods: 0,
  totalContainers: 0,
  totalInitContainers: 0,
  runningPods: 0,
  succeededPods: 0,
  pendingPods: 0,
  failedPods: 0,
  readyPods: 0,
  startingPods: 0,
  failingPods: 0,
  terminatingPods: 0,
  restartedPods: 0,
  notReadyPods: 0,
  totalDeployments: 0,
  totalStatefulSets: 0,
  totalDaemonSets: 0,
  totalCronJobs: 0,
  workloadResourceUsage: {
    deployments: { cpuUsage: '0', memoryUsage: '0' },
    daemonSets: { cpuUsage: '0', memoryUsage: '0' },
    statefulSets: { cpuUsage: '0', memoryUsage: '0' },
    jobs: { cpuUsage: '0', memoryUsage: '0' },
  },
  readyNodes: 0,
  notReadyNodes: 0,
  cordonedNodes: 0,
  totalNamespaces: 0,
  recentEvents: [],
};

function renderClusterOverview() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(<ClusterOverview clusterContext="Default" />);
  });

  const rerender = () => {
    act(() => {
      root.render(<ClusterOverview clusterContext="Default" />);
    });
  };

  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };

  return { container, rerender, cleanup };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function statValueFor(container: HTMLElement, label: string): string {
  const labelElement = Array.from(container.querySelectorAll('.metric-stat__label')).find(
    (element) => element.textContent === label
  );
  const item = labelElement?.closest('.metric-stat');
  return item?.querySelector('.metric-stat__count')?.textContent?.trim() ?? '';
}

function createDomainState(
  status: 'loading' | 'idle' | 'ready' | 'updating' | 'error',
  overrides: Partial<{ clusterId: string; overview: ClusterOverviewPayload; error: string }> = {}
): {
  status: 'loading' | 'idle' | 'ready' | 'updating' | 'error';
  data:
    | (Partial<ClusterOverviewSnapshotPayload> & Pick<ClusterOverviewSnapshotPayload, 'overview'>)
    | null;
  error: string | null;
} {
  if (status === 'ready' || status === 'updating') {
    if (!overrides.overview) {
      throw new Error('createDomainState requires overview data when status is ready or updating');
    }
    return {
      status,
      data: { clusterId: overrides.clusterId, overview: overrides.overview },
      error: null,
    };
  }

  if (status === 'error') {
    return {
      status,
      data: null,
      error: overrides.error ?? 'failed to load',
    };
  }

  return {
    status,
    data: null,
    error: null,
  };
}
