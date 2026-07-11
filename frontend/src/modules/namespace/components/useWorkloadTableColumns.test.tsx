/**
 * frontend/src/modules/namespace/components/useWorkloadTableColumns.test.tsx
 *
 * Test suite for useWorkloadTableColumns.
 * Covers key behaviors and edge cases for useWorkloadTableColumns.
 */

import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { requireReactElement } from '@/test-utils/requireReactElement';

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';

const renderHook = <T,>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };

  const TestComponent: React.FC = () => {
    result.current = hook();
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    get() {
      if (result.current === undefined) {
        throw new Error('Hook result not set');
      }
      return result.current;
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useWorkloadTableColumns', () => {
  const workload: WorkloadData = {
    clusterId: 'cluster-a',
    kind: 'Deployment',
    name: 'api',
    namespace: 'team-a',
    status: 'Running',
    statusState: '1/1',
    statusPresentation: 'ready',
    ready: '1/1',
    restarts: 0,
    cpuUsage: '10m',
    memUsage: '20Mi',
    age: '5m',
  };

  it('returns columns with interactive kind and name handlers', () => {
    const handleWorkloadClick = vi.fn();
    const hook = renderHook(() =>
      useWorkloadTableColumns({
        handleWorkloadClick,
        showNamespaceColumn: true,
        useShortResourceNames: false,
        metrics: null,
      })
    );
    const columns = hook.get();

    const kindColumn = columns.find((column) => column.key === 'kind');
    expect(kindColumn).toBeDefined();
    kindColumn?.render(workload);
    const nameColumn = columns.find((column) => column.key === 'name');
    const nameElement = requireReactElement<{
      onClick?: (event: { stopPropagation: () => void }) => void;
    }>(nameColumn?.render(workload), 'expected workload name element');
    nameElement.props.onClick?.({ stopPropagation: () => undefined });
    expect(handleWorkloadClick).toHaveBeenCalledTimes(1);
    hook.cleanup();
  });

  it('uses backend statusPresentation for the status class', () => {
    const hook = renderHook(() =>
      useWorkloadTableColumns({
        handleWorkloadClick: vi.fn(),
        showNamespaceColumn: false,
        useShortResourceNames: false,
        metrics: null,
      })
    );
    const columns = hook.get();
    const statusColumn = columns.find((column) => column.key === 'status');
    const cell = statusColumn?.render({ ...workload, statusPresentation: 'warning' });
    expect(React.isValidElement(cell)).toBe(true);
    expect(
      requireReactElement<{ className?: string }>(cell, 'expected status element').props.className
    ).toBe('status-text warning');
    hook.cleanup();
  });

  it('does not use statusState as the status class fallback', () => {
    const hook = renderHook(() =>
      useWorkloadTableColumns({
        handleWorkloadClick: vi.fn(),
        showNamespaceColumn: false,
        useShortResourceNames: false,
        metrics: null,
      })
    );
    const columns = hook.get();
    const statusColumn = columns.find((column) => column.key === 'status');
    const cell = statusColumn?.render({
      ...workload,
      statusState: 'true',
      statusPresentation: undefined,
    });
    expect(React.isValidElement(cell)).toBe(true);
    expect(
      requireReactElement<{ className?: string }>(cell, 'expected status element').props.className
    ).toBe('status-text unknown');
    hook.cleanup();
  });
});
