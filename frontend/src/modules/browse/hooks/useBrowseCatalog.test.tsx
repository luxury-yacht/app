/**
 * frontend/src/modules/browse/hooks/useBrowseCatalog.test.tsx
 *
 * Verifies the Browse catalog hook against the real refresh owners: which
 * catalog queries it reads (scope, page size, filters, debounced search,
 * hydration gate), how it pages (next, previous, numbered jumps, invalid
 * cursors, failed pages, export walks), how doorbells re-read the current page
 * quietly and without echo, and that scope switches never publish the previous
 * scope's rows or blank the filter options mid-change. The hook runs inside the
 * production shell over a faked backend (test-utils/appState) whose catalog
 * query pages a fixed item list by row offset.
 */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestContextRefresh } from '@/core/data-access';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { failureMessage } from '@/core/refresh/refreshFailure';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { CatalogItem, CatalogSnapshotPayload, ErrorStatus } from '@/core/refresh/types';
import { backendQuerySource } from '@/modules/resource-grid/backendQuerySource';
import { useResourceInventoryTable } from '@/modules/resource-grid/useResourceInventoryTable';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse, statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { type UseBrowseCatalogResult, useBrowseCatalog } from './useBrowseCatalog';

const app = installAppStateHarness();
let dev: TestCluster;
let stg: TestCluster;
let view: MountedApp;
let result: UseBrowseCatalogResult | null;

const item = (
  name: string,
  { kind = 'Pod', namespace = 'default', clusterId }: Partial<Record<string, string>> = {}
): CatalogItem => ({
  ref: {
    clusterId: clusterId ?? dev.clusterId,
    group: '',
    version: 'v1',
    kind,
    resource: `${kind.toLowerCase()}s`,
    namespace: kind === 'Node' ? undefined : namespace,
    name,
    uid: `${namespace}-${name}`,
  },
  resourceVersion: '1',
  creationTimestamp: '2026-01-01T00:00:00Z',
  scope: kind === 'Node' ? 'Cluster' : 'Namespace',
});

type CatalogAnswer = Partial<CatalogSnapshotPayload> | ErrorStatus;

/**
 * The backend's catalog query over `catalog.items`: the resource scope, pins,
 * filters, and page address select the page; cursors are row offsets and a
 * page's `self` is its own offset. `catalog.override` answers a query first.
 */
const catalog = {
  items: [] as CatalogItem[],
  override: null as null | ((query: URLSearchParams) => CatalogAnswer | undefined),
  hold: null as null | ((query: URLSearchParams) => boolean),
  // Held reads answer with the catalog as it was when they went out.
  asOfRequest: false,
  parked: [] as Array<() => void>,
};

/** The kinds each resource family's views list. */
const FAMILY_KINDS: Record<string, string[] | undefined> = {
  argocd: ['Application'],
  'external-secrets': ['ExternalSecret'],
};

const queryOf = (scope: string) => new URLSearchParams(scope.slice(scope.indexOf('|') + 1));

const pageOf = (scope: string, query: URLSearchParams): Partial<CatalogSnapshotPayload> => {
  const clusterId = scope.split('|')[0];
  const resourceScope = query.get('resourceScope');
  const pinned = query.getAll('scopeNamespace');
  const inScope = catalog.items.filter(
    (entry) =>
      entry.ref.clusterId === clusterId &&
      (!FAMILY_KINDS[query.get('resourceFamily') ?? ''] ||
        FAMILY_KINDS[query.get('resourceFamily') ?? '']?.includes(entry.ref.kind)) &&
      (resourceScope !== 'cluster' || entry.scope === 'Cluster') &&
      (resourceScope !== 'namespace' || entry.scope === 'Namespace') &&
      (pinned.length === 0 || pinned.includes(entry.ref.namespace ?? ''))
  );
  const kinds = query.getAll('kind');
  const matching = inScope.filter(
    (entry) =>
      (kinds.length === 0 || kinds.includes(entry.ref.kind)) &&
      entry.ref.name.includes(query.get('search') ?? '')
  );
  const limit = Number(query.get('limit'));
  const start = Number(query.get('continue') ?? query.get('startRank') ?? 0);
  const page = matching.slice(start, start + limit);
  return {
    items: page,
    total: matching.length,
    unfilteredTotal: inScope.length,
    batchSize: page.length,
    continue: start + limit < matching.length ? String(start + limit) : '',
    previous: start > 0 ? String(Math.max(0, start - limit)) : '',
    self: String(start),
    pageStartRank: start,
    kinds: Array.from(new Set(inScope.map((entry) => entry.ref.kind))).map((kind) => ({
      kind,
      namespaced: kind !== 'Node',
    })),
    namespaces: Array.from(
      new Set(inScope.flatMap((entry) => (entry.ref.namespace ? [entry.ref.namespace] : [])))
    ),
  };
};

