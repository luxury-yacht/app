/**
 * frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.liveScope.test.tsx
 *
 * A query-backed table follows its live scope (the unqueried cluster or
 * namespace scope it subscribes to): it re-reads its page when the scope's
 * stream is acknowledged or rings a doorbell clock, while the scheduled poll
 * stands in for a stream that never acknowledges, and never because another
 * reader's snapshot of the scope landed. Its first read waits while another
 * reader is still loading the scope, and it shows only its own page. Runs
 * inside the app shell with the real query, refresh orchestrator, and stream
 * manager over a faked backend whose stream acknowledges only when the test
 * says so (test-utils/appState).
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestRefreshDomainState } from '@/core/data-access';
import {
  makeClusterNodeSnapshotEntry,
  makeClusterNodeSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import {
  ALL_NAMESPACES_SELECTOR,
  buildRefreshScope,
  CLUSTER_SELECTOR,
  parseRefreshScope,
} from '@/core/refresh/scopeSelector';
import { getScopedDomainState } from '@/core/refresh/store';
import type { CanonicalResourceRef } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse, streamKey } from '@/test-utils/appState/transport';
import ResourceInventoryTable from './ResourceInventoryTable';
import { selectPayloadRows, type TypedQueryPayload } from './typedResourceQueryScope';
import {
  type QueryBackedNamespaceGridResult,
  useQueryBackedClusterResourceGridTable,
  useQueryBackedNamespaceResourceGridTable,
} from './useQueryBackedResourceGridTable';

interface Row {
  ref: CanonicalResourceRef;
}
type Payload = TypedQueryPayload & { rows?: Row[] };
type LiveDomain = 'nodes' | 'pods';

const app = installAppStateHarness({ streams: 'manual' });
let dev: TestCluster;
let view: MountedApp;
let grid: QueryBackedNamespaceGridResult<Row, Payload> | undefined;

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.ref.name },
];
const rowKey = (row: Row) => `${row.ref.clusterId}|${row.ref.namespace}/${row.ref.name}`;

function Table({ result }: Readonly<{ result: QueryBackedNamespaceGridResult<Row, Payload> }>) {
  grid = result;
  return (
    <ResourceInventoryTable
      source={result.source}
      gridTableProps={result.gridTableProps}
      columns={columns}
      spinnerMessage="Loading..."
    />
  );
}

function NodesTable() {
  const result = useQueryBackedClusterResourceGridTable<Payload, Row>({
    clusterId: dev.clusterId,
    domain: 'nodes',
    label: 'Cluster Nodes',
    selectRows: selectPayloadRows,
    viewId: 'cluster-nodes',
    columns,
    keyExtractor: rowKey,
    supportsCustomMetadataColumns: true,
  });
  return <Table result={result} />;
}

function PodsTable({ namespace }: Readonly<{ namespace: string }>) {
  const result = useQueryBackedNamespaceResourceGridTable<Payload, Row>({
    clusterId: dev.clusterId,
    domain: 'pods',
    label: 'Pods',
    selectRows: selectPayloadRows,
    viewId: 'namespace-pods',
    namespace,
    columns,
    keyExtractor: rowKey,
    supportsCustomMetadataColumns: true,
  });
  return <Table result={result} />;
}

// Whether a read is the table's typed page (a scope with a query) or the live scope.
const isPageRead = (domain: LiveDomain, scope: string) =>
  Boolean(parseRefreshScope(domain, scope).query);
const pageReads = (domain: LiveDomain) =>
  app.snapshots
    .reads(domain)
    .map((read) => read.scope)
    .filter((scope) => isPageRead(domain, scope));

const renderedRows = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).map(
    (row) => row.textContent ?? ''
  );

const liveScopeOf = (domain: LiveDomain, selector = CLUSTER_SELECTOR) =>
  buildRefreshScope(domain, { clusterId: dev.clusterId, selector });

/**
 * What the backend serves for the cluster's nodes and pods: the table's typed
 * page holds a `query-` row, a snapshot of the live scope a `live-` row.
 */
const tablePayload = (domain: string, scope: string) => {
  const identity = { clusterId: dev.clusterId, clusterName: dev.clusterName };
  if (domain === 'nodes') {
    const name = isPageRead(domain, scope) ? 'query-node' : 'live-node';
    return makeClusterNodeSnapshotPayload({
      ...identity,
      rows: [makeClusterNodeSnapshotEntry({ ref: { clusterId: dev.clusterId, name } })],
      total: 1,
      unfilteredTotal: 1,
    });
  }
  if (domain === 'pods') {
    const name = isPageRead(domain, scope) ? 'query-pod' : 'live-pod';
    return makePodSnapshotPayload({
      ...identity,
      rows: [
        makePodSnapshotEntry({ ref: { clusterId: dev.clusterId, namespace: 'team-a', name } }),
      ],
      total: 1,
      unfilteredTotal: 1,
    });
  }
  return undefined;
};

