/**
 * frontend/src/core/refresh/components/DiagnosticsPanel.test.ts
 *
 * Test suite for DiagnosticsPanel.
 * Covers key behaviors and edge cases for DiagnosticsPanel.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, expect, test, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyboardProvider } from '@ui/shortcuts';
import type { ViewType } from '@/types/navigation/views';
import type { TelemetrySummary } from '../types';
import type {
  CapabilityNamespaceDiagnostics,
  CapabilityEntry,
  NormalizedCapabilityDescriptor,
} from '@/core/capabilities/types';
import type { PermissionStatus } from '@/core/capabilities/bootstrap';
import type { DomainSnapshotState } from '../store';
import { resourceStreamManager } from '../streaming/resourceStreamManager';
import { buildClusterScopeList } from '@/core/refresh/clusterScope';

const fetchTelemetrySummaryMock = vi.hoisted(() =>
  vi.fn<() => Promise<TelemetrySummary>>(async () => {
    throw new Error('fetchTelemetrySummary not stubbed');
  })
);

vi.mock('../client', () => ({
  fetchTelemetrySummary: fetchTelemetrySummaryMock,
}));

let capabilityDiagnosticsData: CapabilityNamespaceDiagnostics[] = [];
let permissionMapData: Map<string, PermissionStatus> = new Map();

vi.mock('@/core/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/core/capabilities')>('@/core/capabilities');
  return {
    ...actual,
    useCapabilityDiagnostics: () => capabilityDiagnosticsData,
    useUserPermissions: () => permissionMapData,
  };
});

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

vi.mock('@components/dockable', () => ({
  DockablePanel: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

const domainStateMap: Record<string, DomainSnapshotState<any>> = {};
const scopedEntriesMap: Record<string, Array<[string, DomainSnapshotState<any>]>> = {};
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

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}));

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => mockViewState,
}));

vi.mock('@/modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => mockNamespaceState,
}));

vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: 'test-cluster',
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

let getPermissionKeyRef: (typeof import('@/core/capabilities'))['getPermissionKey'];

beforeAll(async () => {
  ({ getPermissionKey: getPermissionKeyRef } = await import('@/core/capabilities'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

const setDomainState = (domain: string, state: DomainSnapshotState<any>) => {
  domainStateMap[domain] = state;
};

const setScopedEntries = (domain: string, entries: Array<[string, DomainSnapshotState<any>]>) => {
  scopedEntriesMap[domain] = entries;
};

const resetDomainStates = () => {
  Object.keys(domainStateMap).forEach((key) => delete domainStateMap[key]);
  Object.keys(scopedEntriesMap).forEach((key) => delete scopedEntriesMap[key]);
  refreshState = { pendingRequests: 0 };
};

const createReadyState = (data: any = null): DomainSnapshotState<any> => ({
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

const renderDiagnosticsPanel = async (
  DiagnosticsPanelComponent: React.ComponentType<any>,
  props: Partial<{ isOpen: boolean; onClose: () => void }> = {}
) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  let currentProps = {
    isOpen: true,
    onClose: () => undefined,
    ...props,
  };

  await act(async () => {
    root.render(
      React.createElement(KeyboardProvider, {
        disabled: true,
        children: React.createElement(DiagnosticsPanelComponent, currentProps),
      })
    );
    await Promise.resolve();
  });

  return {
    container: host,
    rerender: async (nextProps: Partial<{ isOpen: boolean; onClose: () => void }> = {}) => {
      currentProps = { ...currentProps, ...nextProps };
      await act(async () => {
        root.render(
          React.createElement(KeyboardProvider, {
            disabled: true,
            children: React.createElement(DiagnosticsPanelComponent, currentProps),
          })
        );
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
  mockViewState = {
    viewType: 'cluster',
    activeClusterTab: null,
    activeNamespaceTab: 'workloads',
  };
  mockNamespaceState.selectedNamespace = 'default';
  fetchTelemetrySummaryMock.mockReset();
  fetchTelemetrySummaryMock.mockRejectedValue(new Error('fetchTelemetrySummary not stubbed'));
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
    expect(module.resolveDomainNamespace('pods', 'alpha|workload:default:deployment:web')).toBe(
      'default'
    );
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

    scopedEntriesMap['pods'] = [
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

    const markup = renderToStaticMarkup(
      React.createElement(KeyboardProvider, {
        disabled: true,
        children: React.createElement(DiagnosticsPanel, {
          isOpen: true,
          onClose: () => undefined,
        }),
      })
    );

    expect(markup).toContain('Cluster Overview');
    expect(markup).toContain('OK (5 polls)');

    const clusterIndex = markup.indexOf('Cluster Overview');
    const podsIndex = markup.indexOf('Pods');
    expect(clusterIndex).toBeGreaterThan(-1);
    expect(podsIndex).toBeGreaterThan(clusterIndex);
  });

  test('renders namespace scoped pod row with namespace label', async () => {
    seedBaseDomainStates();
    const now = Date.now();

    scopedEntriesMap['pods'] = [
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

    const markup = renderToStaticMarkup(
      React.createElement(KeyboardProvider, {
        disabled: true,
        children: React.createElement(DiagnosticsPanel, {
          isOpen: true,
          onClose: () => undefined,
        }),
      })
    );

    expect(markup).toContain('ObjPanel - Pods - team-a');
    expect(markup).toContain('team-a');
  });

  test('strips cluster prefixes from pod scopes when rendering labels', async () => {
    seedBaseDomainStates();
    const now = Date.now();

    scopedEntriesMap['pods'] = [
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

    const markup = renderToStaticMarkup(
      React.createElement(KeyboardProvider, {
        disabled: true,
        children: React.createElement(DiagnosticsPanel, {
          isOpen: true,
          onClose: () => undefined,
        }),
      })
    );

    // Only the namespace portion should be shown in the label.
    expect(markup).toContain('ObjPanel - Pods - team-a');
  });

  test('renders telemetry summaries after successful fetch', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(baseTime);
    const now = Date.now();

    refreshState = { pendingRequests: 2 };

    const telemetrySummary: TelemetrySummary = {
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
      },
      streams: [
        {
          name: 'events',
          activeSessions: 2,
          totalMessages: 12,
          droppedMessages: 1,
          errorCount: 0,
          lastConnect: now - 6000,
          lastEvent: now - 3000,
        },
        {
          name: 'resources',
          activeSessions: 1,
          totalMessages: 15,
          droppedMessages: 0,
          errorCount: 0,
          lastConnect: now - 4000,
          lastEvent: now - 1500,
        },
        {
          name: 'catalog',
          activeSessions: 3,
          totalMessages: 20,
          droppedMessages: 4,
          errorCount: 1,
          lastConnect: now - 7000,
          lastEvent: now - 2000,
          lastError: 'Catalog stream disconnected',
        },
        {
          name: 'object-logs',
          activeSessions: 1,
          totalMessages: 9,
          droppedMessages: 2,
          errorCount: 0,
          lastConnect: now - 8000,
          lastEvent: now - 1000,
        },
      ],
    };

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

    fetchTelemetrySummaryMock.mockResolvedValueOnce(telemetrySummary);

    const catalogState = createReadyState({
      firstBatchLatencyMs: 900,
    });
    catalogState.stats = {
      timeToFirstRowMs: 450,
    } as any;
    setDomainState('catalog', catalogState);

    scopedEntriesMap['object-logs'] = [
      [
        'workload:default:deployment:web',
        {
          ...createReadyState({}),
          status: 'ready',
          lastUpdated: now - 2000,
        },
      ],
      [
        'workload:default:deployment:api',
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

    await flushAsync();
    await flushAsync();

    const orchestratorPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(1) .diagnostics-summary-primary'
    );
    expect(orchestratorPrimary?.textContent?.trim()).toBe('Pending Requests: 2');

    const metricsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(2) .diagnostics-summary-primary'
    );
    expect(metricsPrimary?.textContent).toContain('Status: OK • Polls: 7');

    const eventsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(3) .diagnostics-summary-primary'
    );
    expect(eventsPrimary?.textContent).toContain('Active: 2');
    expect(eventsPrimary?.textContent).toContain('Delivered: 12');

    const catalogPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(4) .diagnostics-summary-primary'
    );
    expect(catalogPrimary?.className).toContain('diagnostics-summary-error');
    expect(catalogPrimary?.textContent).toContain('Active: 3');
    expect(catalogPrimary?.textContent).toContain('Batches: 20');

    const logPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(5) .diagnostics-summary-primary'
    );
    expect(logPrimary?.className).toContain('diagnostics-summary-error');
    expect(logPrimary?.textContent).toContain('Scopes: 2');
    expect(logPrimary?.textContent).toContain('Sessions: 1');
    expect(logPrimary?.textContent).toContain('Delivered: 9');

    const tabButtons = rendered.container.querySelectorAll<HTMLButtonElement>('.tab-item');
    await act(async () => {
      tabButtons[1].click();
      await Promise.resolve();
    });
    await flushAsync();

    const streamsSection = rendered.container.querySelector('.diagnostics-section');
    expect(streamsSection?.textContent).toContain('Streams');
    expect(streamsSection?.textContent).toContain('Resources');
    const streamRows = streamsSection?.querySelectorAll('tbody tr') ?? [];
    expect(streamRows).toHaveLength(4);
    const resourcesRow = Array.from(streamRows).find((row) =>
      row.textContent?.includes('Resources')
    );
    const cells = resourcesRow?.querySelectorAll('td') ?? [];
    expect(cells[5]?.textContent?.trim()).toBe('2');
    expect(cells[6]?.textContent?.trim()).toBe('1');

    await rendered.unmount();
    resourceStreamSpy.mockRestore();
  });

  test('shows resource stream health and fallback details in telemetry tooltips', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(baseTime);
    const now = Date.now();

    const scope = buildClusterScopeList(['cluster-a'], '');
    const configState = {
      ...createReadyState({
        resources: [{ kind: 'ConfigMap', name: 'app-config', namespace: 'default', data: 2 }],
      }),
      scope,
    };
    // cluster-config is now a scoped domain, so set scoped entries instead of domain state.
    setScopedEntries('cluster-config', [[scope, configState]]);

    fetchTelemetrySummaryMock.mockResolvedValueOnce({
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
          activeSessions: 1,
          totalMessages: 5,
          droppedMessages: 1,
          errorCount: 0,
          lastConnect: now - 4000,
          lastEvent: now - 1500,
        },
      ],
    });

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

    await flushAsync();
    await flushAsync();

    const rows = rendered.container.querySelectorAll('.diagnostics-table tbody tr');
    const configRow = Array.from(rows).find((row) => row.textContent?.includes('Cluster Config'));
    expect(configRow).toBeDefined();

    const cells = configRow?.querySelectorAll('td') ?? [];
    const telemetryCell = cells[11];
    expect(telemetryCell?.textContent).toContain('Stream unhealthy');
    expect(telemetryCell?.getAttribute('title')).toContain('Stream health: unhealthy');
    expect(telemetryCell?.getAttribute('title')).toContain('Stream reason: no-delivery');
    expect(telemetryCell?.getAttribute('title')).toContain('Stream fallbacks: 2');
    expect(telemetryCell?.getAttribute('title')).toContain('Last fallback: stream stalled');

    await rendered.unmount();
    healthSpy.mockRestore();
    telemetrySpy.mockRestore();
  });

  test('shows all streams without filter controls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    fetchTelemetrySummaryMock.mockResolvedValueOnce({
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
          errorCount: 0,
          lastConnect: now - 1000,
          lastEvent: now - 500,
        },
        {
          name: 'events',
          activeSessions: 2,
          totalMessages: 10,
          droppedMessages: 1,
          errorCount: 0,
          lastConnect: now - 1200,
          lastEvent: now - 700,
        },
      ],
    });

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });

    await flushAsync();
    await flushAsync();

    const tabButtons = rendered.container.querySelectorAll<HTMLButtonElement>('.tab-item');
    await act(async () => {
      tabButtons[1].click();
      await Promise.resolve();
    });
    await flushAsync();

    const streamsSection = rendered.container.querySelector('.diagnostics-section');
    expect(streamsSection).toBeTruthy();
    expect(streamsSection!.querySelectorAll('button, input').length).toBe(0);

    const streamRows = streamsSection!.querySelectorAll('tbody tr');
    expect(Array.from(streamRows).some((row) => row.textContent?.includes('Resources'))).toBe(true);
    expect(Array.from(streamRows).some((row) => row.textContent?.includes('Events'))).toBe(true);

    await rendered.unmount();
  });

  test('shows idle metrics summary when polling is inactive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    fetchTelemetrySummaryMock.mockResolvedValueOnce({
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
    });

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });

    await flushAsync();
    await flushAsync();

    const metricsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(2) .diagnostics-summary-primary'
    );
    expect(metricsPrimary?.textContent).toContain('Status: Idle');

    await rendered.unmount();
  });

  test('shows warning summaries when telemetry fetch fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    fetchTelemetrySummaryMock.mockRejectedValueOnce(new Error('Telemetry offline'));

    const { DiagnosticsPanel } = await import('./DiagnosticsPanel');
    const rendered = await renderDiagnosticsPanel(DiagnosticsPanel, { isOpen: true });

    await flushAsync();
    await flushAsync();

    const metricsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(2) .diagnostics-summary-primary'
    );
    expect(metricsPrimary?.textContent).toContain('Status: Unavailable');
    expect(metricsPrimary?.className).toContain('diagnostics-summary-warning');

    const eventsPrimary = rendered.container.querySelector<HTMLSpanElement>(
      '.diagnostics-summary-card:nth-of-type(3) .diagnostics-summary-primary'
    );
    expect(eventsPrimary?.className).toContain('diagnostics-summary-warning');
    expect(eventsPrimary?.textContent?.trim()).toBe('Active: — • Delivered: — • Dropped: —');

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

    const descriptorDefault: NormalizedCapabilityDescriptor = {
      id: 'cap-default',
      resourceKind: 'deployments',
      verb: 'get',
      namespace: 'default',
    };
    const descriptorExec: NormalizedCapabilityDescriptor = {
      id: 'cap-exec',
      resourceKind: 'pods',
      verb: 'create',
      namespace: 'default',
      subresource: 'exec',
    };
    const descriptorCluster: NormalizedCapabilityDescriptor = {
      id: 'cap-cluster',
      resourceKind: 'namespaces',
      verb: 'list',
    };
    const descriptorOther: NormalizedCapabilityDescriptor = {
      id: 'cap-other',
      resourceKind: 'configmaps',
      verb: 'get',
      namespace: 'kube-system',
    };

    capabilityDiagnosticsData = [
      {
        key: 'diag-default',
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
        pendingCount: 0,
        inFlightCount: 0,
        consecutiveFailureCount: 0,
        lastDescriptors: [descriptorCluster],
      },
    ];

    const createEntry = (
      descriptor: NormalizedCapabilityDescriptor,
      overrides: Partial<CapabilityEntry> = {}
    ): CapabilityEntry => ({
      key: `entry-${descriptor.id}`,
      request: descriptor,
      status: overrides.status ?? 'ready',
      result: overrides.result,
      error: overrides.error,
      lastFetched: overrides.lastFetched ?? now - 1000,
    });

    const permissionStatuses: PermissionStatus[] = [
      {
        id: 'perm-default',
        allowed: false,
        pending: false,
        reason: 'Forbidden',
        error: 'Denied by policy',
        descriptor: descriptorDefault,
        entry: createEntry(descriptorDefault, {
          result: {
            id: descriptorDefault.id,
            verb: descriptorDefault.verb,
            resourceKind: descriptorDefault.resourceKind,
            namespace: descriptorDefault.namespace,
            allowed: false,
          },
        }),
        feature: 'Namespace workloads',
      },
      {
        id: 'perm-exec',
        allowed: false,
        pending: true,
        descriptor: descriptorExec,
        entry: createEntry(descriptorExec, { status: 'loading' }),
        feature: 'Namespace workloads',
      },
      {
        id: 'perm-cluster',
        allowed: true,
        pending: false,
        descriptor: descriptorCluster,
        entry: createEntry(descriptorCluster, {
          result: {
            id: descriptorCluster.id,
            verb: descriptorCluster.verb,
            resourceKind: descriptorCluster.resourceKind,
            allowed: true,
          },
        }),
        feature: 'Cluster RBAC',
      },
      {
        id: 'perm-other',
        allowed: true,
        pending: false,
        descriptor: descriptorOther,
        entry: createEntry(descriptorOther, {
          result: {
            id: descriptorOther.id,
            verb: descriptorOther.verb,
            resourceKind: descriptorOther.resourceKind,
            namespace: descriptorOther.namespace,
            allowed: true,
          },
        }),
        feature: 'Namespace workloads',
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

    const tabButtons = rendered.container.querySelectorAll<HTMLButtonElement>('.tab-item');
    await act(async () => {
      // Skip the new streams tab to reach capability checks.
      tabButtons[2].click();
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
    expect(batchCells[0].textContent?.trim()).toBe('default');
    expect(batchCells[1].textContent?.trim()).toBe('2');
    expect(batchCells[2].textContent?.trim()).toBe('1');
    expect(batchCells[3].textContent?.trim()).toMatch(/s$/);
    expect(batchCells[6].textContent?.trim()).toBe('Error');
    expect(batchCells[9].textContent).toContain('Denied by policy');
    // Descriptors are rendered in grouped format: "resource: verb(s)".
    expect(batchCells[10].textContent).toContain('deployments:');
    expect(batchCells[10].textContent).toContain('pods:');

    await act(async () => {
      tabButtons[3].click();
      await Promise.resolve();
    });
    await flushAsync();

    const permissionsBody = rendered.container.querySelector('.diagnostics-table tbody');
    expect(permissionsBody).toBeTruthy();
    const scopedRows = permissionsBody!.querySelectorAll('tr');
    expect(scopedRows.length).toBe(2);
    expect(scopedRows[0].textContent).toContain('default');
    expect(scopedRows[0].textContent).toContain('deployments (get)');
    expect(scopedRows[1].textContent).toContain('pods/exec (create)');

    const toggle = rendered.container.querySelector<HTMLInputElement>(
      '.diagnostics-permissions-toggle input'
    );
    expect(toggle).toBeTruthy();
    expect(toggle?.checked).toBe(false);

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    await flushAsync();

    const updatedToggle = rendered.container.querySelector<HTMLInputElement>(
      '.diagnostics-permissions-toggle input'
    );
    expect(updatedToggle?.checked).toBe(true);
    const allRows = permissionsBody!.querySelectorAll('tr');
    expect(allRows.length).toBe(4);
    expect(Array.from(allRows).some((row) => row.textContent?.includes('Cluster RBAC'))).toBe(true);
    expect(Array.from(allRows).some((row) => row.textContent?.includes('kube-system'))).toBe(true);

    await rendered.unmount();
  });
});
