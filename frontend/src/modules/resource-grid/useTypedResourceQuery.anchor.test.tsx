/**
 * frontend/src/modules/resource-grid/useTypedResourceQuery.anchor.test.tsx
 *
 * Anchor jump intent lifecycle (docs/architecture/large-data.md "Page
 * Addressing Contract"): anchorTo
 * fires an anchored request; a found landing seeds pageIndex from the
 * serve-time rank and adopts the self cursor so live refetches stay
 * page-stable; the intent survives soft resets (re-anchors) and is cleared by
 * manual pagination or a missing anchor.
 */

import type { SortConfig } from '@hooks/useTableSort';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypedQueryPayload } from './typedResourceQueryScope';
import { type UseTypedResourceQueryResult, useTypedResourceQuery } from './useTypedResourceQuery';

const { requestRefreshDomainStateMock } = vi.hoisted(() => ({
  requestRefreshDomainStateMock: vi.fn(),
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomainState: (...args: unknown[]) => requestRefreshDomainStateMock(...(args as [])),
}));

interface TestRow {
  name: string;
}

interface TestPayload extends TypedQueryPayload {
  rows?: TestRow[];
}

const selectRows = (payload: TestPayload) => payload.rows ?? [];

const executed = (data: TestPayload) => ({
  status: 'executed',
  data: { status: 'ready', data },
});

const anchorRef = {
  clusterId: 'cluster-a',
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'default',
  name: 'web-47',
};

const scopeOfCallFromEnd = (offset: number): string => {
  const calls = requestRefreshDomainStateMock.mock.calls;
  const call = calls[calls.length - offset]?.[0] as { scope: string } | undefined;
  if (!call) {
    throw new Error(`Expected refresh-domain call at offset ${offset}`);
  }
  return call.scope;
};
const lastScope = (): string => scopeOfCallFromEnd(1);

