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
});
