/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.test.tsx
 *
 * Verifies EventsTab carries per-event cluster identity through to
 * openRelatedObject, preferring it over the parent panel's cluster.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectEventSummary } from '@/core/refresh/types';

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
  data: null as any,
  status: 'ready' as string,
  error: null as string | null,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: () => hoistedSnapshot,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => true,
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
  default: ({ data, onRowClick }: { data: any[]; onRowClick: (item: any) => void }) => (
    <div data-testid="grid-table">
      {data.map((item: any, i: number) => (
        <button key={i} data-testid={`row-${i}`} onClick={() => onRowClick(item)} />
      ))}
    </div>
  ),
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
    kind: 'Event',
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
    namespace: 'default',
    ...overrides,
  };
}

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('EventsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let EventsTab: React.FC<any>;

  beforeAll(async () => {
    ({ default: EventsTab } = await import('./EventsTab'));
  });

  beforeEach(() => {
    mockOpenWithObject.mockClear();
    mockFindCatalogObjectByUID.mockReset();
    mockFetchScopedDomain.mockClear();
    refreshWatcherState.onRefresh = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    hoistedSnapshot.data = null;
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
          isActive={true}
          eventsScope="parent-cluster|default:Deployment:my-deploy"
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

  it('passes isManual flag through to fetchScopedDomain without inversion', async () => {
    hoistedSnapshot.data = { events: [] };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(
        <EventsTab
          objectData={parentObjectData}
          isActive={true}
          eventsScope="parent-cluster|default:Deployment:my-deploy"
        />
      );
    });

    expect(refreshWatcherState.onRefresh).toBeTruthy();

    // Manual refresh — orchestrator should see isManual: true.
    mockFetchScopedDomain.mockClear();
    await act(async () => {
      await refreshWatcherState.onRefresh!(true);
    });
    expect(mockFetchScopedDomain).toHaveBeenCalledWith('object-events', expect.any(String), {
      isManual: true,
    });

    // Scheduled refresh — orchestrator should see isManual: false.
    mockFetchScopedDomain.mockClear();
    await act(async () => {
      await refreshWatcherState.onRefresh!(false);
    });
    expect(mockFetchScopedDomain).toHaveBeenCalledWith('object-events', expect.any(String), {
      isManual: false,
    });
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
          isActive={true}
          eventsScope="parent-cluster|default:Deployment:my-deploy"
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
          isActive={true}
          eventsScope="parent-cluster|default:Deployment:my-deploy"
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
          isActive={true}
          eventsScope="parent-cluster|default:Deployment:my-deploy"
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
          isActive={true}
          eventsScope="parent-cluster|default:Deployment:my-deploy"
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
