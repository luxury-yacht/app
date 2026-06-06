/**
 * frontend/src/modules/resource-grid/boundedRowsSource.test.ts
 *
 * Verifies the bounded source normalizes local row arrays into the shared
 * controller contract: complete bounded data is exact (no partial label, no
 * pagination), and capped/windowed data is partial with an explaining label.
 */
import { describe, expect, it } from 'vitest';

import { boundedRowsSource } from './boundedRowsSource';
import { deriveResourceInventoryRenderState } from './useResourceInventoryTable';

interface Row {
  clusterId: string;
  name: string;
}

const rows: Row[] = [
  { clusterId: 'cluster-a', name: 'a' },
  { clusterId: 'cluster-a', name: 'b' },
];

describe('boundedRowsSource', () => {
  it('treats Local Complete as the complete matching set with no pagination', () => {
    const source = boundedRowsSource({ rows, mode: 'Local Complete' });
    expect(source.completeness).toBe('complete');
    expect(source.partialLabel).toBeNull();
    expect(source.pagination).toBeNull();
    expect(source.loaded).toBe(true);
    expect(source.loading).toBe(false);

    const render = deriveResourceInventoryRenderState(source);
    expect(render.status).toBe('ready');
    expect(render.isPartial).toBe(false);
  });

  it('defaults to Local Complete when no mode is given', () => {
    expect(boundedRowsSource({ rows }).completeness).toBe('complete');
  });

  it('treats Local Partial as a capped view carrying its window label', () => {
    const source = boundedRowsSource({
      rows,
      mode: 'Local Partial',
      partialLabel: 'Bounded local snapshot (most recent 200)',
    });
    expect(source.completeness).toBe('partial');
    expect(source.partialLabel).toBe('Bounded local snapshot (most recent 200)');
    expect(source.pagination).toBeNull();

    const render = deriveResourceInventoryRenderState(source);
    expect(render.isPartial).toBe(true);
    expect(render.partialLabel).toBe('Bounded local snapshot (most recent 200)');
  });

  it('renders an empty bounded array as settled empty, not loading', () => {
    const render = deriveResourceInventoryRenderState(boundedRowsSource({ rows: [] }));
    expect(render.status).toBe('empty');
    expect(render.isEmpty).toBe(true);
    expect(render.showLoadingBoundary).toBe(false);
  });

  it('surfaces a still-filling bounded array as loading until loaded', () => {
    const render = deriveResourceInventoryRenderState(
      boundedRowsSource({ rows: [], loading: true, loaded: false })
    );
    expect(render.status).toBe('loading');
    expect(render.showLoadingBoundary).toBe(true);
    expect(render.isEmpty).toBe(false);
  });

  it('propagates blocked and error states', () => {
    expect(boundedRowsSource({ rows: [], blocked: true }).blocked).toBe(true);
    expect(boundedRowsSource({ rows: [], error: 'nope' }).error).toBe('nope');
  });
});
