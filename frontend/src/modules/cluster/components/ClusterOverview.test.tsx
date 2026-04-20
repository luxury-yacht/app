/**
 * frontend/src/modules/cluster/components/ClusterOverview.test.tsx
 *
 * Test suite for ClusterOverview.
 * Covers key behaviors and edge cases for ClusterOverview.
 */

import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '@/core/events';
import type { ClusterOverviewPayload } from '@/core/refresh/types';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import ClusterOverview from './ClusterOverview';

const {
  mockRefreshOrchestrator,
  domainStateRef,
  kubeconfigStateRef,
  setSelectedNamespaceMock,
  setActiveNamespaceTabMock,
  setSidebarSelectionMock,
  navigateToNamespaceMock,
  emitPodsUnhealthySignalMock,
  getAppInfoMock,
  browserOpenURLMock,
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
        setSelectedKubeconfig: vi.fn(),
        setActiveKubeconfig: vi.fn(),
        getClusterMeta: vi.fn(),
        loadKubeconfigs: vi.fn(),
      },
    },
    setSelectedNamespaceMock: vi.fn(),
    setActiveNamespaceTabMock: vi.fn(),
    setSidebarSelectionMock: vi.fn(),
    navigateToNamespaceMock: vi.fn(),
    emitPodsUnhealthySignalMock: vi.fn(),
    getAppInfoMock: vi.fn(),
    browserOpenURLMock: vi.fn(),
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
  currentAttempt: 0,
  maxAttempts: 0,
  secondsUntilRetry: 0,
};

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
  useRefreshScopedDomain: () => domainStateRef.current,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  __esModule: true,
  useKubeconfig: () => kubeconfigStateRef.current,
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

