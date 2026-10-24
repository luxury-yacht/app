/**
 * frontend/src/modules/resource-grid/useTypedResourceQuery.test.tsx
 *
 * The typed resource query every query-backed table pages through: which
 * snapshot reads it issues (cluster, selector, page size, filters, sort,
 * cursor), the page it delivers, warm-up versus failure, quiet refetches that
 * keep rows visible, cursor navigation and its rollback, cluster isolation,
 * and the export walk. The hook runs inside the app shell through the real
 * data-access broker, orchestrator, and refresh store; only the backend
 * boundary is faked (test-utils/appState).
 */

import type { SortConfig } from '@hooks/useTableSort';
import type { GridTableFilterState } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { act, useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  makeNamespaceConfigSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { ALL_NAMESPACES_SELECTOR, parseRefreshScope } from '@/core/refresh/scopeSelector';
import { getScopedDomainState } from '@/core/refresh/store';
import type { CanonicalResourceRef, PodSnapshotPayload, RefreshDomain } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse, statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { selectPayloadRows, type TypedQueryPayload } from './typedResourceQueryScope';
import { type UseTypedResourceQueryResult, useTypedResourceQuery } from './useTypedResourceQuery';

type Row = { ref: CanonicalResourceRef } & Record<string, unknown>;
type Payload = TypedQueryPayload & { rows?: Row[] };

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let query: UseTypedResourceQueryResult<Row, Payload> | undefined;
// Every committed render: which cluster it showed and the rows it painted.
let committed: Array<{ clusterId: string; names: string[] }> = [];

const NAME_ASC: SortConfig = { key: 'name', direction: 'asc' };

interface ProbeProps {
  clusterId?: string;
  domain?: RefreshDomain;
  filters?: GridTableFilterState;
  sortConfig?: SortConfig | null;
  pageLimit?: number;
  liveDataVersion?: string;
}

function QueryProbe({
  clusterId,
  domain = 'pods',
  filters = DEFAULT_GRID_TABLE_FILTER_STATE,
  sortConfig = NAME_ASC,
  pageLimit,
  liveDataVersion,
}: Readonly<ProbeProps>) {
  const cluster = clusterId ?? dev.clusterId;
  const result = useTypedResourceQuery<Payload, Row>({
    enabled: true,
    clusterId: cluster,
    domain,
    label: 'All Namespaces Pods',
    baseSelector: ALL_NAMESPACES_SELECTOR,
    filters,
    sortConfig,
    pageLimit,
    liveDataVersion,
    selectRows: selectPayloadRows,
  });
  query = result;
  useLayoutEffect(() => {
    committed.push({ clusterId: cluster, names: result.rows.map((row) => row.ref.name) });
  });
  return null;
}

const current = () => requireValue(query, 'expected the typed query result');
const rowNames = () => current().rows.map((row) => row.ref.name);

/** A pods page as backend/refresh/snapshot/pods.go serves it, in `cluster`. */
const page = (
  names: string[],
  overrides: Partial<PodSnapshotPayload> = {},
  cluster: TestCluster = dev
): PodSnapshotPayload =>
  makePodSnapshotPayload({
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    rows: names.map((name) =>
      makePodSnapshotEntry({ ref: { clusterId: cluster.clusterId, namespace: 'team-a', name } })
    ),
    total: names.length,
    unfilteredTotal: names.length,
    ...overrides,
  });

interface PageRequest {
  domain: string;
  clusterId: string;
  params: URLSearchParams;
}

// What the backend answers for each typed read; tests replace it.
let answerPage: (request: PageRequest) => unknown = () => undefined;

const paramsOf = (domain: string, scope: string) =>
  new URLSearchParams(parseRefreshScope(domain as RefreshDomain, scope).query ?? '');

const readsOf = (domain: RefreshDomain = 'pods') =>
  app.snapshots.reads(domain).map((read) => read.scope);
const lastRead = (domain: RefreshDomain = 'pods') =>
  requireValue(readsOf(domain).slice(-1)[0], `expected a ${domain} read`);

const start = async (lifecycle?: backend.ClusterLifecycleState) => {
  query = undefined;
  committed = [];
  answerPage = () => undefined;
  dev = app.cluster({ name: 'dev', context: 'alpha', lifecycle });
  app.namespaces(dev, ['team-a']);
  app.snapshots.answer(({ domain, scope }) => {
    if (domain !== 'pods' && domain !== 'namespace-config') {
      return undefined;
    }
    const { clusterId } = parseRefreshScope(domain, scope);
    return answerPage({ domain, clusterId, params: paramsOf(domain, scope) });
  });
  view = await app.render(null);
};

let heldVersion = 1_000_000;

/** Parks the typed reads `matches` accepts until the returned release runs. */
const holdReads = (
  matches: (params: URLSearchParams, clusterId: string) => boolean = () => true
) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.snapshots.respond(({ domain, scope }) => {
    if (domain !== 'pods') {
      return undefined;
    }
    const { clusterId } = parseRefreshScope(domain, scope);
    const params = paramsOf(domain, scope);
    if (!matches(params, clusterId)) {
      return undefined;
    }
    // The backend answers once released, with what it serves by then.
    return gate.then(() =>
      snapshotResponse({
        domain,
        scope,
        version: ++heldVersion,
        payload: answerPage({ domain, clusterId, params }),
      })
    );
  });
  return async () => {
    app.snapshots.respond(null);
    release();
    await app.settle();
  };
};

