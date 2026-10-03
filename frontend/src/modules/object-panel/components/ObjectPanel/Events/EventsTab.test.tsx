/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.test.tsx
 *
 * Verifies EventsTab carries per-event cluster identity through to
 * openRelatedObject, preferring it over the parent panel's cluster.
 */

import type { GridTableProps } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { act, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalRowTestOverrides, ObjectEventSummary } from '@/core/refresh/types';
import { requireReactElement } from '@/test-utils/requireReactElement';
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
const navigationMocks = vi.hoisted(() => ({ available: true, navigateToView: vi.fn() }));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: mockOpenWithObject,
  }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => navigationMocks,
}));

vi.mock('@core/backend-api', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => mockFindCatalogObjectByUID(...args),
}));

vi.mock('@/core/refresh/clusterScope', () => ({
  buildClusterScope: (_clusterId: string | undefined, scope: string) => `scoped:${scope}`,
  // The broker-read diagnostics store parses the request scope to attribute a
  // read to its cluster, so this module's mock must carry that export too.
  parseClusterScope: (value?: string | null) => ({
    clusterId: '',
    scope: (value ?? '').trim(),
    isMultiCluster: false,
  }),
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

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@/core/cluster-workspace/useClusterWorkspace', () => ({
  useClusterNameResolver: () => (clusterId: string) =>
    clusterId === 'event-cluster' ? 'Event Cluster' : 'Parent Cluster',
}));

const PARENT_CLUSTER_ID = 'parent-cluster';
const PARENT_CLUSTER_NAME = 'Parent Cluster';
const EVENT_CLUSTER_ID = 'event-cluster';
const EVENT_CLUSTER_NAME = 'Event Cluster';

