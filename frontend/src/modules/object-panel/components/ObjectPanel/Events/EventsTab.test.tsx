/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.test.tsx
 *
 * Verifies EventsTab opens an event, and the object it involves, with full
 * identity in the event's cluster. That is always the panel's own cluster: a
 * Kubernetes Event's object references carry no cluster
 * (k8s.io/api core/v1 ObjectReference), and the backend builds an object's
 * events from its scope's cluster (backend/refresh/snapshot/object_events.go).
 * Runs inside the real app shell (or a native panel window's shell) over a
 * faked backend (test-utils/appState); the table is stubbed only to reach its
 * cell renders.
 */

import type { GridTableProps } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { act, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePodSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import { getScopedDomainState } from '@/core/refresh/store';
import type { CanonicalRowTestOverrides, ObjectEventSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type OpenPanelTarget,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { streamKey } from '@/test-utils/appState/transport';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type CapturedEventRow = Record<string, unknown>;
interface CapturedGridTableProps
  extends Pick<GridTableProps<CapturedEventRow>, 'columns' | 'data' | 'sortConfig'> {
  onRowClick: (item: CapturedEventRow) => void;
}

const app = installAppStateHarness();

/**
 * Identity without the display name. When an event's related object is in
 * another cluster, the opened ref can carry the panel's cluster name or none.
 */
const withoutClusterName = (target: OpenPanelTarget) => {
  const { clusterName: _clusterName, ...identity } = target as OpenPanelTarget & {
    clusterName?: string;
  };
  return identity;
};

const gridTableState = vi.hoisted(() => ({
  lastProps: null as CapturedGridTableProps | null,
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

let PARENT_CLUSTER_ID = '';

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
        clusterId: PARENT_CLUSTER_ID,
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
  let EventsTab: typeof import('./EventsTab').default;
  let parent: TestCluster;
  let view: MountedApp;
  let eventsScope: string;

  const parentDeployment = {
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    namespace: 'default',
    name: 'my-deploy',
  };

  beforeEach(async () => {
    ({ default: EventsTab } = await import('./EventsTab'));
    parent = app.cluster({ name: 'dev', context: 'parent' });
    PARENT_CLUSTER_ID = parent.clusterId;
    app.namespaces(parent, ['default', 'team-a']);
    eventsScope = app.object(parent, parentDeployment).scopes.eventsScope ?? '';
    gridTableState.lastProps = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const parentObjectData = () => ({
    ...parentDeployment,
    clusterId: parent.clusterId,
    clusterName: parent.clusterName,
  });

  const serveEvents = (events: ObjectEventSummary[]) => {
    app.snapshots.serve('object-events', eventsScope, {
      clusterId: parent.clusterId,
      clusterName: parent.clusterName,
      events,
    });
  };

  const showEventsTab = async (isActive = true) => {
    await view.show(
      <EventsTab objectData={parentObjectData()} eventsScope={eventsScope} isActive={isActive} />
    );
  };

  const startWorkspace = async () => {
    view = await app.render(null);
  };

  const gridProps = () =>
    requireValue(
      gridTableState.lastProps,
      'expected captured GridTable props in EventsTab.test.tsx'
    );

  const firstRow = () =>
    requireValue(gridProps().data[0], 'expected Event row in EventsTab.test.tsx');

  const columnCell = <P,>(key: string) =>
    requireReactElement<P>(
      requireValue(
        gridProps().columns.find((column) => column.key === key),
        `expected ${key} column in EventsTab.test.tsx`
      ).render(firstRow()),
      `expected interactive ${key} cell in EventsTab.test.tsx`
    );

  const activate = async (run: () => void) => {
    await act(async () => {
      run();
    });
    await app.settle();
  };

  // The Object Name link opens the involved object; Enter on the focused row
  // opens the Event.
  const clickObjectName = () =>
    activate(() =>
      columnCell<{ onClick?: (event: { altKey: boolean }) => void }>('objectName').props.onClick?.({
        altKey: false,
      })
    );

  const relatedPod = () => ({
    clusterId: parent.clusterId,
    clusterName: parent.clusterName,
    group: '',
    version: 'v1',
    kind: 'Pod',
    namespace: 'default',
    name: 'related-pod',
  });

  it('navigates the workspace to the involved object on Object Name Alt+click', async () => {
    serveEvents([makeEvent()]);
    await startWorkspace();
    await showEventsTab();

    // The link opens the involved object while Enter on the row opens the Event, so it
    // is its own action with its own Tab stop.
    const objectNameColumn = requireValue(
      gridProps().columns.find((column) => column.key === 'objectName'),
      'expected object name column'
    );
    expect(objectNameColumn.rowAction).not.toBe(true);
    await activate(() =>
      columnCell<{
        onClick: (event: {
          altKey: boolean;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => void;
      }>('objectName').props.onClick({
        altKey: true,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
    );

    const owners = view.owners();
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('pods');
    expect(owners.namespace.selectedNamespace).toBe('default');
    expect(view.openPanels()).toEqual([]);
  });

  it('opens the involved object on Object Name Alt+click in a panel window, which has no workspace navigation', async () => {
    serveEvents([makeEvent()]);
    // A panel window renders every panel it opens; the pod panel reads its own data.
    const pod = app.object(parent, { ...relatedPod(), group: '', version: 'v1' });
    app.snapshots.serve('object-details', pod.scopes.detailScope ?? '', {
      detailType: 'pod',
      details: { name: 'related-pod', namespace: 'default' },
    } as never);
    app.snapshots.serve(
      'pods',
      buildRefreshScope('pods', {
        clusterId: parent.clusterId,
        selector: { kind: 'namespace', namespace: 'default' },
      }),
      makePodSnapshotPayload({ clusterId: parent.clusterId, clusterName: parent.clusterName })
    );
    app.panelWindow(parent);
    view = await app.render(null);
    await showEventsTab();

    await activate(() =>
      columnCell<{
        onClick: (event: {
          altKey: boolean;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => void;
      }>('objectName').props.onClick({
        altKey: true,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
    );

    expect(view.owners().viewState).toBeFalsy();
    expect(view.openPanels()).toEqual([relatedPod()]);
  });

  it('defaults the visible Last Seen column to newest-event sorting', async () => {
    serveEvents([makeEvent()]);
    await startWorkspace();
    await showEventsTab();

    expect(gridProps().sortConfig).toEqual({ key: 'age', direction: 'desc' });
  });

  it('renders Event Last Seen from the live event timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    serveEvents([makeEvent({ lastTimestamp: '2026-01-01T00:00:00Z' })]);
    await startWorkspace();
    await showEventsTab();

    const ageColumn = requireValue(
      gridProps().columns.find((column) => column.key === 'age'),
      'expected age column in EventsTab.test.tsx'
    );
    const cellContainer = document.createElement('div');
    document.body.appendChild(cellContainer);
    const cellRoot = ReactDOM.createRoot(cellContainer);
    try {
      act(() => {
        cellRoot.render(ageColumn.render(firstRow()));
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
    serveEvents([makeEvent({ eventType: 'Warning' })]);
    await startWorkspace();
    await showEventsTab();

    expect(gridProps().columns.map((column) => column.header)).toEqual([
      'Kind',
      'Type',
      'Source',
      'Object Type',
      'Object Name',
      'Reason',
      'Message',
      'Last Seen',
    ]);
    const typeCell = columnCell<{ children?: ReactNode; variant?: string }>('type');
    expect(typeCell.props).toMatchObject({ children: 'Warning', variant: 'warning' });
  });

  const eventA = () => ({
    clusterId: parent.clusterId,
    clusterName: parent.clusterName,
    group: 'events.k8s.io',
    version: 'v1',
    kind: 'Event',
    namespace: 'default',
    name: 'event-a',
  });

  // The stubbed table invokes onRowClick, which GridTable calls only for Enter on
  // the focused row; a mouse click on a row opens nothing.
  it('opens the Event itself when the focused row is activated with Enter', async () => {
    serveEvents([makeEvent()]);
    await startWorkspace();
    await showEventsTab();

    const row = view.container.querySelector('[data-testid="row-0"]') as HTMLButtonElement;
    await activate(() => row.click());

    expect(view.openPanels()).toEqual([eventA()]);
  });

  // The Kind badge is how a mouse user opens the Event, as in the Cluster and
  // Namespace Events tables; a click on the row itself opens nothing.
  it('opens the Event itself from its Kind badge', async () => {
    serveEvents([makeEvent()]);
    await startWorkspace();
    await showEventsTab();

    await activate(() =>
      columnCell<{ onClick: (event: { altKey: boolean }) => void }>('kind').props.onClick({
        altKey: false,
      })
    );

    expect(view.openPanels()).toEqual([eventA()]);
  });

  it('keeps the exact events scope subscribed while active and its data once hidden', async () => {
    vi.useFakeTimers();
    serveEvents([makeEvent()]);
    await startWorkspace();
    await showEventsTab(true);
    expect(app.snapshots.reads('object-events').map((read) => read.scope)).toContain(eventsScope);
    expect(app.streams.active()).toContain(streamKey('object-events', eventsScope));

    await showEventsTab(false);
    // A preserved scope's stream cancels after the unsubscribe debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(app.streams.active()).not.toContain(streamKey('object-events', eventsScope));
    // preserveState repaints the retained events when the tab is shown again.
    expect(getScopedDomainState('object-events', eventsScope).data?.events).toHaveLength(1);
  });

  it('shows the paused message instead of a loading placeholder before first load', async () => {
    app.preferences({ autoRefreshEnabled: false });
    serveEvents([makeEvent()]);
    await startWorkspace();
    await showEventsTab();

    expect(view.container.textContent).toContain('Auto-refresh is disabled');
    expect(view.container.textContent).not.toContain('Loading events...');
    expect(app.snapshots.reads('object-events')).toEqual([]);
  });

  it('prefers the openable involvedObject ref over display-only event object fields', async () => {
    serveEvents([
      makeEvent({
        involvedObjectKind: 'Pod',
        involvedObjectName: 'display-only-name',
        involvedObjectNamespace: 'default',
        involvedObjectUid: 'display-uid',
        involvedObject: {
          ref: {
            clusterId: PARENT_CLUSTER_ID,
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
    ]);
    await startWorkspace();
    await showEventsTab();

    await clickObjectName();

    expect(view.openPanels().map(withoutClusterName)).toEqual([
      {
        clusterId: parent.clusterId,
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'team-a',
        name: 'api',
      },
    ]);
  });

  it('resolves involved CRDs by UID when the event omits apiVersion', async () => {
    app.backend.answer(
      'FindCatalogObjectByUID',
      () =>
        ({
          ref: {
            kind: 'Database',
            name: 'orders-db',
            namespace: 'team-a',
            clusterId: PARENT_CLUSTER_ID,
            group: 'db.example.io',
            version: 'v1',
            resource: 'databases',
            uid: 'orders-db-uid',
          },
        }) as never
    );
    serveEvents([
      makeEvent({
        involvedObjectKind: 'Database',
        involvedObjectName: 'orders-db',
        involvedObjectNamespace: 'team-a',
        involvedObjectUid: 'orders-db-uid',
        // Without an apiVersion the backend can only send a display-only link.
        involvedObject: {
          display: {
            clusterId: PARENT_CLUSTER_ID,
            kind: 'Database',
            namespace: 'team-a',
            name: 'orders-db',
            uid: 'orders-db-uid',
          },
        },
      }),
    ]);
    await startWorkspace();
    await showEventsTab();

    await clickObjectName();

    expect(app.backend.calls('FindCatalogObjectByUID')).toEqual([
      [PARENT_CLUSTER_ID, 'orders-db-uid'],
    ]);
    expect(view.openPanels().map(withoutClusterName)).toEqual([
      {
        clusterId: parent.clusterId,
        group: 'db.example.io',
        version: 'v1',
        kind: 'Database',
        namespace: 'team-a',
        name: 'orders-db',
      },
    ]);
  });
});
