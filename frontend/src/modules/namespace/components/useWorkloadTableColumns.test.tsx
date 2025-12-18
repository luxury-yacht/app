import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';

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
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  const workload: WorkloadData = {
    kind: 'Deployment',
    name: 'api',
    namespace: 'team-a',
    status: 'Running',
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
    const nameElement = nameColumn?.render(workload) as React.ReactElement<any>;
    nameElement.props.onClick?.({ stopPropagation() {} });
    expect(handleWorkloadClick).toHaveBeenCalledTimes(1);
    hook.cleanup();
  });
});