const run = async (action: () => void) => {
  await act(async () => {
    action();
  });
  await app.settle();
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await app.settle();
};

beforeEach(async () => {
  grid = undefined;
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.snapshots.answer(({ domain, scope }) => tablePayload(domain, scope));
  view = await app.render(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useQueryBackedResourceGridTable live scope', () => {
  it.each([
    {
      name: 'cluster nodes',
      table: () => <NodesTable />,
      domain: 'nodes' as const,
      liveScope: () => liveScopeOf('nodes'),
    },
    {
      name: 'All Namespaces pods',
      table: () => <PodsTable namespace={ALL_NAMESPACES_SCOPE} />,
      domain: 'pods' as const,
      liveScope: () => liveScopeOf('pods', ALL_NAMESPACES_SELECTOR),
    },
  ])(
    'subscribes to its live scope and re-reads its page on each doorbell clock ($name)',
    async ({ table, domain, liveScope }) => {
      vi.useFakeTimers();
      await view.show(table());
      expect(app.streams.active()).toContain(streamKey(domain, liveScope()));
      await run(() => app.streams.acknowledge(domain, liveScope()));
      const page = pageReads(domain).slice(-1)[0];

      for (const clock of ['object', 'metric']) {
        const before = pageReads(domain).length;
        await run(() => app.streams.ring(domain, liveScope(), clock, `${clock}-2`));
        // The stream manager coalesces a doorbell for 150 ms (resourceStreamManager.ts).
        await advance(200);
        expect(pageReads(domain).slice(before)).toEqual([page]);
      }
      // The table reads only its page; the live scope is subscribed, never read.
      expect(app.snapshots.reads(domain).every((read) => isPageRead(domain, read.scope))).toBe(
        true
      );
    }
  );

  it('re-reads its page once the live subscription is acknowledged', async () => {
    await view.show(<NodesTable />);
    const before = pageReads('nodes');
    expect(before).not.toEqual([]);

    await run(() => app.streams.acknowledge('nodes', liveScopeOf('nodes')));

    expect(pageReads('nodes').slice(before.length)).toEqual(before.slice(-1));
  });

  it('lets the scheduled poll re-read its page only while the stream is unacknowledged', async () => {
    vi.useFakeTimers();
    await view.show(<NodesTable />);

    // nodes polls every 5 s (backend/refresh/domain/refresh-domain-contract.json).
    let before = pageReads('nodes').length;
    await advance(5_000);
    expect(pageReads('nodes').length).toBe(before + 1);

    await run(() => app.streams.acknowledge('nodes', liveScopeOf('nodes')));
    before = pageReads('nodes').length;
    await advance(5_000);
    expect(pageReads('nodes')).toHaveLength(before);
  });

  it('does not re-read its page when another reader’s snapshot of the live scope lands', async () => {
    await view.show(<NodesTable />);
    await run(() => app.streams.acknowledge('nodes', liveScopeOf('nodes')));
    const before = pageReads('nodes').length;

    // Another surface reads the same base scope; its payload carries new source versions.
    await run(() => {
      void requestRefreshDomainState({
        domain: 'nodes',
        scope: liveScopeOf('nodes'),
        reason: 'user',
        preserveState: true,
      });
    });

    expect(getScopedDomainState('nodes', liveScopeOf('nodes')).data).toBeTruthy();
    expect(pageReads('nodes')).toHaveLength(before);
  });

  it('waits while another reader loads the live scope, then shows only its own page', async () => {
    const liveScope = liveScopeOf('pods', { kind: 'namespace', namespace: 'team-a' });
    let releaseLive!: () => void;
    const liveGate = new Promise<void>((resolve) => {
      releaseLive = resolve;
    });
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'pods' && scope === liveScope
        ? liveGate.then(() =>
            snapshotResponse({ domain, scope, version: 1, payload: tablePayload(domain, scope) })
          )
        : undefined
    );
    // Another surface (an object panel) is loading the namespace's pods snapshot.
    let liveRead: Promise<unknown> = Promise.resolve();
    await run(() => {
      liveRead = requestRefreshDomainState({
        domain: 'pods',
        scope: liveScope,
        reason: 'user',
        preserveState: true,
      });
    });

    await view.show(<PodsTable namespace="team-a" />);
    expect(pageReads('pods')).toEqual([]);
    expect(grid?.source.loading).toBe(true);

    await act(async () => {
      releaseLive();
      await liveRead;
    });
    await app.settle();

    expect(pageReads('pods')).not.toEqual([]);
    expect(renderedRows()).toEqual([expect.stringContaining('query-pod')]);
  });
});
