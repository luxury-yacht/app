/**
 * frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.test.tsx
 *
 * The query-backed table wrappers every cluster and namespace view renders
 * through ResourceInventoryTable: which page they read (default sort, saved
 * page size and filters, the cluster's shared Namespaces selection, facets the
 * view owns or hides), that the first read waits for saved table state, the
 * loading states they show (first load versus quiet refetch versus a page
 * request), what they save back, and the degraded-result label. Live-scope
 * doorbells and gating are in useQueryBackedResourceGridTable.liveScope.test.tsx.
 * The wrappers run inside the app shell with the real query, persistence, and
 * GridTable; only the backend boundary is faked (test-utils/appState).
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { createAgeColumn } from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  buildGridTableStorageKey,
  computeClusterHash,
  type GridTablePersistedState,
} from '@shared/components/tables/persistence/gridTablePersistence';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { parseRefreshScope } from '@/core/refresh/scopeSelector';
import type {
  CanonicalResourceRef,
  PodSnapshotEntry,
  PodSnapshotPayload,
} from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';
import ResourceInventoryTable from './ResourceInventoryTable';
import { selectPayloadRows, type TypedQueryPayload } from './typedResourceQueryScope';
import {
  type QueryBackedClusterGridParams,
  type QueryBackedNamespaceGridParams,
  type QueryBackedNamespaceGridResult,
  useQueryBackedClusterResourceGridTable,
  useQueryBackedNamespaceResourceGridTable,
} from './useQueryBackedResourceGridTable';

interface Row {
  ref: CanonicalResourceRef;
  age?: string;
  ageTimestamp?: number;
  cpuUsageMilli?: number;
}
type Payload = TypedQueryPayload & { rows?: Row[] };
type PageDomain = 'pods' | 'cluster-events';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let grid: QueryBackedNamespaceGridResult<Row, Payload> | undefined;

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.ref.name },
  { key: 'cpu', header: 'CPU', sortable: true, render: (row) => String(row.cpuUsageMilli ?? '') },
  createAgeColumn<Row>(),
];
const rowKey = (row: Row) => `${row.ref.clusterId}|${row.ref.namespace}/${row.ref.name}`;

/** What a view renders: the wrapper's source and binding through ResourceInventoryTable. */
function Table({ result }: Readonly<{ result: QueryBackedNamespaceGridResult<Row, Payload> }>) {
  grid = result;
  return (
    <ResourceInventoryTable
      source={result.source}
      gridTableProps={result.gridTableProps}
      favModal={result.favModal}
      columns={columns}
      spinnerMessage="Loading..."
    />
  );
}

function NamespaceTable(props: Readonly<Partial<QueryBackedNamespaceGridParams<Payload, Row>>>) {
  const result = useQueryBackedNamespaceResourceGridTable<Payload, Row>({
    clusterId: dev.clusterId,
    domain: 'pods',
    label: 'Namespace Pods',
    selectRows: selectPayloadRows,
    viewId: 'namespace-pods',
    namespace: 'team-a',
    columns,
    keyExtractor: rowKey,
    supportsCustomMetadataColumns: true,
    ...props,
  });
  return <Table result={result} />;
}

function ClusterTable(props: Readonly<Partial<QueryBackedClusterGridParams<Payload, Row>>>) {
  const result = useQueryBackedClusterResourceGridTable<Payload, Row>({
    clusterId: dev.clusterId,
    domain: 'cluster-events',
    label: 'Cluster Events',
    selectRows: selectPayloadRows,
    viewId: 'cluster-events',
    columns,
    keyExtractor: rowKey,
    supportsCustomMetadataColumns: true,
    ...props,
  });
  return <Table result={result} />;
}

const current = () => requireValue(grid, 'expected the query-backed table');

const pod = (name: string, overrides: Partial<PodSnapshotEntry> = {}) =>
  makePodSnapshotEntry({
    ref: { clusterId: dev.clusterId, namespace: 'team-a', name },
    ...overrides,
  });

/** A pods page as backend/refresh/snapshot/pods.go serves it. */
const podsPage = (rows: PodSnapshotEntry[], overrides: Partial<PodSnapshotPayload> = {}) =>
  makePodSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    rows,
    total: rows.length,
    unfilteredTotal: rows.length,
    ...overrides,
  });

// What the backend answers for each pods read; tests replace it.
let answerPods: (params: URLSearchParams) => PodSnapshotPayload = () => podsPage([]);

const paramsOf = (domain: PageDomain, scope: string) =>
  new URLSearchParams(parseRefreshScope(domain, scope).query ?? '');
