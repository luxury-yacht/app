/**
 * frontend/src/core/refresh/components/DiagnosticsPanel.test.ts
 *
 * Test suite for DiagnosticsPanel.
 * Covers key behaviors and edge cases for DiagnosticsPanel.
 */

import { KeyboardProvider } from '@ui/shortcuts';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { PERMISSION_FEATURES } from '@/core/capabilities';
import type {
  PermissionQueryDiagnostics,
  PermissionStatus,
} from '@/core/capabilities/permissionTypes';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { requireValue } from '@/test-utils/requireValue';
import type { ViewType } from '@/types/navigation/views';
import type { KubernetesAPIClientDiagnostics } from '../client';
import { makeTelemetrySummary } from '../refreshContractTestBuilders';
import type { DomainSnapshotState } from '../store';
import { resourceStreamManager } from '../streaming/resourceStreamManager';
import type { TelemetrySummary } from '../types';
import type { DiagnosticsPanelProps } from './diagnostics/diagnosticsPanelTypes';

const fetchTelemetrySummaryMock = vi.hoisted(() =>
  vi.fn<() => Promise<TelemetrySummary>>(async () => {
    throw new Error('fetchTelemetrySummary not stubbed');
  })
);
const fetchSelectionDiagnosticsMock = vi.hoisted(() =>
  vi.fn<
    () => Promise<{
      activeQueueDepth: number;
      maxQueueDepth: number;
      sampleCount: number;
      totalMutations: number;
      failedMutations: number;
      canceledMutations: number;
      supersededMutations: number;
      queueP95Ms: number;
      lastReason?: string;
      lastError?: string;
    }>
  >(async () => ({
    activeQueueDepth: 0,
    maxQueueDepth: 0,
    sampleCount: 0,
    totalMutations: 0,
    failedMutations: 0,
    canceledMutations: 0,
    supersededMutations: 0,
    queueP95Ms: 0,
  }))
);
const fetchKubernetesAPIClientDiagnosticsMock = vi.hoisted(() =>
  vi.fn<() => Promise<KubernetesAPIClientDiagnostics[]>>(async () => [])
);
const handleInlineMock = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
  fetchTelemetrySummary: fetchTelemetrySummaryMock,
  fetchSelectionDiagnostics: fetchSelectionDiagnosticsMock,
  fetchKubernetesAPIClientDiagnostics: fetchKubernetesAPIClientDiagnosticsMock,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handleInline: (...args: unknown[]) => handleInlineMock(...args),
  },
}));

let capabilityDiagnosticsData: PermissionQueryDiagnostics[] = [];
let permissionMapData: Map<string, PermissionStatus> = new Map();
let brokerReadDiagnosticsData: Array<{
  key: string;
  broker: 'data-access' | 'app-state-access';
  resource: string;
  label?: string;
  adapter: string;
  reason?: 'background' | 'startup' | 'user';
  totalRequests: number;
  inFlightCount: number;
  successCount: number;
  errorCount: number;
  blockedCount: number;
  lastStatus: 'success' | 'error' | 'blocked' | 'never';
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastDurationMs?: number;
  lastBlockedReason?: string | null;
  lastError?: string | null;
  lastScope?: string | null;
  recentScopes: string[];
}> = [];

vi.mock('@/core/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/core/capabilities')>('@/core/capabilities');
  return {
    ...actual,
    useCapabilityDiagnostics: () => capabilityDiagnosticsData,
    useUserPermissions: () => permissionMapData,
  };
});

vi.mock('@/core/read-diagnostics', () => ({
  useBrokerReadDiagnostics: () => brokerReadDiagnosticsData,
}));

type MockViewState = {
  viewType: ViewType;
  activeClusterTab: string | null;
  activeNamespaceTab: string;
};

let mockViewState: MockViewState = {
  viewType: 'cluster',
  activeClusterTab: null,
  activeNamespaceTab: 'workloads',
};

const mockNamespaceState: { selectedNamespace: string | null } = {
  selectedNamespace: 'default',
};

vi.mock('@ui/dockable', () => ({
  DockablePanel: ({
    children,
    panelRef,
  }: {
    children: React.ReactNode;
    panelRef?: React.Ref<HTMLDivElement>;
  }) => React.createElement('div', { ref: panelRef }, children),
}));

const domainStateMap: Record<string, DomainSnapshotState<unknown>> = {};
const scopedEntriesMap: Record<string, Array<[string, DomainSnapshotState<unknown>]>> = {};
let refreshState: { pendingRequests: number } = { pendingRequests: 0 };

const mockRefreshManager = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  getRefresherInterval: vi.fn(() => 5000),
  subscribe: vi.fn(() => () => undefined),
  disable: vi.fn(),
  enableDomain: vi.fn(),
  disableDomain: vi.fn(),
  fetchDomain: vi.fn(),
  registerScoped: vi.fn(),
  unregisterScoped: vi.fn(),
  enableScopedDomain: vi.fn(),
  disableScopedDomain: vi.fn(),
  fetchScopedDomain: vi.fn(),
  getRegisteredDomains: vi.fn(() => new Set<string>()),
  getState: vi.fn(() => ({ status: 'enabled' })),
}));

vi.mock('../RefreshManager', () => ({
  refreshManager: mockRefreshManager,
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: vi.fn(() => () => undefined),
}));

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => mockViewState,
}));

vi.mock('@/modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => mockNamespaceState,
}));

const mockKubeconfigState: { selectedClusterId: string } = {
  selectedClusterId: 'test-cluster',
};

vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: mockKubeconfigState.selectedClusterId,
    getClusterMeta: (id: string) => ({ id, name: id }),
  }),
}));

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store');
  return {
    ...actual,
    useRefreshScopedDomainEntries: (domain: string) => scopedEntriesMap[domain] ?? [],
    useRefreshState: () => refreshState,
  };
});

let getPermissionKeyRef: typeof import('@/core/capabilities')['getPermissionKey'];

beforeAll(async () => {
  ({ getPermissionKey: getPermissionKeyRef } = await import('@/core/capabilities'));
});

const getPermissionKeySafe = (
  resourceKind: string,
  verb: string,
  namespace: string | null,
  subresource: string | null
) => {
  if (!getPermissionKeyRef) {
    throw new Error('getPermissionKey not initialised');
  }
  return getPermissionKeyRef(resourceKind, verb, namespace, subresource);
};

const setDomainState = (domain: string, state: DomainSnapshotState<unknown>) => {
  domainStateMap[domain] = state;
};

const setScopedEntries = (
  domain: string,
  entries: Array<[string, DomainSnapshotState<unknown>]>
) => {
  scopedEntriesMap[domain] = entries;
};

const resetDomainStates = () => {
  Object.keys(domainStateMap).forEach((key) => {
    delete domainStateMap[key];
  });
  Object.keys(scopedEntriesMap).forEach((key) => {
    delete scopedEntriesMap[key];
  });
  refreshState = { pendingRequests: 0 };
};

const createReadyState = (data: unknown = null): DomainSnapshotState<unknown> => ({
  status: 'ready',
  data,
  stats: null,
  version: 1,
  checksum: 'test',
  lastUpdated: Date.now(),
  lastManualRefresh: undefined,
  lastAutoRefresh: Date.now(),
  error: null,
  isManual: false,
  droppedAutoRefreshes: 0,
  scope: undefined,
});

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const selectDiagnosticsTab = async (container: HTMLElement, index: number) => {
  const tabButtons = container.querySelectorAll<HTMLElement>('[role="tab"]');
  await act(async () => {
    requireValue(tabButtons[index], `expected diagnostics tab at index ${index}`).click();
    await Promise.resolve();
  });
  await flushAsync();
};

const selectClusterDataTab = async (container: HTMLElement) => selectDiagnosticsTab(container, 1);