describe('useTypedResourceQuery anchor lifecycle', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let result: UseTypedResourceQueryResult<TestRow, TestPayload> | undefined;
  let setSort: ((sort: SortConfig | null) => void) | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    result = undefined;
    requestRefreshDomainStateMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderQuery = async () => {
    const Probe: React.FC = () => {
      const [sort, updateSort] = React.useState<SortConfig | null>({
        key: 'name',
        direction: 'asc',
      });
      setSort = updateSort;
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig: sort,
        pageLimit: 20,
        selectRows,
      });
      return null;
    };
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const settle = async (action?: () => void) => {
    await act(async () => {
      action?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('lands on the anchored page, seeds pageIndex from rank, and stays page-stable', async () => {
    // Initial page 1.
    requestRefreshDomainStateMock.mockResolvedValueOnce(
      executed({ rows: [{ name: 'pod-1' }], total: 300, totalIsExact: true, continue: 'c1' })
    );
    await renderQuery();

    // Anchored landing: rank 47 at limit 20 → page 3 (ranks 40-59).
    requestRefreshDomainStateMock.mockResolvedValueOnce(
      executed({
        rows: [{ name: 'row-40' }, { name: 'web-47' }],
        total: 300,
        totalIsExact: true,
        continue: 'c-next',
        previous: 'c-prev',
        self: 'c-self',
        anchor: { found: true, rank: 47 },
        pageStartRank: 40,
      })
    );
    // The adopted self cursor triggers one quiet refetch of the same page.
    requestRefreshDomainStateMock.mockResolvedValueOnce(
      executed({
        rows: [{ name: 'row-40' }, { name: 'web-47' }],
        total: 300,
        totalIsExact: true,
        continue: 'c-next',
        previous: 'c-prev',
      })
    );

    await settle(() => result?.anchorTo(anchorRef));
    expect(lastScope()).toContain('continue=c-self');

    expect(result?.pageIndex).toBe(3);
    expect(result?.anchorResult).toEqual({ found: true, rank: 47 });
    expect(result?.hasPrevious).toBe(true);
    expect(result?.rows?.[1]?.name).toBe('web-47');

    // The anchored fetch itself carried anchor params and no continue token.
    const anchoredScope = scopeOfCallFromEnd(2);
    expect(anchoredScope).toContain('anchor.name=web-47');
    expect(anchoredScope).toContain('anchor.clusterId=cluster-a');
    expect(anchoredScope).not.toContain('continue=');
  });

  it('re-anchors on a sort change (the intent survives soft resets)', async () => {
    requestRefreshDomainStateMock.mockResolvedValue(
      executed({
        rows: [{ name: 'web-47' }],
        total: 300,
        totalIsExact: true,
        self: 'c-self',
        previous: 'c-prev',
        anchor: { found: true, rank: 47 },
        pageStartRank: 40,
      })
    );
    await renderQuery();
    await settle(() => result?.anchorTo(anchorRef));

    requestRefreshDomainStateMock.mockClear();
    await settle(() => setSort?.({ key: 'name', direction: 'desc' }));

    const scopes = requestRefreshDomainStateMock.mock.calls.map(
      (call) => (call[0] as { scope: string }).scope
    );
    expect(scopes.some((scope) => scope.includes('anchor.name=web-47'))).toBe(true);
  });

  it('clears the intent on manual pagination', async () => {
    // Realistic serve: only anchored scopes return an anchor result; cursor
    // and first-page scopes return plain pages.
    requestRefreshDomainStateMock.mockImplementation((args: { scope: string }) =>
      Promise.resolve(
        args.scope.includes('anchor.')
          ? executed({
              rows: [{ name: 'web-47' }],
              total: 300,
              totalIsExact: true,
              continue: 'c-next',
              previous: 'c-prev',
              self: 'c-self',
              anchor: { found: true, rank: 47 },
              pageStartRank: 40,
            })
          : executed({
              rows: [{ name: 'plain' }],
              total: 300,
              totalIsExact: true,
              continue: 'c-next-2',
              previous: 'c-prev-2',
            })
      )
    );
    await renderQuery();
    await settle(() => result?.anchorTo(anchorRef));

    await settle(() => result?.loadMore());
    expect(result?.anchorResult).toBeNull();

    // A later sort change must NOT re-anchor (intent gone).
    requestRefreshDomainStateMock.mockClear();
    await settle(() => setSort?.(null));
    const scopes = requestRefreshDomainStateMock.mock.calls.map(
      (call) => (call[0] as { scope: string }).scope
    );
    expect(scopes.every((scope) => !scope.includes('anchor.'))).toBe(true);
  });

  it('reports a missing anchor, serves the first page, and drops the intent', async () => {
    requestRefreshDomainStateMock.mockResolvedValueOnce(
      executed({ rows: [{ name: 'pod-1' }], total: 3, totalIsExact: true })
    );
    await renderQuery();

    requestRefreshDomainStateMock.mockResolvedValueOnce(
      executed({
        rows: [{ name: 'pod-1' }],
        total: 3,
        totalIsExact: true,
        anchor: { found: false, rank: -1, reason: 'filtered' },
        pageStartRank: 0,
      })
    );
    await settle(() => result?.anchorTo(anchorRef));

    expect(result?.anchorResult).toEqual({ found: false, rank: -1, reason: 'filtered' });
    expect(result?.pageIndex).toBe(1);

    // No re-anchor on the next soft reset — the intent is gone.
    requestRefreshDomainStateMock.mockClear();
    requestRefreshDomainStateMock.mockResolvedValue(
      executed({ rows: [{ name: 'pod-1' }], total: 3, totalIsExact: true })
    );
    await settle(() => setSort?.({ key: 'name', direction: 'desc' }));
    const scopes = requestRefreshDomainStateMock.mock.calls.map(
      (call) => (call[0] as { scope: string }).scope
    );
    expect(scopes.every((scope) => !scope.includes('anchor.'))).toBe(true);
  });
});
