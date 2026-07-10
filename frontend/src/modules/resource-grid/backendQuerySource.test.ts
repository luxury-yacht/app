/**
 * frontend/src/modules/resource-grid/backendQuerySource.test.ts
 *
 * Verifies the query-backed source normalizes typed/catalog query results into
 * the shared controller contract, and — critically — that it reproduces the
 * false-empty fix end-to-end through the controller WITHOUT any local-row
 * retention: a warm reload that momentarily returns nothing renders as loading,
 * and only a truly settled-empty query renders the empty state.
 */
import { describe, expect, it } from 'vitest';

import { type BackendQuerySourceInput, backendQuerySource } from './backendQuerySource';
import { deriveResourceInventoryRenderState } from './useResourceInventoryTable';

interface Row {
  clusterId: string;
  name: string;
}

function input(
  overrides: Partial<BackendQuerySourceInput<Row>> = {}
): BackendQuerySourceInput<Row> {
  return {
    enabled: true,
    rows: [],
    loading: false,
    loaded: false,
    error: null,
    ...overrides,
  };
}

describe('backendQuerySource', () => {
  it('treats a disabled query as blocked with no pagination', () => {
    const source = backendQuerySource(input({ enabled: false, loaded: true }));
    expect(source.blocked).toBe(true);
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
