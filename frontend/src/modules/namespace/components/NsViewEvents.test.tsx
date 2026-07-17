/**
 * frontend/src/modules/namespace/components/NsViewEvents.test.tsx
 *
 * Test suite for NsViewEvents.
 * Covers key behaviors and edge cases for NsViewEvents.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { OBJECT_ACTION_IDS, objectActionLabel } from '@shared/actions/objectActionContract';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SortConfig, UseTableSortOptions } from '@/hooks/useTableSort';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

import NsViewEvents, { type EventData } from '@modules/namespace/components/NsViewEvents';

type CapturedGridTableProps = GridTableProps<EventData> & {
  getCustomContextMenuItems: NonNullable<GridTableProps<EventData>['getCustomContextMenuItems']>;
};

const {
  gridTablePropsRef,
  openWithObjectMock,
  persistedSortRef,
  shortNamesMock,
  formatAgeMock,
  findCatalogObjectByUIDMock,
  useTableSortMock,
  requestRefreshDomainStateMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as unknown as CapturedGridTableProps },
  openWithObjectMock: vi.fn(),
  persistedSortRef: { current: null as SortConfig | null },
  shortNamesMock: vi.fn(() => false),
  formatAgeMock: vi.fn((timestamp: number) => `${timestamp}s`),
  findCatalogObjectByUIDMock: vi.fn(),
  requestRefreshDomainStateMock: vi.fn(),
  useTableSortMock: vi.fn(
    (
      data: EventData[],
      defaultKey?: string,
      defaultDir?: SortConfig['direction'],
      opts?: UseTableSortOptions<EventData>
    ) => {
      const fallbackSort = defaultKey
        ? { key: defaultKey, direction: defaultDir ?? 'asc' }
        : { key: '', direction: null };
      return {
        sortedData: data,
        sortConfig: opts?.controlledSort ?? fallbackSort,
        handleSort: vi.fn(),
      };
    }
  ),
}));

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],

    addFavorite: vi.fn(),
    updateFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
  FavoritesProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: () => ({
    type: 'toggle',
    id: 'favorite',
    icon: null,
    active: false,
    onClick: () => undefined,
    title: 'Save as favorite',
  }),
}));

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: CapturedGridTableProps) => {
      gridTablePropsRef.current = props;
      return (
        <table data-testid="grid-table">
          <tbody>
            {withStableListKeys(props.data, (row) => JSON.stringify(row)).map(
              ({ key, value: row }) => (
                <tr key={key}>
                  <td>{row.reason}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      );
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => findCatalogObjectByUIDMock(...args),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (
    data: EventData[],
    defaultKey?: string,
    defaultDirection?: SortConfig['direction'],
    options?: UseTableSortOptions<EventData>
  ) => useTableSortMock(data, defaultKey, defaultDirection, options),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => shortNamesMock(),
}));

// Single-namespace event tables are query-backed now, so the displayed rows come from the typed
// query. Override only the typed-query data path and its readiness gates; keep the rest of these
// modules real so the involved-object catalog lookup (requestData/readCatalogObjectByUID) still
// resolves through the mocked Wails layer.
vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/data-access')>();
  return {
    ...actual,
    requestRefreshDomainState: (...args: unknown[]) => requestRefreshDomainStateMock(...args),
    useScopedRefreshDomainLifecycle: vi.fn(),
  };
});

vi.mock('@/core/refresh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/refresh')>();
  return {
    ...actual,
    // A settled live domain so the typed query's readiness gate opens in tests.
    useRefreshScopedDomain: () => ({
      status: 'ready',
      data: { rows: [] },
      stats: null,
      version: 1,
      checksum: '',
      lastUpdated: 1,
      droppedAutoRefreshes: 0,
    }),
  };
});

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    storageKey: 'gridtable:v1:cluster-a:namespace-events',
    sortConfig: { key: 'age', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: {
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
      includeMetadata: false,
    },
    setFilters: vi.fn(),
    pageSize: null,
    setPageSize: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
  }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/utils/ageFormatter', () => ({
  formatAge: (timestamp: number) => formatAgeMock(timestamp),
  formatFullDate: (timestamp: number) => `full:${timestamp}`,
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => ({
    sortConfig: persistedSortRef.current,
    onSortChange: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    isNamespaceScoped: true,
    resetState: vi.fn(),
  }),
}));

describe('NsViewEvents', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    persistedSortRef.current = null;
    openWithObjectMock.mockReset();
    findCatalogObjectByUIDMock.mockReset();
    useTableSortMock.mockClear();
    shortNamesMock.mockReturnValue(false);
    formatAgeMock.mockClear();
    requestRefreshDomainStateMock.mockReset();
    // Default: the typed query settles with no payload (no rows). Tests that assert on rendered
    // rows / the involved-object action override this with their own row(s). A null payload leaves
    // the query's facet filter options untouched, so the local truncation/partial label is
    // preserved for the single-namespace partial-data copy test.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: null },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseEvent = (overrides: Partial<EventData> = {}): EventData => ({
    kind: 'Event',
    name: 'api.123',
    uid: 'event-uid',
    resourceVersion: '1',
    type: 'Warning',
    source: 'kubelet',
    reason: 'FailedScheduling',
    object: 'Pod/api',
    objectApiVersion: 'v1',
    message: 'Insufficient CPU',
    objectNamespace: 'team-a',
    namespace: 'team-a',
    clusterId: 'alpha:ctx',
    clusterName: 'alpha',
    ageTimestamp: 42,
    ...overrides,
  });

  const renderEventsView = async (
    showNamespaceColumnOrOptions:
      | boolean
      | { namespace?: string; showNamespaceColumn?: boolean; stats?: unknown } = true
  ) => {
    const options =
      typeof showNamespaceColumnOrOptions === 'boolean'
        ? { showNamespaceColumn: showNamespaceColumnOrOptions }
        : showNamespaceColumnOrOptions;
    await act(async () => {
      root.render(
        <NsViewEvents
          namespace={options.namespace ?? 'team-a'}
          showNamespaceColumn={options.showNamespaceColumn ?? true}
        />
      );
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  it('defines Last Seen as the visible Event timestamp sort column', async () => {
    const event = baseEvent({ ageTimestamp: 42 });
    const props = await renderEventsView();
    const ageColumn = requireValue(
      props.columns.find((column) => column.key === 'age'),
      'expected the event age column'
    );

    expect(ageColumn).toBeTruthy();
    expect(ageColumn.sortable).not.toBe(false);
    expect(requireValue(ageColumn.sortValue, 'expected the event age sort accessor')(event)).toBe(
      -42
    );
  });

  it('projects backend Event triage facets for All Namespaces', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [baseEvent()],
          total: 1,
          unfilteredTotal: 2,
          totalIsExact: true,
          namespaces: ['team-a', 'team-b'],
          kinds: ['Pod'],
          facetValues: [
            {
              key: 'types',
              options: [
                { value: 'Normal', label: 'Normal' },
                { value: 'Warning', label: 'Warning' },
              ],
              exact: true,
            },
            {
              key: 'reasons',
              options: [{ value: 'FailedScheduling', label: 'FailedScheduling' }],
              exact: true,
            },
            {
              key: 'sources',
              options: [{ value: 'kubelet', label: 'kubelet' }],
              exact: true,
            },
          ],
          facetsExact: true,
          capabilities: {
            queryFacets: [
              {
                key: 'types',
                label: 'Type',
                placeholder: 'All types',
                searchable: false,
                bulkActions: true,
              },
              {
                key: 'reasons',
                label: 'Reason',
                placeholder: 'All reasons',
                searchable: true,
                bulkActions: true,
              },
              {
                key: 'sources',
                label: 'Source',
                placeholder: 'All sources',
                searchable: true,
                bulkActions: true,
              },
            ],
          },
        },
      },
    });

    const props = await renderEventsView({
      namespace: ALL_NAMESPACES_SCOPE,
      showNamespaceColumn: true,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(props.filters?.options?.queryFacets).toEqual([
      expect.objectContaining({ key: 'types', searchable: false }),
      expect.objectContaining({ key: 'reasons', searchable: true }),
      expect.objectContaining({ key: 'sources', searchable: true }),
    ]);
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'namespace-events',
        scope: expect.stringContaining('cluster-a|namespace:all?'),
      })
    );
  });

  it('offers context menu navigation to related object', async () => {
    const event = baseEvent();
    // Single-namespace events are query-backed now; the involved-object action resolves the clicked
    // event against the rendered query rows, so feed the query the same row.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [event],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Event'],
          facetsExact: true,
        },
      },
    });
    await renderEventsView();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const props = gridTablePropsRef.current;

    const menu = props.getCustomContextMenuItems(event, 'objectName');
    const labels = menu.map((item) => item.label);
    expect(labels).not.toContain(objectActionLabel(OBJECT_ACTION_IDS.goToTable));
    expect(labels).toContain('View Pod');

    await act(async () => {
      menu.find((item) => item.actionId === OBJECT_ACTION_IDS.viewInvolvedObject)?.onClick?.();
      await Promise.resolve();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        group: '',
        version: 'v1',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('renders interactive object column that triggers navigation', async () => {
    const event = baseEvent();
    const props = await renderEventsView();

    const objectNameColumn = requireValue(
      props.columns.find((column) => column.key === 'objectName'),
      'expected the event object-name column'
    );

    const cell = requireReactElement<{
      onClick: (event: { stopPropagation: () => void }) => void;
      'data-gridtable-rowclick'?: string;
    }>(objectNameColumn.render(event), 'expected the event object-name cell element');

    expect(cell.props['data-gridtable-rowclick']).toBe('suppress');

    await act(async () => {
      cell.props.onClick({ stopPropagation: () => undefined });
      await Promise.resolve();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        group: '',
        version: 'v1',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('opens the Event object from the row and Kind badge', async () => {
    const event = baseEvent();
    const props = await renderEventsView();
    const onRowClick = requireValue(props.onRowClick, 'expected the namespace Event row action');

    act(() => {
      onRowClick(event);
    });

    expect(openWithObjectMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clusterId: 'alpha:ctx',
        clusterName: 'alpha',
        group: '',
        version: 'v1',
        kind: 'Event',
        resource: 'events',
        namespace: 'team-a',
        name: 'api.123',
        uid: 'event-uid',
      })
    );

    openWithObjectMock.mockClear();
    const kindColumn = requireValue(
      props.columns.find((column) => column.key === 'kind'),
      'expected the namespace Event kind column'
    );
    const kindCell = requireReactElement<{ onClick: (event: { altKey: boolean }) => void }>(
      kindColumn.render(event),
      'expected the namespace Event kind badge'
    );

    act(() => {
      kindCell.props.onClick({ altKey: false });
    });

    expect(openWithObjectMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
        kind: 'Event',
        namespace: 'team-a',
        name: 'api.123',
      })
    );
  });

  it('resolves CRD involved objects by UID when the event omits apiVersion', async () => {
    findCatalogObjectByUIDMock.mockResolvedValue({
      kind: 'Database',
      name: 'primary',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      group: 'db.example.io',
      version: 'v1',
      resource: 'databases',
      uid: 'database-uid',
    });
    const event = baseEvent({
      object: 'Database/primary',
      objectUid: 'database-uid',
      objectApiVersion: undefined,
    });
    const props = await renderEventsView();
    const objectNameColumn = requireValue(
      props.columns.find((column) => column.key === 'objectName'),
      'expected the event object-name column'
    );
    const cell = requireReactElement<{
      onClick: (event: { stopPropagation: () => void }) => void;
    }>(objectNameColumn.render(event), 'expected the event object-name cell element');

    await act(async () => {
      cell.props.onClick({ stopPropagation: () => undefined });
      await Promise.resolve();
    });

    expect(findCatalogObjectByUIDMock).toHaveBeenCalledWith('alpha:ctx', 'database-uid');
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Database',
        name: 'primary',
        group: 'db.example.io',
        version: 'v1',
        uid: 'database-uid',
      })
    );
  });

  it('keeps Event actions when no involved object is available', async () => {
    const event = baseEvent({ object: undefined });
    const props = await renderEventsView();
    const menu = props.getCustomContextMenuItems(event, 'objectName');
    const viewDetails = menu.find((item) => item.actionId === OBJECT_ACTION_IDS.viewDetails);
    expect(viewDetails).toBeTruthy();
    expect(menu.some((item) => item.actionId === OBJECT_ACTION_IDS.viewInvolvedObject)).toBe(false);

    act(() => {
      viewDetails?.onClick?.();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
        kind: 'Event',
        namespace: 'team-a',
        name: 'api.123',
      })
    );
  });

  it('passes stable event row identity into useTableSort', async () => {
    const event = baseEvent();
    await renderEventsView();

    const options = requireValue(
      useTableSortMock.mock.calls[0]?.[3],
      'expected event table sort options'
    );
    const rowIdentity = requireValue(options.rowIdentity, 'expected event table row identity');
    expect(rowIdentity(event, 0)).toBe('alpha:ctx|/v1/Event/team-a/api.123');
  });

  it('renders age from timestamp when available and falls back to provided age', async () => {
    const eventWithTimestamp = baseEvent({ ageTimestamp: 99, age: undefined });
    const props = await renderEventsView();
    const ageColumn = requireValue(
      props.columns.find((column) => column.key === 'age'),
      'expected the event age column'
    );
    const cell = requireReactElement<{ timestamp?: number; fallback?: string }>(
      ageColumn.render(eventWithTimestamp),
      'expected the live event age element'
    );
    expect(cell.props.timestamp).toBe(99);
    expect(cell.props.fallback).toBe('-');

    formatAgeMock.mockClear();
    const eventWithAge = baseEvent({ ageTimestamp: undefined, age: '5m' });
    const fallbackProps = await renderEventsView();
    const fallbackAgeColumn = requireValue(
      fallbackProps.columns.find((column) => column.key === 'age'),
      'expected the fallback event age column'
    );
    expect(fallbackAgeColumn.render(eventWithAge)).toBe('5m');
    expect(formatAgeMock).not.toHaveBeenCalled();
  });

  it('derives namespace from objectNamespace, event namespace, or component namespace', async () => {
    const noNamespaceEvent = baseEvent({ objectNamespace: undefined, namespace: undefined });
    // Query-backed: feed the query the row so the involved-object action can resolve it.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [noNamespaceEvent],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Event'],
          facetsExact: true,
        },
      },
    });
    await renderEventsView();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const props = gridTablePropsRef.current;
    const menu = props.getCustomContextMenuItems(noNamespaceEvent, 'objectName');
    await act(async () => {
      menu.find((item) => item.actionId === OBJECT_ACTION_IDS.viewInvolvedObject)?.onClick?.();
      await Promise.resolve();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('generates stable keys and omits namespace column when not requested', async () => {
    const event = baseEvent({
      objectNamespace: '',
      namespace: 'ns-one',
      age: '2m',
      ageTimestamp: undefined,
    });
    const props = await renderEventsView();
    const key = props.keyExtractor(event, 0);
    expect(key).toContain('ns-one');
    expect(key).toContain('2m');

    const noNamespaceProps = await renderEventsView(false);
    const namespaceColumn = noNamespaceProps.columns.find((column) => column.key === 'namespace');
    expect(namespaceColumn).toBeUndefined();
  });

  it('renders Event types with status chips', async () => {
    const props = await renderEventsView();

    const typeColumn = requireValue(
      props.columns.find((column) => column.key === 'type'),
      'expected the event type column'
    );
    const warning = requireReactElement<{ children?: React.ReactNode; variant?: string }>(
      typeColumn.render(baseEvent({ type: 'Warning' })),
      'expected the warning event type chip'
    );
    const normal = requireReactElement<{ children?: React.ReactNode; variant?: string }>(
      typeColumn.render(baseEvent({ type: 'Normal' })),
      'expected the normal event type chip'
    );

    expect(warning.props).toMatchObject({ children: 'Warning', variant: 'warning' });
    expect(normal.props).toMatchObject({ children: 'Normal', variant: 'healthy' });
  });

  it('uses the canonical Event table labels', async () => {
    const props = await renderEventsView();

    expect(props.columns.map((column) => column.header)).toEqual([
      'Kind',
      'Type',
      'Namespace',
      'Source',
      'Object Type',
      'Object Name',
      'Reason',
      'Message',
      'Last Seen',
    ]);
  });
});
