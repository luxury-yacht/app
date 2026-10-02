/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricHistoryModel.test.ts
 */

import { metrichistory } from '@core/backend-api/models';
import { describe, expect, it } from 'vitest';
import { graphStats, liveTimeline, refreshIntervalMs, timeTicks } from './metricHistoryModel';

const MINUTE = 60_000;

const cpuGraph = (series: metrichistory.Series[]): metrichistory.Graph => ({
  id: metrichistory.GraphID.GraphCPU,
  unit: metrichistory.Unit.UnitMillicores,
  status: metrichistory.GraphStatus.GraphStatusOK,
  series,
});

describe('graphStats', () => {
  it('reads current as the newest sample, not a trailing gap, and peak over the whole range', () => {
    const stats = graphStats(
      cpuGraph([
        { id: 'usage', role: metrichistory.SeriesRole.RoleUsage, values: [null, 4, 9, 3, null] },
        { id: 'request', role: metrichistory.SeriesRole.RoleRequest, values: [50, 50, 50, 50, 50] },
        {
          id: 'limit',
          role: metrichistory.SeriesRole.RoleLimit,
          values: [100, 200, null, null, null],
        },
      ])
    );
    expect(stats).toEqual({ current: 3, peak: 9, request: 50, limit: 200 });
  });

  it('leaves values the source never reported undefined rather than zero', () => {
    const stats = graphStats(
      cpuGraph([{ id: 'usage', role: metrichistory.SeriesRole.RoleUsage, values: [null, null] }])
    );
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
    ['15m', 15 * MINUTE, 15_000],
    ['1h', 60 * MINUTE, 15_000],
    ['6h', 360 * MINUTE, 75_000],
    ['24h', 1440 * MINUTE, 300_000],
    ['7d', 7 * 1440 * MINUTE, 2_025_000],
  ])('labels a %s range with a few evenly spaced round times', (_label, span, stepMs) => {
    const endMs = Date.UTC(2026, 9, 1, 14, 7, 30);
    const count = Math.floor(span / stepMs) + 1;
    const grid = { startMs: endMs - (count - 1) * stepMs, stepMs, count };

    const ticks = timeTicks(grid.startMs, endMs);

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(8);
    const interval = ticks[1] - ticks[0];
    expect(NICE_INTERVALS).toContain(interval);
    ticks.forEach((tick, index) => {
      expect(tick).toBeGreaterThanOrEqual(grid.startMs);
      expect(tick).toBeLessThanOrEqual(endMs);
      if (index > 0) {
        expect(tick - ticks[index - 1]).toBe(interval);
      }
      // Round in the viewer's local time: whole minutes, and whole hours/days for coarse ranges.
      const local = new Date(tick);
      const localMinutes = local.getHours() * 60 + local.getMinutes();
      expect(local.getSeconds()).toBe(0);
      expect(localMinutes % Math.min(interval / MINUTE, 1440)).toBe(0);
    });
  });
});

describe('liveTimeline', () => {
  it('fills the graphs live metrics can supply and leaves the others without data', () => {
    const live = (id: metrichistory.GraphID, unit: metrichistory.Unit): metrichistory.Graph => ({
      id,
      unit,
      status: metrichistory.GraphStatus.GraphStatusLive,
      series: null,
    });
    const timeline = liveTimeline(
      [
        { t: 1_000, cpu: { usage: 10, request: 50 }, memory: { usage: 2_048 } },
        { t: 6_000, cpu: { usage: 30, request: 50 }, memory: {} },
      ],
      [
        live(metrichistory.GraphID.GraphCPU, metrichistory.Unit.UnitMillicores),
        live(metrichistory.GraphID.GraphMemory, metrichistory.Unit.UnitBytes),
        live('restarts' as metrichistory.GraphID, metrichistory.Unit.UnitBytes),
      ]
    );

    expect(timeline.times).toEqual([1_000, 6_000]);
    const [cpu, memory, restarts] = timeline.graphs;
    expect(cpu.status).toBe(metrichistory.GraphStatus.GraphStatusOK);
    expect(cpu.series).toEqual([
      { id: 'usage', role: metrichistory.SeriesRole.RoleUsage, values: [10, 30] },
      { id: 'request', role: metrichistory.SeriesRole.RoleRequest, values: [50, 50] },
    ]);
    // A missing sample is a gap, never a zero; reservations the pod never set are not drawn.
    expect(memory.series).toEqual([
      { id: 'usage', role: metrichistory.SeriesRole.RoleUsage, values: [2_048, null] },
    ]);
    expect(restarts.status).toBe(metrichistory.GraphStatus.GraphStatusLive);
  });
});

describe('refreshIntervalMs', () => {
  it('re-queries once per step, no faster than 30s and no slower than 5 minutes', () => {
    expect(refreshIntervalMs({ startMs: 0, stepMs: 15_000, count: 241 })).toBe(30_000);
    expect(refreshIntervalMs({ startMs: 0, stepMs: 75_000, count: 289 })).toBe(75_000);
    expect(refreshIntervalMs({ startMs: 0, stepMs: 2_025_000, count: 299 })).toBe(300_000);
    // Live mode carries no source grid; the source is retried on the floor cadence.
    expect(refreshIntervalMs({ startMs: 0, stepMs: 0, count: 0 })).toBe(30_000);
  });
});
