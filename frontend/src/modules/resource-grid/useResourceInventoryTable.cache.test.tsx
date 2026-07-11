/**
 * frontend/src/modules/resource-grid/useResourceInventoryTable.cache.test.tsx
 *
 * The universal revisit-replay contract for every resource view: on first load
 * (no cache) the loading boundary shows; on a subsequent visit the controller
 * replays the previously-shown rows immediately — no spinner, no overlay — while
 * the live source refetches in the background. A settled-empty result, a blocked
 * source, and a different view key must NOT replay stale rows.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventBus } from '@/core/events';
import {
  type ResourceInventoryRenderState,
  type ResourceInventorySourceState,
  resetResourceInventoryRowCache,
  useResourceInventoryTable,
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

  it('keeps cached rows visible across a failed refetch (errors report via toasts)', () => {
    render(src({ cacheKey: 'view-k', rows: [{ name: 'n1' }], loaded: true }));
    // The refetch fails (e.g. revoked permissions). The bridged page stays
    // usable; the failure itself is reported through the refresh error toasts,
    // so the render state carries no error while cached rows are shown.
    render(src({ cacheKey: 'view-k', rows: [], loading: false, loaded: true, error: 'forbidden' }));
    expect(captured.current?.rows).toEqual([{ name: 'n1' }]);
    expect(captured.current?.error).toBeNull();
    expect(captured.current?.status).toBe('ready');

    // Recovery replaces the bridged page with live rows.
    render(src({ cacheKey: 'view-k', rows: [{ name: 'n1' }], loaded: true }));
    expect(captured.current?.error).toBeNull();
    expect(captured.current?.status).toBe('ready');
  });

  it('surfaces an error immediately when there are no rows to bridge', () => {
    // Cold-load failure with nothing cached: an honest error beats a false
    // "No data available".
    render(src({ cacheKey: 'view-k', rows: [], loading: false, loaded: true, error: 'forbidden' }));
    expect(captured.current?.error).toBe('forbidden');
    expect(captured.current?.status).toBe('error');
    expect(captured.current?.isEmpty).toBe(false);
  });

  it('evicts a cluster’s cached rows when that cluster is pruned', () => {
    render(
      src({ cacheKey: 'view-pods|cluster-a|namespace:all', rows: [{ name: 'n1' }], loaded: true })
    );
    remount();
    act(() => {
      eventBus.emit('refresh:cluster-pruned', { clusterId: 'cluster-a' });
    });
    render(src({ cacheKey: 'view-pods|cluster-a|namespace:all', rows: [], loading: true }));
    expect(captured.current?.rows).toEqual([]);
    expect(captured.current?.showLoadingBoundary).toBe(true);
  });

  it('keeps other clusters’ cached rows when one cluster is pruned', () => {
    render(
      src({ cacheKey: 'view-pods|cluster-b|namespace:all', rows: [{ name: 'nb' }], loaded: true })
    );
    remount();
    act(() => {
      eventBus.emit('refresh:cluster-pruned', { clusterId: 'cluster-a' });
    });
    render(src({ cacheKey: 'view-pods|cluster-b|namespace:all', rows: [], loading: true }));
    expect(captured.current?.rows).toEqual([{ name: 'nb' }]);
  });

  it('clears the whole cache when the kubeconfig is changing', () => {
    render(src({ cacheKey: 'view-k|cluster-a|', rows: [{ name: 'n1' }], loaded: true }));
    remount();
    act(() => {
      eventBus.emit('kubeconfig:changing', 'other-config');
    });
    render(src({ cacheKey: 'view-k|cluster-a|', rows: [], loading: true }));
    expect(captured.current?.rows).toEqual([]);
  });

  it('caps the cache and evicts the oldest view key', () => {
    // Fill the cache one past its cap; the first key written must fall out.
    for (let i = 0; i <= 64; i += 1) {
      render(src({ cacheKey: `view-${i}|c|`, rows: [{ name: `n${i}` }], loaded: true }));
    }
    remount();
    render(src({ cacheKey: 'view-0|c|', rows: [], loading: true }));
    expect(captured.current?.rows).toEqual([]);
    // A recent key is still cached.
    remount();
    render(src({ cacheKey: 'view-64|c|', rows: [], loading: true }));
    expect(captured.current?.rows).toEqual([{ name: 'n64' }]);
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
