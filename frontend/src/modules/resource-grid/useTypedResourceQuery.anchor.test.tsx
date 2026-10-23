/**
 * frontend/src/modules/resource-grid/useTypedResourceQuery.anchor.test.tsx
 *
 * Anchor jump intent lifecycle (docs/architecture/large-data-query.md "Page
 * Addressing Contract"): anchorTo reads the anchored page with the object's
 * full identity; a found landing seeds the page position from the serve-time
 * rank and adopts the self cursor so live refetches stay page-stable; the
 * intent survives sort changes (re-anchors) and is dropped by manual
 * pagination or a missing anchor. The hook runs inside the app shell through
 * the real data-access broker and orchestrator; only the backend boundary is
 * faked (test-utils/appState).
 */

import type { SortConfig } from '@hooks/useTableSort';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { ALL_NAMESPACES_SELECTOR, parseRefreshScope } from '@/core/refresh/scopeSelector';
import type { PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { selectPayloadRows } from './typedResourceQueryScope';
import { type UseTypedResourceQueryResult, useTypedResourceQuery } from './useTypedResourceQuery';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let query: UseTypedResourceQueryResult<PodSnapshotEntry, PodSnapshotPayload> | undefined;

function QueryProbe({ sortConfig }: Readonly<{ sortConfig: SortConfig | null }>) {
  query = useTypedResourceQuery<PodSnapshotPayload, PodSnapshotEntry>({
    enabled: true,
    clusterId: dev.clusterId,
    domain: 'pods',
    baseSelector: ALL_NAMESPACES_SELECTOR,
    label: 'Pods',
    filters: DEFAULT_GRID_TABLE_FILTER_STATE,
    sortConfig,
    pageLimit: 20,
    selectRows: selectPayloadRows,
  });
  return null;
}

const current = () => requireValue(query, 'expected the typed query result');

const page = (names: string[], overrides: Partial<PodSnapshotPayload> = {}) =>
  makePodSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    rows: names.map((name) =>
      makePodSnapshotEntry({ ref: { clusterId: dev.clusterId, namespace: 'default', name } })
    ),
    total: 300,
    unfilteredTotal: 300,
    ...overrides,
  });

/** The page the backend lands an anchor on: rank 47 at 20 rows a page is page 3. */
const landing = (overrides: Partial<PodSnapshotPayload> = {}) =>
  page(['row-40', 'web-47'], {
    continue: 'c-next',
    previous: 'c-prev',
    self: 'c-self',
    anchor: { found: true, rank: 47 },
    pageStartRank: 40,
    ...overrides,
  });

const params = (scope: string) => new URLSearchParams(parseRefreshScope('pods', scope).query ?? '');
const reads = () => app.snapshots.reads('pods').map((read) => params(read.scope));
const anchored = (read: URLSearchParams) => read.has('anchor.name');

// What the backend answers for each pods read; tests replace it.
let answer: (read: URLSearchParams) => PodSnapshotPayload = () => page(['pod-1']);

const NAME_ASC: SortConfig = { key: 'name', direction: 'asc' };

const show = (sortConfig: SortConfig | null = NAME_ASC) =>
  view.show(<QueryProbe sortConfig={sortConfig} />);

const run = async (action: () => void) => {
  await act(async () => {
    action();
  });
  await app.settle();
};

const anchorToWeb47 = () =>
  run(() =>
    current().anchorTo({
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'web-47',
    })
  );

beforeEach(async () => {
  query = undefined;
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.snapshots.answer(({ domain, scope }) =>
    domain === 'pods' ? answer(params(scope)) : undefined
  );
  view = await app.render(null);
});

describe('useTypedResourceQuery anchor lifecycle', () => {
  it('lands on the anchored page, seeds the page position from its rank, and stays page-stable', async () => {
    answer = (read) => {
      if (anchored(read)) {
        return landing();
      }
      // The adopted self cursor reproduces the landing page without re-anchoring.
      return read.get('continue') === 'c-self'
        ? page(['row-40', 'web-47'], { continue: 'c-next', previous: 'c-prev' })
        : page(['pod-1'], { continue: 'c1' });
    };
    await show();

    await anchorToWeb47();

    const anchoredRead = requireValue(reads().find(anchored), 'expected an anchored read');
    expect(Object.fromEntries(anchoredRead)).toMatchObject({
      'anchor.clusterId': dev.clusterId,
      'anchor.version': 'v1',
      'anchor.kind': 'Pod',
      'anchor.namespace': 'default',
      'anchor.name': 'web-47',
    });
    expect(anchoredRead.has('continue')).toBe(false);
    expect(reads().slice(-1)[0]?.get('continue')).toBe('c-self');
    expect(current().pageIndex).toBe(3);
    expect(current().anchorResult).toEqual({ found: true, rank: 47 });
    expect(current().hasPrevious).toBe(true);
    expect(current().rows.map((row) => row.ref.name)).toEqual(['row-40', 'web-47']);
  });

  it('re-anchors on a sort change (the intent survives soft resets)', async () => {
    answer = () => landing();
    await show();
    await anchorToWeb47();
    app.snapshots.clearReads();

    await show({ key: 'name', direction: 'desc' });

    expect(reads().some((read) => anchored(read) && read.get('sortDirection') === 'desc')).toBe(
      true
    );
  });

  it('drops the intent on manual pagination', async () => {
    answer = (read) =>
      anchored(read) ? landing() : page(['plain'], { continue: 'c-next-2', previous: 'c-prev-2' });
    await show();
    await anchorToWeb47();

    await run(() => current().loadMore());
    expect(current().anchorResult).toBeNull();

    // A later sort change must not re-anchor.
    app.snapshots.clearReads();
    await show(null);
    expect(reads()).not.toEqual([]);
    expect(reads().some(anchored)).toBe(false);
  });

  it('reports a missing anchor, serves the first page, and drops the intent', async () => {
    answer = (read) =>
      anchored(read)
        ? page(['pod-1'], {
            total: 3,
            anchor: { found: false, rank: -1, reason: 'filtered' },
            pageStartRank: 0,
          })
        : page(['pod-1'], { total: 3 });
    await show();

    await anchorToWeb47();

    expect(current().anchorResult).toEqual({ found: false, rank: -1, reason: 'filtered' });
    expect(current().pageIndex).toBe(1);

    app.snapshots.clearReads();
    await show({ key: 'name', direction: 'desc' });
    expect(reads()).not.toEqual([]);
    expect(reads().some(anchored)).toBe(false);
  });
});
