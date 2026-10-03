/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricsTabModel.ts
 *
 * Pure helpers for the Metrics tab: the graphs it draws from live metrics-server samples, the peak
 * usage, chart rows, time ticks, and value formatting. Values are CPU millicores and memory
 * bytes; a null value is a gap, never a zero.
 */

import { formatResourceValue } from '@shared/utils/resourceCalculations';
import type { ResourceMetricValues } from '@/core/resource-metrics';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type MetricUnit = 'millicores' | 'bytes';
export type MetricSeriesRole = 'usage' | 'request' | 'limit' | 'allocatable';

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

// Only nodes report allocatable: what the node offers to pods.
const SERIES_ROLES: readonly MetricSeriesRole[] = ['usage', 'request', 'limit', 'allocatable'];

// A spacing this many times the usual one means collection paused (auto-refresh off, another
// cluster shown, the panel's window closed while it was kept for reclaiming).
const GAP_FACTOR = 3;

const medianSpacing = (samples: readonly LiveMetricSample[]): number => {
  const spacings = samples
    .slice(1)
    .map((sample, index) => sample.t - samples[index].t)
    .sort((left, right) => left - right);
  return spacings[Math.floor(spacings.length / 2)];
};

// A sample with no values where collection paused, so the chart leaves a gap instead of joining
// across it. Needs a few samples to know the usual spacing.
const withGapBreaks = (samples: readonly LiveMetricSample[]): readonly LiveMetricSample[] => {
  if (samples.length < 3) {
    return samples;
  }
  const limit = GAP_FACTOR * medianSpacing(samples);
  return samples.flatMap((sample, index) =>
    index > 0 && sample.t - samples[index - 1].t > limit
      ? [{ t: (samples[index - 1].t + sample.t) / 2 }, sample]
      : [sample]
  );
};

const liveGraph = (
  { id, title, unit }: (typeof LIVE_GRAPHS)[number],
  samples: readonly LiveMetricSample[]
): MetricGraph => {
  const series: MetricSeries[] = [];
  for (const role of SERIES_ROLES) {
    const values = samples.map((sample) => sample[id]?.[role] ?? null);
    // Usage always draws; a value the object never reported (an unset limit, allocatable for
    // anything but a node) draws no line.
    if (role === 'usage' || values.some((value) => value !== null)) {
      series.push({ role, values });
    }
  }
  return { id, title, unit, hasData: series[0].values.some((value) => value !== null), series };
};

/** The CPU and memory graphs for the samples collected so far. */
export const liveTimeline = (collected: readonly LiveMetricSample[]): MetricTimeline => {
  const samples = withGapBreaks(collected);
  return {
    times: samples.map((sample) => sample.t),
    graphs: LIVE_GRAPHS.map((graph) => liveGraph(graph, samples)),
  };
};

type Values = readonly (number | null)[];

const seriesValues = (graph: MetricGraph, role: MetricSeriesRole): Values =>
  graph.series.find((series) => series.role === role)?.values ?? [];

const peakValue = (values: Values): number | undefined => {
  let peak: number | undefined;
  for (const value of values) {
    if (value !== null && (peak === undefined || value > peak)) {
      peak = value;
    }
  }
  return peak;
};

/** The highest usage among the graph's samples, skipping gaps; undefined before any usage. */
export const peakUsage = (graph: MetricGraph): number | undefined =>
  peakValue(seriesValues(graph, 'usage'));

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

// The chart shows at least this much time, so a few samples do not stretch across it.
const MIN_WINDOW_MS = 5 * MINUTE;

/**
 * The chart's time range: the samples' span, or a five-minute window ending at the newest sample
 * while there is less than that, so new samples enter at the right edge.
 */
export const chartDomain = (times: readonly number[]): [number, number] => {
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  return [Math.min(first, last - MIN_WINDOW_MS), last];
};

// Seconds first, so the axis has times as soon as the second sample arrives (5-second polls).
const TICK_INTERVALS_MS = [
  5_000,
  10_000,
  15_000,
  30_000,
  ...[1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((minutes) => minutes * MINUTE),
];
const MAX_TICK_GAPS = 7;

// The smallest round step that leaves at most MAX_TICK_GAPS gaps across the span.
const tickStep = (spanMs: number): number =>
  TICK_INTERVALS_MS.find((candidate) => spanMs / candidate <= MAX_TICK_GAPS) ??
  TICK_INTERVALS_MS[TICK_INTERVALS_MS.length - 1];

// The first instant at or after start that is a whole multiple of interval in local time.
const firstLocalBoundary = (startMs: number, intervalMs: number): number => {
  const offsetMs = new Date(startMs).getTimezoneOffset() * MINUTE;
  return Math.ceil((startMs - offsetMs) / intervalMs) * intervalMs + offsetMs;
};

/**
 * Round local times to label a numeric time axis; Recharts does not generate time ticks. A lone
 * sample, or samples too close for any round step between them, is labelled at the first sample.
 */
export const timeTicks = (startMs: number, endMs: number): number[] => {
  const intervalMs = tickStep(endMs - startMs);
  const ticks: number[] = [];
  for (let tick = firstLocalBoundary(startMs, intervalMs); tick <= endMs; tick += intervalMs) {
    ticks.push(tick);
  }
  return ticks.length > 0 ? ticks : [startMs];
};

/** Full display value for chart tooltips, using the app's resource formatting. */
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

/** Axis time labels: clock time (with seconds while ticks are under a minute apart), the date
 * for spans over two days. */
export const formatTickTime = (timeMs: number, spanMs: number): string => {
  const date = new Date(timeMs);
  if (spanMs > 2 * 24 * HOUR) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: tickStep(spanMs) < MINUTE ? '2-digit' : undefined,
  });
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
