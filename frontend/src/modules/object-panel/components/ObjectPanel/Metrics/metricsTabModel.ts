/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricsTabModel.ts
 *
 * Pure helpers for the Metrics tab: the graphs it draws from live metrics-server samples, tile
 * statistics, chart rows, time ticks, and value formatting. Values are CPU millicores and memory
 * bytes; a null value is a gap, never a zero.
 */

import { formatResourceValue } from '@shared/utils/resourceCalculations';
import type { ResourceMetricValues } from '@/core/resource-metrics';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type MetricUnit = 'millicores' | 'bytes';
export type MetricSeriesRole = 'usage' | 'request' | 'limit';

export interface MetricSeries {
  role: MetricSeriesRole;
  values: (number | null)[];
}

export interface MetricGraph {
  id: 'cpu' | 'memory';
  title: string;
  unit: MetricUnit;
  /** False until a usage sample arrives. */
  hasData: boolean;
  series: MetricSeries[];
}

/** What the tab charts: each graph's series values line up with times (ms). */
export interface MetricTimeline {
  times: number[];
  graphs: MetricGraph[];
}

/** One live metrics-server collection for the panel's object. */
export interface LiveMetricSample {
  t: number;
  cpu?: ResourceMetricValues;
  memory?: ResourceMetricValues;
}

// The graphs the metrics API can fill, in display order.
const LIVE_GRAPHS = [
  { id: 'cpu', title: 'CPU', unit: 'millicores' },
  { id: 'memory', title: 'Memory', unit: 'bytes' },
] as const;

const SERIES_ROLES: readonly MetricSeriesRole[] = ['usage', 'request', 'limit'];

const liveGraph = (
  { id, title, unit }: (typeof LIVE_GRAPHS)[number],
  samples: readonly LiveMetricSample[]
): MetricGraph => {
  const series: MetricSeries[] = [];
  for (const role of SERIES_ROLES) {
    const values = samples.map((sample) => sample[id]?.[role] ?? null);
    // Usage always draws; a reservation the object never set draws no line.
    if (role === 'usage' || values.some((value) => value !== null)) {
      series.push({ role, values });
    }
  }
  return { id, title, unit, hasData: series[0].values.some((value) => value !== null), series };
};

/** The CPU and memory graphs for the samples collected so far. */
export const liveTimeline = (samples: readonly LiveMetricSample[]): MetricTimeline => ({
  times: samples.map((sample) => sample.t),
  graphs: LIVE_GRAPHS.map((graph) => liveGraph(graph, samples)),
});

type Values = readonly (number | null)[];

const seriesValues = (graph: MetricGraph, role: MetricSeriesRole): Values =>
  graph.series.find((series) => series.role === role)?.values ?? [];

const lastValue = (values: Values): number | undefined => {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];
    if (value !== null) {
      return value;
    }
  }
  return undefined;
};

const peakValue = (values: Values): number | undefined => {
  let peak: number | undefined;
  for (const value of values) {
    if (value !== null && (peak === undefined || value > peak)) {
      peak = value;
    }
  }
  return peak;
};

export interface MetricGraphStats {
  current?: number;
  peak?: number;
  request?: number;
  limit?: number;
}

/** Tile numbers: the newest usage sample, the peak so far, and the newest reservations. */
export const graphStats = (graph: MetricGraph): MetricGraphStats => {
  const usage = seriesValues(graph, 'usage');
  return {
    current: lastValue(usage),
    peak: peakValue(usage),
    request: lastValue(seriesValues(graph, 'request')),
    limit: lastValue(seriesValues(graph, 'limit')),
  };
};

export type MetricChartRow = { t: number } & Partial<Record<MetricSeriesRole, number | null>>;

/** One chart row per sample, keyed by series role. */
export const chartRows = (times: readonly number[], graph: MetricGraph): MetricChartRow[] =>
  times.map((t, index) => {
    const row: MetricChartRow = { t };
    for (const line of graph.series) {
      row[line.role] = line.values[index] ?? null;
    }
    return row;
  });

const TICK_INTERVALS_MS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map(
  (minutes) => minutes * MINUTE
);
const MAX_TICK_GAPS = 7;

// The first instant at or after start that is a whole multiple of interval in local time.
const firstLocalBoundary = (startMs: number, intervalMs: number): number => {
  const offsetMs = new Date(startMs).getTimezoneOffset() * MINUTE;
  return Math.ceil((startMs - offsetMs) / intervalMs) * intervalMs + offsetMs;
};

/** Round local times to label a numeric time axis; Recharts does not generate time ticks. */
export const timeTicks = (startMs: number, endMs: number): number[] => {
  const spanMs = endMs - startMs;
  if (spanMs <= 0) {
    return [];
  }
  const intervalMs =
    TICK_INTERVALS_MS.find((candidate) => spanMs / candidate <= MAX_TICK_GAPS) ??
    TICK_INTERVALS_MS[TICK_INTERVALS_MS.length - 1];
  const ticks: number[] = [];
  for (let tick = firstLocalBoundary(startMs, intervalMs); tick <= endMs; tick += intervalMs) {
    ticks.push(tick);
  }
  return ticks;
};

/** Full display value for tiles and tooltips, using the app's resource formatting. */
export const formatMetricValue = (unit: MetricUnit, value: number | undefined): string =>
  formatResourceValue(value, unit === 'millicores' ? 'cpu' : 'memory');

const BYTE_UNITS = ['', 'K', 'M', 'G', 'T'];

/** Compact axis labels (250m, 1.5, 750M, 1.2G) that fit a narrow axis. */
export const formatAxisValue = (unit: MetricUnit, value: number): string => {
  if (unit === 'millicores') {
    return value < 1000 ? `${Math.round(value)}m` : `${Number((value / 1000).toFixed(1))}`;
  }
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    index++;
  }
  const digits = scaled >= 10 || index === 0 ? 0 : 1;
  return `${Number(scaled.toFixed(digits))}${BYTE_UNITS[index]}`;
};

/** Axis time labels: clock time within a day, the date for longer spans. */
export const formatTickTime = (timeMs: number, spanMs: number): string => {
  const date = new Date(timeMs);
  return spanMs > 2 * 24 * HOUR
    ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Tooltip time; seconds matter when points are under a minute apart. */
export const formatTooltipTime = (timeMs: number, withSeconds: boolean): string =>
  new Date(timeMs).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
  });

/** Clock time for the live badge, e.g. "since 14:02". */
export const formatClockTime = (timeMs: number): string =>
  new Date(timeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