/** Build a minimal ObjectEventSummary for testing. */
function makeEvent(
  overrides: CanonicalRowTestOverrides<ObjectEventSummary> = {}
): ObjectEventSummary {
  const { ref, ...row } = overrides;
  return {
    ref: {
      clusterId: PARENT_CLUSTER_ID,
      group: 'events.k8s.io',
      version: 'v1',
      kind: 'Event',
      resource: 'events',
      namespace: 'default',
      name: 'event-a',
      uid: 'event-a-uid',
      ...ref,
    },
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
    // The backend sends an openable link whenever the event names a versioned
    // involved object, stamped with the event's cluster.
    involvedObject: {
      ref: {
        clusterId: ref?.clusterId ?? PARENT_CLUSTER_ID,
        group: '',
        version: 'v1',
        kind: 'Pod',
        resource: 'pods',
        namespace: 'default',
        name: 'related-pod',
        uid: 'related-pod-uid',
      },
    },
    ...row,
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
    navigationMocks.available = true;
    navigationMocks.navigateToView.mockClear();
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

  // The Object Name link opens the involved object; Enter on the focused row
  // opens the Event.
  const clickObjectName = async (index = 0) => {
    const gridProps = requireValue(
      gridTableState.lastProps,
      'expected captured GridTable props in EventsTab.test.tsx'
    );
    const column = requireValue(
      gridProps.columns.find((candidate) => candidate.key === 'objectName'),
      'expected Object Name column in EventsTab.test.tsx'
    );
    const cell = requireReactElement<{ onClick?: (event: { altKey: boolean }) => void }>(
      column.render(
        requireValue(gridProps.data[index], 'expected Event row in EventsTab.test.tsx')
      ),
      'expected interactive Object Name cell in EventsTab.test.tsx'
    );
    await act(async () => {
      cell.props.onClick?.({ altKey: false });
      await Promise.resolve();
    });
  };

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

  it.each([true, false])(
    'preserves Object Name Alt+click with workspace navigation available=%s',
    async (available) => {
      navigationMocks.available = available;
      hoistedSnapshot.data = { events: [makeEvent()] };
      act(() => {
        root.render(
          <EventsTab
            objectData={parentObjectData}
            panelId={PANEL_ID}
            eventsScope="cluster-a:events"
            isActive
          />
        );
      });

      const objectNameColumn = requireValue(
        gridTableState.lastProps?.columns.find((column) => column.key === 'objectName'),
        'expected object name column'
      );
      const row = requireValue(gridTableState.lastProps?.data[0], 'expected event row');
      // The link opens the involved object while Enter on the row opens the Event, so it
      // is its own action with its own Tab stop.
      expect(objectNameColumn.rowAction).not.toBe(true);
      const objectNameCell = requireReactElement<{
        onClick: (event: {
          altKey: boolean;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => void;
      }>(objectNameColumn.render(row), 'expected interactive event object name');
      await act(async () => {
        objectNameCell.props.onClick({
          altKey: true,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });
        await Promise.resolve();
      });
      const expectedAction = available ? navigationMocks.navigateToView : mockOpenWithObject;
      const otherAction = available ? mockOpenWithObject : navigationMocks.navigateToView;
      expect(otherAction).not.toHaveBeenCalled();
      expect(expectedAction).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          clusterId: PARENT_CLUSTER_ID,
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'default',
          name: 'related-pod',
        })
      );
    }
  );

  it('defaults the visible Last Seen column to newest-event sorting', async () => {
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

  it('renders Event Last Seen from the live event timestamp', async () => {
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

  it('uses the canonical Event columns and status chip', async () => {
    hoistedSnapshot.data = {
      events: [makeEvent({ eventType: 'Warning' })],
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
    expect(gridProps.columns.map((column) => column.header)).toEqual([
      'Kind',
      'Type',
      'Source',
      'Object Type',
      'Object Name',
      'Reason',
      'Message',
      'Last Seen',
    ]);

    const typeColumn = requireValue(
      gridProps.columns.find((column) => column.key === 'type'),
      'expected Event Type column in EventsTab.test.tsx'
    );
    const typeCell = requireReactElement<{ children?: ReactNode; variant?: string }>(
      typeColumn.render(
        requireValue(gridProps.data[0], 'expected Event row in EventsTab.test.tsx')
      ),
      'expected Event status chip in EventsTab.test.tsx'
    );
    expect(typeCell.props).toMatchObject({ children: 'Warning', variant: 'warning' });
  });

  // The mocked table invokes onRowClick, which GridTable calls only for Enter on
  // the focused row; a mouse click on a row opens nothing.
  it('opens the Event itself when the focused row is activated with Enter', async () => {
    hoistedSnapshot.data = { events: [makeEvent()] };
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
        clusterId: PARENT_CLUSTER_ID,
        group: 'events.k8s.io',
        version: 'v1',
        kind: 'Event',
        namespace: 'default',
        name: 'event-a',
      })
    );
  });

  // The Kind badge is how a mouse user opens the Event, as in the Cluster and
  // Namespace Events tables; a click on the row itself opens nothing.
  it('opens the Event itself from its Kind badge', async () => {
    hoistedSnapshot.data = { events: [makeEvent()] };
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
    const kindColumn = requireValue(
      gridProps.columns.find((column) => column.key === 'kind'),
      'expected the Event Kind column in EventsTab.test.tsx'
    );
    const kindCell = requireReactElement<{ onClick: (event: { altKey: boolean }) => void }>(
      kindColumn.render(
        requireValue(gridProps.data[0], 'expected Event row in EventsTab.test.tsx')
      ),
      'expected the interactive Event Kind badge in EventsTab.test.tsx'
    );
    await act(async () => {
      kindCell.props.onClick({ altKey: false });
      await Promise.resolve();
    });

    expect(mockOpenWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: PARENT_CLUSTER_ID,
        kind: 'Event',
        namespace: 'default',
        name: 'event-a',
      })
    );
  });

  it('prefers per-event clusterId over parent panel cluster when opening related objects', async () => {
    // Event has its own cluster identity distinct from the parent panel.
    hoistedSnapshot.data = {
      events: [makeEvent({ ref: { clusterId: EVENT_CLUSTER_ID } })],
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

    await clickObjectName();

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    const call = mockOpenWithObject.mock.calls[0][0];
    expect(call.clusterId).toBe(EVENT_CLUSTER_ID);
    expect(call.clusterName).toBe(EVENT_CLUSTER_NAME);
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
    expect(mockFetchScopedDomain).toHaveBeenCalledWith(
      'object-events',
      expect.any(String),
      expect.objectContaining({
        isManual: true,
        streamSignal: false,
        correlationId: expect.any(String),
      })
    );

    // Scheduled refresh — orchestrator should see isManual: false.
    mockFetchScopedDomain.mockClear();
    await act(async () => {
      await requireValue(
        refreshWatcherState.onRefresh,
        'expected test value in EventsTab.test.tsx'
      )(false);
    });
    expect(mockFetchScopedDomain).toHaveBeenCalledWith(
      'object-events',
      expect.any(String),
      expect.objectContaining({
        isManual: false,
        streamSignal: false,
        correlationId: expect.any(String),
      })
    );
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

  it('prefers the openable involvedObject ref over display-only event object fields', async () => {
    hoistedSnapshot.data = {
      events: [
        makeEvent({
          involvedObjectKind: 'Pod',
          involvedObjectName: 'display-only-name',
          involvedObjectNamespace: 'default',
          involvedObjectUid: 'display-uid',
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

    await clickObjectName();

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

  it('resolves involved CRDs by UID when the event omits apiVersion', async () => {
    mockFindCatalogObjectByUID.mockResolvedValue({
      ref: {
        kind: 'Database',
        name: 'orders-db',
        namespace: 'team-a',
        clusterId: EVENT_CLUSTER_ID,
        group: 'db.example.io',
        version: 'v1',
        resource: 'databases',
        uid: 'orders-db-uid',
      },
    });
    hoistedSnapshot.data = {
      events: [
        makeEvent({
          ref: { clusterId: EVENT_CLUSTER_ID },
          involvedObjectKind: 'Database',
          involvedObjectName: 'orders-db',
          involvedObjectNamespace: 'team-a',
          involvedObjectUid: 'orders-db-uid',
          // Without an apiVersion the backend can only send a display-only link.
          involvedObject: {
            display: {
              clusterId: EVENT_CLUSTER_ID,
              kind: 'Database',
              namespace: 'team-a',
              name: 'orders-db',
              uid: 'orders-db-uid',
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

    await clickObjectName();

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
