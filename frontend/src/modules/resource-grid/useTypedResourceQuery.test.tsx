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

  it('marks missing query payloads as loaded so the table does not stay in an initial spinner', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready' },
    });

    await renderQuery();

    expect(result?.loading).toBe(false);
    expect(result?.loaded).toBe(true);
    expect(result?.error).toBe('All Namespaces Pods returned no data');
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

  it('flags user-initiated refetches (sort/filter) but not background live refetches', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    requestRefreshDomainStateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const Probe: React.FC<{ kinds: string[]; liveDataVersion: string }> = ({
      kinds,
      liveDataVersion,
    }) => {
      result = useTypedResourceQuery<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, kinds },
        sortConfig,
        liveDataVersion,
        selectRows,
      });
      return null;
    };
    const settle = async () => {
      await act(async () => {
        resolveFetch?.({ status: 'executed', data: { status: 'ready', data: { rows: [] } } });
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    // Mount: the initial fetch counts as a reset; it clears once settled.
    await act(async () => {
      root.render(<Probe kinds={[]} liveDataVersion="v1" />);
      await Promise.resolve();
    });
    await settle();
    expect(result?.resetPending).toBe(false);

    // A user filter change is a reset: pending until the fetch settles.
    await act(async () => {
      root.render(<Probe kinds={['Pod']} liveDataVersion="v1" />);
      await Promise.resolve();
    });
    expect(result?.resetPending).toBe(true);
    await settle();
    expect(result?.resetPending).toBe(false);

    // A background live invalidation refetches WITHOUT flagging a reset.
    await act(async () => {
      root.render(<Probe kinds={['Pod']} liveDataVersion="v2" />);
      await Promise.resolve();
    });
    expect(result?.loading).toBe(true);
    expect(result?.resetPending).toBe(false);
    await settle();
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

  it('marks blocked query requests as loaded so the table does not stay in an initial spinner', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    });

    await renderQuery();

    expect(result?.loading).toBe(false);
    expect(result?.loaded).toBe(true);
    expect(result?.error).toBe(
      'All Namespaces Pods could not load because auto-refresh is disabled'
    );
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

    expect(requestRefreshDomainStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.not.stringContaining('continue='),
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
