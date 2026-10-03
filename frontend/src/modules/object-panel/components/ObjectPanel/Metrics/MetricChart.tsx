/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricChart.tsx
 *
 * One Metrics-tab chart (Recharts). Usage is a solid line with the area under it filled; requests,
 * limits, and a node's allocatable are dashed reference lines. Charts in a panel share a crosshair
 * through syncId. Colors are theme tokens passed as var(--…) so light and dark need no JavaScript.
 * ComposedChart, not LineChart: Recharts draws an Area only in an AreaChart or a ComposedChart.
 */

import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import {
  chartDomain,
  chartRows,
  formatAxisValue,
  formatMetricValue,
  formatTickTime,
  formatTooltipTime,
  type MetricGraph,
  type MetricSeriesRole,
  type MetricUnit,
  timeTicks,
} from './metricsTabModel';

interface SeriesStyle {
  label: string;
  stroke: string;
  dash?: string;
}

const SERIES_STYLES: Record<MetricSeriesRole, SeriesStyle> = {
  usage: { label: 'Usage', stroke: 'var(--chart-usage-color)' },
  request: { label: 'Request', stroke: 'var(--chart-request-color)', dash: '4 3' },
  limit: { label: 'Limit', stroke: 'var(--chart-limit-color)', dash: '6 3' },
  allocatable: { label: 'Allocatable', stroke: 'var(--chart-allocatable-color)', dash: '2 3' },
};

const MINUTE = 60_000;

interface MetricChartProps {
  graph: MetricGraph;
  /** When each series value was measured (ms): the live collection times. */
  times: readonly number[];
  /** Charts with the same syncId share the crosshair. */
  syncId: string;
}

function MetricTooltip({
  active,
  payload,
  label,
  unit,
  withSeconds,
}: Readonly<
  // Recharts injects active/payload/label when it clones this element.
  Partial<Pick<TooltipContentProps, 'active' | 'payload' | 'label'>> & {
    unit: MetricUnit;
    withSeconds: boolean;
  }
>) {
  if (!active || !payload?.length || typeof label !== 'number') {
    return null;
  }
  return (
    <div className="metrics-chart-tooltip">
      <div className="metrics-chart-tooltip__time">{formatTooltipTime(label, withSeconds)}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="metrics-chart-tooltip__row">
          <span>{entry.name}</span>
          <span>
            {formatMetricValue(unit, typeof entry.value === 'number' ? entry.value : undefined)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MetricChart({ graph, times, syncId }: Readonly<MetricChartProps>) {
  // At least five minutes wide, ending at the newest sample.
  const [startMs, endMs] = useMemo(() => chartDomain(times), [times]);
  const rows = useMemo(() => chartRows(times, graph), [times, graph]);
  const ticks = useMemo(() => timeTicks(startMs, endMs), [startMs, endMs]);
  const withSeconds = times.length < 2 || times[1] - times[0] < MINUTE;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        syncId={syncId}
        syncMethod="value"
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={[startMs, endMs]}
          ticks={ticks}
          tickFormatter={(value: number) => formatTickTime(value, endMs - startMs)}
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)' }}
        />
        <YAxis
          width={48}
          tickFormatter={(value: number) => formatAxisValue(graph.unit, value)}
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)' }}
        />
        <Tooltip
          // Appear at the cursor instead of sliding in from the chart's corner.
          isAnimationActive={false}
          content={<MetricTooltip unit={graph.unit} withSeconds={withSeconds} />}
        />
        {graph.series.map((series) => {
          const style = SERIES_STYLES[series.role];
          const shared = {
            dataKey: series.role,
            name: style.label,
            stroke: style.stroke,
            // A lone first live sample has no line yet; show it as a dot.
            dot: times.length === 1,
            isAnimationActive: false,
          };
          // The fill token carries its own transparency.
          return series.role === 'usage' ? (
            <Area key={series.role} {...shared} fill="var(--chart-usage-fill)" fillOpacity={1} />
          ) : (
            <Line key={series.role} {...shared} strokeDasharray={style.dash} />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
