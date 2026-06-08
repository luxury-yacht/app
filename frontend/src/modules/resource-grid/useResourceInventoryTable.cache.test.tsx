/**
 * frontend/src/modules/resource-grid/useResourceInventoryTable.cache.test.tsx
 *
 * The universal revisit-replay contract for every resource view: on first load
 * (no cache) the loading boundary shows; on a subsequent visit the controller
 * replays the previously-shown rows immediately — no spinner, no overlay — while
 * the live source refetches in the background. A settled-empty result, a blocked
 * source, and a different view key must NOT replay stale rows.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  resetResourceInventoryRowCache,
  useResourceInventoryTable,
  type ResourceInventoryRenderState,
  type ResourceInventorySourceState,
} from './useResourceInventoryTable';

interface Row {
  name: string;
}

const captured: { current: ResourceInventoryRenderState<Row> | null } = { current: null };
let container: HTMLDivElement;
let root: ReactDOM.Root;

function Probe({ source }: { source: ResourceInventorySourceState<Row> }) {
  captured.current = useResourceInventoryTable(source);
  return null;
}

const src = (o: Partial<ResourceInventorySourceState<Row>>): ResourceInventorySourceState<Row> => ({
  rows: [],
  loading: false,
  loaded: false,
  error: null,
  completeness: 'complete',
  ...o,
});

const render = (source: ResourceInventorySourceState<Row>) => {
  act(() => {
    root.render(<Probe source={source} />);
  });
};

const remount = () => {
  act(() => {
    root.unmount();
  });
  root = ReactDOM.createRoot(container);
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
  captured.current = null;
  resetResourceInventoryRowCache();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('useResourceInventoryTable revisit replay cache', () => {
  it('shows the loading boundary on first load when nothing is cached', () => {
    render(src({ cacheKey: 'view-k', loading: true }));
    expect(captured.current?.showLoadingBoundary).toBe(true);
    expect(captured.current?.rows).toEqual([]);
  });

  it('replays the last rows on revisit with no spinner and no overlay', () => {
    // First visit: rows are shown → cached.
    render(src({ cacheKey: 'view-k', rows: [{ name: 'n1' }], loaded: true }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);

    remount();

    // Revisit: the live source is briefly empty while the first page is in flight.
    render(src({ cacheKey: 'view-k', rows: [], loading: true, loaded: false }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);
    expect(captured.current?.showLoadingBoundary).toBe(false);
    expect(captured.current?.showRefreshOverlay).toBe(false);
  });

  it('does not replay one view’s rows under a different view key', () => {
    render(src({ cacheKey: 'view-a', rows: [{ name: 'a' }], loaded: true }));
    remount();
    render(src({ cacheKey: 'view-b', rows: [], loading: true }));
    expect(captured.current?.rows).toEqual([]);
    expect(captured.current?.showLoadingBoundary).toBe(true);
  });

  it('shows an in-place empty once a fetch settles successfully with zero rows', () => {
    // A real fetch runs and returns rows (cache populated)...
    render(src({ cacheKey: 'view-k', rows: [], loading: true, loaded: false }));
    render(src({ cacheKey: 'view-k', rows: [{ name: 'n1' }], loading: false, loaded: true }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);
    // ...then a filter narrows it to nothing — a successful settled empty, which
    // must show through, not resurrect the cached rows.
    render(src({ cacheKey: 'view-k', rows: [], loading: false, loaded: true }));
    expect(captured.current?.rows).toEqual([]);
    expect(captured.current?.isEmpty).toBe(true);
  });

  it('keeps the last rows through a transient refetch error instead of blanking', () => {
    // The real flash (from the live diagnostic): a background refetch transiently
    // errors ("returned no data") before succeeding. The table must NOT blank.
    render(src({ cacheKey: 'view-k', rows: [], loading: true, loaded: false }));
    render(src({ cacheKey: 'view-k', rows: [{ name: 'n1' }], loading: false, loaded: true }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);
    // Refetch starts (empty + loading) → bridged.
    render(src({ cacheKey: 'view-k', rows: [], loading: true, loaded: false }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);
    // Refetch errors transiently (empty + error) → still bridged, no "no data".
    render(
      src({ cacheKey: 'view-k', rows: [], loading: false, loaded: true, error: 'returned no data' })
    );
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);
    expect(captured.current?.isEmpty).toBe(false);
    expect(captured.current?.showLoadingBoundary).toBe(false);
    // Retry succeeds → live rows replace the bridged page.
    render(src({ cacheKey: 'view-k', rows: [{ name: 'n1' }, { name: 'n2' }], loaded: true }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }, { name: 'n2' }]);
  });

  it('shows empty once a REAL fetch settles empty, and clears the cache', () => {
    render(src({ cacheKey: 'view-k', rows: [{ name: 'n1' }], loaded: true }));
    remount();
    // Revisit: fetch in flight → bridged with the cached page.
    render(src({ cacheKey: 'view-k', rows: [], loading: true, loaded: false }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);
    // That fetch settles empty → the view genuinely has no rows; show empty.
    render(src({ cacheKey: 'view-k', rows: [], loading: false, loaded: true }));
    expect(captured.current?.isEmpty).toBe(true);
    expect(captured.current?.rows).toEqual([]);

    // And the cache was cleared, so the next revisit does not resurrect them.
    remount();
    render(src({ cacheKey: 'view-k', rows: [], loading: true, loaded: false }));
    expect(captured.current?.rows).toEqual([]);
  });
});