/** The backend fails the typed reads `matches` accepts. */
const failReads = (matches: (params: URLSearchParams) => boolean) => {
  app.snapshots.respond(({ domain, scope }) =>
    domain === 'pods' && matches(paramsOf(domain, scope))
      ? statusResponse(makeErrorStatus('InternalError', 'pods list failed'))
      : undefined
  );
};

/** Takes the failed-read report the orchestrator raises for the pods table. */
const takeReadFailures = () => app.errors.take((record) => record.context?.domain === 'pods');

const run = async (action: () => void) => {
  await act(async () => {
    action();
  });
  await app.settle();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useTypedResourceQuery', () => {
  it('refetches the current page on a live-data change, keeping its rows until the new page lands', async () => {
    await start();
    let names = ['pod-a'];
    answerPage = () => page(names);
    await view.show(<QueryProbe liveDataVersion="version-1" />);
    expect(rowNames()).toEqual(['pod-a']);
    expect(current().loading).toBe(false);

    const release = holdReads();
    names = ['pod-b'];
    await view.show(<QueryProbe liveDataVersion="version-2" />);
    expect(rowNames()).toEqual(['pod-a']);
    expect(current().loading).toBe(true);

    await release();
    expect(rowNames()).toEqual(['pod-b']);
    expect(current().loading).toBe(false);
    // Every read, the refetch included, is the visible page of the cluster's query.
    expect(new Set(readsOf())).toEqual(
      new Set([`${dev.clusterId}|namespace:all?limit=50&sort=name&sortDirection=asc`])
    );
  });

  it('reuses unchanged rows and refs across live refetches', async () => {
    await start();
    let data = 2;
    answerPage = ({ domain }) =>
      domain === 'namespace-config'
        ? makeNamespaceConfigSnapshotPayload({
            clusterId: dev.clusterId,
            clusterName: dev.clusterName,
            total: 1,
            unfilteredTotal: 1,
            rows: [
              {
                ref: {
                  clusterId: dev.clusterId,
                  group: '',
                  version: 'v1',
                  kind: 'ConfigMap',
                  resource: 'configmaps',
                  namespace: 'team-a',
                  name: 'api',
                  uid: 'api-uid',
                },
                data,
                age: '1d',
              },
            ],
          })
        : undefined;
    await view.show(<QueryProbe domain="namespace-config" liveDataVersion="v1" />);
    const first = requireValue(current().rows[0], 'first config row');

    await view.show(<QueryProbe domain="namespace-config" liveDataVersion="v2" />);
    const unchanged = requireValue(current().rows[0], 'unchanged config row');
    expect(unchanged).toBe(first);
    expect(unchanged.ref).toBe(first.ref);

    data = 3;
    await view.show(<QueryProbe domain="namespace-config" liveDataVersion="v3" />);
    const changed = requireValue(current().rows[0], 'changed config row');
    expect(changed).not.toBe(first);
    expect(changed.ref).toBe(first.ref);
    expect(changed.data).toBe(3);
  });

  it('walks every page of the current query for export at the export page size', async () => {
    await start();
    answerPage = ({ params }) => {
      if (params.get('limit') !== '1000') {
        return page([]);
      }
      return params.get('continue') === 'cursor-1'
        ? page(['c'], { total: 3 })
        : page(['a', 'b'], { total: 3, continue: 'cursor-1' });
    };
    await view.show(<QueryProbe />);

    let all: Row[] = [];
    await act(async () => {
      all = await current().fetchAllRows();
    });

    expect(all.map((row) => row.ref.name)).toEqual(['a', 'b', 'c']);
    const exportReads = readsOf()
      .map((scope) => paramsOf('pods', scope))
      .filter((params) => params.get('limit') === '1000');
    expect(exportReads.map((params) => params.get('continue'))).toEqual([null, 'cursor-1']);
    expect(exportReads.every((params) => params.get('sort') === 'name')).toBe(true);
  });

  it('walks an export override query with its own filters, sort, page size, and predicates', async () => {
    await start();
    answerPage = ({ params }) => {
      if (params.get('limit') !== '25') {
        return page([]);
      }
      return params.get('continue') === 'cursor-1'
        ? page(['worker'])
        : page(['api'], { continue: 'cursor-1' });
    };
    await view.show(<QueryProbe />);

    let all: Row[] = [];
    await act(async () => {
      all = await current().fetchAllRows({
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          search: 'api',
          includeMetadata: true,
          namespaces: { mode: 'some', values: ['team-b', 'team-a'] },
          kinds: { mode: 'some', values: ['Pod'] },
        },
        sortConfig: { key: 'cpu', direction: 'desc' },
        pageLimit: 25,
        predicates: { owner: 'team-a/api|team-a/worker' },
        label: 'Pod Export',
      });
    });

    expect(all.map((row) => row.ref.name)).toEqual(['api', 'worker']);
    const [first, second] = readsOf()
      .map((scope) => paramsOf('pods', scope))
      .filter((params) => params.get('limit') === '25');
    expect(Object.fromEntries(requireValue(first, 'first export page'))).toEqual({
      limit: '25',
      search: 'api',
      includeMetadata: 'true',
      namespaces: 'team-a,team-b',
      kinds: 'Pod',
      sort: 'cpu',
      sortDirection: 'desc',
      'predicate.owner': 'team-a/api|team-a/worker',
    });
    expect(second?.get('continue')).toBe('cursor-1');
  });

  it('rejects an export whose later page fails instead of returning a partial result', async () => {
    await start();
    answerPage = ({ params }) =>
      params.get('limit') === '1000' ? page(['a'], { continue: 'cursor-1' }) : page([]);
    failReads((params) => params.get('continue') === 'cursor-1');
    await view.show(<QueryProbe />);

    await expect(current().fetchAllRows()).rejects.toThrow(/page 2/);
    expect(takeReadFailures()).toHaveLength(1);
  });

  it('rolls back a failed page navigation so the cursor, buttons, and retry stay usable', async () => {
    await start();
    answerPage = ({ params }) =>
      params.get('continue') === 'cursor-2'
        ? page(['c'], { total: 3 })
        : page(['a', 'b'], { total: 3, continue: 'cursor-2' });
    await view.show(<QueryProbe pageLimit={2} />);
    expect(current().continueToken).toBe('cursor-2');
    const pageOne = lastRead();

    failReads((params) => params.get('continue') === 'cursor-2');
    await run(() => current().loadMore());

    // The failure neither advances the page nor latches the pagination buttons,
    // and the failed cursor does not leak into the refetch that follows.
    expect(takeReadFailures()).toHaveLength(1);
    expect(current().pageIndex).toBe(1);
    expect(current().isRequestingMore).toBe(false);
    expect(lastRead()).toBe(pageOne);

    // A retry issues a real page-2 read.
    app.snapshots.respond(null);
    await run(() => current().loadMore());
    expect(paramsOf('pods', lastRead()).get('continue')).toBe('cursor-2');
    expect(rowNames()).toEqual(['c']);
    expect(current().pageIndex).toBe(2);
    expect(current().isRequestingMore).toBe(false);
  });

  it('keeps the backend-published kind vocabulary across filter refetches', async () => {
    await start();
    const capabilities = {
      sortableFields: [],
      filterableFields: [],
      searchableFields: [],
      kindVocabulary: ['Pod', 'Deployment', 'StatefulSet'],
    };
    answerPage = ({ params }) =>
      page(['pod-a'], {
        kinds: params.get('kinds') ? ['Pod'] : ['Pod', 'Deployment'],
        capabilities,
      });
    const release = holdReads();
    await view.show(<QueryProbe />);
    expect(current().kindVocabulary).toBeNull();

    await release();
    expect(current().kindVocabulary).toEqual(['Pod', 'Deployment', 'StatefulSet']);

    // A kind filter collapses the facets; the vocabulary rides the capabilities.
    await view.show(
      <QueryProbe
        filters={{ ...DEFAULT_GRID_TABLE_FILTER_STATE, kinds: { mode: 'some', values: ['Pod'] } }}
      />
    );
    expect(paramsOf('pods', lastRead()).get('kinds')).toBe('Pod');
    expect(current().filterOptions.kinds).toEqual(['Pod']);
    expect(current().kindVocabulary).toEqual(['Pod', 'Deployment', 'StatefulSet']);
  });

  // An empty domain's live-data identity never changes, so only the hook's own
  // retry can settle a first read made while its cluster was still starting.
  it('stays loading through a cluster warm-up and settles on its own once the cluster serves', async () => {
    await start(backend.ClusterLifecycleState.ClusterStateConnecting);
    vi.useFakeTimers();
    answerPage = () => page([]);
    await view.show(<QueryProbe liveDataVersion="0::" />);

    expect(current().loaded).toBe(false);
    expect(current().error).toBeNull();
    expect(readsOf()).toEqual([]);

    await act(async () => {
      app.events.emit('cluster:lifecycle', { clusterId: dev.clusterId, state: 'ready' });
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await app.settle();

    expect(readsOf()).not.toEqual([]);
    expect(current().loaded).toBe(true);
    expect(current().rows).toEqual([]);
    expect(current().error).toBeNull();
  });

  it('stops retrying once the query has loaded', async () => {
    await start();
    vi.useFakeTimers();
    answerPage = () => page(['pvc-a']);
    await view.show(<QueryProbe liveDataVersion="v1" />);
    expect(current().loaded).toBe(true);
    const readsAfterLoad = readsOf().length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(readsOf()).toHaveLength(readsAfterLoad);
  });

  it('settles a failed read as the query error instead of a warm-up', async () => {
    await start();
    failReads(() => true);
    await view.show(<QueryProbe />);

    expect(current().loading).toBe(false);
    expect(current().loaded).toBe(true);
    expect(current().error).toMatchObject({
      kind: 'backend',
      status: { reason: 'InternalError', message: 'pods list failed' },
    });
    expect(takeReadFailures()).not.toEqual([]);
  });

  it('keeps the applied rows and loaded state through filter refetches (quiet filtering)', async () => {
    await start();
    let names = ['pod-a'];
    answerPage = () => page(names);
    const withReasons = (reasons: string[]): GridTableFilterState => ({
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      queryFacets: { reasons: { mode: 'some', values: reasons } },
    });
    await view.show(<QueryProbe liveDataVersion="v1" />);
    expect(rowNames()).toEqual(['pod-a']);

    // The new page is in flight: the table neither dims nor swaps to a spinner.
    let release = holdReads();
    names = [];
    await view.show(<QueryProbe liveDataVersion="v1" filters={withReasons(['BackOff'])} />);
    expect(rowNames()).toEqual(['pod-a']);
    expect(current().loaded).toBe(true);

    // A no-match page stays loaded, so the next keystroke cannot re-enter the
    // first-load state that unmounts the filter input.
    await release();
    expect(rowNames()).toEqual([]);
    expect(current().loaded).toBe(true);

    release = holdReads();
    await view.show(
      <QueryProbe liveDataVersion="v1" filters={withReasons(['BackOff', 'FailedScheduling'])} />
    );
    expect(current().loaded).toBe(true);
    await release();
    expect(paramsOf('pods', lastRead()).getAll('facet.reasons')).toEqual([
      'BackOff',
      'FailedScheduling',
    ]);
  });

  it('waits for typing to pause before reading a new search', async () => {
    await start();
    answerPage = () => page([]);
    await view.show(<QueryProbe />);
    vi.useFakeTimers();
    const before = readsOf().length;
    const searching = (search: string) => (
      <QueryProbe filters={{ ...DEFAULT_GRID_TABLE_FILTER_STATE, search }} />
    );

    await view.show(searching('a'));
    await view.show(searching('ap'));
    expect(readsOf()).toHaveLength(before);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await app.settle();

    const searched = readsOf()
      .slice(before)
      .map((scope) => paramsOf('pods', scope).get('search'));
    expect(new Set(searched)).toEqual(new Set(['ap']));
  });

  it('leaves no retained state or stream behind for the query scope', async () => {
    await start();
    answerPage = () => page(['pod-a']);
    await view.show(<QueryProbe />);
    expect(rowNames()).toEqual(['pod-a']);

    expect(getScopedDomainState('pods', lastRead()).data).toBeFalsy();
    expect(app.streams.active().filter((stream) => stream.startsWith('pods '))).toEqual([]);
  });

  it('never paints the previous cluster’s rows under a newly selected cluster', async () => {
    const stg = app.cluster({ name: 'stg', context: 'beta' });
    app.namespaces(stg, ['team-a']);
    await start();
    answerPage = ({ clusterId }) => (clusterId === dev.clusterId ? page(['pod-a']) : undefined);
    await view.show(<QueryProbe />);
    expect(rowNames()).toEqual(['pod-a']);

    // The new cluster's page never arrives: only a stale page could paint.
    const release = holdReads((_params, clusterId) => clusterId === stg.clusterId);
    committed = [];
    await view.show(<QueryProbe clusterId={stg.clusterId} />);

    expect(committed.filter((frame) => frame.clusterId === stg.clusterId)).not.toEqual([]);
    expect(
      committed.filter((frame) => frame.clusterId === stg.clusterId && frame.names.length > 0)
    ).toEqual([]);
    answerPage = () => page([], {}, stg);
    await release();
  });

  it('pages forward and back on the backend’s cursors', async () => {
    await start();
    answerPage = ({ params }) => {
      switch (params.get('continue')) {
        case 'cursor-page-2':
          return page(['pod-c'], { total: 3, previous: 'cursor-page-1-prev' });
        default:
          return page(['pod-a', 'pod-b'], { total: 3, continue: 'cursor-page-2' });
      }
    };
    await view.show(<QueryProbe pageLimit={2} />);
    expect(current()).toMatchObject({
      pageIndex: 1,
      pageSize: 2,
      totalCount: 3,
      totalIsExact: true,
      continueToken: 'cursor-page-2',
      hasPrevious: false,
    });

    await run(() => current().loadMore());
    expect(paramsOf('pods', lastRead()).get('continue')).toBe('cursor-page-2');
    expect(rowNames()).toEqual(['pod-c']);
    expect(current().pageIndex).toBe(2);
    expect(current().hasPrevious).toBe(true);

    // Backward paging rides the backend's previous cursor, not a client stack.
    await run(() => current().loadPrevious());
    expect(paramsOf('pods', lastRead()).get('continue')).toBe('cursor-page-1-prev');
    expect(rowNames()).toEqual(['pod-a', 'pod-b']);
    expect(current().pageIndex).toBe(1);
    expect(current().hasPrevious).toBe(false);
  });

  it('refetches the current cursor page when live data changes', async () => {
    await start();
    let fresh = false;
    answerPage = ({ params }) => {
      if (params.get('continue') === 'cursor-page-2') {
        return page(fresh ? ['pod-c-fresh', 'pod-d-fresh'] : ['pod-c', 'pod-d'], { total: 4 });
      }
      return page(['pod-a', 'pod-b'], { total: 4, continue: 'cursor-page-2' });
    };
    await view.show(<QueryProbe pageLimit={2} liveDataVersion="version-1" />);
    await run(() => current().loadMore());
    expect(rowNames()).toEqual(['pod-c', 'pod-d']);

    fresh = true;
    await view.show(<QueryProbe pageLimit={2} liveDataVersion="version-2" />);

    expect(paramsOf('pods', lastRead()).get('continue')).toBe('cursor-page-2');
    expect(current().pageIndex).toBe(2);
    expect(rowNames()).toEqual(['pod-c-fresh', 'pod-d-fresh']);
  });

  it('drops the current cursor before reading a changed sort', async () => {
    await start();
    answerPage = ({ params }) => {
      if (params.get('sort') === 'status') {
        return page(['pod-status-a', 'pod-status-b'], {
          total: 3,
          continue: 'status-cursor-page-2',
        });
      }
      return params.get('continue') === 'cursor-page-2'
        ? page(['pod-c'], { total: 3 })
        : page(['pod-a', 'pod-b'], { total: 3, continue: 'cursor-page-2' });
    };
    await view.show(<QueryProbe pageLimit={2} />);
    await run(() => current().loadMore());
    expect(paramsOf('pods', lastRead()).get('continue')).toBe('cursor-page-2');

    await view.show(<QueryProbe pageLimit={2} sortConfig={{ key: 'status', direction: 'asc' }} />);

    expect(lastRead()).toBe(`${dev.clusterId}|namespace:all?limit=2&sort=status&sortDirection=asc`);
    expect(current().pageIndex).toBe(1);
    expect(rowNames()).toEqual(['pod-status-a', 'pod-status-b']);
  });

  it('returns to the first page when the backend reports an invalid cursor', async () => {
    await start();
    let cursor = 'stale-cursor';
    answerPage = ({ params }) =>
      params.get('continue') === 'stale-cursor'
        ? page([], { cursorInvalid: true })
        : page(['pod-a'], { total: 2, continue: cursor });
    await view.show(<QueryProbe pageLimit={2} />);

    cursor = 'fresh-cursor';
    await run(() => current().loadMore());

    expect(paramsOf('pods', lastRead()).get('continue')).toBeNull();
    expect(rowNames()).toEqual(['pod-a']);
    expect(current().continueToken).toBe('fresh-cursor');
    expect(current().pageIndex).toBe(1);
    expect(current().hasPrevious).toBe(false);
  });
});