let version = 0;
const catalogResponse = (scope: string): Response => {
  const query = queryOf(scope);
  const answer = catalog.override?.(query) ?? pageOf(scope, query);
  if ('reason' in answer) {
    return statusResponse(answer);
  }
  version += 1;
  const clusterId = scope.split('|')[0] ?? '';
  return snapshotResponse({
    domain: 'catalog',
    scope,
    version,
    payload: makeCatalogSnapshotPayload({ clusterId, clusterName: clusterId, ...answer }),
  });
};

/** Answers the parked reads with what the backend holds now. */
const releaseHeld = async () => {
  const parked = catalog.parked.splice(0);
  catalog.hold = null;
  await act(async () => {
    parked.forEach((answer) => {
      answer();
    });
  });
  await app.settle();
};

const reads = () => app.snapshots.reads('catalog').map((read) => read.scope);
const readQueries = () => reads().map(queryOf);
/** Page reads, without the facet (limit=1) reads. */
const pageReads = () => readQueries().filter((query) => query.get('limit') !== '1');
/** Page cursors in read order. */
const pageAddresses = () => pageReads().map((query) => query.get('continue'));

// Views pass a memoized pin list (BrowseView.tsx pinnedNamespaces).
const DEFAULT_PINNED = ['default'];
const NO_KINDS: string[] = [];

function Catalog({
  clusterId = dev.clusterId,
  resourceFamily,
  onCommit,
  search = '',
  kinds = NO_KINDS,
  pinnedNamespaces = DEFAULT_PINNED,
  clusterScopedOnly = false,
  customOnly = false,
  enabled = true,
  pageLimit = 2,
  onPageLimitChange,
}: {
  clusterId?: string;
  resourceFamily?: string;
  onCommit?: (value: UseBrowseCatalogResult) => void;
  search?: string;
  kinds?: string[];
  pinnedNamespaces?: string[];
  clusterScopedOnly?: boolean;
  customOnly?: boolean;
  enabled?: boolean;
  pageLimit?: number | null;
  onPageLimitChange?: (value: number) => void;
}) {
  // Models the persistence owner: the prop supplies the value and accepted
  // user changes override it.
  const [pageLimitOverride, setPageLimit] = React.useState<number | null>(null);
  result = useBrowseCatalog({
    enabled,
    clusterId,
    resourceFamily,
    pinnedNamespaces,
    clusterScopedOnly,
    customOnly,
    pageLimit: pageLimitOverride ?? pageLimit ?? undefined,
    onPageLimitChange: (value) => {
      setPageLimit(value);
      onPageLimitChange?.(value);
    },
    filters: { search, kinds, namespaces: [] },
    diagnosticLabel: 'test browse',
  });
  const current = result;
  React.useLayoutEffect(() => {
    onCommit?.(current);
  });
  const inventory = useResourceInventoryTable(
    backendQuerySource({
      enabled,
      rows: current.items,
      loading: current.loading,
      loaded: current.hasLoadedOnce,
      error: current.error,
      cacheKey: `${resourceFamily ?? 'browse'}|${clusterId}|${pinnedNamespaces.join(',')}`,
    })
  );
  return <output>{inventory.rows.map((row) => row.ref.name).join(',')}</output>;
}

const show = (props: React.ComponentProps<typeof Catalog> = {}) =>
  view.show(<Catalog {...props} />);
const shown = () => view.container.querySelector('output')?.textContent;
const names = () => result?.items.map((entry) => entry.ref.name);
const catalogNow = () => requireValue(result, 'expected the catalog hook result');

const run = async (action: () => unknown) => {
  await act(async () => {
    action();
  });
  await app.settle();
};

