/**
 * frontend/src/modules/resource-grid/useResourceInventoryTable.test.ts
 *
 * Lifecycle matrix for the resource-inventory controller. Exercises the pure
 * `deriveResourceInventoryRenderState` projection so every state a resource
 * table can be in — and especially the ones that produced the historical
 * transient "No X found" false-empty — is locked down without React.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveResourceInventoryRenderState,
  type ResourceInventorySourceState,
} from './useResourceInventoryTable';

interface Row {
  clusterId: string;
  name: string;
}

const row = (name: string): Row => ({ clusterId: 'cluster-a', name });

function source(
  overrides: Partial<ResourceInventorySourceState<Row>>
): ResourceInventorySourceState<Row> {
  return {
    rows: [],
    loading: false,
    loaded: false,
    error: null,
    completeness: 'complete',
    ...overrides,
  };
}

describe('deriveResourceInventoryRenderState', () => {
  it('initializing with no rows shows the loading boundary, not empty', () => {
    const render = deriveResourceInventoryRenderState(source({ loaded: false, loading: false }));
    expect(render.status).toBe('initializing');
    expect(render.showLoadingBoundary).toBe(true);
    expect(render.hasLoaded).toBe(false);
    expect(render.isEmpty).toBe(false);
    expect(render.showRefreshOverlay).toBe(false);
  });

  it('cold loading with no rows shows the loading boundary', () => {
    const render = deriveResourceInventoryRenderState(source({ loaded: false, loading: true }));
    expect(render.status).toBe('loading');
    expect(render.showLoadingBoundary).toBe(true);
    expect(render.isEmpty).toBe(false);
  });

  it('ready with rows renders the table with no boundary or overlay', () => {
    const render = deriveResourceInventoryRenderState(
      source({ rows: [row('a')], loaded: true, loading: false })
    );
    expect(render.status).toBe('ready');
    expect(render.showLoadingBoundary).toBe(false);
    expect(render.showRefreshOverlay).toBe(false);
    expect(render.isEmpty).toBe(false);
    expect(render.hasLoaded).toBe(true);
  });

  it('refreshing with rows shows the overlay, not the boundary', () => {
    const render = deriveResourceInventoryRenderState(
      source({ rows: [row('a')], loaded: true, loading: true })
    );
    expect(render.status).toBe('refreshing');
    expect(render.showRefreshOverlay).toBe(true);
    expect(render.showLoadingBoundary).toBe(false);
    expect(render.isEmpty).toBe(false);
  });

  it('refreshing with no rows shows the boundary and never flashes empty', () => {
    // A warm reload that momentarily returns nothing must not render "No X found".
    const render = deriveResourceInventoryRenderState(
      source({ rows: [], loaded: true, loading: true })
    );
    expect(render.status).toBe('loading');
    expect(render.showLoadingBoundary).toBe(true);
    expect(render.isEmpty).toBe(false);
  });

  it('settled empty is the only state that renders the empty message', () => {
    const render = deriveResourceInventoryRenderState(
      source({ rows: [], loaded: true, loading: false })
    );
    expect(render.status).toBe('empty');
    expect(render.isEmpty).toBe(true);
    expect(render.showLoadingBoundary).toBe(false);
    expect(render.showRefreshOverlay).toBe(false);
  });

  it('blocked is neither loading nor empty', () => {
    const render = deriveResourceInventoryRenderState(
      source({ rows: [], loaded: false, loading: false, blocked: true })
    );
    expect(render.status).toBe('blocked');
    expect(render.blocked).toBe(true);
    expect(render.isEmpty).toBe(false);
    expect(render.showLoadingBoundary).toBe(false);
  });

  it('error takes precedence over rows and loading', () => {
    const render = deriveResourceInventoryRenderState(
      source({ rows: [row('a')], loaded: true, loading: true, error: 'forbidden' })
    );
    expect(render.status).toBe('error');
    expect(render.error).toBe('forbidden');
    expect(render.isEmpty).toBe(false);
    expect(render.showRefreshOverlay).toBe(false);
  });

  it('error with no rows before any settlement still renders through the boundary', () => {
    // A cold-load failure can report loaded=false; the error surface must not
    // hide behind the boundary spinner.
    const render = deriveResourceInventoryRenderState(
      source({ rows: [], loaded: false, loading: false, error: 'forbidden' })
    );
    expect(render.status).toBe('error');
    expect(render.hasLoaded).toBe(true);
    expect(render.showLoadingBoundary).toBe(false);
    expect(render.isEmpty).toBe(false);
  });

  it('blocked takes precedence over an in-flight load but not over an error', () => {
    expect(
      deriveResourceInventoryRenderState(source({ loading: true, blocked: true })).status
    ).toBe('blocked');
    expect(
      deriveResourceInventoryRenderState(source({ blocked: true, error: 'boom' })).status
    ).toBe('error');
  });

  it('Local Partial surfaces the partial label and isPartial', () => {
    const render = deriveResourceInventoryRenderState(
      source({
        rows: [row('a')],
        loaded: true,
        completeness: 'partial',
        partialLabel: 'Showing most recent 500 of 9000',
      })
    );
    expect(render.isPartial).toBe(true);
    expect(render.partialLabel).toBe('Showing most recent 500 of 9000');
    expect(render.status).toBe('ready');
  });

  it('complete results never carry a partial label even if one is passed', () => {
    const render = deriveResourceInventoryRenderState(
      source({ rows: [row('a')], loaded: true, completeness: 'complete', partialLabel: 'ignored' })
    );
    expect(render.isPartial).toBe(false);
    expect(render.partialLabel).toBeNull();
  });
});
