/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricChart.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installWindowProperty } from '@/test-utils/windowProperty';
import { MetricChart } from './MetricChart';
import type { MetricGraph, MetricSeriesRole } from './metricsTabModel';

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

const cpu = (roles: MetricSeriesRole[]): MetricGraph => ({
  id: 'cpu',
  title: 'CPU',
  unit: 'millicores',
  hasData: true,
  series: roles.map((role) => ({ role, values: [10, null, 30, 25] })),
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

  const linesFor = async (graph: MetricGraph) => {
    await act(async () => {
      root.render(<MetricChart graph={graph} times={TIMES} syncId="panel-1" />);
    });
    return container.querySelectorAll('.recharts-line').length;
  };

  it('draws exactly the series the source returned', async () => {
    expect(await linesFor(cpu(['usage', 'request', 'limit']))).toBe(3);
    // A node also has an allocatable ceiling.
    expect(await linesFor(cpu(['usage', 'request', 'limit', 'allocatable']))).toBe(4);
    // No limit set: no limit line, rather than a line at zero.
    expect(await linesFor(cpu(['usage']))).toBe(1);
  });
});
