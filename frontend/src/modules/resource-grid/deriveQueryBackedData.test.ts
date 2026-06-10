/**
 * `deriveQueryBackedData` decides what a resource grid shows. Two contracts matter:
 *
 * 1. A query-backed table is NEVER sourced from the live snapshot — that snapshot is
 *    unsorted client-side and unpaginated, so showing it during the reload window made
 *    a revisit appear unsorted until the server-sorted query reloaded. While the query
 *    is gating or before its first page applies it reports empty+loading so the
 *    controller bridges with the cached page.
 *
 * 2. `loading` is true ONLY for that initial gap. Every later refetch — filter, sort,
 *    page size, manual, or background — is visually silent: no overlay, no spinner
 *    swap, and the filter input stays mounted (and focused) on a no-match result.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveQueryBackedData,
  typedQueryPageLimitOrDefault,
} from './useQueryBackedResourceGridTable';

interface Row {
  name: string;
}

const queryPage: Row[] = [{ name: 'q1' }, { name: 'q2' }];

const base = {
  clusterId: 'c1',
  queryEnabled: false,
  queryRows: [] as Row[],
  queryLoaded: false,
  queryError: null as string | null,
};

describe('deriveQueryBackedData', () => {
  it('never shows the live snapshot for a query-backed table while gating', () => {
    const r = deriveQueryBackedData<Row>({ ...base, queryEnabled: false });
    expect(r.data).toEqual([]); // NOT `local`
    expect(r.loading).toBe(true); // hold loading so the controller replays the cache
    expect(r.loaded).toBe(false);
    expect(r.error).toBeNull();
  });

  it('shows the server-sorted query page once the query is enabled and loaded', () => {
    const r = deriveQueryBackedData<Row>({
      ...base,
      queryEnabled: true,
      queryRows: queryPage,
      queryLoaded: true,
    });
    expect(r.data).toBe(queryPage);
    expect(r.loading).toBe(false);
    expect(r.loaded).toBe(true);
  });

  it('reports empty+loading before the first page applies (no live-snapshot fallback)', () => {
    const r = deriveQueryBackedData<Row>({
      ...base,
      queryEnabled: true,
      queryRows: [],
      queryLoaded: false,
    });
    expect(r.data).toEqual([]);
    expect(r.loading).toBe(true);
  });

  it('surfaces a query error (empty rows + error) so the controller bridges with cache', () => {
    const r = deriveQueryBackedData<Row>({
      ...base,
      queryEnabled: true,
      queryRows: [],
      queryLoaded: true,
      queryError: 'returned no data',
    });
    expect(r.data).toEqual([]);
    expect(r.error).toBe('returned no data');
  });

  it('stays quiet during refetches with rows visible (quiet filter refresh, no overlay)', () => {
    const r = deriveQueryBackedData<Row>({
      ...base,
      queryEnabled: true,
      queryRows: queryPage,
      queryLoaded: true,
    });
    expect(r.data).toBe(queryPage);
    expect(r.loading).toBe(false);
  });

  it('stays quiet while refetching a no-match result (filter input must stay mounted)', () => {
    const r = deriveQueryBackedData<Row>({
      ...base,
      queryEnabled: true,
      queryRows: [],
      queryLoaded: true,
    });
    expect(r.data).toEqual([]);
    expect(r.loading).toBe(false);
  });
});

describe('typedQueryPageLimitOrDefault', () => {
  it('keeps a persisted page size that is a real option', () => {
    expect(typedQueryPageLimitOrDefault(250, 100)).toBe(250);
  });

  it('falls back to the app default for missing or off-list page sizes', () => {
    expect(typedQueryPageLimitOrDefault(null, 100)).toBe(100);
    expect(typedQueryPageLimitOrDefault(undefined, 100)).toBe(100);
    expect(typedQueryPageLimitOrDefault(333, 100)).toBe(100);
  });
});
