import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import type { SortConfig } from '@hooks/useTableSort';
import { useTypedResourceQuery, type UseTypedResourceQueryResult } from './useTypedResourceQuery';
import type { TypedQueryPayload } from './typedResourceQueryScope';

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

const sortConfig = { key: 'name', direction: 'asc' } as const;
const selectRows = (payload: TestPayload) => payload.rows ?? [];

describe('useTypedResourceQuery', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let result: UseTypedResourceQueryResult<TestRow> | undefined;

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
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
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

  const renderPagedQuery = async (pageLimit = 2) => {
    const Probe: React.FC = () => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        pageLimit,
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

  it('keeps a missing query payload in the warm-up (not-loaded) state', async () => {
    // An executed refresh whose scoped state carries no payload yet means the
    // backend is still warming up. The hook stays not-loaded (the table keeps
    // its loading presentation) and the next live-data identity change retries
    // — no fabricated error.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready' },
    });

    await renderQuery();

    expect(result?.loaded).toBe(false);
    expect(result?.error).toBeNull();
  });

  it('fetchAllRows pages through the full result set following the cursor', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [] } },
    });
    await renderQuery();
    expect(result).toBeDefined();

    requestRefreshDomainStateMock.mockReset();
    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: { rows: [{ name: 'a' }, { name: 'b' }], continue: 'cursor-1' },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: { status: 'ready', data: { rows: [{ name: 'c' }] } },
      });

    let all: TestRow[] = [];
    await act(async () => {
      all = await result!.fetchAllRows();
    });

    expect(all.map((row) => row.name)).toEqual(['a', 'b', 'c']);
    expect(requestRefreshDomainStateMock).toHaveBeenCalledTimes(2);
  });

  it('fetchAllRows can walk an override query scope with custom filters and predicates', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [] } },
    });
    await renderQuery();
    expect(result).toBeDefined();

    requestRefreshDomainStateMock.mockReset();
    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: { rows: [{ name: 'api' }], continue: 'cursor-1' },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: { status: 'ready', data: { rows: [{ name: 'worker' }] } },
      });

    let all: TestRow[] = [];
    await act(async () => {
      all = await result!.fetchAllRows({
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          search: 'api',
          includeMetadata: true,
          namespaces: ['team-b', 'team-a'],
          kinds: ['Pod'],
        },
        sortConfig: { key: 'cpu', direction: 'desc' },
        pageLimit: 25,
        predicates: { owner: 'team-a/api|team-a/worker' },
        label: 'Pod Export',
      });
    });

    expect(all.map((row) => row.name)).toEqual(['api', 'worker']);
    expect(requestRefreshDomainStateMock).toHaveBeenCalledTimes(2);
    expect(requestRefreshDomainStateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        label: 'Pod Export',
        scope: expect.stringContaining('limit=25'),
      })
    );
    const firstScope = requestRefreshDomainStateMock.mock.calls[0][0].scope as string;
    expect(firstScope).toContain('search=api');
    expect(firstScope).toContain('includeMetadata=true');
    expect(firstScope).toContain('namespaces=team-a%2Cteam-b');
    expect(firstScope).toContain('kinds=Pod');
    expect(firstScope).toContain('sort=cpu');
    expect(firstScope).toContain('sortDirection=desc');
    expect(firstScope).toContain('predicate.owner=team-a%2Fapi%7Cteam-a%2Fworker');
    const secondScope = requestRefreshDomainStateMock.mock.calls[1][0].scope as string;
    expect(secondScope).toContain('continue=cursor-1');
  });

  it('rolls back a failed page navigation so the cursor, buttons, and retry stay usable', async () => {
    // Page 1 with a next cursor.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: { rows: [{ name: 'a' }, { name: 'b' }], continue: 'cursor-2', total: 3 },
      },
    });
    await renderPagedQuery();
    expect(result?.rows).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(result?.continueToken).toBe('cursor-2');
    const pageOneScope = requestRefreshDomainStateMock.mock.calls[0][0].scope as string;

    // The page-2 fetch fails; the rollback refetch of page 1 succeeds.
    requestRefreshDomainStateMock.mockReset();
    requestRefreshDomainStateMock
      .mockRejectedValueOnce(new Error('page fetch failed'))
      .mockResolvedValue({
        status: 'executed',
        data: {
          status: 'ready',
          data: { rows: [{ name: 'a' }, { name: 'b' }], continue: 'cursor-2', total: 3 },
        },
      });

    await act(async () => {
      result!.loadMore();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Let the rollback-triggered refetch settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The failure must not advance the page or latch the pagination buttons.
    expect(result?.pageIndex).toBe(1);
    expect(result?.isRequestingMore).toBe(false);

    // The failed cursor must not leak into later refetches: the rollback
    // refetch reuses the page-1 scope, not the failed page-2 cursor.
    const calls = requestRefreshDomainStateMock.mock.calls;
    const lastScope = calls[calls.length - 1][0].scope as string;
    expect(lastScope).toBe(pageOneScope);

    // Retry issues a REAL page-2 fetch (the latch bug made this a no-op with
    // isRequestingMore stuck true).
    requestRefreshDomainStateMock.mockClear();
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [{ name: 'c' }], total: 3 } },
    });
    await act(async () => {
      result!.loadMore();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestRefreshDomainStateMock).toHaveBeenCalled();
    const retryCalls = requestRefreshDomainStateMock.mock.calls;
    expect((retryCalls[retryCalls.length - 1][0].scope as string).includes('cursor-2')).toBe(true);
    expect(result?.rows).toEqual([{ name: 'c' }]);
    expect(result?.pageIndex).toBe(2);
    expect(result?.isRequestingMore).toBe(false);
  });

  it('exposes the backend-published kind vocabulary and keeps it across filter refetches', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    requestRefreshDomainStateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const Probe: React.FC<{ kinds: string[] }> = ({ kinds }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, kinds },
        sortConfig,
        selectRows,
      });
      return null;
    };
    const settle = async (payload: TestPayload) => {
      await act(async () => {
        resolveFetch?.({ status: 'executed', data: { status: 'ready', data: payload } });
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await act(async () => {
      root.render(<Probe kinds={[]} />);
      await Promise.resolve();
    });
    // No payload applied yet — no vocabulary.
    expect(result?.kindVocabulary).toBeNull();

    await settle({
      rows: [{ name: 'pod-a' }],
      kinds: ['Pod', 'Deployment'],
      capabilities: { kindVocabulary: ['Pod', 'Deployment', 'StatefulSet'] },
    });
    expect(result?.kindVocabulary).toEqual(['Pod', 'Deployment', 'StatefulSet']);

    // A kind filter collapses the FACETS but the vocabulary rides the payload
    // capabilities and stays complete.
    await act(async () => {
      root.render(<Probe kinds={['Pod']} />);
      await Promise.resolve();
    });
    await settle({
      rows: [{ name: 'pod-a' }],
      kinds: ['Pod'],
      capabilities: { kindVocabulary: ['Pod', 'Deployment', 'StatefulSet'] },
    });
    expect(result?.kindVocabulary).toEqual(['Pod', 'Deployment', 'StatefulSet']);
  });

  it('treats blocked and payload-less results as warm-up, not failures', async () => {
    // First request: blocked (e.g., cluster still connecting). The hook must
    // stay in the not-loaded (loading) state — no fabricated error — so the
    // table keeps its spinner instead of flashing "Unable to load data".
    requestRefreshDomainStateMock.mockResolvedValueOnce({ status: 'blocked' });

    const Probe: React.FC<{ liveDataVersion: string }> = ({ liveDataVersion }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Cluster Events',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        liveDataVersion,
        selectRows,
      });
      return null;
    };

    await act(async () => {
      root.render(<Probe liveDataVersion="v1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.error).toBeNull();
    expect(result?.loaded).toBe(false);

    // Second request: executed but the scoped state carries no payload yet
    // (backend caches still syncing). Same treatment.
    requestRefreshDomainStateMock.mockResolvedValueOnce({
      status: 'executed',
      data: { status: 'ready', data: null },
    });
    await act(async () => {
      root.render(<Probe liveDataVersion="v2" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.error).toBeNull();
    expect(result?.loaded).toBe(false);

    // The live domain delivers → identity change → the retry succeeds.
    requestRefreshDomainStateMock.mockResolvedValueOnce({
      status: 'executed',
      data: { status: 'ready', data: { rows: [{ name: 'event-a' }] } },
    });
    await act(async () => {
      root.render(<Probe liveDataVersion="v3" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.rows).toEqual([{ name: 'event-a' }]);
    expect(result?.loaded).toBe(true);
    expect(result?.error).toBeNull();
  });

  it('self-heals a warm-up result without waiting for a live-data identity change', async () => {
    // The first request warms up (executed but no payload yet — backend caches
    // still syncing on the very first view). For an EMPTY domain the live-data
    // identity is a constant (no rows ⇒ version 0, checksum stable), so the
    // identity-driven retry can never fire. The hook must retry the warm-up on
    // its own and settle once the backend is ready, instead of spinning forever.
    requestRefreshDomainStateMock
      .mockResolvedValueOnce({ status: 'executed', data: { status: 'ready', data: null } })
      .mockResolvedValue({ status: 'executed', data: { status: 'ready', data: { rows: [] } } });

    const Probe: React.FC = () => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'namespace-storage',
        label: 'Namespace Storage',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        // Constant across the whole test — the empty-domain identity never moves.
        liveDataVersion: '0::',
        selectRows,
      });
      return null;
    };

    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<Probe />);
        await Promise.resolve();
        await Promise.resolve();
      });

      // Warm-up: not loaded yet, no fabricated error, still showing the spinner.
      expect(result?.loaded).toBe(false);
      expect(result?.error).toBeNull();
      expect(requestRefreshDomainStateMock).toHaveBeenCalledTimes(1);

      // Without any live-data identity change, the warm-up retry fires and the
      // now-ready (empty) payload settles the table — no infinite spinner.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(requestRefreshDomainStateMock.mock.calls.length).toBeGreaterThan(1);
      expect(result?.loaded).toBe(true);
      expect(result?.rows).toEqual([]);
      expect(result?.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the warm-up retry once the query has loaded (no refetch storm)', async () => {
    // Once a payload applies, the self-healing retry must go quiet: a loaded
    // table must not keep re-issuing the query on a timer.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [{ name: 'pvc-a' }] } },
    });

    const Probe: React.FC = () => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'namespace-storage',
        label: 'Namespace Storage',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        liveDataVersion: 'v1',
        selectRows,
      });
      return null;
    };

    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<Probe />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result?.loaded).toBe(true);
      const callsAfterLoad = requestRefreshDomainStateMock.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      // No additional requests fired after the load settled.
      expect(requestRefreshDomainStateMock.mock.calls.length).toBe(callsAfterLoad);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a thrown fetch failure as a real error', async () => {
    requestRefreshDomainStateMock.mockRejectedValueOnce(new Error('cluster gone'));

    const Probe: React.FC = () => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Cluster Events',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        selectRows,
      });
      return null;
    };

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.error).toBe('cluster gone');
    expect(result?.loaded).toBe(true);
  });

  it('keeps the applied rows and loaded state during user filter refetches (quiet refresh)', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    requestRefreshDomainStateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const Probe: React.FC<{ kinds: string[] }> = ({ kinds }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, kinds },
        sortConfig,
        liveDataVersion: 'v1',
        selectRows,
      });
      return null;
    };
    const settle = async (rows: TestRow[]) => {
      await act(async () => {
        resolveFetch?.({ status: 'executed', data: { status: 'ready', data: { rows } } });
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await act(async () => {
      root.render(<Probe kinds={[]} />);
      await Promise.resolve();
    });
    await settle([{ name: 'pod-a' }]);
    expect(result?.rows).toEqual([{ name: 'pod-a' }]);
    expect(result?.loaded).toBe(true);

    // A filter change refetches QUIETLY: the applied rows and loaded state
    // survive until the new page lands, so the table never dims or swaps to a
    // spinner mid-filtering.
    await act(async () => {
      root.render(<Probe kinds={['Pod']} />);
      await Promise.resolve();
    });
    expect(result?.rows).toEqual([{ name: 'pod-a' }]);
    expect(result?.loaded).toBe(true);

    // A no-match result settles to empty rows but STAYS loaded — the next
    // keystroke's refetch must not re-enter the initial-loading state (that
    // unmounts the filter input and steals focus).
    await settle([]);
    expect(result?.rows).toEqual([]);
    expect(result?.loaded).toBe(true);

    await act(async () => {
      root.render(<Probe kinds={['Pod', 'Job']} />);
      await Promise.resolve();
    });
    expect(result?.loaded).toBe(true);
    await settle([]);
  });

  it('debounces search changes instead of querying on every keystroke', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [], total: 0 } },
    });

    const Probe: React.FC<{ search: string }> = ({ search }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, search },
        sortConfig,
        selectRows,
      });
      return null;
    };

    await act(async () => {
      root.render(<Probe search="" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestRefreshDomainStateMock).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      // Two quick keystrokes: no new backend build until the debounce elapses.
      await act(async () => {
        root.render(<Probe search="a" />);
      });
      await act(async () => {
        root.render(<Probe search="ap" />);
      });
      expect(requestRefreshDomainStateMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(requestRefreshDomainStateMock).toHaveBeenCalledTimes(2);
      const calls = requestRefreshDomainStateMock.mock.calls;
      expect(calls[calls.length - 1][0].scope as string).toContain('search=ap');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetchAllRows rejects when a page fails instead of returning a partial result', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [] } },
    });
    await renderQuery();

    requestRefreshDomainStateMock.mockReset();
    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: { status: 'ready', data: { rows: [{ name: 'a' }], continue: 'cursor-1' } },
      })
      .mockResolvedValueOnce({ status: 'blocked', blockedReason: 'auto-refresh-disabled' });

    // A partial export saved with a success toast is worse than an error: the
    // walk must reject so the action surfaces the failure.
    await expect(result!.fetchAllRows()).rejects.toThrow(/page 2/);
  });

  it('treats a payload with rows but no total as approximate instead of an exact 0', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [{ name: 'a' }, { name: 'b' }] } },
    });

    await renderQuery();

    // total is absent on the payload: it must not render as a false exact 0
    // while two rows are visible. Fall back to the visible count, marked
    // approximate so the UI does not claim "Page N of M".
    expect(result?.totalCount).toBe(2);
    expect(result?.totalIsExact).toBe(false);
  });

  it('marks failed query requests as loaded so the error can render instead of a spinner', async () => {
    requestRefreshDomainStateMock.mockRejectedValue(new Error('query failed'));

    await renderQuery();

    expect(result?.loading).toBe(false);
    expect(result?.loaded).toBe(true);
    expect(result?.error).toBe('query failed');
  });

  it('uses one-shot refresh reads for table queries so query scopes are cleaned up', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [] } },
    });

    await renderQuery();

    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'user', cleanup: true, preserveState: false })
    );
  });

  it('reloads the current query when live refresh data changes', async () => {
    const Probe: React.FC<{ liveDataVersion: string }> = ({ liveDataVersion }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        liveDataVersion,
        selectRows,
      });
      return null;
    };
    const renderInvalidatedQuery = async (liveDataVersion: string) => {
      await act(async () => {
        root.render(<Probe liveDataVersion={liveDataVersion} />);
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-a' }],
            total: 1,
            totalIsExact: true,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-b' }],
            total: 1,
            totalIsExact: true,
          },
        },
      });

    await renderInvalidatedQuery('version-1');
    expect(result?.rows).toEqual([{ name: 'pod-a' }]);

    await renderInvalidatedQuery('version-2');

    expect(requestRefreshDomainStateMock).toHaveBeenCalledTimes(2);
    expect(requestRefreshDomainStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
      })
    );
    expect(result?.rows).toEqual([{ name: 'pod-b' }]);
  });

  it('keeps the current rows visible while live refresh invalidation refetches', async () => {
    let resolveSecondRequest:
      | ((value: {
          status: 'executed';
          data: { status: 'ready'; data: { rows: TestRow[]; total: number } };
        }) => void)
      | undefined;
    const secondRequest = new Promise<{
      status: 'executed';
      data: { status: 'ready'; data: { rows: TestRow[]; total: number } };
    }>((resolve) => {
      resolveSecondRequest = resolve;
    });
    const Probe: React.FC<{ liveDataVersion: string }> = ({ liveDataVersion }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        liveDataVersion,
        selectRows,
      });
      return null;
    };

    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-a' }],
            total: 1,
          },
        },
      })
      .mockReturnValueOnce(secondRequest);

    await act(async () => {
      root.render(<Probe liveDataVersion="version-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result?.rows).toEqual([{ name: 'pod-a' }]);
    expect(result?.loading).toBe(false);

    await act(async () => {
      root.render(<Probe liveDataVersion="version-2" />);
      await Promise.resolve();
    });

    expect(result?.rows).toEqual([{ name: 'pod-a' }]);
    expect(result?.loading).toBe(true);

    await act(async () => {
      resolveSecondRequest?.({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-b' }],
            total: 1,
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result?.loading).toBe(false);
    expect(result?.rows).toEqual([{ name: 'pod-b' }]);
  });

  it('never commits the previous cluster rows after a cluster switch (no cross-cluster flash)', async () => {
    // Multi-cluster correctness: switching the active cluster must NOT paint the
    // prior cluster's rows under the new cluster, even for one frame. Cluster A
    // settles with rows; cluster B is held in flight so the ONLY way pod-a could
    // appear under cluster-b is the stale in-flight `rows` state surviving the
    // switch. We record every COMMITTED frame via a layout effect (which never
    // fires for a render React discards) and assert no committed cluster-b frame
    // carries cluster-a's rows.
    requestRefreshDomainStateMock.mockImplementation((request: { scope?: string }) => {
      if (typeof request?.scope === 'string' && request.scope.startsWith('cluster-a')) {
        return Promise.resolve({
          status: 'executed',
          data: { status: 'ready', data: { rows: [{ name: 'pod-a' }] } },
        });
      }
      // cluster-b: keep the fetch in flight so no cluster-b rows ever arrive.
      return new Promise(() => {});
    });

    const committed: Array<{ clusterId: string; rows: TestRow[] }> = [];
    const Probe: React.FC<{ clusterId: string }> = ({ clusterId }) => {
      const query = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId,
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        liveDataVersion: 'v1',
        selectRows,
      });
      result = query;
      React.useLayoutEffect(() => {
        committed.push({ clusterId, rows: query.rows });
      });
      return null;
    };

    await act(async () => {
      root.render(<Probe clusterId="cluster-a" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.rows).toEqual([{ name: 'pod-a' }]);

    // Ignore cluster-a's own committed frames; only what commits under cluster-b matters.
    committed.length = 0;

    await act(async () => {
      root.render(<Probe clusterId="cluster-b" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const leakedFrames = committed.filter(
      (frame) => frame.clusterId === 'cluster-b' && frame.rows.some((row) => row.name === 'pod-a')
    );
    expect(leakedFrames).toEqual([]);
  });

  it('keeps a blocked query request in the warm-up (not-loaded) state', async () => {
    // Blocked refreshes (auto-refresh paused, cluster still connecting) are
    // warm-up conditions, not failures. With auto-refresh paused the table's
    // boundary renders the paused empty state; otherwise the loading state
    // holds until the live domain delivers and the query retries.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    });

    await renderQuery();

    expect(result?.loaded).toBe(false);
    expect(result?.error).toBeNull();
  });

  it('tracks cursor-backed next and previous pages without exposing random page jumps', async () => {
    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-a' }, { name: 'pod-b' }],
            total: 3,
            totalIsExact: true,
            continue: 'cursor-page-2',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-c' }],
            total: 3,
            totalIsExact: true,
            // Backend-minted prev cursor (F5): populated on every response —
            // the hook keeps no client token stack.
            previous: 'cursor-page-1-prev',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-a' }, { name: 'pod-b' }],
            total: 3,
            totalIsExact: true,
            continue: 'cursor-page-2',
          },
        },
      });

    await renderPagedQuery();

    expect(result?.pageIndex).toBe(1);
    expect(result?.pageSize).toBe(2);
    expect(result?.totalCount).toBe(3);
    expect(result?.totalIsExact).toBe(true);
    expect(result?.continueToken).toBe('cursor-page-2');
    expect(result?.hasPrevious).toBe(false);

    await act(async () => {
      result?.loadMore();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestRefreshDomainStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.stringContaining('continue=cursor-page-2'),
      })
    );
    expect(result?.rows).toEqual([{ name: 'pod-c' }]);
    expect(result?.pageIndex).toBe(2);
    expect(result?.hasPrevious).toBe(true);

    await act(async () => {
      result?.loadPrevious();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Backward paging rides the BACKEND prev cursor, not a client stack.
    expect(requestRefreshDomainStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.stringContaining('continue=cursor-page-1-prev'),
      })
    );
    expect(result?.rows).toEqual([{ name: 'pod-a' }, { name: 'pod-b' }]);
    expect(result?.pageIndex).toBe(1);
    expect(result?.hasPrevious).toBe(false);
  });

  it('refetches the current cursor page when live refresh data changes', async () => {
    const Probe: React.FC<{ liveDataVersion: string }> = ({ liveDataVersion }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig,
        pageLimit: 2,
        liveDataVersion,
        selectRows,
      });
      return null;
    };

    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-a' }, { name: 'pod-b' }],
            total: 4,
            continue: 'cursor-page-2',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-c' }, { name: 'pod-d' }],
            total: 4,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-c-fresh' }, { name: 'pod-d-fresh' }],
            total: 4,
          },
        },
      });

    await act(async () => {
      root.render(<Probe liveDataVersion="version-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      result?.loadMore();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result?.pageIndex).toBe(2);
    expect(result?.rows).toEqual([{ name: 'pod-c' }, { name: 'pod-d' }]);

    await act(async () => {
      root.render(<Probe liveDataVersion="version-2" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestRefreshDomainStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.stringContaining('continue=cursor-page-2'),
      })
    );
    expect(result?.pageIndex).toBe(2);
    expect(result?.rows).toEqual([{ name: 'pod-c-fresh' }, { name: 'pod-d-fresh' }]);
  });

  it('drops the current cursor before requesting a changed sort query', async () => {
    const Probe: React.FC<{ activeSort: SortConfig }> = ({ activeSort }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        sortConfig: activeSort,
        pageLimit: 2,
        selectRows,
      });
      return null;
    };

    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-a' }, { name: 'pod-b' }],
            total: 3,
            continue: 'cursor-page-2',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-c' }],
            total: 3,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-status-a' }, { name: 'pod-status-b' }],
            total: 3,
            continue: 'status-cursor-page-2',
          },
        },
      });

    await act(async () => {
      root.render(<Probe activeSort={sortConfig} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      result?.loadMore();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestRefreshDomainStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.stringContaining('continue=cursor-page-2'),
      })
    );

    await act(async () => {
      root.render(<Probe activeSort={{ key: 'status', direction: 'asc' }} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestRefreshDomainStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.stringMatching(
          /^cluster-a\|namespace:all\?limit=2&sort=status&sortDirection=asc$/
        ),
      })
    );
    expect(result?.pageIndex).toBe(1);
    expect(result?.rows).toEqual([{ name: 'pod-status-a' }, { name: 'pod-status-b' }]);
  });

  it('resets cursor pagination when the backend reports an invalid cursor', async () => {
    requestRefreshDomainStateMock
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [{ name: 'pod-a' }],
            total: 2,
            continue: 'stale-cursor',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            cursorInvalid: true,
          },
        },
      });

    await renderPagedQuery();

    await act(async () => {
      result?.loadMore();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result?.continueToken).toBe(null);
    expect(result?.pageIndex).toBe(1);
    expect(result?.hasPrevious).toBe(false);
  });
});
