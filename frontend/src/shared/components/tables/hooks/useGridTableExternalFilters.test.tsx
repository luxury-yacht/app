import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  requestGridTableFilters,
  setPendingGridTableFilterRequest,
  useGridTableExternalFilters,
} from './useGridTableExternalFilters';

const requestedFilters = {
  ...DEFAULT_GRID_TABLE_FILTER_STATE,
  kinds: { mode: 'some' as const, values: ['Pod'] },
  queryFacets: {
    findings: { mode: 'some' as const, values: ['restarts'] },
  },
};

function Harness({
  clusterId,
  hydrated,
  setFilters,
}: {
  clusterId: string;
  hydrated: boolean;
  setFilters: (filters: GridTableFilterState) => void;
}) {
  useGridTableExternalFilters({
    clusterId,
    destinationViewId: 'cluster-attention',
    persistence: { hydrated, setFilters },
  });
  return null;
}

describe('useGridTableExternalFilters', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    setPendingGridTableFilterRequest(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setPendingGridTableFilterRequest(null);
  });

  it('waits for the exact cluster and destination persistence to hydrate, then consumes once', async () => {
    const setFilters = vi.fn();
    requestGridTableFilters({
      clusterId: 'cluster-a',
      destinationViewId: 'cluster-attention',
      filters: requestedFilters,
    });

    await act(async () => {
      root.render(<Harness clusterId="cluster-b" hydrated setFilters={setFilters} />);
    });
    expect(setFilters).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Harness clusterId="cluster-a" hydrated={false} setFilters={setFilters} />);
    });
    expect(setFilters).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Harness clusterId="cluster-a" hydrated setFilters={setFilters} />);
    });
    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(setFilters).toHaveBeenCalledWith(requestedFilters);

    await act(async () => {
      root.render(<Harness clusterId="cluster-a" hydrated setFilters={setFilters} />);
    });
    expect(setFilters).toHaveBeenCalledTimes(1);
  });

  it('applies a matching request emitted while the destination is already mounted', async () => {
    const setFilters = vi.fn();
    await act(async () => {
      root.render(<Harness clusterId="cluster-a" hydrated setFilters={setFilters} />);
    });

    act(() => {
      requestGridTableFilters({
        clusterId: 'cluster-a',
        destinationViewId: 'cluster-attention',
        filters: requestedFilters,
      });
    });

    expect(setFilters).toHaveBeenCalledWith(requestedFilters);
  });
});
