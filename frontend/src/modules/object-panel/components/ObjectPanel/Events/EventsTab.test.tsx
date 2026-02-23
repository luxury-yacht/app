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

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: mockOpenWithObject,
  }),
}));

vi.mock('@/core/refresh/clusterScope', () => ({
  buildClusterScope: (_clusterId: string | undefined, scope: string) => `scoped:${scope}`,
}));

const hoistedSnapshot = vi.hoisted(() => ({
  data: null as any,
  status: 'ready' as string,
  error: null as string | null,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: () => hoistedSnapshot,
}));

vi.mock('@/core/refresh', () => ({
  refreshManager: { register: vi.fn(), unregister: vi.fn() },
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    fetchScopedDomain: vi.fn(),
  },
}));

vi.mock('@/core/refresh/hooks/useRefreshWatcher', () => ({
  useRefreshWatcher: vi.fn(),
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

  it('prefers per-event clusterId over parent panel cluster when opening related objects', () => {
    // Event has its own cluster identity distinct from the parent panel.
    hoistedSnapshot.data = {
      events: [makeEvent({ clusterId: EVENT_CLUSTER_ID, clusterName: EVENT_CLUSTER_NAME })],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(<EventsTab objectData={parentObjectData} isActive={true} />);
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    expect(row).toBeTruthy();

    act(() => row.click());

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    const call = mockOpenWithObject.mock.calls[0][0];
    expect(call.clusterId).toBe(EVENT_CLUSTER_ID);
    expect(call.clusterName).toBe(EVENT_CLUSTER_NAME);
  });

  it('falls back to parent panel cluster when event has no cluster identity', () => {
    // Event without cluster fields — should fall back to parent panel.
    hoistedSnapshot.data = {
      events: [makeEvent({ clusterId: undefined, clusterName: undefined })],
    };
    hoistedSnapshot.status = 'ready';

    act(() => {
      root.render(<EventsTab objectData={parentObjectData} isActive={true} />);
    });

    const row = container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    expect(row).toBeTruthy();

    act(() => row.click());

    expect(mockOpenWithObject).toHaveBeenCalledTimes(1);
    const call = mockOpenWithObject.mock.calls[0][0];
    expect(call.clusterId).toBe(PARENT_CLUSTER_ID);
    expect(call.clusterName).toBe(PARENT_CLUSTER_NAME);
  });
});
