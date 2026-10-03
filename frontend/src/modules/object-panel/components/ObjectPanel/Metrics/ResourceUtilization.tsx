/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/ResourceUtilization.tsx
 *
 * One resource's utilization bar and legend, shown in that resource's Metrics tab section (which
 * carries the CPU / Memory title). Reuses the ResourceBar housing styles (.resource-group /
 * .metric-header / .resource-bar-placeholder / .metric-legend*) shipped with ResourceBar so the
 * look matches the cluster overview's Resource Usage block.
 */

import ResourceBarErrorBoundary from '@shared/components/errors/ResourceBarErrorBoundary';
import ResourceBar from '@shared/components/ResourceBar';
import Tooltip from '@shared/components/Tooltip';
import {
  calculateResourceMetrics,
  formatCpuValue,
  formatMemoryValue,
  formatResourceValue,
} from '@shared/utils/resourceCalculations';
import type React from 'react';
import type { ResourceMetricValues } from '@/core/resource-metrics';
import '../shared.css';
import './ResourceUtilization.css';

interface ResourceUtilizationProps {
  data: ResourceMetricValues;
  type: 'cpu' | 'memory';
  mode?: 'podMetrics' | 'nodeMetrics' | 'nodePods';
  /** The highest usage among the samples charted with this bar, when there are any. */
  peak?: number;
}

const formatPercentSuffix = (numerator: number, denominator: number): string =>
  numerator > 0 && denominator > 0 ? ` (${Math.round((numerator / denominator) * 100)}%)` : '';

const LEGEND_TOOLTIPS: Record<string, React.ReactNode> = {
  peak: 'Highest usage among the samples charted below.',
  allocatable: 'Total available to pods on this node.',
  request: 'Sum of the resource Requests from all containers.',
  limit: 'Sum of the resource Limits from all containers.',
  overcommitted: (
    <>
      Above 100% means the configured Limits exceeds the Allocatable resources.
      <br />
      <br />
      Overcommit is not necessarily a problem, but increases the risk of pods being evicted under
      resource pressure.
    </>
  ),
};

const LegendItem: React.FC<{
  count: React.ReactNode;
  label: string;
  tooltip?: React.ReactNode;
}> = ({ count, label, tooltip }) => {
  const item = (
    <span className="metric-legend__item">
      <span className="metric-legend__count">{count}</span>
      <span className="metric-legend__label">{label}</span>
    </span>
  );
  const resolvedTooltip = tooltip ?? LEGEND_TOOLTIPS[label];
  return resolvedTooltip ? <Tooltip content={resolvedTooltip}>{item}</Tooltip> : item;
};

type ResourceMetrics = ReturnType<typeof calculateResourceMetrics>;

interface LegendProps {
  data: ResourceMetricValues;
  type: 'cpu' | 'memory';
  metrics: ResourceMetrics;
  isNodeMode: boolean;
}

// Usage percentages: usage / requests is always meaningful when requests are set. The second
// percentage is usage / allocatable for nodes (a node-level concept) and usage / limits for
// workloads. Null when there is nothing to compare usage against.
const usagePercentages = (
  metrics: ResourceMetrics,
  isNodeMode: boolean
): { request: number | null; secondary: string | null } | null => {
  const secondaryDenominator = isNodeMode ? metrics.allocatable : metrics.limit;
  if (metrics.usage <= 0 || (metrics.request <= 0 && secondaryDenominator <= 0)) {
    return null;
  }
  return {
    request: metrics.consumption,
    secondary:
      secondaryDenominator > 0
        ? `${Math.round((metrics.usage / secondaryDenominator) * 100)}%`
        : null,
  };
};

const UsedLegendItem = ({ data, type, metrics, isNodeMode }: LegendProps) => {
  const percentages = usagePercentages(metrics, isNodeMode);
  const usedTooltip = (
    <>
      Current utilization. Percentages are
      <br />
      (% of Requests / % of {isNodeMode ? 'Allocatable' : 'Limits'}).
    </>
  );
  return (
    <LegendItem
      tooltip={usedTooltip}
      count={
        <>
          {formatResourceValue(data.usage, type)}
          {percentages ? (
            <>
              {' ('}
              {percentages.request === null ? (
                '-'
              ) : (
                <span className={percentages.request > 100 ? 'overcommitted-text' : ''}>
                  {percentages.request}%
                </span>
              )}
              {' / '}
              {percentages.secondary ?? '-'}
              {')'}
            </>
          ) : null}
        </>
      }
      label="use"
    />
  );
};

// Per-row request/limit suffixes: only meaningful for nodes, where allocatable provides a
// denominator. An unset request or limit arrives as absent (zero is omitted on the wire).
const ReservationLegendItems = ({ data, type, metrics, isNodeMode }: LegendProps) => {
  const formatReservation = (value: number | undefined): string =>
    value ? formatResourceValue(value, type) : '-';
  const requestSuffix = isNodeMode ? formatPercentSuffix(metrics.request, metrics.allocatable) : '';
  const limitSuffix = isNodeMode ? formatPercentSuffix(metrics.limit, metrics.allocatable) : '';
  return (
    <>
      <LegendItem
        count={
          <>
            {formatReservation(data.request)}
            {requestSuffix}
          </>
        }
        label="request"
      />
      <LegendItem
        count={
          <>
            {formatReservation(data.limit)}
            {!!limitSuffix && (
              <span className={metrics.limitPercent > 100 ? 'overcommitted-text' : ''}>
                {limitSuffix}
              </span>
            )}
          </>
        }
        label="limit"
      />
    </>
  );
};

const OvercommittedLegendItem = ({ type, metrics }: Pick<LegendProps, 'type' | 'metrics'>) => {
  const formatValue = type === 'cpu' ? formatCpuValue : formatMemoryValue;
  return (
    <LegendItem
      count={
        metrics.overcommittedAmount > 0 ? (
          <span className="overcommitted-text">
            {formatValue(metrics.overcommittedAmount)} ({metrics.overcommittedPercent}%)
          </span>
        ) : (
          `${formatValue(0)} (0%)`
        )
      }
      label="overcommitted"
    />
  );
};

const ResourceUtilization: React.FC<ResourceUtilizationProps> = ({
  data,
  type,
  mode = 'podMetrics',
  peak,
}) => {
  const metrics = calculateResourceMetrics(data);
  const isNodeMode = mode === 'nodeMetrics';
  const legend = { data, type, metrics, isNodeMode };

  return (
    <div className="resource-group">
      {!!data.allocatable && (
        <div className="metric-header">
          <div className="metric-legend__total">
            <span className="metric-legend__total-value">
              {formatResourceValue(data.allocatable, type)}
            </span>
            <span className="metric-legend__total-label"> total</span>
          </div>
        </div>
      )}

      <div className="resource-bar-placeholder">
        <ResourceBarErrorBoundary>
          <ResourceBar
            usage={data.usage}
            request={data.request}
            limit={data.limit}
            allocatable={data.allocatable}
            type={type}
          />
        </ResourceBarErrorBoundary>
      </div>

      <div className="metric-legend">
        <div className="metric-legend__items">
          <UsedLegendItem {...legend} />
          {peak === undefined ? null : (
            <LegendItem count={formatResourceValue(peak, type)} label="peak" />
          )}
          {isNodeMode && !!data.allocatable && (
            <LegendItem count={formatResourceValue(data.allocatable, type)} label="allocatable" />
          )}
          <ReservationLegendItems {...legend} />
          {isNodeMode && <OvercommittedLegendItem type={type} metrics={metrics} />}
        </div>
      </div>
    </div>
  );
};

export default ResourceUtilization;
