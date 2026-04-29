/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabUtilization.tsx
 *
 * Per-resource utilization section. Reuses the ResourceBar housing styles
 * (.resource-group / .metric-header / .resource-bar-placeholder /
 * .metric-legend*) shipped with ResourceBar so the look matches the cluster
 * overview's Resource Usage block.
 */

import React from 'react';
import ResourceBar from '@shared/components/ResourceBar';
import ResourceBarErrorBoundary from '@shared/components/errors/ResourceBarErrorBoundary';
import Tooltip from '@shared/components/Tooltip';
import {
  calculateResourceMetrics,
  formatCpuValue,
  formatMemoryValue,
} from '@shared/utils/resourceCalculations';
import '../shared.css';
import './DetailsTabUtilization.css';

interface UtilizationProps {
  cpu?: {
    usage?: string;
    request?: string;
    limit?: string;
    capacity?: string;
    allocatable?: string;
  };
  memory?: {
    usage?: string;
    request?: string;
    limit?: string;
    capacity?: string;
    allocatable?: string;
  };
  pods?: {
    count?: string;
    capacity?: string;
    allocatable?: string;
  };
  mode?: 'podMetrics' | 'nodeMetrics' | 'nodePods';
  podCount?: number;
  readyPodCount?: number;
}

interface ResourceSectionProps {
  title: string;
  data: {
    usage?: string;
    request?: string;
    limit?: string;
    allocatable?: string;
  };
  type: 'cpu' | 'memory';
  mode: 'podMetrics' | 'nodeMetrics' | 'nodePods';
}

const formatPercentSuffix = (numerator: number, denominator: number): string =>
  numerator > 0 && denominator > 0 ? ` (${Math.round((numerator / denominator) * 100)}%)` : '';

const LEGEND_TOOLTIPS: Record<string, React.ReactNode> = {
  allocatable: 'Total available to pods on this node.',
  requests: 'Sum of the resource Requests from all containers.',
  limits: 'Sum of the resource Limits from all containers.',
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

const ResourceSection: React.FC<ResourceSectionProps> = ({ title, data, type, mode }) => {
  const metrics = calculateResourceMetrics(data, type);
  const formatValue = type === 'cpu' ? formatCpuValue : formatMemoryValue;

  const isNodeMode = mode === 'nodeMetrics';

  // Usage percentages: usage / requests is always meaningful when requests
  // are set. The second percentage is usage / allocatable for nodes (a
  // node-level concept) and usage / limits for workloads.
  const usageRequestPct = metrics.consumption;
  const usageSecondaryDenominator = isNodeMode ? metrics.allocatable : metrics.limit;
  const usageSecondaryPct =
    metrics.usage > 0 && usageSecondaryDenominator > 0
      ? `${Math.round((metrics.usage / usageSecondaryDenominator) * 100)}%`
      : null;

  // Per-row request/limit suffixes: only meaningful for nodes, where
  // allocatable provides a denominator.
  const requestSuffix = isNodeMode ? formatPercentSuffix(metrics.request, metrics.allocatable) : '';
  const limitSuffix = isNodeMode ? formatPercentSuffix(metrics.limit, metrics.allocatable) : '';

  const showAllocatableRow = isNodeMode && Boolean(data.allocatable);
  const showOvercommittedRow = isNodeMode;

  const usedTooltip = (
    <>
      Current utilization. Percentages are
      <br />
      (% of Requests / % of {isNodeMode ? 'Allocatable' : 'Limits'}).
    </>
  );

  return (
    <div className="resource-group">
      <div className="metric-header">
        <h3>{title}</h3>
        {data.allocatable && (
          <div className="metric-legend__total">
            <span className="metric-legend__total-value">{data.allocatable}</span>
            <span className="metric-legend__total-label"> total</span>
          </div>
        )}
      </div>

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
          <LegendItem
            tooltip={usedTooltip}
            count={
              <>
                {data.usage || 'not set'}
                {metrics.usage > 0 && (metrics.request > 0 || usageSecondaryDenominator > 0) && (
                  <>
                    {' ('}
                    {usageRequestPct !== null ? (
                      <span className={usageRequestPct > 100 ? 'overcommitted-text' : ''}>
                        {usageRequestPct}%
                      </span>
                    ) : (
                      '-'
                    )}
                    {' / '}
                    {usageSecondaryPct ?? '-'}
                    {')'}
                  </>
                )}
              </>
            }
            label="used"
          />
          {showAllocatableRow && (
            <LegendItem count={data.allocatable as string} label="allocatable" />
          )}
          <LegendItem
            count={
              <>
                {data.request || 'not set'}
                {requestSuffix}
              </>
            }
            label="requests"
          />
          <LegendItem
            count={
              <>
                {data.limit || 'not set'}
                {limitSuffix && (
                  <span className={metrics.limitPercent > 100 ? 'overcommitted-text' : ''}>
                    {limitSuffix}
                  </span>
                )}
              </>
            }
            label="limits"
          />
          {showOvercommittedRow && (
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
          )}
        </div>
      </div>
    </div>
  );
};

const Utilization: React.FC<UtilizationProps> = ({
  cpu,
  memory,
  pods,
  mode = 'podMetrics',
  podCount,
  readyPodCount,
}) => {
  return (
    <div className="object-panel-section">
      <div className="object-panel-section-title">
        Resource Utilization
        {podCount != null && podCount > 0 && (
          <span className="utilization-pod-count">
            {readyPodCount != null ? `${readyPodCount}/${podCount} pods` : `${podCount} pods`}
          </span>
        )}
      </div>

      <div className="utilization-content">
        {cpu || memory || pods ? (
          <div className="utilization-resources-grid">
            {cpu && <ResourceSection title="CPU" data={cpu} type="cpu" mode={mode} />}
            {memory && <ResourceSection title="Memory" data={memory} type="memory" mode={mode} />}
          </div>
        ) : (
          <div className="utilization-empty">No resource utilization data available</div>
        )}
      </div>
    </div>
  );
};

export default Utilization;
