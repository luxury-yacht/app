/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricHistoryModel.ts
 *
 * Pure helpers for the Metrics tab: range presets, tile statistics, the timeline both modes chart
 * (source history on its grid, or live samples at their collection times), time ticks, and the
 * re-query cadence. Values are CPU millicores and memory bytes; a null value is a gap, never a zero.
 */

import { metrichistory } from '@core/backend-api/models';
import { formatResourceValue } from '@shared/utils/resourceCalculations';
import type { ResourceMetricValues } from '@/core/resource-metrics';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const METRIC_RANGE_PRESETS = [
  { id: '15m', spanMs: 15 * MINUTE },
  { id: '1h', spanMs: HOUR },
  { id: '6h', spanMs: 6 * HOUR },
  { id: '24h', spanMs: 24 * HOUR },
  { id: '7d', spanMs: 7 * 24 * HOUR },
] as const;

export type MetricRangePresetId = (typeof METRIC_RANGE_PRESETS)[number]['id'];

export const DEFAULT_RANGE_PRESET: MetricRangePresetId = '1h';

export const presetSpanMs = (preset: MetricRangePresetId): number =>
  METRIC_RANGE_PRESETS.find((candidate) => candidate.id === preset)?.spanMs ?? HOUR;

type Values = readonly (number | null)[];

const seriesValues = (graph: metrichistory.Graph, role: metrichistory.SeriesRole): Values =>
  graph.series?.find((series) => series.role === role)?.values ?? [];

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

/** Tile numbers: the newest usage sample, the range's peak, and the newest reservations. */
export const graphStats = (graph: metrichistory.Graph): MetricGraphStats => {
  const usage = seriesValues(graph, metrichistory.SeriesRole.RoleUsage);
  return {
    current: lastValue(usage),
    peak: peakValue(usage),
    request: lastValue(seriesValues(graph, metrichistory.SeriesRole.RoleRequest)),
    limit: lastValue(seriesValues(graph, metrichistory.SeriesRole.RoleLimit)),
  };
};

/** What a tab charts: each graph's series values line up with times (ms). */
export interface MetricTimeline {
  times: number[];
  graphs: metrichistory.Graph[];
}

/** The times of a source response's grid points. */
export const gridTimes = (grid: metrichistory.Grid): number[] =>
  Array.from({ length: grid.count }, (_, index) => grid.startMs + index * grid.stepMs);

/** One live metrics-server collection for the panel's object. */
export interface LiveMetricSample {
  t: number;
  cpu?: ResourceMetricValues;
  memory?: ResourceMetricValues;
}

// The graphs live metrics can fill, and the sample field each one reads.
const LIVE_FIELDS: Partial<Record<metrichistory.GraphID, 'cpu' | 'memory'>> = {
  [metrichistory.GraphID.GraphCPU]: 'cpu',
  [metrichistory.GraphID.GraphMemory]: 'memory',
};

const LIVE_ROLES = [
  [metrichistory.SeriesRole.RoleUsage, 'usage'],
  [metrichistory.SeriesRole.RoleRequest, 'request'],
  [metrichistory.SeriesRole.RoleLimit, 'limit'],
] as const;

const liveGraph = (
  graph: metrichistory.Graph,
  field: 'cpu' | 'memory',
  samples: readonly LiveMetricSample[]
): metrichistory.Graph => {
  const series: metrichistory.Series[] = [];
  for (const [role, key] of LIVE_ROLES) {
    const values = samples.map((sample) => sample[field]?.[key] ?? null);
    // Usage always draws; a reservation the pod never set draws no line.
    if (role === metrichistory.SeriesRole.RoleUsage || values.some((value) => value !== null)) {
      series.push({ id: role, role, values });
    }
  }
  const hasUsage = series[0].values?.some((value) => value !== null);
  return {
    ...graph,
    status: hasUsage
      ? metrichistory.GraphStatus.GraphStatusOK
      : metrichistory.GraphStatus.GraphStatusNoData,
    series,
  };
};

/** The live-mode timeline: catalog graphs live metrics can supply are filled from the samples. */
export const liveTimeline = (
  samples: readonly LiveMetricSample[],
  graphs: readonly metrichistory.Graph[]
): MetricTimeline => ({
  times: samples.map((sample) => sample.t),
  graphs: graphs.map((graph) => {
    const field = LIVE_FIELDS[graph.id];
    return field ? liveGraph(graph, field, samples) : graph;
  }),
});

export type MetricChartRow = { t: number; [seriesId: string]: number | null };

/** One chart row per timeline point, keyed by series id. */
export const chartRows = (
  times: readonly number[],
  graph: metrichistory.Graph
): MetricChartRow[] => {
  const series = graph.series ?? [];
  return times.map((t, index) => {
    const row: MetricChartRow = { t };
    for (const line of series) {
      row[line.id] = line.values?.[index] ?? null;
    }
    return row;
  });
};

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

const MIN_REFRESH_MS = 30_000;
const MAX_REFRESH_MS = 5 * MINUTE;

/** Re-query once per grid step, clamped; live mode has no grid and retries on the floor. */
export const refreshIntervalMs = (grid: metrichistory.Grid | null | undefined): number =>
  Math.min(Math.max(grid?.stepMs ?? 0, MIN_REFRESH_MS), MAX_REFRESH_MS);

const isCpu = (unit: metrichistory.Unit) => unit === metrichistory.Unit.UnitMillicores;

/** Full display value for tiles and tooltips, using the app's resource formatting. */
export const formatMetricValue = (unit: metrichistory.Unit, value: number | undefined): string =>
  formatResourceValue(value, isCpu(unit) ? 'cpu' : 'memory');

const BYTE_UNITS = ['', 'K', 'M', 'G', 'T'];

/** Compact axis labels (250m, 1.5, 750M, 1.2G) that fit a narrow axis. */
export const formatAxisValue = (unit: metrichistory.Unit, value: number): string => {
  if (isCpu(unit)) {
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

/** Axis time labels: clock time within a day, the date for daily ticks. */
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
