/**
 * `deriveQueryBackedData` decides what a resource grid shows. The contract that
 * matters for the revisit sort bug: a query-backed table is NEVER sourced from the
 * live snapshot (`localData`) — that snapshot is unsorted client-side and
 * unpaginated, so showing it during the reload window made a revisit appear
 * unsorted until the server-sorted query reloaded. While the query is gating or in
 * flight it reports empty+loading so the controller bridges with the cached page.
 */
import { describe, expect, it } from 'vitest';

import { deriveQueryBackedData } from './useQueryBackedResourceGridTable';

interface Row {
  name: string;
}

const local: Row[] = [{ name: 'live-snapshot-row' }];
const queryPage: Row[] = [{ name: 'q1' }, { name: 'q2' }];

const base = {
  enabled: true,
  clusterId: 'c1',
  queryEnabled: false,
  queryRows: [] as Row[],
  queryLoading: false,
  queryLoaded: false,
  queryError: null as string | null,
  localData: local,
  localLoading: false,
  localLoaded: true,
  localError: null as string | null,
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

  it('reports empty+loading while the enabled query is in flight (no live-snapshot fallback)', () => {
    const r = deriveQueryBackedData<Row>({
      ...base,
      queryEnabled: true,
      queryRows: [],
      queryLoading: true,
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

  it('sources a non-query (local) table from localData unchanged', () => {
    const r = deriveQueryBackedData<Row>({
      ...base,
      enabled: false,
      localData: local,
      localLoading: false,
      localLoaded: true,
    });
    expect(r.data).toBe(local);
    expect(r.loaded).toBe(true);
  });
});