let doorbell = 0;
/** The backend announces a change to the cluster's catalog. */
const ringCatalog = async () => {
  doorbell += 1;
  await act(async () => {
    app.streams.ring(
      'catalog',
      buildClusterRefreshScope('catalog', dev.clusterId),
      'catalog',
      `catalog:${doorbell}`
    );
    // Doorbells coalesce before the hook re-reads (resourceStreamManager.ts UPDATE_COALESCE_MS).
    await vi.advanceTimersByTimeAsync(200);
  });
  await app.settle();
};

beforeEach(async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  stg = app.cluster({ name: 'stg', context: 'beta' });
  app.namespaces(dev, ['default', 'other']);
  app.namespaces(stg, ['default']);
  // Views without a persisted page size use it (Settings ▸ Display ▸ Tables).
  app.preferences({ defaultTablePageSize: 250 });
  result = null;
  version = 0;
  doorbell = 0;
  catalog.items = [];
  catalog.override = null;
  catalog.hold = null;
  catalog.asOfRequest = false;
  catalog.parked = [];
  app.snapshots.respond((request) => {
    if (request.domain !== 'catalog') {
      return undefined;
    }
    if (catalog.hold?.(queryOf(request.scope))) {
      const asSent = catalog.asOfRequest ? catalogResponse(request.scope) : null;
      return new Promise<Response>((resolve) => {
        catalog.parked.push(() => resolve(asSent ?? catalogResponse(request.scope)));
      });
    }
    return catalogResponse(request.scope);
  });
  view = await app.render(null);
});

afterEach(async () => {
  // Answer anything still parked so no read outlives the test.
  await releaseHeld();
  vi.useRealTimers();
});