/** The typed page reads (scopes with a query) of `domain`. */
const pageReads = (domain: PageDomain = 'pods') =>
  app.snapshots
    .reads(domain)
    .map((read) => read.scope)
    .filter((scope) => parseRefreshScope(domain, scope).query);
const lastPageRead = (domain: PageDomain = 'pods') =>
  paramsOf(domain, requireValue(pageReads(domain).slice(-1)[0], `expected a ${domain} page read`));

const renderedRows = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).map(
    (row) => row.textContent ?? ''
  );

// The backend's saved table state: what hydration returns and saves write.
let savedTables = new Map<string, unknown>();

const storageKey = async (viewId: string, namespace: string | null) =>
  requireValue(
    buildGridTableStorageKey({
      clusterHash: await computeClusterHash(dev.clusterId),
      viewId,
      namespace,
    }),
    'expected a table storage key'
  );

// Namespace tables share one saved entry across namespaces in the default
// (shared) persistence mode.
const SHARED_NAMESPACES = '__shared__';

const saveTable = async (
  viewId: string,
  namespace: string | null,
  state: Omit<GridTablePersistedState, 'version'>
) => {
  savedTables.set(await storageKey(viewId, namespace), { version: 3, ...state });
};

const savedTable = async (viewId: string, namespace: string | null) =>
  savedTables.get(await storageKey(viewId, namespace)) as GridTablePersistedState | undefined;

let heldVersion = 1_000_000;

/** Parks every pods page read `matches` accepts until the returned release runs. */
const holdPageReads = (matches: (params: URLSearchParams) => boolean = () => true) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.snapshots.respond(({ domain, scope }) => {
    if (domain !== 'pods' || !parseRefreshScope(domain, scope).query) {
      return undefined;
    }
    const params = paramsOf(domain, scope);
    if (!matches(params)) {
      return undefined;
    }
    // The backend answers once released, with what it serves by then.
    return gate.then(() =>
      snapshotResponse({ domain, scope, version: ++heldVersion, payload: answerPods(params) })
    );
  });
  return async () => {
    app.snapshots.respond(null);
    release();
    await app.settle();
  };
};

const run = async (action: () => void) => {
  await act(async () => {
    action();
  });
  await app.settle();
};

/** Lets the search debounce and the debounced table-state save run. */
const letDebouncesRun = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  await app.settle();
};

// Saved table state hydrates once, at startup: save it before starting.
const start = async () => {
  view = await app.render(null);
};

