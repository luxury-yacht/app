/**
 * frontend/src/modules/resource-grid/backendQuerySource.test.ts
 *
 * Verifies the query-backed source normalizes typed/catalog query results into
 * the shared controller contract, and — critically — that it reproduces the
 * false-empty fix end-to-end through the controller WITHOUT any local-row
 * retention: a warm reload that momentarily returns nothing renders as loading,
 * and only a truly settled-empty query renders the empty state.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  backendQuerySource,
  type BackendQueryPaginationInput,
  type BackendQuerySourceInput,
} from './backendQuerySource';
import { deriveResourceInventoryRenderState } from './useResourceInventoryTable';

interface Row {
  clusterId: string;
  name: string;
}

const pagination = (
  overrides: Partial<BackendQueryPaginationInput> = {}
): BackendQueryPaginationInput => ({
  continueToken: null,
  hasPrevious: false,
  pageIndex: 1,
  pageSize: 50,
  totalCount: 0,
  totalIsExact: true,
  isRequestingMore: false,
  loadMore: () => {},
  loadPrevious: () => {},
  ...overrides,
});

function input(
  overrides: Partial<BackendQuerySourceInput<Row>> = {}
): BackendQuerySourceInput<Row> {
  return {
    enabled: true,
    rows: [],
    loading: false,
    loaded: false,
    error: null,
    pagination: pagination(),
    ...overrides,
  };
}

describe('backendQuerySource', () => {
  it('maps an enabled query result with pagination', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const source = backendQuerySource(
      input({
        rows: [{ clusterId: 'c', name: 'a' }],
        loading: false,
        loaded: true,
        pagination: pagination({
          continueToken: 'next-cursor',
          hasPrevious: true,
          pageIndex: 2,
          pageSize: 100,
          totalCount: 240,
          totalIsExact: false,
          isRequestingMore: true,
          loadMore: onNext,
          loadPrevious: onPrevious,
        }),
      })
    );

    expect(source.blocked).toBe(false);
    expect(source.pagination).not.toBeNull();
    expect(source.pagination?.hasNext).toBe(true);
    expect(source.pagination?.hasPrevious).toBe(true);
    expect(source.pagination?.pageIndex).toBe(2);
    expect(source.pagination?.pageSize).toBe(100);
    expect(source.pagination?.totalCount).toBe(240);
    expect(source.pagination?.totalIsExact).toBe(false);
    expect(source.pagination?.isRequestingMore).toBe(true);
    source.pagination?.onNext();
    source.pagination?.onPrevious();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
  });

  it('derives hasNext from the continue token', () => {
    expect(backendQuerySource(input()).pagination?.hasNext).toBe(false);
    expect(
      backendQuerySource(input({ pagination: pagination({ continueToken: 'x' }) })).pagination
        ?.hasNext
    ).toBe(true);
  });

  it('treats a disabled query as blocked with no pagination', () => {
    const source = backendQuerySource(input({ enabled: false, loaded: true }));
    expect(source.blocked).toBe(true);
    expect(source.pagination).toBeNull();
    expect(source.loading).toBe(false);
    expect(deriveResourceInventoryRenderState(source).status).toBe('blocked');
  });

  it('defaults completeness to complete and carries no partial label', () => {
    const source = backendQuerySource(
      input({ rows: [{ clusterId: 'c', name: 'a' }], loaded: true })
    );
    expect(source.completeness).toBe('complete');
    expect(source.partialLabel).toBeNull();
    expect(deriveResourceInventoryRenderState(source).isPartial).toBe(false);
  });

  it('surfaces a degraded (partial) envelope with its label', () => {
    const source = backendQuerySource(
      input({
        rows: [{ clusterId: 'c', name: 'a' }],
        loaded: true,
        completeness: 'partial',
        partialLabel: 'Catalog degraded; pagination disabled',
      })
    );
    expect(source.completeness).toBe('partial');
    const render = deriveResourceInventoryRenderState(source);
    expect(render.isPartial).toBe(true);
    expect(render.partialLabel).toBe('Catalog degraded; pagination disabled');
  });

  it('a warm reload that momentarily returns nothing renders as loading, not empty', () => {
    // This is the false-empty case, with NO local-row retention: loaded already,
    // a refresh in flight, rows momentarily empty.
    const render = deriveResourceInventoryRenderState(
      backendQuerySource(input({ rows: [], loaded: true, loading: true }))
    );
    expect(render.status).toBe('loading');
    expect(render.showLoadingBoundary).toBe(true);
    expect(render.isEmpty).toBe(false);
  });

  it('a settled-empty query renders the empty state', () => {
    const render = deriveResourceInventoryRenderState(
      backendQuerySource(input({ rows: [], loaded: true, loading: false }))
    );
    expect(render.status).toBe('empty');
    expect(render.isEmpty).toBe(true);
  });

  it('passes the query error through to the render state', () => {
    const render = deriveResourceInventoryRenderState(
      backendQuerySource(input({ error: 'forbidden', loaded: true }))
    );
    expect(render.status).toBe('error');
    expect(render.error).toBe('forbidden');
  });
});