describe('useBrowseCatalog queries', () => {
  it('reads at the Default Page Size when the view has none persisted', async () => {
    catalog.items = [item('pod-a')];

    await show({ pageLimit: null });

    expect(catalogNow().pageLimit).toBe(250);
    // The read at mount, and the one the live subscription's acknowledgement
    // asks for (as typed tables do), both use the default size.
    expect(new Set(pageReads().map((query) => query.get('limit')))).toEqual(new Set(['250']));
    expect(names()).toEqual(['pod-a']);
  });

  it('waits for persisted table state, then reads only with the persisted page size and search, and publishes changes', async () => {
    const onPageLimitChange = vi.fn();
    catalog.items = [item('pod-a'), item('api')];
    await show({ enabled: false });
    expect(reads()).toEqual([]);

    // Hydration enables the query with the saved search, which is not typing.
    await show({ enabled: true, pageLimit: 250, search: 'api', onPageLimitChange });
    expect(
      new Set(pageReads().map((query) => `${query.get('limit')} ${query.get('search')}`))
    ).toEqual(new Set(['250 api']));
    expect(names()).toEqual(['api']);

    await run(() => catalogNow().setPageLimit(500));
    expect(onPageLimitChange).toHaveBeenCalledWith(500);
    expect(pageReads().slice(-1)[0]?.get('limit')).toBe('500');
  });

  it('threads custom-only and kind filters into the page and facet queries', async () => {
    catalog.items = [item('widget', { kind: 'Widget' })];
    await show({ pinnedNamespaces: [], clusterScopedOnly: true, customOnly: true });
    expect(new Set(readQueries().map((query) => query.get('customOnly')))).toEqual(
      new Set(['true'])
    );
    expect(new Set(readQueries().map((query) => query.get('limit')))).toEqual(new Set(['2', '1']));

    await show({
      pinnedNamespaces: [],
      clusterScopedOnly: true,
      customOnly: true,
      kinds: ['Widget'],
    });

    const filtered = requireValue(pageReads().slice(-1)[0], 'expected a filtered read');
    expect(filtered.getAll('kind')).toEqual(['Widget']);
    expect(filtered.get('resourceScope')).toBe('cluster');
  });

  it('reads a changed query once, with no follow-up read', async () => {
    vi.useFakeTimers();
    catalog.items = [item('pod-a'), item('web', { kind: 'Deployment' })];
    await show();
    const before = pageReads().length;

    await show({ kinds: ['Pod'] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await app.settle();

    expect(
      pageReads()
        .slice(before)
        .map((query) => query.getAll('kind'))
    ).toEqual([['Pod']]);
    expect(names()).toEqual(['pod-a']);
  });

  it('debounces search before re-querying', async () => {
    vi.useFakeTimers();
    catalog.items = [item('api'), item('web')];
    await show();
    const before = reads().length;

    await show({ search: 'api' });
    expect(reads()).toHaveLength(before);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await app.settle();
    expect(pageReads().slice(-1)[0]?.get('search')).toBe('api');
    expect(names()).toEqual(['api']);
  });

  it('offers the unfiltered scope’s kinds while a filter narrows the page, holding them while the filtered page loads', async () => {
    catalog.items = [item('pod-a'), item('web', { kind: 'Deployment' })];
    await show();
    expect(catalogNow().filterOptions.kinds).toEqual(['Deployment', 'Pod']);

    catalog.hold = (query) => query.getAll('kind').length > 0;
    await show({ kinds: ['Pod'] });
    expect(catalogNow().filterOptions.kinds).toEqual(['Deployment', 'Pod']);

    await releaseHeld();
    expect(names()).toEqual(['pod-a']);
    expect(catalogNow().filterOptions.kinds).toEqual(['Deployment', 'Pod']);
  });
});

describe('useBrowseCatalog loading and scope switches', () => {
  it('stays quiet while refreshing after the first load, and only a final result empties the page', async () => {
    vi.useFakeTimers();
    catalog.items = [item('pod-a')];
    await show();
    expect(names()).toEqual(['pod-a']);
    expect(catalogNow().loading).toBe(false);

    // A refresh in flight keeps the rows up without a loading state.
    catalog.hold = () => true;
    await ringCatalog();
    expect(names()).toEqual(['pod-a']);
    expect(catalogNow().loading).toBe(false);

    // A catalog still rebuilding is not an authoritative empty result.
    catalog.override = () => ({ items: [], total: 0, isFinal: false });
    await releaseHeld();
    expect(names()).toEqual(['pod-a']);

    catalog.override = () => ({ items: [], total: 0, isFinal: true });
    await ringCatalog();
    expect(names()).toEqual([]);
    expect(catalogNow().loading).toBe(false);
  });

  it('keeps Cluster Browse loading while the catalog is still building', async () => {
    catalog.override = () => ({ items: [], total: 826, isFinal: false });

    await show({ pinnedNamespaces: [], clusterScopedOnly: true });

    expect(names()).toEqual([]);
    expect(catalogNow().hasLoadedOnce).toBe(false);
    expect(catalogNow().loading).toBe(true);
  });

  it.each([
    {
      label: 'another resource family',
      destination: { resourceFamily: 'external-secrets' },
      expected: [],
    },
    {
      label: 'another cluster',
      destination: { resourceFamily: 'argocd', clusterId: 'stg' },
      expected: ['stg-application'],
    },
    {
      label: 'another namespace',
      destination: { resourceFamily: 'argocd', pinnedNamespaces: ['other'] },
      expected: ['other-application'],
    },
    {
      label: 'Cluster Browse',
      destination: { pinnedNamespaces: [], clusterScopedOnly: true },
      expected: ['node-a'],
    },
  ])(
    'never publishes or caches the previous scope’s rows when switching to $label',
    async ({ destination, expected }) => {
      catalog.items = [
        item('old-application', { kind: 'Application' }),
        item('node-a', { kind: 'Node' }),
        item('stg-application', { kind: 'Application', clusterId: stg.clusterId }),
        item('other-application', { kind: 'Application', namespace: 'other' }),
      ];
      await show({ resourceFamily: 'argocd' });
      expect(shown()).toBe('old-application');

      const target = {
        ...destination,
        clusterId: destination.clusterId === 'stg' ? stg.clusterId : dev.clusterId,
      };
      const commits: UseBrowseCatalogResult[] = [];
      catalog.hold = () => true;
      await show({ ...target, onCommit: (value) => commits.push(value) });

      expect(commits.length).toBeGreaterThan(0);
      expect(commits.every((value) => value.items.length === 0 && !value.hasLoadedOnce)).toBe(true);
      expect(commits.every((value) => value.filterOptions.kinds.length === 0)).toBe(true);
      expect(catalogNow().loading).toBe(true);
      expect(shown()).toBe('');

      await releaseHeld();
      expect(names()).toEqual(expected);
      expect(shown()).toBe(expected.join(','));
    }
  );
});

describe('useBrowseCatalog doorbells', () => {
  it('reads the page again when the catalog changes while its first read is out', async () => {
    vi.useFakeTimers();
    catalog.items = [item('pod-a')];
    catalog.hold = (query) => query.get('limit') !== '1';
    catalog.asOfRequest = true;
    await show();
    expect(catalog.parked).toHaveLength(1);

    catalog.items = [item('pod-a'), item('pod-b')];
    await ringCatalog();
    await releaseHeld();

    expect(names()).toEqual(['pod-a', 'pod-b']);
  });

  it('re-reads the current page once per catalog doorbell, without echo reads', async () => {
    vi.useFakeTimers();
    catalog.items = [item('pod-a')];
    await show();
    const baseScope = requireValue(reads()[0], 'expected the page read');
    expect(app.streams.active()).toContain(
      `catalog ${buildClusterRefreshScope('catalog', dev.clusterId)}`
    );

    const baseReads = () => reads().filter((scope) => scope === baseScope).length;
    const atMount = baseReads();

    catalog.items = [item('pod-a'), item('pod-b')];
    await ringCatalog();
    expect(names()).toEqual(['pod-a', 'pod-b']);
    expect(baseReads()).toBe(atMount + 1);

    // The applied response must not count as another doorbell.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await app.settle();
    expect(baseReads()).toBe(atMount + 1);
  });

  // Refresh Now (command palette, connectivity status) reconciles every query
  // the cluster leases; a query-only consumer re-reads its own page.
  it('re-reads the current page when the user refreshes the cluster', async () => {
    catalog.items = [item('pod-a')];
    await show();

    catalog.items = [item('pod-a'), item('pod-b')];
    await run(() => requestContextRefresh({ reason: 'user', clusterId: dev.clusterId }));

    expect(names()).toEqual(['pod-a', 'pod-b']);
  });

  it('keeps the selected cursor page through a doorbell and refreshes that page on demand', async () => {
    vi.useFakeTimers();
    catalog.items = ['node-a', 'node-b', 'node-c'].map((name) => item(name, { kind: 'Node' }));
    await show({ pinnedNamespaces: [], clusterScopedOnly: true });
    await run(() => catalogNow().handleLoadMore());
    expect(names()).toEqual(['node-c']);
    expect(catalogNow().pageIndex).toBe(2);

    catalog.items = [...catalog.items, item('node-d', { kind: 'Node' })];
    await ringCatalog();
    expect(catalogNow().pageIndex).toBe(2);
    expect(names()).toEqual(['node-c', 'node-d']);
    expect(catalogNow().totalCount).toBe(4);

    catalog.items[2] = item('node-c-refreshed', { kind: 'Node' });
    const before = pageReads().length;
    await run(() => catalogNow().refresh());
    // A refresh re-reads the selected page at its cursor, not the first page.
    expect(
      new Set(
        pageReads()
          .slice(before)
          .map((query) => query.get('continue'))
      )
    ).toEqual(new Set(['2']));
    expect(names()).toEqual(['node-c-refreshed', 'node-d']);
    expect(catalogNow().pageIndex).toBe(2);
  });

  // On a churning cluster doorbells ring continuously; a busy flag per ring
  // would leave the footer permanently disabled.
  it('re-reads the current page quietly and never lets a late quiet read replace the user’s page', async () => {
    vi.useFakeTimers();
    catalog.items = ['a', 'b', 'c', 'd'].map((name) => item(name));
    await show();

    catalog.hold = (query) => query.get('continue') === '2';
    await run(() => catalogNow().pagination.onRequestMore());
    expect(catalogNow().pagination.isRequestingMore).toBe(true);
    await releaseHeld();
    expect(names()).toEqual(['c', 'd']);
    expect(catalogNow().pagination.isRequestingMore).toBe(false);

    catalog.hold = (query) => query.get('continue') === '2';
    await ringCatalog();
    expect(catalog.parked).toHaveLength(1);
    expect(catalogNow().pagination.isRequestingMore).toBe(false);

    // The user goes back while the quiet read is outstanding.
    catalog.hold = null;
    const parkedQuietRead = catalog.parked.splice(0);
    await run(() => catalogNow().pagination.onRequestPrevious());
    expect(catalogNow().pageIndex).toBe(1);
    expect(names()).toEqual(['a', 'b']);

    await act(async () => {
      parkedQuietRead.forEach((answer) => {
        answer();
      });
    });
    await app.settle();
    expect(catalogNow().pageIndex).toBe(1);
    expect(names()).toEqual(['a', 'b']);
    expect(catalogNow().pagination.isRequestingMore).toBe(false);
  });
});

describe('useBrowseCatalog paging', () => {
  it('replaces the row window with each next and previous cursor page', async () => {
    catalog.items = ['a', 'b', 'c', 'd', 'e'].map((name) => item(name));
    await show();
    expect(names()).toEqual(['a', 'b']);
    const atMount = pageAddresses().length;

    await run(() => catalogNow().handleLoadMore());
    await run(() => catalogNow().handleLoadMore());
    expect(names()).toEqual(['e']);
    expect(catalogNow().pageIndex).toBe(3);
    expect(catalogNow().continueToken).toBeNull();
    // Each page is read once.
    expect(pageAddresses().slice(atMount)).toEqual(['2', '4']);

    await run(() => catalogNow().handleLoadPrevious());
    expect(names()).toEqual(['c', 'd']);
    expect(catalogNow().pageIndex).toBe(2);
  });

  it('lands a numbered jump and keeps that page through a doorbell', async () => {
    vi.useFakeTimers();
    catalog.items = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => item(name));
    await show();

    await run(() => catalogNow().pagination.onJumpToPage(3));
    expect(pageReads().slice(-1)[0]?.get('startRank')).toBe('4');
    expect(catalogNow().pageIndex).toBe(3);
    expect(shown()).toBe('e,f');

    catalog.items[4] = item('updated');
    await ringCatalog();
    // The page re-reads at its own cursor, not page one.
    expect(pageReads().slice(-1)[0]?.get('continue')).toBe('4');
    expect(catalogNow().pageIndex).toBe(3);
    expect(shown()).toBe('updated,f');
  });

  it('returns to the first page when the backend rejects a cursor', async () => {
    catalog.items = ['a', 'b', 'c'].map((name) => item(name));
    catalog.override = (query) =>
      query.get('continue') === '2' ? { items: [], cursorInvalid: true, total: 3 } : undefined;
    await show();

    await run(() => catalogNow().handleLoadMore());

    expect(catalogNow().pageIndex).toBe(1);
    expect(names()).toEqual(['a', 'b']);
    expect(pageReads().slice(-1)[0]?.get('continue')).toBeNull();
  });

  // The refresh orchestrator settles a failed read into the scope's state
  // and reports it (orchestrator.ts executeFetch); Browse shows the failure.
  it('keeps the current page and shows the failure when the next page fails to load, which is reported', async () => {
    catalog.items = ['a', 'b', 'c'].map((name) => item(name));
    catalog.override = (query) =>
      query.get('continue') === '2' ? makeErrorStatus('Gone', 'catalog page expired') : undefined;
    await show();

    await run(() => catalogNow().handleLoadMore());

    expect(catalogNow().pageIndex).toBe(1);
    expect(names()).toEqual(['a', 'b']);
    expect(catalogNow().pagination.isRequestingMore).toBe(false);
    expect(failureMessage(catalogNow().error)).toBe('catalog page expired');
    expect(
      app.errors.take(
        (record) =>
          record.context?.domain === 'catalog' &&
          String(record.context?.scope).endsWith('&continue=2')
      )
    ).toHaveLength(1);
  });

  it('exports every page at the backend’s maximum page size, and rejects a partial export', async () => {
    catalog.items = ['a', 'b', 'c'].map((name) => item(name));
    await show();
    // The backend caps each export page; the walk follows its cursor.
    catalog.override = (query) =>
      query.get('limit') === '10000'
        ? pageOf(
            `${dev.clusterId}|`,
            new URLSearchParams({ ...Object.fromEntries(query), limit: '2' })
          )
        : undefined;

    const exported = await catalogNow().fetchAllRows();
    expect(exported.map((entry) => entry.ref.name)).toEqual(['a', 'b', 'c']);
    const exportReads = pageReads().filter((query) => query.get('limit') === '10000');
    expect(new Set(exportReads.map((query) => query.get('continue')))).toEqual(
      new Set([null, '2'])
    );

    catalog.override = (query) =>
      query.get('limit') === '10000' && query.get('continue') === '2'
        ? makeErrorStatus('InternalError', 'catalog unavailable')
        : query.get('limit') === '10000'
          ? pageOf(
              `${dev.clusterId}|`,
              new URLSearchParams({ ...Object.fromEntries(query), limit: '2' })
            )
          : undefined;
    await expect(catalogNow().fetchAllRows()).rejects.toThrow();
    app.errors.take((record) => record.context?.domain === 'catalog');
  });
});
