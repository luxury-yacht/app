/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricsTabModel.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  chartDomain,
  formatTickTime,
  liveTimeline,
  type MetricGraph,
  peakUsage,
  timeTicks,
} from './metricsTabModel';

const MINUTE = 60_000;

const cpuGraph = (series: MetricGraph['series']): MetricGraph => ({
  id: 'cpu',
  title: 'CPU',
  unit: 'millicores',
  hasData: true,
  series,
});

describe('peakUsage', () => {
  it('reads the highest usage so far, skipping gaps', () => {
    expect(peakUsage(cpuGraph([{ role: 'usage', values: [null, 4, 9, 3, null] }]))).toBe(9);
  });

  it('has no peak before any usage, rather than zero', () => {
    expect(peakUsage(cpuGraph([{ role: 'usage', values: [null, null] }]))).toBeUndefined();
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

  it('labels a span under a minute with round seconds, from the second sample', () => {
    // Samples at :02 and :07, the default 5-second poll.
    const startMs = Date.UTC(2026, 9, 1, 14, 2, 2);
    expect(timeTicks(startMs, startMs + 5_000)).toEqual([Date.UTC(2026, 9, 1, 14, 2, 5)]);
  });

  it('labels the lone first sample', () => {
    const startMs = Date.UTC(2026, 9, 1, 14, 2, 2);
    expect(timeTicks(startMs, startMs)).toEqual([startMs]);
  });

  it('labels the first sample when no round step falls between two close samples', () => {
    const startMs = Date.UTC(2026, 9, 1, 14, 2, 1);
    expect(timeTicks(startMs, startMs + 1_000)).toEqual([startMs]);
  });
});

describe('chartDomain', () => {
  const last = Date.UTC(2026, 9, 1, 14, 2, 2);

  it('keeps a short series at the right edge of a five-minute window', () => {
    expect(chartDomain([last - 10_000, last - 5_000, last])).toEqual([last - 5 * MINUTE, last]);
    expect(chartDomain([last])).toEqual([last - 5 * MINUTE, last]);
  });

  it('spans the samples once there are more than five minutes of them', () => {
    expect(chartDomain([last - 12 * MINUTE, last])).toEqual([last - 12 * MINUTE, last]);
  });
});

describe('formatTickTime', () => {
  it('shows seconds while the ticks are under a minute apart', () => {
    const t = Date.UTC(2026, 9, 1, 14, 2, 5);
    const clock = { hour: '2-digit', minute: '2-digit' } as const;
    const withSeconds = new Date(t).toLocaleTimeString([], { ...clock, second: '2-digit' });
    expect(formatTickTime(t, 0)).toBe(withSeconds);
    expect(formatTickTime(t, 5_000)).toBe(withSeconds);
    expect(formatTickTime(t, 10 * MINUTE)).toBe(new Date(t).toLocaleTimeString([], clock));
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

  it("charts a node's allocatable as a line next to its requests and limits", () => {
    const timeline = liveTimeline([
      { t: 1_000, cpu: { usage: 250, request: 900, limit: 3_000, allocatable: 1_900 } },
      { t: 6_000, cpu: { usage: 300, request: 900, limit: 3_000, allocatable: 1_900 } },
    ]);

    const [cpu] = timeline.graphs;
    expect(cpu.series.map((series) => series.role)).toEqual([
      'usage',
      'request',
      'limit',
      'allocatable',
    ]);
  });

  it('breaks the lines where collection paused instead of joining across the gap', () => {
    // Collected every 5s, then nothing for 49s (auto-refresh paused, another cluster shown).
    const timeline = liveTimeline([
      { t: 1_000, cpu: { usage: 10 } },
      { t: 6_000, cpu: { usage: 20 } },
      { t: 11_000, cpu: { usage: 15 } },
      { t: 60_000, cpu: { usage: 30 } },
      { t: 65_000, cpu: { usage: 25 } },
    ]);

    const [cpu] = timeline.graphs;
    // A point with no values between the two runs; Recharts leaves a gap at nulls.
    expect(timeline.times).toEqual([1_000, 6_000, 11_000, 35_500, 60_000, 65_000]);
    expect(cpu.series[0].values).toEqual([10, 20, 15, null, 30, 25]);
    expect(peakUsage(cpu)).toBe(30);
  });

  it('keeps an evenly collected series joined', () => {
    const timeline = liveTimeline([
      { t: 1_000, cpu: { usage: 10 } },
      { t: 6_000, cpu: { usage: 20 } },
      { t: 12_000, cpu: { usage: 30 } },
    ]);
    expect(timeline.times).toEqual([1_000, 6_000, 12_000]);
  });

  it('has no data before the first sample', () => {
    expect(liveTimeline([]).graphs.map((graph) => graph.hasData)).toEqual([false, false]);
  });
});