// readScopeRows walks the Cluster Data tree the way a reader does: a domain
// group row names the domain for the scope rows beneath it, and a standalone
// scope row names its own. Either way each scope resolves to one labelled row.
const readScopeRows = (
  container: HTMLElement
): Array<{
  label: string;
  scope: string;
  feed: string;
  health: string;
  activity: string;
  error: string;
}> => {
  const domainText = (row: Element): string =>
    row.querySelector('.diagnostics-domain')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  let groupLabel = '';
  const out: Array<{
    label: string;
    scope: string;
    feed: string;
    health: string;
    activity: string;
    error: string;
  }> = [];
  container.querySelectorAll('.diagnostics-table tbody tr').forEach((row) => {
    if (row.classList.contains('diagnostics-domain-row')) {
      groupLabel = domainText(row);
      return;
    }
    if (row.classList.contains('diagnostics-cluster-row')) {
      groupLabel = '';
      return;
    }
    if (!row.classList.contains('diagnostics-scope-row')) {
      return;
    }
    const cells = row.querySelectorAll('td');
    out.push({
      label: domainText(row) || groupLabel,
      scope: cells[1]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      health: cells[2]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      feed: cells[3]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      activity: cells[6]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      error: cells[7]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    });
  });
  return out;
};

// Cluster Data shows eight columns; everything else lives behind the row's
// expander. expandScopeRow opens the row whose first cell names `label` and
// returns its detail grid as a label -> value map.
const expandScopeRow = async (
  container: HTMLElement,
  label: string
): Promise<Record<string, string>> => {
  // A grouped scope row is unlabelled by design, so resolve its domain the same
  // way a reader does: from the domain group row above it.
  let groupLabel = '';
  let row: Element | undefined;
  for (const candidate of Array.from(container.querySelectorAll('.diagnostics-table tbody tr'))) {
    if (candidate.classList.contains('diagnostics-cluster-row')) {
      groupLabel = '';
      continue;
    }
    if (candidate.classList.contains('diagnostics-domain-row')) {
      groupLabel = candidate.querySelector('.diagnostics-domain')?.textContent?.trim() ?? '';
      continue;
    }
    if (!candidate.classList.contains('diagnostics-scope-row')) {
      continue;
    }
    const own = candidate.querySelector('td')?.textContent ?? '';
    if (own.includes(label) || groupLabel.includes(label)) {
      row = candidate;
      break;
    }
  }
  const expander = row?.querySelector<HTMLButtonElement>('.diagnostics-row-expander');
  if (!expander) {
    throw new Error(`no expandable Cluster Data row for "${label}"`);
  }
  await act(async () => {
    expander.click();
    await Promise.resolve();
  });
  const detailRow = row?.nextElementSibling;
  const entries = Array.from(detailRow?.querySelectorAll('.diagnostics-detail-item') ?? []).map(
    (item) => [
      item.querySelector('dt')?.textContent?.trim() ?? '',
      item.querySelector('dd')?.textContent?.trim() ?? '',
    ]
  );
  return Object.fromEntries(entries);
};

