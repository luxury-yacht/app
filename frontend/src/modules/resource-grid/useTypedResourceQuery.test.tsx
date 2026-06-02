import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
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

  it('marks failed query requests as loaded so the error can render instead of a spinner', async () => {
    requestRefreshDomainStateMock.mockRejectedValue(new Error('query failed'));

    await renderQuery();

    expect(result?.loading).toBe(false);
    expect(result?.loaded).toBe(true);
    expect(result?.error).toBe('query failed');
  });

  it('uses a user-visible request reason for table queries', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { rows: [] } },
    });

    await renderQuery();

    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'user' })
    );
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
