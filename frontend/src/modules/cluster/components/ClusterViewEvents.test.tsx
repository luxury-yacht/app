/**
 * frontend/src/modules/cluster/components/ClusterViewEvents.test.tsx
 *
 * Test suite for ClusterViewEvents.
 * Covers key behaviors and edge cases for ClusterViewEvents.
 */

import ClusterViewEvents from '@modules/cluster/components/ClusterViewEvents';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterEventsSnapshotPayload } from '@/core/refresh/types';
import type { SortConfig, UseTableSortOptions } from '@/hooks/useTableSort';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type GeneratedEventRow = NonNullable<ClusterEventsSnapshotPayload['rows']>[number];
type EventRow = Omit<GeneratedEventRow, 'objectApiVersion' | 'objectNamespace' | 'objectUid'> &
  Partial<Pick<GeneratedEventRow, 'objectApiVersion' | 'objectNamespace' | 'objectUid'>>;
type BaseGridTableProps = GridTableProps<EventRow>;
type CapturedGridTableProps = BaseGridTableProps & {
  filters: NonNullable<BaseGridTableProps['filters']> & {
    options: NonNullable<NonNullable<BaseGridTableProps['filters']>['options']>;
  };
};

const { persistedSortRef, useTableSortMock } = vi.hoisted(() => ({
  persistedSortRef: { current: null as SortConfig | null },
  useTableSortMock: vi.fn(
    (
      data: EventRow[],
      defaultKey?: string,
      defaultDir?: SortConfig['direction'],
      opts?: UseTableSortOptions<EventRow>
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

const openWithObjectMock = vi.fn();
const findCatalogObjectByUIDMock = vi.fn();

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

const gridTablePropsRef: { current: CapturedGridTableProps } = {
  current: null as unknown as CapturedGridTableProps,
};

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: CapturedGridTableProps) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => findCatalogObjectByUIDMock(...args),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (
    data: EventRow[],
    defaultKey?: string,
    defaultDirection?: SortConfig['direction'],
    options?: UseTableSortOptions<EventRow>
  ) => useTableSortMock(data, defaultKey, defaultDirection, options),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: persistedSortRef.current,
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

const baseEvent: EventRow = {
  clusterName: 'alpha',
  kind: 'Event',
  name: 'test',
  uid: 'event-uid',
  resourceVersion: '1',
  namespace: 'team-a',
  objectNamespace: 'team-a',
  objectUid: 'pod-uid',
  type: 'Warning',
  source: 'kubelet',
  reason: 'Failed',
  object: 'Pod/foo',
  objectApiVersion: 'v1',
  message: 'Something happened',
  age: '1m',
  ageTimestamp: 123,
  clusterId: 'test-cluster',
};

describe('ClusterViewEvents', () => {
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes the query-backed newest-first Last Seen sort to GridTable when no persisted sort exists', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'age', direction: 'asc' });
    expect(props.columnVisibility).toBe(null);
    expect(props.filters?.value).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
    });

    const key = props.keyExtractor(baseEvent, 0);
    expect(key).toContain('team-a');
    expect(props.columnWidths).toBe(null);
  });

  it('uses the shared newest-first Last Seen sort value for local table fallback rows', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const ageColumn = requireValue(
      gridTablePropsRef.current.columns.find((column) => column.key === 'age'),
      'expected the cluster event age column'
    );

    expect(
      requireValue(ageColumn.sortValue, 'expected the cluster event age sort accessor')(baseEvent)
    ).toBe(-123);
  });

  it('renders Event types with status chips', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const typeColumn = requireValue(
      gridTablePropsRef.current.columns.find((column) => column.key === 'type'),
      'expected the cluster event type column'
    );
    const warning = requireReactElement<{ children?: React.ReactNode; variant?: string }>(
      typeColumn.render(baseEvent),
      'expected the cluster event type chip'
    );
    const normal = requireReactElement<{ children?: React.ReactNode; variant?: string }>(
      typeColumn.render({ ...baseEvent, type: 'Normal' }),
      'expected the cluster normal event type chip'
    );
    const custom = requireReactElement<{ children?: React.ReactNode; variant?: string }>(
      typeColumn.render({ ...baseEvent, type: 'Notice' }),
      'expected the cluster custom event type chip'
    );

    expect(warning.props).toMatchObject({ children: 'Warning', variant: 'warning' });
    expect(normal.props).toMatchObject({ children: 'Normal', variant: 'healthy' });
    expect(custom.props).toMatchObject({ children: 'Notice', variant: 'info' });
  });

  it('uses the canonical Event table labels', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.columns.map((column) => column.header)).toEqual([
      'Kind',
      'Type',
      'Source',
      'Object Type',
      'Object Name',
      'Reason',
      'Message',
      'Last Seen',
    ]);
  });

  it('opens the involved object with group/version when object name is clicked', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const objectNameColumn = requireValue(
      props.columns.find((column) => column.key === 'objectName'),
      'expected the cluster event object-name column'
    );

    const cell = requireReactElement<{ onClick: (event: { altKey: boolean }) => void }>(
      objectNameColumn.render(baseEvent),
      'expected the cluster event object-name cell element'
    );

    expect(cell.props).toMatchObject({ 'data-gridtable-rowclick': 'suppress' });

    await act(async () => {
      cell.props.onClick({ altKey: false });
      await Promise.resolve();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'foo',
        group: '',
        version: 'v1',
        clusterId: 'test-cluster',
      })
    );
  });

  it('opens the Event object from the row and Kind badge', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const onRowClick = requireValue(props.onRowClick, 'expected the cluster Event row action');

    act(() => {
      onRowClick(baseEvent);
    });

    expect(openWithObjectMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clusterId: 'test-cluster',
        clusterName: 'alpha',
        group: '',
        version: 'v1',
        kind: 'Event',
        resource: 'events',
        namespace: 'team-a',
        name: 'test',
        uid: 'event-uid',
      })
    );

    openWithObjectMock.mockClear();
    const kindColumn = requireValue(
      props.columns.find((column) => column.key === 'kind'),
      'expected the cluster Event kind column'
    );
    const kindCell = requireReactElement<{
      onClick: (event: { altKey: boolean }) => void;
      'data-gridtable-rowclick'?: string;
    }>(kindColumn.render(baseEvent), 'expected the cluster Event kind badge');

    expect(kindCell.props['data-gridtable-rowclick']).toBe('suppress');

    act(() => {
      kindCell.props.onClick({ altKey: false });
    });

    expect(openWithObjectMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clusterId: 'test-cluster',
        group: '',
        version: 'v1',
        kind: 'Event',
        namespace: 'team-a',
        name: 'test',
      })
    );
  });

  it('opens the Event object from pointer row activation', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const onRowPointerClick = requireValue(
      gridTablePropsRef.current.onRowPointerClick,
      'expected the cluster Event pointer row action'
    );

    act(() => {
      onRowPointerClick(baseEvent);
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'test-cluster',
        group: '',
        version: 'v1',
        kind: 'Event',
        namespace: 'team-a',
        name: 'test',
      })
    );
  });

  it('passes stable event row identity into useTableSort', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const options = requireValue(
      useTableSortMock.mock.calls[0]?.[3],
      'expected cluster event table sort options'
    );
    const rowIdentity = requireValue(options.rowIdentity, 'expected cluster event row identity');
    expect(rowIdentity(baseEvent, 0)).toBe('test-cluster|/v1/Event/team-a/test');
  });

  it('resolves CRD involved objects by UID when the stream omits apiVersion', async () => {
    findCatalogObjectByUIDMock.mockResolvedValue({
      kind: 'Database',
      name: 'primary',
      namespace: 'team-a',
      clusterId: 'test-cluster',
      clusterName: 'alpha',
      group: 'db.example.io',
      version: 'v1',
      resource: 'databases',
      uid: 'database-uid',
    });
    const event = {
      ...baseEvent,
      object: 'Database/primary',
      objectUid: 'database-uid',
      objectApiVersion: undefined,
    };

    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const objectNameColumn = requireValue(
      props.columns.find((column) => column.key === 'objectName'),
      'expected the cluster event object-name column'
    );
    const cell = requireReactElement<{ onClick: (event: { altKey: boolean }) => void }>(
      objectNameColumn.render(event),
      'expected the cluster event object-name cell element'
    );

    await act(async () => {
      cell.props.onClick({ altKey: false });
      await Promise.resolve();
    });

    expect(findCatalogObjectByUIDMock).toHaveBeenCalledWith('test-cluster', 'database-uid');
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

  it('fails closed when catalog lookup rejects during involved object resolution', async () => {
    findCatalogObjectByUIDMock.mockRejectedValue(new Error('catalog unavailable'));
    const event = {
      ...baseEvent,
      object: 'Database/primary',
      objectUid: 'database-uid',
      objectApiVersion: undefined,
    };

    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const objectNameColumn = requireValue(
      props.columns.find((column) => column.key === 'objectName'),
      'expected the cluster event object-name column'
    );
    const cell = requireReactElement<{ onClick: (event: { altKey: boolean }) => void }>(
      objectNameColumn.render(event),
      'expected the cluster event object-name cell element'
    );

    await act(async () => {
      cell.props.onClick({ altKey: false });
      await Promise.resolve();
    });

    expect(openWithObjectMock).not.toHaveBeenCalled();
  });

  it('does not expose recent-window copy for query-backed cluster events', async () => {
    await act(async () => {
      root.render(<ClusterViewEvents />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.filters.options.partialDataLabel).toBeUndefined();
  });
});
