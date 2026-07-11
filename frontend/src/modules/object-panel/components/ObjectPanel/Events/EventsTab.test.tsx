/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.test.tsx
 *
 * Verifies EventsTab carries per-event cluster identity through to
 * openRelatedObject, preferring it over the parent panel's cluster.
 */

import type { GridTableProps } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectEventSummary } from '@/core/refresh/types';
import { requireValue } from '@/test-utils/requireValue';

type CapturedEventRow = Record<string, unknown>;
interface CapturedGridTableProps
  extends Pick<GridTableProps<CapturedEventRow>, 'columns' | 'data' | 'sortConfig'> {
  onRowClick: (item: CapturedEventRow) => void;
}

interface RefreshOrchestratorMock {
  setScopedDomainEnabled: ReturnType<typeof vi.fn>;
}

interface RefreshManagerMock {
  register: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
}

// Capture the openWithObject calls so we can inspect clusterId.
const mockOpenWithObject = vi.fn();
const mockFindCatalogObjectByUID = vi.fn();

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: mockOpenWithObject,
  }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => mockFindCatalogObjectByUID(...args),
}));

vi.mock('@/core/refresh/clusterScope', () => ({
  buildClusterScope: (_clusterId: string | undefined, scope: string) => `scoped:${scope}`,
  // Minimal stub matching the real signature. Tests that care about the
  // GVK form assert on the scope string they get back; the legacy
  // kind-only tests are agnostic.
  buildObjectScope: (args: {
    namespace: string;
    group?: string | null;
    version?: string | null;
    kind: string;
    name: string;
  }) => {
    const version = (args.version ?? '').trim();
    if (!version) {
      return `${args.namespace}:${args.kind}:${args.name}`;
    }
    const group = (args.group ?? '').trim();
    return `${args.namespace}:${group}/${version}:${args.kind}:${args.name}`;
  },
}));

const hoistedSnapshot = vi.hoisted(() => ({
  data: null as { events: ObjectEventSummary[] } | null,
  stats: null as import('@/core/refresh/types').SnapshotStats | null,
  status: 'ready' as string,
  error: null as string | null,
}));

const gridTableState = vi.hoisted(() => ({
  lastProps: null as CapturedGridTableProps | null,
}));

const autoRefreshLoadingState = vi.hoisted(() => ({
  isPaused: false,
  isManualRefreshActive: false,
  suppressPassiveLoading: false,
}));

const appPreferencesMocks = vi.hoisted(() => ({
  getAutoRefreshEnabled: vi.fn(() => true),
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: () => hoistedSnapshot,
  // Consumed by useStreamSignalRefetch (the object-events doorbell refetch);
  // no doorbell clocks in these tests, so an empty state map keeps it inert.
  useRefreshScopedDomainStates: () => ({}),
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => autoRefreshLoadingState,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => appPreferencesMocks.getAutoRefreshEnabled(),
}));

const mockFetchScopedDomain = vi.fn(() => Promise.resolve());

vi.mock('@/core/refresh', () => ({
  refreshManager: { register: vi.fn(), unregister: vi.fn() },
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    fetchScopedDomain: mockFetchScopedDomain,
  },
}));