beforeEach(() => {
  grid = undefined;
  savedTables = new Map();
  answerPods = () => podsPage([]);
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  app.backend.answer('GetGridTablePersistence', () => Object.fromEntries(savedTables));
  app.backend.answer('SetGridTablePersistence', (key, state) => {
    savedTables.set(key, state);
  });
  app.backend.answer('DeleteGridTablePersistence', (key) => {
    savedTables.delete(key);
  });
  app.snapshots.answer(({ domain, scope }) =>
    domain === 'pods' ? answerPods(paramsOf('pods', scope)) : undefined
  );
  app.serveTable(dev, 'cluster-events');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useQueryBackedResourceGridTable', () => {
  it('offers no metadata controls when a view’s rows carry no labels or annotations', async () => {
    await start();
    const offersMetadata = () =>
      (current().gridTableProps.filters?.options?.preActions ?? []).some(
        (item) => 'id' in item && item.id === 'include-metadata'
      ) || current().gridTableProps.customMetadataColumns !== undefined;

    await view.show(<NamespaceTable supportsCustomMetadataColumns={false} />);
    expect(offersMetadata()).toBe(false);
    await view.show(<ClusterTable supportsCustomMetadataColumns={false} />);
    expect(offersMetadata()).toBe(false);
  });

  it.each([
    {
      name: 'an All Namespaces table showing the Namespaces filter reads it',
      namespace: ALL_NAMESPACES_SCOPE,
      showNamespaceFilters: true,
      expected: 'team-a',
    },
    {
      name: 'an All Namespaces table without the Namespaces filter ignores it',
      namespace: ALL_NAMESPACES_SCOPE,
      showNamespaceFilters: false,
      expected: null,
    },
    {
      name: 'a single-namespace table ignores it',
      namespace: 'team-a',
      showNamespaceFilters: true,
      expected: null,
    },
  ])('shares the cluster’s Namespaces selection: $name', async (testCase) => {
    await saveTable('shared-namespace-filter', null, {
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: { mode: 'some', values: ['team-a'] },
      },
    });
    await start();

    await view.show(
      <NamespaceTable
        viewId="namespace-workloads"
        namespace={testCase.namespace}
        showNamespaceFilters={testCase.showNamespaceFilters}
      />
    );

    expect(lastPageRead().get('namespaces')).toBe(testCase.expected);
  });

  it('labels a degraded page with the backend’s issues', async () => {
    answerPods = () =>
      podsPage([], {
        completeness: 'partial',
        issues: [{ kind: 'Pod', message: 'Pod data is still syncing' }],
        totalIsExact: false,
      });
    await start();

    await view.show(<NamespaceTable />);

    expect(current().source.completeness).toBe('partial');
    expect(current().source.partialLabel).toContain('Pod data is still syncing');
  });

  it('sorts by usage in its one page query (usage is joined at serve)', async () => {
    await saveTable('namespace-pods', SHARED_NAMESPACES, {
      sort: { key: 'cpu', direction: 'desc' },
    });
    await start();
    const startupDomains = new Set(app.snapshots.reads().map((read) => read.domain));

    await view.show(<NamespaceTable />);

    const tableReads = app.snapshots.reads().filter((read) => !startupDomains.has(read.domain));
    expect(new Set(tableReads.map((read) => read.domain))).toEqual(new Set(['pods']));
    expect(new Set(pageReads())).toEqual(
      new Set([`${dev.clusterId}|namespace:team-a?limit=50&sort=cpu&sortDirection=desc`])
    );
  });

  it('drops a facet the view hides from the saved filters and from the query', async () => {
    await saveTable('namespace-pods', SHARED_NAMESPACES, {
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        queryFacets: {
          statuses: { mode: 'some', values: ['Running'] },
          nodes: { mode: 'some', values: ['node-a'] },
        },
      },
    });
    await start();
    vi.useFakeTimers();

    await view.show(<NamespaceTable excludedQueryFacetKeys={['statuses']} />);
    await letDebouncesRun();

    expect(lastPageRead().getAll('facet.statuses')).toEqual([]);
    expect(lastPageRead().getAll('facet.nodes')).toEqual(['node-a']);
    expect((await savedTable('namespace-pods', SHARED_NAMESPACES))?.filters?.queryFacets).toEqual({
      nodes: { mode: 'some', values: ['node-a'] },
    });
  });

  it('narrows the query by the view’s row selection without saving it', async () => {
    await start();
    vi.useFakeTimers();
    const ownerSelection = { owners: { mode: 'some' as const, values: ['owner:api'] } };
    await view.show(
      <NamespaceTable
        excludedQueryFacetKeys={['statuses', 'owners']}
        selectionQueryFacets={ownerSelection}
      />
    );

    await run(() =>
      current().gridTableProps.filters?.onChange?.({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        search: 'web',
      })
    );
    await letDebouncesRun();

    expect(lastPageRead().get('search')).toBe('web');
    expect(lastPageRead().getAll('facet.owners')).toEqual(['owner:api']);
    const saved = await savedTable('namespace-pods', SHARED_NAMESPACES);
    expect(saved?.filters?.search).toBe('web');
    expect(JSON.stringify(saved)).not.toContain('owner:api');
  });

  it('drops a saved Namespaces filter from an All Namespaces table without a Namespaces control', async () => {
    await saveTable('cluster-node-pods', ALL_NAMESPACES_SCOPE, {
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: { mode: 'some', values: ['team-a'] },
      },
    });
    await start();
    vi.useFakeTimers();

    await view.show(
      <NamespaceTable
        viewId="cluster-node-pods"
        namespace={ALL_NAMESPACES_SCOPE}
        showNamespaceFilters={false}
      />
    );
    await letDebouncesRun();

    expect(pageReads().map((scope) => paramsOf('pods', scope).get('namespaces'))).not.toContain(
      'team-a'
    );
    expect(
      JSON.stringify((await savedTable('cluster-node-pods', ALL_NAMESPACES_SCOPE)) ?? null)
    ).not.toContain('team-a');
  });

  it.each([
    {
      name: 'cluster',
      table: <ClusterTable defaultSortKey="age" defaultSortDirection="desc" />,
      domain: 'cluster-events' as const,
    },
    {
      name: 'namespace',
      table: <NamespaceTable defaultSort={{ key: 'age', direction: 'desc' }} />,
      domain: 'pods' as const,
    },
  ])(
    'reads in the view’s default sort before any user sort ($name table)',
    async ({ table, domain }) => {
      await start();

      await view.show(table);

      const sorts = pageReads(domain).map((scope) => {
        const params = paramsOf(domain, scope);
        return `${params.get('sort')} ${params.get('sortDirection')}`;
      });
      expect(new Set(sorts)).toEqual(new Set(['age desc']));
    }
  );

  it('holds the first read until saved table state hydrates, then reads with the saved filters', async () => {
    await saveTable('namespace-pods', SHARED_NAMESPACES, {
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        search: 'api',
        queryFacets: { nodes: { mode: 'some', values: ['node-a'] } },
      },
    });
    const hydrate = app.backend.hold('GetGridTablePersistence');
    await start();

    await view.show(<NamespaceTable />);
    expect(pageReads()).toEqual([]);
    expect(current().source.loading).toBe(true);
    expect(current().source.loaded).toBe(false);

    await run(hydrate);
    expect(pageReads()).not.toEqual([]);
    // No read shows the unfiltered page first: the saved search is not typing.
    expect(
      pageReads().map((scope) => {
        const params = paramsOf('pods', scope);
        return [params.get('search'), params.getAll('facet.nodes')];
      })
    ).toEqual(pageReads().map(() => ['api', ['node-a']]));
  });

  it('shows the first-load state only before the first page; a refetch with rows stays quiet', async () => {
    answerPods = () => podsPage([pod('pod-a')]);
    await start();
    vi.useFakeTimers();
    let release = holdPageReads();
    await view.show(<NamespaceTable />);
    expect(current().source.loading).toBe(true);
    expect(current().source.loaded).toBe(false);

    await release();
    expect(current().source.loading).toBe(false);
    expect(renderedRows()).toEqual([expect.stringContaining('pod-a')]);

    // A filter refetch is in flight: rows stay, with no loading state.
    release = holdPageReads();
    await run(() =>
      current().gridTableProps.filters?.onChange?.({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        search: 'pod',
      })
    );
    await letDebouncesRun();
    expect(lastPageRead().get('search')).toBe('pod');
    expect(current().source.loading).toBe(false);
    expect(renderedRows()).toEqual([expect.stringContaining('pod-a')]);
    expect(view.container.querySelector('[aria-label="Page request in progress"]')).toBeNull();
    await release();
  });

  it('shows a page request in progress only while the next page is being read', async () => {
    answerPods = (params) =>
      params.get('continue') === 'page-2'
        ? podsPage([pod('pod-c')], { total: 3, previous: 'page-1' })
        : podsPage([pod('pod-a'), pod('pod-b')], { total: 3, continue: 'page-2' });
    await start();
    await view.show(<NamespaceTable />);
    const next = requireValue(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]'),
      'expected the Next page button'
    );

    const release = holdPageReads((params) => params.get('continue') === 'page-2');
    await run(() => next.click());
    expect(view.container.querySelector('[aria-label="Page request in progress"]')).not.toBeNull();
    expect(next.disabled).toBe(true);
    expect(current().source.loading).toBe(false);

    await release();
    expect(view.container.querySelector('[aria-label="Page request in progress"]')).toBeNull();
    expect(renderedRows()).toEqual([expect.stringContaining('pod-c')]);
  });

  it('reads the saved rows per page and saves a page-size change', async () => {
    await saveTable('namespace-pods', SHARED_NAMESPACES, { pageSize: 250 });
    answerPods = () => podsPage([pod('pod-a')], { total: 1000 });
    await start();
    vi.useFakeTimers();
    await view.show(<NamespaceTable />);
    expect(lastPageRead().get('limit')).toBe('250');

    const pageSize = requireValue(
      view.container.querySelector<HTMLElement>('.table-pagination-page-size .dropdown-trigger'),
      'expected the Rows per page control'
    );
    await run(() => pageSize.click());
    const option = requireValue(
      Array.from(document.querySelectorAll<HTMLElement>('.dropdown-option')).find(
        (candidate) => candidate.textContent?.trim() === '500'
      ),
      'expected the 500 rows option'
    );
    await run(() => option.click());
    await letDebouncesRun();

    expect(lastPageRead().get('limit')).toBe('500');
    expect((await savedTable('namespace-pods', SHARED_NAMESPACES))?.pageSize).toBe(500);
  });

  it('advances age text without reading the page again', async () => {
    await start();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    answerPods = () =>
      podsPage([pod('pod-a', { age: 'stale', ageTimestamp: Date.parse('2026-01-01T00:00:00Z') })]);
    await view.show(<NamespaceTable />);
    expect(renderedRows()).toEqual([expect.stringContaining('10s')]);
    const reads = pageReads().length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(renderedRows()).toEqual([expect.stringContaining('11s')]);
    expect(pageReads()).toHaveLength(reads);
  });
});