const renderDiagnosticsPanel = async (
  DiagnosticsPanelComponent: React.ComponentType<DiagnosticsPanelProps>,
  props: Partial<{ isOpen: boolean; onClose: () => void }> = {},
  options: { keyboardDisabled?: boolean } = {}
) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  const keyboardDisabled = options.keyboardDisabled ?? true;
  let currentProps = {
    isOpen: true,
    onClose: () => undefined,
    ...props,
  };
  const renderTree = () => {
    const providerProps: React.ComponentProps<typeof KeyboardProvider> = {
      disabled: keyboardDisabled,
      children: React.createElement(DiagnosticsPanelComponent, currentProps),
    };
    return React.createElement(KeyboardProvider, providerProps);
  };

  await act(async () => {
    root.render(renderTree());
    await Promise.resolve();
  });

  return {
    container: host,
    rerender: async (nextProps: Partial<{ isOpen: boolean; onClose: () => void }> = {}) => {
      currentProps = { ...currentProps, ...nextProps };
      await act(async () => {
        root.render(renderTree());
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
};

beforeEach(() => {
  vi.useRealTimers();
  resetDomainStates();
  capabilityDiagnosticsData = [];
  permissionMapData = new Map();
  brokerReadDiagnosticsData = [];
  mockViewState = {
    viewType: 'cluster',
    activeClusterTab: null,
    activeNamespaceTab: 'workloads',
  };
  mockKubeconfigState.selectedClusterId = 'test-cluster';
  mockNamespaceState.selectedNamespace = 'default';
  fetchTelemetrySummaryMock.mockReset();
  fetchTelemetrySummaryMock.mockRejectedValue(new Error('fetchTelemetrySummary not stubbed'));
  fetchSelectionDiagnosticsMock.mockReset();
  fetchSelectionDiagnosticsMock.mockResolvedValue({
    activeQueueDepth: 0,
    maxQueueDepth: 0,
    sampleCount: 0,
    totalMutations: 0,
    failedMutations: 0,
    canceledMutations: 0,
    supersededMutations: 0,
    queueP95Ms: 0,
  });
  fetchKubernetesAPIClientDiagnosticsMock.mockReset();
  fetchKubernetesAPIClientDiagnosticsMock.mockResolvedValue([]);
  handleInlineMock.mockReset();
  handleInlineMock.mockImplementation((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }));
  Object.values(mockRefreshManager).forEach((value) => {
    if (typeof value === 'function') {
      value.mockClear?.();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('resolveDomainNamespace', () => {
  test('returns namespace suffix for namespace domains', async () => {
    const module = await import('./DiagnosticsPanel');
    expect(module.resolveDomainNamespace('namespace-workloads', 'alpha|cluster:default')).toBe(
      'default'
    );
  });

  test('returns workload namespace for pod scopes', async () => {
    const module = await import('./DiagnosticsPanel');
    expect(
      module.resolveDomainNamespace('pods', 'alpha|workload:default:apps:v1:Deployment:web')
    ).toBe('default');
  });

  test('returns namespace for namespace-scoped pod scopes', async () => {
    const module = await import('./DiagnosticsPanel');
    expect(module.resolveDomainNamespace('pods', 'alpha|namespace:dev')).toBe('dev');
    expect(module.resolveDomainNamespace('pods', 'alpha|namespace:all')).toBe('All');
  });

  test('returns dash for cluster scoped domains', async () => {
    const module = await import('./DiagnosticsPanel');
    expect(module.resolveDomainNamespace('cluster-events', 'alpha|cluster')).toBe('-');
  });
});

describe('broker read diagnostics', () => {
  test('renders brokered read rows on the dedicated tab and filters noisy history', async () => {
    brokerReadDiagnosticsData = [
      {
        key: 'data-access::query-permissions::permission-read::startup',
        broker: 'data-access',
        resource: 'query-permissions',
        label: 'Query Permissions',
        adapter: 'permission-read',
        reason: 'startup',
        totalRequests: 3,
        inFlightCount: 1,
        successCount: 2,
        errorCount: 0,
        blockedCount: 1,
        lastStatus: 'blocked',
        lastCompletedAt: Date.now(),
        lastDurationMs: 12,
        lastBlockedReason: 'auto-refresh-disabled',
        lastScope: 'cluster:test-cluster',
        recentScopes: ['cluster:test-cluster'],
      },
      {
        key: 'app-state-access::app-info::rpc-read::',
        broker: 'app-state-access',
        resource: 'app-info',
        label: 'App Info',
        adapter: 'rpc-read',
        totalRequests: 2,
        inFlightCount: 0,
        successCount: 2,
        errorCount: 0,
        blockedCount: 0,
        lastStatus: 'success',
        lastCompletedAt: Date.now(),
        lastDurationMs: 3,
        lastScope: null,
        recentScopes: [],
      },
    ];

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });

    const tabButtons = rendered.container.querySelectorAll<HTMLElement>('[role="tab"]');
    await act(async () => {
      tabButtons[2].click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(rendered.container.textContent).toContain('Reads that belong to no refresh domain');
    expect(rendered.container.textContent).toContain('Query Permissions');
    expect(rendered.container.textContent).toContain('query-permissions');
    expect(rendered.container.textContent).toContain('cluster:test-cluster');
    expect(rendered.container.textContent).toContain('permission-read');
    expect(rendered.container.textContent).toContain('auto-refresh-disabled');
    expect(rendered.container.textContent).toContain('App Info');

    const issuesOnlyButton = Array.from(rendered.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Issues Only')
    );
    expect(issuesOnlyButton).toBeDefined();

    await act(async () => {
      issuesOnlyButton?.click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(rendered.container.textContent).toContain('Showing Issues');
    expect(rendered.container.textContent).toContain('Query Permissions');
    expect(rendered.container.textContent).not.toContain('App Info');
  });
});

describe('DiagnosticsPanel component', () => {
  const baseDomains = [
    'namespaces',
    'cluster-overview',
    'nodes',
    'cluster-config',
    'cluster-crds',
    'cluster-events',
    'cluster-rbac',
    'cluster-storage',
    'namespace-workloads',
    'namespace-autoscaling',
    'namespace-config',
    'namespace-custom',
    'namespace-events',
    'namespace-helm',
    'namespace-network',
    'namespace-quotas',
    'namespace-rbac',
    'namespace-storage',
  ];

  // All base domains are now scoped — seed scopedEntriesMap so rows pass the idle filter.
  const seedBaseDomainStates = () => {
    baseDomains.forEach((domain) => {
      if (!scopedEntriesMap[domain]?.length) {
        setScopedEntries(domain, [['default-scope', createReadyState(null)]]);
      }
    });
  };

  test('renders cluster overview row with metrics summary before pods', async () => {
    seedBaseDomainStates();

    setScopedEntries('namespaces', [
      [
        'default-scope',
        createReadyState({
          namespaces: [
            {
              name: 'default',
              phase: 'Active',
              resourceVersion: '1',
              creationTimestamp: Date.now(),
            },
          ],
        }),
      ],
    ]);

    setScopedEntries('nodes', [
      [
        'default-scope',
        createReadyState({
          nodes: [],
          metrics: {
            collectedAt: Date.now(),
            stale: false,
            lastError: '',
            consecutiveFailures: 0,
            successCount: 2,
            failureCount: 0,
          },
        }),
      ],
    ]);

    setScopedEntries('cluster-overview', [
      [
        'default-scope',
        createReadyState({
          overview: {
            clusterType: 'EKS',
            clusterVersion: 'v1.29.3',
            cpuUsage: '150m',
            cpuRequests: '320m',
            cpuLimits: '500m',
            cpuAllocatable: '2.50',
            memoryUsage: '200.0Mi',
            memoryRequests: '320.0Mi',
            memoryLimits: '512.0Mi',
            memoryAllocatable: '9.0Gi',
            totalNodes: 3,
            fargateNodes: 1,
            regularNodes: 0,
            ec2Nodes: 2,
            totalPods: 24,
            totalContainers: 48,
            totalInitContainers: 4,
            runningPods: 20,
            pendingPods: 3,
            failedPods: 1,
            totalNamespaces: 6,
          },
          metrics: {
            collectedAt: Date.now(),
            stale: false,
            lastError: '',
            consecutiveFailures: 0,
            successCount: 5,
            failureCount: 1,
          },
        }),
      ],
    ]);

    scopedEntriesMap.pods = [
      [
        'node:worker-1',
        {
          ...createReadyState({
            pods: [{ metadata: { name: 'pod-a' } }, { metadata: { name: 'pod-b' } }],
            metrics: {
              collectedAt: Date.now(),
              stale: false,
              lastError: '',
              consecutiveFailures: 0,
              successCount: 3,
              failureCount: 0,
            },
          }),
          lastUpdated: Date.now(),
        },
      ],
    ];

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    const markup = rendered.container.innerHTML;

    expect(markup).toContain('Cluster Overview');
    // Sync wait and Metrics are detail fields now, not columns. Nodes carries
    // the joined-usage freshness block on its base payload, so Metrics reflects
    // it directly; with no informer-sync telemetry there is no Sync wait entry.
    const nodesDetails = await expandScopeRow(rendered.container, 'Nodes');
    expect(nodesDetails['Sync wait']).toBeUndefined();
    expect(nodesDetails.Metrics).toBe('OK (2 polls)');

    const clusterIndex = markup.indexOf('Cluster Overview');
    const podsIndex = markup.indexOf('Pods');
    expect(clusterIndex).toBeGreaterThan(-1);
    expect(podsIndex).toBeGreaterThan(clusterIndex);

    await rendered.unmount();
  });

  test('renders joined metrics freshness on the base domain rows', async () => {
    seedBaseDomainStates();
    mockKubeconfigState.selectedClusterId = 'cluster-a';
    const now = Date.now();
    const namespaceScope = buildClusterScope('cluster-a', 'namespace:team-a');
    const clusterScope = buildClusterScope('cluster-a', '');

    // The metric refresh domains were deleted: the base payloads carry the
    // poller freshness block alongside their rows.
    setScopedEntries('pods', [
      [
        namespaceScope,
        {
          ...createReadyState({
            rows: [],
            metrics: {
              collectedAt: now,
              stale: false,
              lastError: '',
              consecutiveFailures: 0,
              successCount: 4,
              failureCount: 0,
            },
          }),
          scope: namespaceScope,
        },
      ],
    ]);
    setScopedEntries('nodes', [
      [
        clusterScope,
        {
          ...createReadyState({
            rows: [],
            metrics: {
              collectedAt: now,
              stale: true,
              lastError: '',
              consecutiveFailures: 2,
              successCount: 1,
              failureCount: 2,
            },
          }),
          scope: clusterScope,
        },
      ],
    ]);
    setScopedEntries('namespace-workloads', [
      [
        namespaceScope,
        {
          ...createReadyState({
            rows: [],
            metrics: {
              collectedAt: now,
              stale: false,
              lastError: 'workload metrics failed',
              consecutiveFailures: 1,
              successCount: 2,
              failureCount: 1,
            },
          }),
          scope: namespaceScope,
        },
      ],
    ]);

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    // Scope and label stay visible; metric freshness is a detail field.
    const visible = Array.from(
      rendered.container.querySelectorAll<HTMLTableRowElement>(
        '.diagnostics-table tbody tr.diagnostics-scope-row'
      )
    ).map((row) => {
      const cells = row.querySelectorAll<HTMLTableCellElement>('td');
      return {
        label:
          cells[0]
            ?.querySelector('.diagnostics-domain')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim() ?? '',
        scope: cells[1]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });
    expect(visible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Nodes', scope: 'cluster-a (active)' }),
        // The cluster prefix is dropped: the cluster header row states it.
        expect.objectContaining({ label: 'Workloads', scope: 'namespace:team-a' }),
      ])
    );

    expect((await expandScopeRow(rendered.container, 'Nodes')).Metrics).toBe(
      'Unavailable (2 fails)'
    );
    expect((await expandScopeRow(rendered.container, 'Workloads')).Metrics).toBe('Error (1 fails)');
    // Pod rows point at the joined usage rather than their own freshness.
    expect((await expandScopeRow(rendered.container, 'ObjPanel - Pods - team-a')).Metrics).toBe(
      'N/A'
    );

    await rendered.unmount();
  });

  test('renders namespace scoped pod row with namespace label', async () => {
    seedBaseDomainStates();
    const now = Date.now();

    scopedEntriesMap.pods = [
      [
        'namespace:team-a',
        {
          ...createReadyState({
            pods: [{ metadata: { name: 'pod-a' } }],
            metrics: {
              collectedAt: now,
              stale: false,
              lastError: '',
              consecutiveFailures: 0,
              successCount: 1,
              failureCount: 0,
            },
          }),
          lastUpdated: now,
        },
      ],
    ];

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');

    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    const markup = rendered.container.innerHTML;

    expect(markup).toContain('ObjPanel - Pods - team-a');
    expect(markup).toContain('team-a');

    await rendered.unmount();
  });

  test('strips cluster prefixes from pod scopes when rendering labels', async () => {
    seedBaseDomainStates();
    const now = Date.now();

    scopedEntriesMap.pods = [
      [
        'cluster-a|namespace:team-a',
        {
          ...createReadyState({
            pods: [{ metadata: { name: 'pod-a' } }],
            metrics: {
              collectedAt: now,
              stale: false,
              lastError: '',
              consecutiveFailures: 0,
              successCount: 1,
              failureCount: 0,
            },
          }),
          lastUpdated: now,
        },
      ],
    ];

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');

    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    const markup = rendered.container.innerHTML;

    // Only the namespace portion should be shown in the label.
    expect(markup).toContain('ObjPanel - Pods - team-a');

    await rendered.unmount();
  });

  test('renders all active cluster scopes and marks the selected cluster as active', async () => {
    seedBaseDomainStates();
    setScopedEntries('cluster-config', [
      [
        'cluster-a|',
        {
          ...createReadyState({
            resources: [{ kind: 'ConfigMap', name: 'cfg-a', namespace: 'default' }],
          }),
          scope: 'cluster-a|',
        },
      ],
      [
        'cluster-b|',
        {
          ...createReadyState({
            resources: [{ kind: 'ConfigMap', name: 'cfg-b', namespace: 'default' }],
          }),
          scope: 'cluster-b|',
        },
      ],
    ]);

    const findClusterConfigScopes = (container: HTMLElement) => {
      const rows = Array.from(container.querySelectorAll('tbody tr'));
      return rows
        .filter((candidate) => {
          const firstCell = candidate.querySelector('td');
          return firstCell?.textContent?.includes('Cluster Config');
        })
        .map((row) => {
          const cells = row.querySelectorAll('td');
          return cells[1]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        });
    };

    const findClusterConfigRow = (container: HTMLElement, clusterName: string) => {
      const rows = Array.from(container.querySelectorAll('tbody tr'));
      return rows.find((candidate) => {
        const firstCell = candidate.querySelector('td');
        const scopeCell = candidate.querySelectorAll('td')[1];
        return (
          firstCell?.textContent?.includes('Cluster Config') &&
          (scopeCell?.textContent?.includes(clusterName) ?? false)
        );
      });
    };

    mockKubeconfigState.selectedClusterId = 'cluster-a';
    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();
    const clusterAScopeRow = findClusterConfigRow(rendered.container, 'cluster-a');
    const clusterBScopeRow = findClusterConfigRow(rendered.container, 'cluster-b');
    expect(clusterAScopeRow).toBeDefined();
    expect(clusterBScopeRow).toBeDefined();
    expect(findClusterConfigScopes(rendered.container)).toEqual(
      expect.arrayContaining(['cluster-a (active)', 'cluster-b'])
    );

    mockKubeconfigState.selectedClusterId = 'cluster-b';
    await rendered.rerender();
    await flushAsync();
    expect(findClusterConfigScopes(rendered.container)).toEqual(
      expect.arrayContaining(['cluster-a', 'cluster-b (active)'])
    );

    await rendered.unmount();
  });

  test('keeps visible background cluster scopes when the active cluster has none', async () => {
    setScopedEntries('cluster-config', [
      [
        'cluster-a|',
        {
          ...createReadyState({
            resources: [{ kind: 'ConfigMap', name: 'cfg-a', namespace: 'default' }],
          }),
          scope: 'cluster-a|',
        },
      ],
    ]);

    mockKubeconfigState.selectedClusterId = 'cluster-b';
    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');

    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    const markup = rendered.container.innerHTML;

    expect(markup).toContain('Cluster Config');
    expect(markup).toContain('cluster-a');

    await rendered.unmount();
  });

  test('renders active and background namespace and overview scopes as separate rows', async () => {
    const clusterAScope = buildClusterScope('cluster-a', '');
    const clusterBScope = buildClusterScope('cluster-b', '');
    mockKubeconfigState.selectedClusterId = 'cluster-b';

    setScopedEntries('namespaces', [
      [
        clusterAScope,
        {
          ...createReadyState({
            namespaces: [
              {
                name: 'ns-a',
                phase: 'Active',
                resourceVersion: '1',
                creationTimestamp: Date.now(),
                clusterId: 'cluster-a',
              },
            ],
          }),
          scope: clusterAScope,
        },
      ],
      [
        clusterBScope,
        {
          ...createReadyState({
            namespaces: [
              {
                name: 'ns-b',
                phase: 'Active',
                resourceVersion: '2',
                creationTimestamp: Date.now(),
                clusterId: 'cluster-b',
              },
            ],
          }),
          scope: clusterBScope,
        },
      ],
    ]);

    setScopedEntries('cluster-overview', [
      [
        clusterAScope,
        {
          ...createReadyState({
            overview: { totalNodes: 4 },
            metrics: { stale: false, successCount: 3, failureCount: 0 },
          }),
          scope: clusterAScope,
        },
      ],
      [
        clusterBScope,
        {
          ...createReadyState({
            overview: { totalNodes: 6 },
            metrics: { stale: false, successCount: 9, failureCount: 0 },
          }),
          scope: clusterBScope,
        },
      ],
    ]);

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();

    const findRowsByLabel = (label: string) => {
      const rows = Array.from(
        rendered.container.querySelectorAll('.diagnostics-table tbody tr.diagnostics-scope-row')
      );
      return rows.filter((row) => row.querySelector('td')?.textContent?.includes(label));
    };

    const namespaceRows = findRowsByLabel('Namespaces');
    expect(namespaceRows).toHaveLength(2);
    const namespaceSummaries = namespaceRows.map((row) => {
      const cells = row.querySelectorAll('td');
      return {
        scope: cells[1]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        count: cells[4]?.textContent?.trim() ?? '',
      };
    });
    expect(namespaceSummaries).toEqual(
      expect.arrayContaining([
        { scope: 'cluster-a', count: '1' },
        { scope: 'cluster-b (active)', count: '1' },
      ])
    );

    const overviewRows = findRowsByLabel('Cluster Overview');
    expect(overviewRows).toHaveLength(2);
    const overviewSummaries = overviewRows.map((row) => {
      const cells = row.querySelectorAll('td');
      return {
        scope: cells[1]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        count: cells[4]?.textContent?.trim() ?? '',
      };
    });
    expect(overviewSummaries).toEqual(
      expect.arrayContaining([
        { scope: 'cluster-a', count: '4' },
        { scope: 'cluster-b (active)', count: '6' },
      ])
    );
    expect(rendered.container.textContent).not.toContain('clusters=');

    await rendered.unmount();
  });

  test('disambiguates durable query-backed scopes and hides transient resource table query scopes', async () => {
    mockKubeconfigState.selectedClusterId = 'cluster-a';

    const catalogScope = buildClusterScope('cluster-a', 'limit=200&namespace=default');
    const catalogMetadataScope = buildClusterScope('cluster-a', 'limit=1&namespace=default');
    setScopedEntries('catalog', [
      [
        catalogScope,
        {
          ...createReadyState({
            items: [{ kind: 'Pod', name: 'api', namespace: 'default' }],
            total: 1,
          }),
          scope: catalogScope,
        },
      ],
      [
        catalogMetadataScope,
        {
          ...createReadyState({
            items: [{ kind: 'Pod', name: 'api', namespace: 'default' }],
            total: 1,
          }),
          scope: catalogMetadataScope,
        },
      ],
    ]);
    fetchTelemetrySummaryMock.mockResolvedValue(
      makeTelemetrySummary({
        snapshots: [
          {
            domain: 'catalog',
            clusterId: 'cluster-a',
            scope: catalogScope,
            lastStatus: 'error',
            lastError: 'page query failed',
            lastDurationMs: 10,
            lastUpdated: Date.now(),
            successCount: 2,
            failureCount: 1,
          },
          {
            domain: 'catalog',
            clusterId: 'cluster-a',
            scope: catalogMetadataScope,
            lastStatus: 'success',
            lastDurationMs: 20,
            lastUpdated: Date.now(),
            successCount: 7,
            failureCount: 0,
          },
        ],
      })
    );

    const nodesScope = buildClusterScope('cluster-a', '');
    const nodesAliasScope = buildClusterScope('cluster-a', 'cluster');
    const nodesQueryScope = buildClusterScope('cluster-a', '?limit=50&sort=name');
    setScopedEntries('nodes', [
      [
        nodesScope,
        {
          ...createReadyState({ nodes: [{ name: 'node-a', clusterId: 'cluster-a' }] }),
          scope: nodesScope,
        },
      ],
      [
        nodesAliasScope,
        {
          ...createReadyState({ nodes: [{ name: 'node-a', clusterId: 'cluster-a' }] }),
          scope: nodesAliasScope,
        },
      ],
      [
        nodesQueryScope,
        {
          ...createReadyState({ nodes: [{ name: 'node-a', clusterId: 'cluster-a' }] }),
          scope: nodesQueryScope,
        },
      ],
    ]);

    const healthSpy = vi
      .spyOn(resourceStreamManager, 'getHealthSnapshot')
      .mockImplementation((domain, scope) =>
        domain === 'catalog'
          ? {
              domain: 'catalog',
              scope,
              status: 'healthy',
              reason: 'synchronized',
              connectionStatus: 'connected',
            }
          : null
      );

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);
    await flushAsync();
    await flushAsync();

    const rows = readScopeRows(rendered.container);

    const catalogRows = rows.filter((row) => row.label === 'Browse Catalog');
    expect(catalogRows).toHaveLength(2);
    expect(new Set(catalogRows.map((row) => row.scope)).size).toBe(2);
    expect(catalogRows.map((row) => row.scope).join(' | ')).toContain('limit=200');
    expect(catalogRows.map((row) => row.scope).join(' | ')).toContain('limit=1');
    // Both catalog scopes are fed by the same stream; Role distinguishes them
    // and is now a detail field rather than a column.
    // Both catalog scopes ride the same stream, so Feed is identical for both;
    // Role is what distinguishes them, and it is a detail field now.
    expect(new Set(catalogRows.map((row) => row.feed)).size).toBe(1);
    expect(catalogRows[0].feed).toContain('Resources');
    const catalogActivityByScope = Object.fromEntries(
      catalogRows.map((row) => [
        row.scope.includes('limit=200') ? 'page' : 'metadata',
        row.activity,
      ])
    );
    expect(catalogActivityByScope).toEqual({ page: '2✓ 1✗ 10 ms', metadata: '7✓ 0✗ 20 ms' });
    expect(catalogRows.find((row) => row.scope.includes('limit=200'))?.error).toContain(
      'page query failed'
    );
    expect(catalogRows.find((row) => row.scope.includes('limit=1'))?.error).not.toContain(
      'page query failed'
    );

    const treeCells = rendered.container.querySelectorAll(
      'td.diagnostics-domain-name, td.diagnostics-scope-name'
    );
    expect(treeCells.length).toBeGreaterThan(0);
    expect(Array.from(treeCells).every((cell) => cell.getAttribute('style') === null)).toBe(true);
    expect(
      Array.from(treeCells).every(
        (cell) =>
          cell.classList.contains('diagnostics-tree-slots--1') ||
          cell.classList.contains('diagnostics-tree-slots--2')
      )
    ).toBe(true);
    expect((await expandScopeRow(rendered.container, 'Browse Catalog')).Role).toBeDefined();

    const nodeRows = rows.filter((row) => row.label === 'Nodes');
    expect(nodeRows).toHaveLength(1);
    expect(nodeRows.some((row) => row.scope === 'cluster-a (active)')).toBe(true);
    expect(nodeRows.some((row) => row.scope.includes('limit=50'))).toBe(false);
    expect((await expandScopeRow(rendered.container, 'Nodes')).Role).toBe('Live Scope');

    await rendered.unmount();
    healthSpy.mockRestore();
  });

  test('renders telemetry summaries after successful fetch', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(baseTime);
    const now = Date.now();

    refreshState = { pendingRequests: 2 };

    const telemetrySummary: TelemetrySummary = makeTelemetrySummary({
      snapshots: [
        {
          domain: 'catalog',
          lastStatus: 'success',
          lastDurationMs: 120,
          lastUpdated: now - 2000,
          successCount: 5,
          failureCount: 1,
        },
        {
          domain: 'namespace-workloads',
          scope: 'cluster:default',
          lastStatus: 'error',
          lastDurationMs: 80,
          lastUpdated: now - 5000,
          successCount: 3,
          failureCount: 2,
          lastError: 'Timeout while fetching workload pods',
        },
      ],
      metrics: {
        lastCollected: now - 3500,
        lastDurationMs: 640,
        consecutiveFailures: 0,
        successCount: 7,
        failureCount: 1,
        active: true,
      },
      streams: [
        {
          name: 'events',
          activeSessions: 2,
          totalMessages: 12,
          droppedMessages: 1,
          skippedTargets: 0,
          errorCount: 0,
          lastConnect: now - 6000,
          lastEvent: now - 3000,
        },
        {
          name: 'resources',
          activeSessions: 1,
          totalMessages: 15,
          droppedMessages: 0,
          skippedTargets: 0,
          errorCount: 0,
          lastConnect: now - 4000,
          lastEvent: now - 1500,
        },
        {
          name: 'resources',
          leafKind: 'domain',
          leaf: 'catalog',
          activeSessions: 0,
          totalMessages: 20,
          droppedMessages: 4,
          skippedTargets: 0,
          errorCount: 1,
          lastConnect: now - 7000,
          lastEvent: now - 2000,
          lastError: 'Catalog subscription disconnected',
        },
        {
          name: 'container-logs',
          activeSessions: 1,
          totalMessages: 9,
          droppedMessages: 2,
          skippedTargets: 5,
          errorCount: 0,
          lastConnect: now - 8000,
          lastEvent: now - 1000,
          lastSkipReason: 'per-scope target cap',
        },
      ],
    });

    const resourceStreamSpy = vi
      .spyOn(resourceStreamManager, 'getTelemetrySummary')
      .mockReturnValue({
        resyncCount: 2,
        fallbackCount: 1,
        lastResyncAt: now - 1200,
        lastResyncReason: 'reset',
        lastFallbackAt: now - 2400,
        lastFallbackReason: 'gap detected',
      });
    // Per-domain resync/fallback source for the Streams table. These fixtures
    // carry no domain, so the resources row is a stream-level row (resyncs null).
    vi.spyOn(resourceStreamManager, 'getTelemetrySummaryByClusterDomain').mockReturnValue({});

    fetchTelemetrySummaryMock.mockResolvedValueOnce(telemetrySummary);
    fetchSelectionDiagnosticsMock.mockResolvedValueOnce({
      activeQueueDepth: 1,
      maxQueueDepth: 2,
      sampleCount: 4,
      totalMutations: 5,
      failedMutations: 1,
      canceledMutations: 1,
      supersededMutations: 0,
      queueP95Ms: 42,
      lastReason: 'set-selected-kubeconfigs',
      lastError: 'context canceled',
    });

    const catalogState = createReadyState({
      firstBatchLatencyMs: 900,
    });
    catalogState.stats = {
      itemCount: 0,
      buildDurationMs: 0,
      timeToFirstRowMs: 450,
    };
    setDomainState('catalog', catalogState);

    scopedEntriesMap['container-logs'] = [
      [
        'cluster-a|default:apps/v1:deployment:web',
        {
          ...createReadyState({}),
          status: 'ready',
          lastUpdated: now - 2000,
        },
      ],
      [
        'cluster-a|default:apps/v1:deployment:api',
        {
          ...createReadyState({}),
          status: 'error',
          error: 'Unable to stream logs',
          lastUpdated: now - 3000,
        },
      ],
    ];

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();
    await flushAsync();

    const orchestratorPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(1) .diagnostics-summary-primary'
    );
    // Each card is now a headline figure plus at most two supporting facts; the
    // full breakdown moved to the card's tooltip so the strip stays glanceable.
    expect(orchestratorPrimary?.textContent?.trim()).toBe('2 pending');
    expect(orchestratorPrimary?.getAttribute('title')).toContain('Failed 1');
    const orchestratorSecondary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(1) .diagnostics-summary-secondary'
    );
    expect(orchestratorSecondary?.textContent).toBe('Queue 1 · p95 42 ms');

    const metricsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(2) .diagnostics-summary-primary'
    );
    expect(metricsPrimary?.textContent).toBe('OK');
    expect(
      rendered.container.querySelector<HTMLSpanElement>(
        '.diagnostics-summary-card:nth-of-type(2) .diagnostics-summary-secondary'
      )?.textContent
    ).toContain('7 polls');

    const eventsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(3) .diagnostics-summary-primary'
    );
    expect(eventsPrimary?.textContent).toBe('12 delivered');
    expect(eventsPrimary?.getAttribute('title')).toContain('Active 2');

    const catalogPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(4) .diagnostics-summary-primary'
    );
    expect(catalogPrimary?.className).toContain('diagnostics-summary-error');
    expect(catalogPrimary?.textContent).toBe('20 batches');
    expect(catalogPrimary?.getAttribute('title')).toContain('Active 1');

    const logPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(5) .diagnostics-summary-primary'
    );
    expect(logPrimary?.className).toContain('diagnostics-summary-error');
    expect(logPrimary?.textContent).toBe('9 delivered');
    // Every figure the headline drops is still reachable in the tooltip.
    expect(logPrimary?.getAttribute('title')).toContain('Scopes: 2');
    expect(logPrimary?.getAttribute('title')).toContain('Sessions: 1');
    expect(logPrimary?.getAttribute('title')).toContain('Skipped Targets: 5');

    const tabButtons = rendered.container.querySelectorAll<HTMLElement>('[role="tab"]');
    await act(async () => {
      tabButtons[2].click();
      await Promise.resolve();
    });
    await flushAsync();

    // Connections lists one socket row per (stream, cluster). The fixture has no
    // leaf-keyed entries, so every row here is a socket.
    const connectionsSection = rendered.container.querySelector('.diagnostics-section');
    expect(connectionsSection?.textContent).toContain('3 sockets');
    expect(connectionsSection?.textContent).toContain('Resources');
    const connectionRows =
      connectionsSection
        ?.querySelector('.diagnostics-table-wrapper')
        ?.querySelectorAll('tbody tr') ?? [];
    expect(connectionRows).toHaveLength(3);
    const resourcesRow = Array.from(connectionRows).find((row) =>
      row.textContent?.includes('Resources')
    );
    // Socket row: Connection | Cluster | Sessions | Last Connect | Delivered(4)
    // | Dropped(5) | Errors(6) | Last Event(7) | Last Error(8).
    const cells = resourcesRow?.querySelectorAll('td') ?? [];
    expect(cells[2]?.textContent?.trim()).toBe('1');
    // The Last Error placeholder is dimmed and has no error colour.
    expect(cells[8]?.textContent?.trim()).toBe('-');
    expect(cells[8]?.querySelector('.table-no-value')).not.toBeNull();
    expect(cells[8]?.classList.contains('diagnostics-error-warning')).toBe(false);

    await rendered.unmount();
    resourceStreamSpy.mockRestore();
  });

  test('renders the recorded informer-sync-gate wait in the Sync Wait column', async () => {
    const clusterScope = buildClusterScope('cluster-a', '');
    mockKubeconfigState.selectedClusterId = 'cluster-a';

    setScopedEntries('namespaces', [
      [clusterScope, { ...createReadyState({ namespaces: [] }), scope: clusterScope }],
    ]);

    fetchTelemetrySummaryMock.mockResolvedValueOnce(
      makeTelemetrySummary({
        snapshots: [
          {
            domain: 'namespaces',
            clusterId: 'cluster-a',
            scope: clusterScope,
            lastStatus: 'success',
            lastDurationMs: 12,
            lastUpdated: Date.now(),
            successCount: 1,
            failureCount: 0,
            // Cold-start build blocked 1500ms on the initial-LIST gate.
            maxInformerSyncWaitMs: 1500,
          },
        ],
        metrics: {
          lastCollected: Date.now(),
          lastDurationMs: 0,
          consecutiveFailures: 0,
          successCount: 1,
          failureCount: 0,
        },
        streams: [],
      })
    );

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);
    await flushAsync();
    await flushAsync();

    // Sync wait is a detail field: it matters when diagnosing a slow first
    // load, not on every row, so it lives behind the row expander.
    expect((await expandScopeRow(rendered.container, 'Namespaces'))['Sync wait']).toBe('1500 ms');

    await rendered.unmount();
  });

  test('renders Kubernetes API client diagnostics on the K8s API tab', async () => {
    fetchTelemetrySummaryMock.mockResolvedValue({
      domains: [],
      streams: [],
      generatedAt: Date.now(),
    } as unknown as TelemetrySummary);
    fetchKubernetesAPIClientDiagnosticsMock.mockResolvedValue([
      {
        clusterId: 'cluster-a',
        clusterName: 'prod',
        configuredQPS: 500,
        configuredBurst: 1000,
        qps1s: 12,
        qps10s: 7,
        qps60s: 3,
        peakQPS1s: 44,
        totalRequests: 1200,
        status2xx: 1150,
        status3xx: 10,
        status4xx: 4,
        status5xx: 2,
        status429: 1,
        errors: 3,
        lastRequestMs: Date.now(),
      },
    ]);

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    const tabButtons = rendered.container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabButtons[0].getAttribute('aria-selected')).toBe('true');
    await flushAsync();

    expect(rendered.container.textContent).toContain('Clusters: 1');
    expect(rendered.container.textContent).toContain('prod');
    expect(rendered.container.textContent).toContain('500 / 1000');
    expect(rendered.container.textContent).toContain('1200');
    expect(rendered.container.textContent).toContain('44');

    await rendered.unmount();
  });

  test('shows resource stream health and fallback details in telemetry tooltips', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(baseTime);
    const now = Date.now();
    mockKubeconfigState.selectedClusterId = 'cluster-a';

    const scope = buildClusterScope('cluster-a', '');
    const configState = {
      ...createReadyState({
        resources: [{ kind: 'ConfigMap', name: 'app-config', namespace: 'default', data: 2 }],
      }),
      scope,
    };
    // cluster-config is now a scoped domain, so set scoped entries instead of domain state.
    setScopedEntries('cluster-config', [[scope, configState]]);

    fetchTelemetrySummaryMock.mockResolvedValueOnce(
      makeTelemetrySummary({
        snapshots: [],
        metrics: {
          lastCollected: now - 2000,
          lastDurationMs: 120,
          consecutiveFailures: 0,
          successCount: 3,
          failureCount: 0,
          active: true,
        },
        streams: [
          {
            name: 'resources',
            clusterId: 'cluster-a',
            activeSessions: 1,
            totalMessages: 5,
            droppedMessages: 1,
            skippedTargets: 0,
            errorCount: 0,
            lastConnect: now - 4000,
            lastEvent: now - 1500,
          },
        ],
      })
    );

    const healthSpy = vi
      .spyOn(resourceStreamManager, 'getHealthSnapshot')
      .mockImplementation((domain, scopeValue) => {
        if (domain === 'cluster-config') {
          return {
            domain: 'cluster-config',
            scope: scopeValue,
            status: 'unhealthy',
            reason: 'no-delivery',
            connectionStatus: 'connected',
            lastMessageAt: now - 1800,
            lastDeliveryAt: now - 2400,
          };
        }
        return null;
      });

    const telemetrySpy = vi.spyOn(resourceStreamManager, 'getTelemetrySummary').mockReturnValue({
      resyncCount: 1,
      fallbackCount: 2,
      lastResyncAt: now - 3000,
      lastResyncReason: 'gap detected',
      lastFallbackAt: now - 2500,
      lastFallbackReason: 'stream stalled',
    });

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();
    await flushAsync();

    const rows = rendered.container.querySelectorAll(
      '.diagnostics-table tbody tr.diagnostics-scope-row'
    );
    const configRow = Array.from(rows).find((row) => row.textContent?.includes('Cluster Config'));
    expect(configRow).toBeDefined();

    // Stream trouble now reads off the single Health badge, with the detail in
    // its tooltip, instead of a separate Telemetry column repeating it.
    const cells = configRow?.querySelectorAll('td') ?? [];
    const healthCell = cells[2];
    // No error MESSAGE on this row — only an unhealthy stream — so the badge
    // says `unhealthy`, not `error`. Reporting `error` here would mean the
    // no-value placeholder was being read as an error again.
    expect(healthCell?.textContent?.trim()).toBe('unhealthy');
    expect(healthCell?.getAttribute('title')).toContain('Health: unhealthy (no-delivery)');
    expect(healthCell?.getAttribute('title')).toContain('Reason: no-delivery');
    const activityCell = cells[6];
    expect(activityCell?.getAttribute('title')).toContain('Stream fallbacks: 2');
    expect(activityCell?.getAttribute('title')).toContain('Last fallback: stream stalled');

    await rendered.unmount();
    healthSpy.mockRestore();
    telemetrySpy.mockRestore();
  });

  test('keeps container log socket health attached to its owning cluster', async () => {
    mockKubeconfigState.selectedClusterId = 'cluster-a';
    const scopeA = buildClusterScope('cluster-a', 'default:apps/v1:deployment:web');
    const scopeB = buildClusterScope('cluster-b', 'default:apps/v1:deployment:api');
    setScopedEntries('container-logs', [
      [scopeA, { ...createReadyState({ entries: [] }), scope: scopeA }],
      [scopeB, { ...createReadyState({ entries: [] }), scope: scopeB }],
    ]);
    fetchTelemetrySummaryMock.mockResolvedValueOnce(
      makeTelemetrySummary({
        streams: [
          {
            name: 'container-logs',
            clusterId: 'cluster-b',
            activeSessions: 1,
            totalMessages: 1,
            droppedMessages: 0,
            skippedTargets: 0,
            errorCount: 1,
            lastError: 'cluster-b socket failed',
            lastConnect: Date.now(),
            lastEvent: Date.now(),
          },
          {
            name: 'container-logs',
            clusterId: 'cluster-a',
            activeSessions: 1,
            totalMessages: 5,
            droppedMessages: 0,
            skippedTargets: 0,
            errorCount: 0,
            lastConnect: Date.now(),
            lastEvent: Date.now(),
          },
        ],
      })
    );

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);
    await flushAsync();
    await flushAsync();

    const rows = readScopeRows(rendered.container).filter((row) => row.label.includes('Logs'));
    expect(rows.find((row) => row.label.includes('web'))?.health).toBe('healthy');
    expect(rows.find((row) => row.label.includes('api'))?.health).toBe('unhealthy');

    await rendered.unmount();
  });

  test('shows every connection unfiltered', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    fetchTelemetrySummaryMock.mockResolvedValueOnce(
      makeTelemetrySummary({
        snapshots: [],
        metrics: {
          lastCollected: now,
          lastDurationMs: 200,
          consecutiveFailures: 0,
          successCount: 1,
          failureCount: 0,
          active: true,
        },
        streams: [
          {
            name: 'resources',
            activeSessions: 1,
            totalMessages: 5,
            droppedMessages: 0,
            skippedTargets: 0,
            errorCount: 0,
            lastConnect: now - 1000,
            lastEvent: now - 500,
          },
          {
            name: 'events',
            activeSessions: 2,
            totalMessages: 10,
            droppedMessages: 1,
            skippedTargets: 0,
            errorCount: 0,
            lastConnect: now - 1200,
            lastEvent: now - 700,
          },
        ],
      })
    );

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();
    await flushAsync();

    const tabButtons = rendered.container.querySelectorAll<HTMLElement>('[role="tab"]');
    await act(async () => {
      tabButtons[2].click();
      await Promise.resolve();
    });
    await flushAsync();

    const streamsSection = rendered.container.querySelector('.diagnostics-section');
    expect(streamsSection).toBeTruthy();
    const connectionsTable = requireValue(
      requireValue(streamsSection, 'expected test value in DiagnosticsPanel.test.ts').querySelector(
        '.diagnostics-table-wrapper'
      ),
      'expected test value in DiagnosticsPanel.test.ts'
    );
    // The connection list itself is never filtered — every socket is shown.
    expect(connectionsTable.querySelectorAll('button, input').length).toBe(0);

    const streamRows = connectionsTable.querySelectorAll('tbody tr');
    expect(Array.from(streamRows).some((row) => row.textContent?.includes('Resources'))).toBe(true);
    expect(Array.from(streamRows).some((row) => row.textContent?.includes('Events'))).toBe(true);

    await rendered.unmount();
  });

  test('shows catalog degradation on its unified resource-stream domain row', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    fetchTelemetrySummaryMock.mockResolvedValueOnce(
      makeTelemetrySummary({
        snapshots: [],
        metrics: {
          lastCollected: now,
          lastDurationMs: 200,
          consecutiveFailures: 0,
          successCount: 1,
          failureCount: 0,
          active: true,
        },
        streams: [
          {
            name: 'resources',
            activeSessions: 1,
            totalMessages: 5,
            droppedMessages: 0,
            skippedTargets: 0,
            errorCount: 1,
            lastConnect: now - 1000,
            lastEvent: now - 500,
            lastError: 'Resource stream disconnected',
          },
          {
            name: 'resources',
            leafKind: 'domain',
            leaf: 'catalog',
            clusterId: 'cluster-a',
            clusterName: 'Cluster A',
            activeSessions: 0,
            totalMessages: 3,
            droppedMessages: 2,
            skippedTargets: 0,
            errorCount: 1,
            lastConnect: now - 1200,
            lastEvent: now - 700,
            lastError: 'Catalog subscription disconnected',
          },
        ],
      })
    );
    const resourceStreamSpy = vi
      .spyOn(resourceStreamManager, 'getTelemetrySummary')
      .mockReturnValue({
        resyncCount: 4,
        fallbackCount: 2,
        lastResyncAt: now - 600,
        lastResyncReason: 'reset',
        lastFallbackAt: now - 400,
        lastFallbackReason: 'gap detected',
      });
    vi.spyOn(resourceStreamManager, 'getTelemetrySummaryByClusterDomain').mockReturnValue({});

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();
    await flushAsync();

    const tabButtons = rendered.container.querySelectorAll<HTMLElement>('[role="tab"]');
    await act(async () => {
      tabButtons[2].click();
      await Promise.resolve();
    });
    await flushAsync();

    // The Connections view owns the TRANSPORT: the resources socket and its
    // errors. Catalog is a refresh domain, so its per-domain counters moved to
    // the Cluster Data tree and must NOT appear as a connection leaf here.
    const connectionsSection = rendered.container.querySelector('.diagnostics-section');
    const connectionRows = Array.from(connectionsSection?.querySelectorAll('tbody tr') ?? []);
    const resourcesRow = connectionRows.find((row) => row.textContent?.includes('Resources'));
    expect(resourcesRow).toBeDefined();
    expect(connectionRows.some((row) => row.textContent?.toLowerCase().includes('catalog'))).toBe(
      false
    );

    // Socket row: Connection | Cluster | Sessions | Last Connect | Delivered(4)
    // | Dropped(5) | Errors(6) | Last Event | Last Error(8).
    const resourceCells = requireValue(
      resourcesRow,
      'expected test value in DiagnosticsPanel.test.ts'
    ).querySelectorAll('td');
    expect(resourceCells[6]?.textContent?.trim()).toBe('1');
    expect(resourceCells[8]?.textContent?.trim()).toBe('Resource stream disconnected');
    // An actual error is coloured with the warning class (not red, not the placeholder).
    expect(resourceCells[8]?.classList.contains('diagnostics-error-warning')).toBe(true);

    await rendered.unmount();
    resourceStreamSpy.mockRestore();
  });

  test('shows idle metrics summary when polling is inactive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    fetchTelemetrySummaryMock.mockResolvedValueOnce(
      makeTelemetrySummary({
        snapshots: [],
        metrics: {
          lastCollected: now - 1000,
          lastDurationMs: 120,
          consecutiveFailures: 0,
          lastError: '',
          successCount: 3,
          failureCount: 0,
          active: false,
        },
        streams: [],
      })
    );

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();
    await flushAsync();

    const metricsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(2) .diagnostics-summary-primary'
    );
    expect(metricsPrimary?.textContent).toBe('Idle');

    await rendered.unmount();
  });

  test('shows warning summaries when telemetry fetch fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    fetchTelemetrySummaryMock.mockRejectedValueOnce(new Error('Telemetry offline'));

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await selectClusterDataTab(rendered.container);

    await flushAsync();
    await flushAsync();

    const metricsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(2) .diagnostics-summary-primary'
    );
    expect(metricsPrimary?.textContent).toBe('Unavailable');
    expect(metricsPrimary?.className).toContain('diagnostics-summary-warning');

    const eventsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(3) .diagnostics-summary-primary'
    );
    expect(eventsPrimary?.className).toContain('diagnostics-summary-warning');
    expect(eventsPrimary?.textContent?.trim()).toBe('—');
    expect(handleInlineMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Telemetry offline' }),
      {
        action: 'loadTelemetryDiagnostics',
        source: 'DiagnosticsPanel',
      }
    );

    await rendered.unmount();
  });

  test('renders capability batches and effective permissions with scoped toggle', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(baseTime);
    const now = Date.now();

    mockViewState = {
      viewType: 'namespace',
      activeClusterTab: null,
      activeNamespaceTab: 'workloads',
    };
    mockNamespaceState.selectedNamespace = 'default';

    type TestPermissionDescriptor = PermissionQueryDiagnostics['lastDescriptors'][number] & {
      clusterId?: string;
      group?: string;
      version?: string;
    };

    const descriptorDefault: TestPermissionDescriptor = {
      resourceKind: 'deployments',
      verb: 'get',
      namespace: 'default',
    };
    const descriptorExec: TestPermissionDescriptor = {
      resourceKind: 'pods',
      verb: 'create',
      namespace: 'default',
      subresource: 'exec',
    };
    const descriptorCluster: TestPermissionDescriptor = {
      resourceKind: 'namespaces',
      verb: 'list',
    };
    const descriptorOther: TestPermissionDescriptor = {
      resourceKind: 'configmaps',
      verb: 'get',
      namespace: 'kube-system',
    };

    capabilityDiagnosticsData = [
      {
        key: 'diag-default',
        method: 'ssrr',
        namespace: 'default',
        pendingCount: 2,
        inFlightCount: 1,
        inFlightStartedAt: now - 1500,
        lastRunDurationMs: 3200,
        lastRunCompletedAt: now - 6000,
        lastError: 'Denied by policy',
        lastResult: 'error',
        totalChecks: 5,
        consecutiveFailureCount: 3,
        lastDescriptors: [descriptorDefault, descriptorExec],
      },
      {
        key: 'diag-cluster',
        method: 'ssar',
        pendingCount: 0,
        inFlightCount: 0,
        totalChecks: 1,
        consecutiveFailureCount: 0,
        lastDescriptors: [descriptorCluster],
      },
    ];

    const toDescriptor = (d: TestPermissionDescriptor): PermissionStatus['descriptor'] => ({
      clusterId: d.clusterId ?? 'test-cluster',
      group: d.group ?? null,
      version: d.version ?? null,
      resourceKind: d.resourceKind,
      verb: d.verb,
      namespace: d.namespace ?? null,
      subresource: d.subresource ?? null,
    });

    const permissionStatuses: PermissionStatus[] = [
      {
        id: 'perm-default',
        allowed: false,
        pending: false,
        reason: 'Forbidden',
        error: 'Denied by policy',
        source: 'denied',
        descriptor: toDescriptor(descriptorDefault),
        entry: { status: 'ready' },
        feature: PERMISSION_FEATURES.namespaceWorkloads,
      },
      {
        id: 'perm-exec',
        allowed: false,
        pending: true,
        reason: null,
        error: null,
        source: null,
        descriptor: toDescriptor(descriptorExec),
        entry: { status: 'loading' },
        feature: PERMISSION_FEATURES.namespaceWorkloads,
      },
      {
        id: 'perm-cluster',
        allowed: true,
        pending: false,
        reason: null,
        error: null,
        source: 'ssrr',
        descriptor: toDescriptor(descriptorCluster),
        entry: { status: 'ready' },
        feature: PERMISSION_FEATURES.clusterRBAC,
      },
      {
        id: 'perm-other',
        allowed: true,
        pending: false,
        reason: null,
        error: null,
        source: 'ssrr',
        descriptor: toDescriptor(descriptorOther),
        entry: { status: 'ready' },
        feature: PERMISSION_FEATURES.namespaceWorkloads,
      },
    ];

    permissionMapData = new Map(
      permissionStatuses.map((status) => [
        getPermissionKeySafe(
          status.descriptor.resourceKind,
          status.descriptor.verb,
          status.descriptor.namespace ?? null,
          status.descriptor.subresource ?? null
        ),
        status,
      ])
    );

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });

    await flushAsync();
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    const tabButtons = rendered.container.querySelectorAll<HTMLElement>('[role="tab"]');
    await act(async () => {
      tabButtons[4].click();
      await Promise.resolve();
    });
    await flushAsync();

    const batchRows = rendered.container.querySelectorAll<HTMLTableRowElement>(
      '.diagnostics-table tbody tr'
    );
    // Row 0 is the "Current Checks" section header; data rows follow.
    expect(batchRows.length).toBe(3);
    expect(batchRows[0].textContent).toContain('Current Checks');
    expect(batchRows[1].textContent).toContain('Cluster');
    expect(batchRows[2].className).toContain('diagnostics-permission-denied');
    const batchCells = batchRows[2].querySelectorAll<HTMLTableCellElement>('td');
    // Column order (15 cols): Namespace(0), InFlight(1), Runtime(2), Duration(3),
    // Age(4), Result(5), Failures(6), Checks(7), Error(8), Method(9),
    // Incomplete(10), Rules(11), SSARFallback(12), Descriptors(13), Features(14).
    expect(batchCells[0].textContent?.trim()).toBe('default');
    expect(batchCells[1].textContent?.trim()).toBe('1'); // In Flight
    expect(batchCells[2].textContent?.trim()).toMatch(/s$/); // Runtime
    expect(batchCells[5].textContent?.trim()).toBe('Error'); // Result
    expect(batchCells[8].textContent).toContain('Denied by policy'); // Error
    // Checks cell is collapsed by default — click the row to expand.
    expect(batchCells[13].textContent).toContain('Click to expand');
    await act(async () => {
      batchRows[2].click();
      await Promise.resolve();
    });
    const expandedCells = batchRows[2].querySelectorAll<HTMLTableCellElement>('td');
    expect(expandedCells[13].textContent).toContain('deployments');

    await act(async () => {
      tabButtons[5].click();
      await Promise.resolve();
    });
    await flushAsync();

    const permissionsBody = rendered.container.querySelector('.diagnostics-table tbody');
    expect(permissionsBody).toBeTruthy();
    const scopedRows = requireValue(
      permissionsBody,
      'expected test value in DiagnosticsPanel.test.ts'
    ).querySelectorAll('tr');
    expect(scopedRows.length).toBe(2);
    expect(scopedRows[0].textContent).toContain('default');
    expect(scopedRows[0].textContent).toContain('deployments (get)');
    expect(scopedRows[1].textContent).toContain('pods/exec (create)');

    expect(
      rendered.container.querySelector<HTMLInputElement>('.diagnostics-permissions-toggle input')
    ).toBeNull();

    await rendered.unmount();
  });

  test('each tab carries data-diagnostics-focusable="true" for the focus walker', async () => {
    // The focus walker at DiagnosticsPanel.tsx:~2067 queries
    // '[data-diagnostics-focusable="true"]' to drive Escape/Arrow navigation.
    // If extraProps stops being forwarded through the shared Tabs component,
    // the attribute silently disappears and keyboard nav breaks. This test
    // guards that regression.
    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });
    await flushAsync();

    const focusableEls = rendered.container.querySelectorAll('[data-diagnostics-focusable="true"]');
    // Expect exactly six focusable tab elements (one per tab descriptor).
    expect(focusableEls.length).toBe(6);
    expect(Array.from(focusableEls).map((el) => el.textContent)).toEqual([
      'K8s API',
      'Cluster Data',
      'Connections',
      'Tables',
      'Cap Checks',
      'Permissions',
    ]);
    // Each should also carry role="tab" — confirming they are the tab divs.
    for (const el of Array.from(focusableEls)) {
      expect(el.getAttribute('role')).toBe('tab');
    }

    await rendered.unmount();
  });

  test('tabs into the first diagnostics tab when the panel is open', async () => {
    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(
      DiagnosticsPanel,
      { isOpen: true },
      { keyboardDisabled: false }
    );
    await flushAsync();

    const outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    await act(async () => {
      outsideButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    const focusableEls = rendered.container.querySelectorAll<HTMLElement>(
      '[data-diagnostics-focusable="true"]'
    );
    expect(focusableEls.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(focusableEls[0]);

    outsideButton.remove();
    await rendered.unmount();
  });
});
