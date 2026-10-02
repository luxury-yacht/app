/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricsTabModel.test.ts
 */

import { describe, expect, it } from 'vitest';
import { graphStats, liveTimeline, type MetricGraph, timeTicks } from './metricsTabModel';

const MINUTE = 60_000;

const cpuGraph = (series: MetricGraph['series']): MetricGraph => ({
  id: 'cpu',
  title: 'CPU',
  unit: 'millicores',
  hasData: true,
  series,
});

describe('graphStats', () => {
  it('reads current as the newest sample, not a trailing gap, and the peak so far', () => {
    const stats = graphStats(
      cpuGraph([
        { role: 'usage', values: [null, 4, 9, 3, null] },
        { role: 'request', values: [50, 50, 50, 50, 50] },
        { role: 'limit', values: [100, 200, null, null, null] },
      ])
    );
    expect(stats).toEqual({ current: 3, peak: 9, request: 50, limit: 200 });
  });

  it('leaves values the metrics API never reported undefined rather than zero', () => {
    const stats = graphStats(cpuGraph([{ role: 'usage', values: [null, null] }]));
    expect(stats).toEqual({
      current: undefined,
      peak: undefined,
      request: undefined,
      limit: undefined,
    });
  });
});

describe('timeTicks', () => {
  const NICE_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MINUTE);

  it.each([
    ['5m', 5 * MINUTE],
    ['15m', 15 * MINUTE],
    ['1h', 60 * MINUTE],
  ])('labels a %s span with a few evenly spaced round times', (_label, span) => {
    const endMs = Date.UTC(2026, 9, 1, 14, 7, 30);
    const startMs = endMs - span;

    const ticks = timeTicks(startMs, endMs);

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(8);
    const interval = ticks[1] - ticks[0];
    expect(NICE_INTERVALS).toContain(interval);
    ticks.forEach((tick, index) => {
      expect(tick).toBeGreaterThanOrEqual(startMs);
      expect(tick).toBeLessThanOrEqual(endMs);
      if (index > 0) {
        expect(tick - ticks[index - 1]).toBe(interval);
      }
      // Round in the viewer's local time: whole minutes on the interval.
      const local = new Date(tick);
      expect(local.getSeconds()).toBe(0);
      expect((local.getHours() * 60 + local.getMinutes()) % (interval / MINUTE)).toBe(0);
    });
  });
});

describe('liveTimeline', () => {
  it('charts CPU and memory from the samples, with gaps and only the reservations set', () => {
    const timeline = liveTimeline([
      { t: 1_000, cpu: { usage: 10, request: 50 }, memory: { usage: 2_048 } },
      { t: 6_000, cpu: { usage: 30, request: 50 }, memory: {} },
    ]);

    expect(timeline.times).toEqual([1_000, 6_000]);
    const [cpu, memory] = timeline.graphs;
    expect(cpu).toMatchObject({ id: 'cpu', unit: 'millicores', hasData: true });
    expect(cpu.series).toEqual([
      { role: 'usage', values: [10, 30] },
      { role: 'request', values: [50, 50] },
    ]);
    // A missing sample is a gap, never a zero; reservations the pod never set are not drawn.
    expect(memory).toMatchObject({ id: 'memory', unit: 'bytes' });
    expect(memory.series).toEqual([{ role: 'usage', values: [2_048, null] }]);
  });

  it('has no data before the first sample', () => {
    expect(liveTimeline([]).graphs.map((graph) => graph.hasData)).toEqual([false, false]);
  });
});
