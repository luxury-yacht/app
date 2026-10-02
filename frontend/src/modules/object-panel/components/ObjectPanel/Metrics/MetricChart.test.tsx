/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricChart.test.tsx
 */

import { metrichistory } from '@core/backend-api/models';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installWindowProperty } from '@/test-utils/windowProperty';
import { MetricChart } from './MetricChart';

// jsdom has no layout; ResponsiveContainer renders nothing until it observes a size.
class SizedResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 400, height: 176 } } as unknown as ResizeObserverEntry],
      this
    );
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

const TIMES = [0, 1, 2, 3].map((index) => 1_790_891_640_000 + index * 15_000);

const cpu = (roles: metrichistory.SeriesRole[]): metrichistory.Graph => ({
  id: metrichistory.GraphID.GraphCPU,
  unit: metrichistory.Unit.UnitMillicores,
  status: metrichistory.GraphStatus.GraphStatusOK,
  series: roles.map((role) => ({ id: role, role, values: [10, null, 30, 25] })),
});

describe('MetricChart', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    restoreResizeObserver = installWindowProperty('ResizeObserver', SizedResizeObserver);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreResizeObserver();
  });

  const linesFor = async (graph: metrichistory.Graph) => {
    await act(async () => {
      root.render(<MetricChart graph={graph} times={TIMES} syncId="panel-1" />);
    });
    return container.querySelectorAll('.recharts-line').length;
  };

  it('draws exactly the series the source returned', async () => {
    const { RoleUsage, RoleRequest, RoleLimit } = metrichistory.SeriesRole;
    expect(await linesFor(cpu([RoleUsage, RoleRequest, RoleLimit]))).toBe(3);
    // No limit set: no limit line, rather than a line at zero.
    expect(await linesFor(cpu([RoleUsage]))).toBe(1);
  });
});
