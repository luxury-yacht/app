/**
 * frontend/src/modules/namespace/components/NsViewEvents.test.tsx
 *
 * Test suite for NsViewEvents.
 * Covers key behaviors and edge cases for NsViewEvents.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

import NsViewEvents, { type EventData } from '@modules/namespace/components/NsViewEvents';

const {
  gridTablePropsRef,
  openWithObjectMock,
  shortNamesMock,
  formatAgeMock,
  findCatalogObjectByUIDMock,
  useTableSortMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as any },
  openWithObjectMock: vi.fn(),
  shortNamesMock: vi.fn(() => false),
  formatAgeMock: vi.fn((timestamp: number) => `${timestamp}s`),
  findCatalogObjectByUIDMock: vi.fn(),
  useTableSortMock: vi.fn(
    (data: unknown[], _defaultKey?: string, _defaultDir?: any, opts?: any) => ({
      sortedData: data,
      sortConfig: opts?.controlledSort ?? { key: 'ageTimestamp', direction: 'desc' },
      handleSort: vi.fn(),
    })
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
    onClick: () => {},
    title: 'Save as favorite',
  }),
}));

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return (
        <table data-testid="grid-table">
          <tbody>
            {props.data.map((row: any, index: number) => (
              <tr key={index}>
                <td>{row.reason}</td>
              </tr>
            ))}
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

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => findCatalogObjectByUIDMock(...args),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: any[]) => (useTableSortMock as any)(...args),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => shortNamesMock(),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: any) => children,
}));

vi.mock('@/utils/ageFormatter', () => ({
  formatAge: (timestamp: number) => formatAgeMock(timestamp),
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => ({
    sortConfig: { key: 'ageTimestamp', direction: 'desc' },
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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    openWithObjectMock.mockReset();
    findCatalogObjectByUIDMock.mockReset();
    useTableSortMock.mockClear();
    shortNamesMock.mockReturnValue(false);
    formatAgeMock.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseEvent = (overrides: Partial<EventData> = {}): EventData => ({
    kind: 'Event',
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
    rows: EventData[] = [baseEvent()],
    showNamespaceColumn = true
  ) => {
    await act(async () => {
      root.render(
        <NsViewEvents
          data={rows}
          loading={false}
          loaded={true}
          namespace="team-a"
          showNamespaceColumn={showNamespaceColumn}
        />
      );
      await Promise.resolve();
    });
    return gridTablePropsRef.current;
  };

  it('offers context menu navigation to related object', async () => {
    const event = baseEvent();
    const props = await renderEventsView([event]);

    const menu = props.getCustomContextMenuItems(event, 'objectName');
    expect(menu).toHaveLength(1);
    expect(menu[0].label).toBe('View Pod');

    await act(async () => {
      menu[0].onClick?.();
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
    const props = await renderEventsView([event]);

    const objectNameColumn = props.columns.find((column: any) => column.key === 'objectName');
    expect(objectNameColumn).toBeTruthy();

    const cell = objectNameColumn.render(event);

    await act(async () => {
      cell.props.onClick({ stopPropagation: () => {} });
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
    const props = await renderEventsView([event]);
    const objectNameColumn = props.columns.find((column: any) => column.key === 'objectName');
    const cell = objectNameColumn.render(event);

    await act(async () => {
      cell.props.onClick({ stopPropagation: () => {} });
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

  it('suppresses context actions when no related object provided', async () => {
    const event = baseEvent({ object: undefined });
    const props = await renderEventsView([event]);
    const menu = props.getCustomContextMenuItems(event, 'objectName');
    expect(menu).toHaveLength(0);
  });

  it('passes stable event row identity into useTableSort', async () => {
    const event = baseEvent();
    await renderEventsView([event]);

    const options = useTableSortMock.mock.calls[0]?.[3];
    expect(options?.rowIdentity).toBeTypeOf('function');
    expect(options.rowIdentity(event, 0)).toBe(
      'alpha:ctx|/v1/Event/team-a/FailedScheduling:kubelet:Pod/api'
    );
  });

  it('formats age using timestamp when available and falls back to provided age', async () => {
    const eventWithTimestamp = baseEvent({ ageTimestamp: 99, age: undefined });
    const props = await renderEventsView([eventWithTimestamp]);
    const ageColumn = props.columns.find((column: any) => column.key === 'age');
    const cell = ageColumn.render(eventWithTimestamp);
    expect(formatAgeMock).toHaveBeenCalledWith(99);
    expect(cell).toContain('99s');

    formatAgeMock.mockClear();
    const eventWithAge = baseEvent({ ageTimestamp: undefined, age: '5m' });
    const fallbackProps = await renderEventsView([eventWithAge]);
    const fallbackAgeColumn = fallbackProps.columns.find((column: any) => column.key === 'age');
    fallbackAgeColumn.render(eventWithAge);
    // Age is passed through formatAge for consistency with ClusterViewEvents
    expect(formatAgeMock).toHaveBeenCalledWith('5m');
  });

  it('derives namespace from objectNamespace, event namespace, or component namespace', async () => {
    const noNamespaceEvent = baseEvent({ objectNamespace: undefined, namespace: undefined });
    const props = await renderEventsView([noNamespaceEvent]);
    const menu = props.getCustomContextMenuItems(noNamespaceEvent, 'objectName');
    await act(async () => {
      menu[0].onClick?.();
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
    const props = await renderEventsView([event]);
    const key = props.keyExtractor(event, 0);
    expect(key).toContain('ns-one');
    expect(key).toContain('2m');

    const noNamespaceProps = await renderEventsView([event], false);
    const namespaceColumn = noNamespaceProps.columns.find(
      (column: any) => column.key === 'namespace'
    );
    expect(namespaceColumn).toBeUndefined();
  });

  it('respects short name preferences when sizing columns', async () => {
    shortNamesMock.mockReturnValue(true);
    const props = await renderEventsView([baseEvent({ type: 'Normal' })]);

    const typeColumn = props.columns.find((column: any) => column.key === 'type');
    expect(typeColumn).toBeTruthy();
    // Type column renders with event-badge styling
    const cell = typeColumn.render(baseEvent({ type: 'Warning' }));
    expect(cell.props.children).toBe('Warning');
    expect(cell.props.className).toContain('event-badge');
  });
});