vi.mock('@assets/luxury-yacht-logo.png', () => ({
  __esModule: true,
  default: 'luxury-yacht-logo.png',
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
    setActiveClusterView: vi.fn(),
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
    navigateToClusterView: vi.fn(),
    navigateToNamespace: navigateToNamespaceMock,
    onNamespaceSelect: vi.fn(),
    onClusterObjectsClick: vi.fn(),
  }),
}));
vi.mock('@modules/namespace/components/podsFilterSignals', () => ({
  __esModule: true,
  emitPodsUnhealthySignal: emitPodsUnhealthySignalMock,
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

vi.mock('@/core/contexts/AuthErrorContext', () => ({
  useActiveClusterAuthState: () => mockAuthState,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => mockAutoRefreshEnabled,
}));

describe('ClusterOverview', () => {
  let cleanupRoot: (() => void) | null = null;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
      currentAttempt: 0,
      maxAttempts: 0,
      secondsUntilRetry: 0,
    };
    getAppInfoMock.mockResolvedValue({
      version: '1.0.0',
      buildTime: 'dev',
      gitCommit: 'dev',
      isBeta: false,
      update: { isUpdateAvailable: false },
    });
    cleanupRoot = null;
  });

  afterEach(() => {
    if (cleanupRoot) {
      cleanupRoot();
      cleanupRoot = null;
    }
  });

  it('renders zero-value skeleton with loading message before data arrives', async () => {
    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'cluster-overview',
      'cluster-1|',
      expect.objectContaining({ isManual: false })
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-overview',
      'cluster-1|',
      true
    );
    expect(container.querySelector('.overview-header h1')?.textContent).toBe('Cluster Overview');
    expect(container.querySelector('.cluster-overview')?.classList.contains('is-skeleton')).toBe(
      true
    );
    expect(
      container.querySelector('.stat-card .stat-value')?.classList.contains('skeleton-text')
    ).toBe(true);
    expect(statValueFor(container, 'Total')).toBe('0');
    expect(statValueFor(container, 'Namespaces')).toBe('0');
    expect(container.querySelector('.cluster-overview .cluster-overview-error') ?? null).toBeNull();
  });

  it('hydrates with overview data once the domain resolves', async () => {
    const { container, rerender, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    domainStateRef.current = createDomainState('ready', {
      overview: {
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
        restartedPods: 7,
        totalNamespaces: 6,
        totalDeployments: 8,
        totalStatefulSets: 2,
        totalDaemonSets: 1,
        totalCronJobs: 3,
      },
    });

    rerender();
    await flushEffects();

    expect(container.querySelector('.cluster-overview')?.classList.contains('is-skeleton')).toBe(
      false
    );
    expect(statValueFor(container, 'Total')).toBe('3');
    expect(statValueFor(container, 'Namespaces')).toBe('6');
    expect(statValueFor(container, 'Pods')).toBe('42');
    expect(container.textContent).toContain('EKS');
    expect(container.textContent).toContain('1.26.3');
    expect(container.textContent).not.toContain('Loading cluster overview...');
    expect(container.textContent).toContain('Status:');
    expect(container.textContent).toContain('Ready');
  });

  it('shows loading namespaces detail until namespaces are ready', async () => {
    mockNamespaceReady = false;

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Status:');
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

    expect(container.textContent).toContain('Status:');
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).not.toContain('Refreshing cluster data');
  });

  it('shows auto-refresh paused when background refresh is disabled', async () => {
    mockAutoRefreshEnabled = false;

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    expect(container.querySelector('.cluster-overview')?.classList.contains('is-skeleton')).toBe(
      false
    );
    expect(container.textContent).toContain('Status:');
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
      true
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'cluster-overview',
      'cluster-1|',
      expect.objectContaining({ isManual: false })
    );
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
      } as any,
      error: null,
    };

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Auto-refresh paused');
    expect(container.textContent).not.toContain('Ready');
    expect(statValueFor(container, 'Total')).toBe('0');
    expect(statValueFor(container, 'Namespaces')).toBe('0');
    expect(statValueFor(container, 'Pods')).toBe('0');
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

    expect(statValueFor(container, 'Total')).toBe('5');
    expect(statValueFor(container, 'EC2')).toBe('3');
    expect(statValueFor(container, 'Fargate')).toBe('2');
    // AKS-specific cards should not appear.
    expect(statValueFor(container, 'VM')).toBe('');
    expect(statValueFor(container, 'Virtual')).toBe('');
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

    expect(statValueFor(container, 'Total')).toBe('4');
    expect(statValueFor(container, 'VM')).toBe('3');
    expect(statValueFor(container, 'Virtual')).toBe('1');
    // EKS-specific cards should not appear.
    expect(statValueFor(container, 'EC2')).toBe('');
    expect(statValueFor(container, 'Fargate')).toBe('');
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

    expect(statValueFor(container, 'Total')).toBe('6');
    // No provider-specific breakdown cards.
    expect(statValueFor(container, 'EC2')).toBe('');
    expect(statValueFor(container, 'Fargate')).toBe('');
    expect(statValueFor(container, 'VM')).toBe('');
    expect(statValueFor(container, 'Virtual')).toBe('');
  });

  it('renders an update banner when a newer release is available', async () => {
    getAppInfoMock.mockResolvedValue({
      version: '1.0.0',
      buildTime: 'dev',
      gitCommit: 'dev',
      isBeta: false,
      update: {
        isUpdateAvailable: true,
        latestVersion: '1.2.0',
        releaseUrl: 'https://github.com/luxury-yacht/app/releases/latest',
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;

    await act(async () => {
      await Promise.resolve();
    });

    const banner = container.querySelector('.overview-update-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toMatch(/update available/i);
    expect(banner?.textContent).toContain('1.2.0');
  });

  it('shows an inline error while retaining the zero skeleton when permissions fail', async () => {
    domainStateRef.current = createDomainState('error', { error: 'forbidden' });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    expect(container.textContent).toContain('Failed to load cluster overview');
    expect(container.textContent).toContain('forbidden');
    expect(container.querySelector('.cluster-overview')?.classList.contains('is-skeleton')).toBe(
      false
    );
    expect(statValueFor(container, 'Total')).toBe('0');
    expect(container.textContent).not.toContain('Loading cluster overview...');
  });

  it('navigates to the pods view with unhealthy filter when clicking a pod status card', async () => {
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        pendingPods: 3,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    const pendingCard = container.querySelector('[data-testid="cluster-pod-status-pending"]');
    expect(pendingCard).not.toBeNull();

    act(() => {
      pendingCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setSelectedNamespaceMock).toHaveBeenCalledWith(ALL_NAMESPACES_SCOPE);
    expect(setActiveNamespaceTabMock).toHaveBeenCalledWith('pods');
    expect(setSidebarSelectionMock).toHaveBeenCalledWith({
      type: 'namespace',
      value: ALL_NAMESPACES_SCOPE,
    });
    expect(navigateToNamespaceMock).toHaveBeenCalled();
    expect(emitPodsUnhealthySignalMock).toHaveBeenCalledWith('cluster-1', ALL_NAMESPACES_SCOPE);
  });

  it('navigates to the pods view without unhealthy filter when clicking the healthy item', async () => {
    domainStateRef.current = createDomainState('ready', {
      overview: {
        ...EMPTY_OVERVIEW_DATA,
        runningPods: 4,
        succeededPods: 1,
      },
    });

    const { container, cleanup } = renderClusterOverview();
    cleanupRoot = cleanup;
    await flushEffects();

    const healthyItem = container.querySelector('[data-testid="cluster-pod-status-healthy"]');
    expect(healthyItem).not.toBeNull();
    expect(healthyItem?.textContent).toContain('5');

    act(() => {
      healthyItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setSelectedNamespaceMock).toHaveBeenCalledWith(ALL_NAMESPACES_SCOPE);
    expect(setActiveNamespaceTabMock).toHaveBeenCalledWith('pods');
    expect(setSidebarSelectionMock).toHaveBeenCalledWith({
      type: 'namespace',
      value: ALL_NAMESPACES_SCOPE,
    });
    expect(navigateToNamespaceMock).toHaveBeenCalled();
    expect(emitPodsUnhealthySignalMock).not.toHaveBeenCalled();
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
  restartedPods: 0,
  totalDeployments: 0,
  totalStatefulSets: 0,
  totalDaemonSets: 0,
  totalCronJobs: 0,
  totalNamespaces: 0,
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
  const labelElement = Array.from(container.querySelectorAll('.stat-label')).find(
    (element) => element.textContent === label
  );
  const statCard = labelElement?.closest('.stat-card');
  return statCard?.querySelector('.stat-value')?.textContent?.trim() ?? '';
}

function createDomainState(
  status: 'loading' | 'idle' | 'ready' | 'updating' | 'error',
  overrides: Partial<{ overview: ClusterOverviewPayload; error: string }> = {}
) {
  if (status === 'ready' || status === 'updating') {
    if (!overrides.overview) {
      throw new Error('createDomainState requires overview data when status is ready or updating');
    }
    return {
      status,
      data: { overview: overrides.overview },
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
