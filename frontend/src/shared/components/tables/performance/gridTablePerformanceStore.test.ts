import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getGridTablePerformanceSnapshot,
  recordGridTablePerformanceSample,
  recordGridTablePerformanceSnapshot,
  resetGridTablePerformanceDiagnostics,
  subscribeGridTablePerformance,
} from './gridTablePerformanceStore';

describe('gridTablePerformanceStore', () => {
  afterEach(() => {
    resetGridTablePerformanceDiagnostics();
  });

  it('records rolling timing samples and snapshot counts by label', () => {
    recordGridTablePerformanceSnapshot('All Namespaces Pods', {
      inputRows: 5000,
      sourceRows: 1000,
      displayedRows: 800,
      inputReferenceChanged: true,
    });
    recordGridTablePerformanceSample('All Namespaces Pods', 'filterOptions', 1.25);
    recordGridTablePerformanceSample('All Namespaces Pods', 'filterOptions', 2.75);
    recordGridTablePerformanceSample('All Namespaces Pods', 'filterPass', 3.5);
    recordGridTablePerformanceSample('All Namespaces Pods', 'sort', 4.5);
    recordGridTablePerformanceSample('All Namespaces Pods', 'render', 5.5, {
      renderPhase: 'update',
    });

    const [entry] = getGridTablePerformanceSnapshot();

    expect(entry.label).toBe('All Namespaces Pods');
    expect(entry.mode).toBe('local');
    expect(entry.updates).toBe(1);
    expect(entry.inputReferenceChanges).toBe(1);
    expect(entry.inputRows).toBe(5000);
    expect(entry.sourceRows).toBe(1000);
    expect(entry.displayedRows).toBe(800);
    expect(entry.filterOptions.samples).toBe(2);
    expect(entry.filterOptions.averageMs).toBe(2);
    expect(entry.filterOptions.maxMs).toBe(2.75);
    expect(entry.filterPass.latestMs).toBe(3.5);
    expect(entry.sort.latestMs).toBe(4.5);
    expect(entry.render.latestMs).toBe(5.5);
    expect(entry.lastRenderPhase).toBe('update');
  });

  it('records explicit diagnostics mode labels with the snapshot', () => {
    recordGridTablePerformanceSnapshot('All Namespaces Browse', {
      mode: 'query',
      inputRows: 25,
      sourceRows: 25,
      displayedRows: 25,
      inputReferenceChanged: false,
    });

    const [entry] = getGridTablePerformanceSnapshot();

    expect(entry.label).toBe('All Namespaces Browse');
    expect(entry.mode).toBe('query');
  });

  it('keeps entries sorted by label', () => {
    recordGridTablePerformanceSnapshot('Namespace Pods', {
      inputRows: 10,
      sourceRows: 10,
      displayedRows: 10,
      inputReferenceChanged: false,
    });
    recordGridTablePerformanceSnapshot('All Namespaces Pods', {
      inputRows: 10,
      sourceRows: 10,
      displayedRows: 10,
      inputReferenceChanged: false,
    });

    expect(getGridTablePerformanceSnapshot().map((entry) => entry.label)).toEqual([
      'All Namespaces Pods',
      'Namespace Pods',
    ]);
  });

  it('notifies subscribers asynchronously and coalesces bursts', async () => {
    vi.useFakeTimers();
    const originalRaf = globalThis.window?.requestAnimationFrame;
    if (globalThis.window) {
      globalThis.window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
        setTimeout(() => callback(0), 0)) as unknown as typeof window.requestAnimationFrame;
    }
    const listener = vi.fn();
    const unsubscribe = subscribeGridTablePerformance(listener);

    recordGridTablePerformanceSnapshot('All Namespaces Pods', {
      inputRows: 10,
      sourceRows: 10,
      displayedRows: 10,
      inputReferenceChanged: false,
    });
    recordGridTablePerformanceSample('All Namespaces Pods', 'render', 4.25, {
      renderPhase: 'update',
    });

    expect(listener).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    if (globalThis.window && originalRaf) {
      globalThis.window.requestAnimationFrame = originalRaf;
    }
    vi.useRealTimers();
  });
});
