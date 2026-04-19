import { afterEach, describe, expect, it } from 'vitest';

import {
  getGridTablePerformanceSnapshot,
  recordGridTablePerformanceSample,
  recordGridTablePerformanceSnapshot,
  resetGridTablePerformanceDiagnostics,
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
});