// Capture the onRefresh callback registered by EventsTab so we can invoke it.
const refreshWatcherState = { onRefresh: null as ((isManual: boolean) => Promise<void>) | null };
vi.mock('@/core/refresh/hooks/useRefreshWatcher', () => ({
  useRefreshWatcher: (opts: { onRefresh: (isManual: boolean) => Promise<void> }) => {
    refreshWatcherState.onRefresh = opts.onRefresh;
  },
}));

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: CapturedGridTableProps) => {
    gridTableState.lastProps = props;
    const { data, onRowClick } = props;
    return (
      <div data-testid="grid-table">
        {withStableListKeys(data, (item) => JSON.stringify(item)).map(({ key, value: item }, i) => (
          <button
            type="button"
            key={key}
            data-testid={`row-${i}`}
            onClick={() => onRowClick(item)}
          />
        ))}
      </div>
    );
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

vi.mock('./EventsTab.css', () => ({}));

const PARENT_CLUSTER_ID = 'parent-cluster';
const PARENT_CLUSTER_NAME = 'Parent Cluster';
const EVENT_CLUSTER_ID = 'event-cluster';
const EVENT_CLUSTER_NAME = 'Event Cluster';

/** Build a minimal ObjectEventSummary for testing. */
function makeEvent(overrides: Partial<ObjectEventSummary> = {}): ObjectEventSummary {
  return {
    clusterId: PARENT_CLUSTER_ID,
    clusterName: PARENT_CLUSTER_NAME,
    kind: 'Event',
    name: 'event-a',
    uid: 'event-a-uid',
    resourceVersion: '1',
    eventType: 'Normal',
    reason: 'Created',
    message: 'test event',
    count: 1,
    firstTimestamp: '2026-01-01T00:00:00Z',
    lastTimestamp: '2026-01-01T00:00:00Z',
    source: 'kubelet',
    involvedObjectName: 'related-pod',
    involvedObjectKind: 'Pod',
    involvedObjectNamespace: 'default',
    involvedObjectUid: 'related-pod-uid',
    involvedObjectApiVersion: 'v1',
    namespace: 'default',
    ...overrides,
  };
}

describe('EventsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let EventsTab: typeof import('./EventsTab').default;
  let refreshOrchestrator: RefreshOrchestratorMock;
  let refreshManagerMock: RefreshManagerMock;

  beforeAll(async () => {
    ({ default: EventsTab } = await import('./EventsTab'));
    const refreshModule = await import('@/core/refresh');
    refreshOrchestrator = refreshModule.refreshOrchestrator as unknown as RefreshOrchestratorMock;
    refreshManagerMock = refreshModule.refreshManager as unknown as RefreshManagerMock;
  });

  beforeEach(() => {
    mockOpenWithObject.mockClear();
    mockFindCatalogObjectByUID.mockReset();
    mockFetchScopedDomain.mockClear();
    refreshOrchestrator.setScopedDomainEnabled.mockClear();
    refreshManagerMock.register.mockClear();
    refreshManagerMock.unregister.mockClear();
    refreshWatcherState.onRefresh = null;
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
    appPreferencesMocks.getAutoRefreshEnabled.mockReturnValue(true);
    gridTableState.lastProps = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    hoistedSnapshot.data = null;
    hoistedSnapshot.stats = null;
    hoistedSnapshot.status = 'ready';
    hoistedSnapshot.error = null;
  });

  const parentObjectData = {
    kind: 'Deployment',
    name: 'my-deploy',
    namespace: 'default',
    clusterId: PARENT_CLUSTER_ID,
    clusterName: PARENT_CLUSTER_NAME,
  };

  const PANEL_ID = `obj:${PARENT_CLUSTER_ID}:apps/v1/deployment:default:my-deploy`;

  it('registers the events refresher under the panel-scoped name', async () => {
    // Same-kind panels must not share an events refresher: a kind-only name
    // let one panel's unmount unregister the other's refresher + subscribers.
    hoistedSnapshot.data = { events: [] };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    expect(refreshManagerMock.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: `object-deployment:${PANEL_ID}-events` })
    );
  });

  it('defaults the visible Age column to newest-event sorting', async () => {
    hoistedSnapshot.data = {
      events: [makeEvent()],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    expect(gridTableState.lastProps?.sortConfig).toEqual({ key: 'age', direction: 'desc' });
  });

  it('renders event Age from the live event timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    hoistedSnapshot.data = {
      events: [makeEvent({ lastTimestamp: '2026-01-01T00:00:00Z' })],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    const gridProps = requireValue(
      gridTableState.lastProps,
      'expected captured GridTable props in EventsTab.test.tsx'
    );
    const ageColumn = requireValue(
      gridProps.columns.find((column) => column.key === 'age'),
      'expected age column in EventsTab.test.tsx'
    );
    const firstRow = requireValue(gridProps.data[0], 'expected event row in EventsTab.test.tsx');
    const cellContainer = document.createElement('div');
    document.body.appendChild(cellContainer);
    const cellRoot = ReactDOM.createRoot(cellContainer);
    try {
      act(() => {
        cellRoot.render(ageColumn.render(firstRow));
      });
      expect(cellContainer.textContent).toBe('10s');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(cellContainer.textContent).toBe('11s');
    } finally {
      act(() => cellRoot.unmount());
      cellContainer.remove();
    }
  });

  it('prefers per-event clusterId over parent panel cluster when opening related objects', async () => {
    // Event has its own cluster identity distinct from the parent panel.
    hoistedSnapshot.data = {
      events: [makeEvent({ clusterId: EVENT_CLUSTER_ID, clusterName: EVENT_CLUSTER_NAME })],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    expect(row).toBeTruthy();

    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    const call = mockOpenWithObject.mock.calls[0][0];
    expect(call.clusterId).toBe(EVENT_CLUSTER_ID);
    expect(call.clusterName).toBe(EVENT_CLUSTER_NAME);
  });

  it('renders backend truncation stats for the object-events Local Partial window', async () => {
    hoistedSnapshot.data = {
      events: [makeEvent()],
    };
    hoistedSnapshot.stats = {
      itemCount: 1,
      buildDurationMs: 0,
      truncated: true,
      totalItems: 9,
      warnings: ['Showing most recent 1 of 9 events'],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    expect(container.textContent).toContain('Showing most recent 1 of 9 events');
    expect(container.textContent).toContain('visible rows');
  });

  it('passes isManual flag through to fetchScopedDomain without inversion', async () => {
    hoistedSnapshot.data = { events: [] };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    expect(refreshWatcherState.onRefresh).toBeTruthy();

    // Manual refresh — orchestrator should see isManual: true.
    mockFetchScopedDomain.mockClear();
    await act(async () => {
      await requireValue(
        refreshWatcherState.onRefresh,
        'expected test value in EventsTab.test.tsx'
      )(true);
    });
    expect(mockFetchScopedDomain).toHaveBeenCalledWith('object-events', expect.any(String), {
      isManual: true,
      streamSignal: false,
    });

    // Scheduled refresh — orchestrator should see isManual: false.
    mockFetchScopedDomain.mockClear();
    await act(async () => {
      await requireValue(
        refreshWatcherState.onRefresh,
        'expected test value in EventsTab.test.tsx'
      )(false);
    });
    expect(mockFetchScopedDomain).toHaveBeenCalledWith('object-events', expect.any(String), {
      isManual: false,
      streamSignal: false,
    });
  });

  it('enables the exact events scope and preserves state on cleanup', async () => {
    const eventsScope = 'parent-cluster|default:apps/v1:Deployment:my-deploy';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope={eventsScope}
        />
      );
    });

    expect(refreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-events',
      eventsScope,
      true
    );

    refreshOrchestrator.setScopedDomainEnabled.mockClear();
    refreshManagerMock.register.mockClear();
    refreshManagerMock.unregister.mockClear();

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={false}
          eventsScope={eventsScope}
        />
      );
    });

    expect(refreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-events',
      eventsScope,
      false,
      { preserveState: true }
    );
  });

  it('shows the paused message instead of a loading placeholder before first load', async () => {
    autoRefreshLoadingState.isPaused = true;
    autoRefreshLoadingState.suppressPassiveLoading = true;
    appPreferencesMocks.getAutoRefreshEnabled.mockReturnValue(false);
    hoistedSnapshot.data = null;
    hoistedSnapshot.status = 'loading';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    expect(container.textContent).toContain('Auto-refresh is disabled');
    expect(container.textContent).not.toContain('Loading events...');
    expect(mockFetchScopedDomain).not.toHaveBeenCalled();
  });

  it('falls back to parent panel cluster when event has no cluster identity', async () => {
    // Event without cluster fields — should fall back to parent panel.
    hoistedSnapshot.data = {
      events: [makeEvent({ clusterId: undefined, clusterName: undefined })],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    expect(row).toBeTruthy();

    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    const call = mockOpenWithObject.mock.calls[0][0];
    expect(call.clusterId).toBe(PARENT_CLUSTER_ID);
    expect(call.clusterName).toBe(PARENT_CLUSTER_NAME);
  });

  it('threads the event involvedObject GVK to openWithObject so colliding kinds are disambiguated', async () => {
    // Two different CRDs both define the kind "DBInstance". Without
    // group/version on the openWithObject reference, the panel cannot
    // tell them apart and the backend's legacy kind-only resolver picks
    // whichever one came first in discovery — which is exactly the
    // kind-only-objects bug.
    hoistedSnapshot.data = {
      events: [
        makeEvent({
          involvedObjectKind: 'DBInstance',
          involvedObjectName: 'orders-db',
          involvedObjectNamespace: 'team-a',
          involvedObjectApiVersion: 'documentdb.services.k8s.aws/v1alpha1',
          clusterId: EVENT_CLUSTER_ID,
        }),
      ],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    expect(row).toBeTruthy();

    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    const call = mockOpenWithObject.mock.calls[0][0];
    expect(call.kind).toBe('DBInstance');
    expect(call.name).toBe('orders-db');
    expect(call.namespace).toBe('team-a');
    expect(call.group).toBe('documentdb.services.k8s.aws');
    expect(call.version).toBe('v1alpha1');
  });

  it('prefers the openable involvedObject ref over display-only event object fields', async () => {
    hoistedSnapshot.data = {
      events: [
        makeEvent({
          involvedObjectKind: 'Pod',
          involvedObjectName: 'display-only-name',
          involvedObjectNamespace: 'default',
          involvedObjectUid: 'display-uid',
          involvedObjectApiVersion: 'v1',
          involvedObject: {
            ref: {
              clusterId: EVENT_CLUSTER_ID,
              group: 'apps',
              version: 'v1',
              kind: 'Deployment',
              resource: 'deployments',
              namespace: 'team-a',
              name: 'api',
              uid: 'deployment-uid',
            },
          },
        }),
      ],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    expect(mockOpenWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: EVENT_CLUSTER_ID,
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        resource: 'deployments',
        namespace: 'team-a',
        name: 'api',
        uid: 'deployment-uid',
      })
    );
  });

  it('parses core/v1 involvedObject apiVersion into an empty group + v1 version', async () => {
    hoistedSnapshot.data = {
      events: [
        makeEvent({
          involvedObjectKind: 'Pod',
          involvedObjectName: 'web-0',
          involvedObjectNamespace: 'default',
          involvedObjectApiVersion: 'v1',
        }),
      ],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    const call = mockOpenWithObject.mock.calls[0][0];
    expect(call.group).toBe('');
    expect(call.version).toBe('v1');
  });

  it('resolves involved CRDs by UID when the event omits apiVersion', async () => {
    mockFindCatalogObjectByUID.mockResolvedValue({
      kind: 'Database',
      name: 'orders-db',
      namespace: 'team-a',
      clusterId: EVENT_CLUSTER_ID,
      clusterName: EVENT_CLUSTER_NAME,
      group: 'db.example.io',
      version: 'v1',
      resource: 'databases',
      uid: 'orders-db-uid',
    });
    hoistedSnapshot.data = {
      events: [
        makeEvent({
          involvedObjectKind: 'Database',
          involvedObjectName: 'orders-db',
          involvedObjectNamespace: 'team-a',
          involvedObjectUid: 'orders-db-uid',
          involvedObjectApiVersion: undefined,
          clusterId: EVENT_CLUSTER_ID,
          clusterName: EVENT_CLUSTER_NAME,
        }),
      ],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          panelId={PANEL_ID}
          isActive={true}
          eventsScope="parent-cluster|default:apps/v1:Deployment:my-deploy"
        />
      );
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    expect(mockFindCatalogObjectByUID).toHaveBeenCalledWith(EVENT_CLUSTER_ID, 'orders-db-uid');
    expect(mockOpenWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Database',
        name: 'orders-db',
        group: 'db.example.io',
        version: 'v1',
        uid: 'orders-db-uid',
      })
    );
  });
});
