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

const LegendItem: React.FC<{
  count: React.ReactNode;
  label: string;
}> = ({ count, label }) => (
  <div className="metric-legend__item">
    <span className="metric-legend__count">{count}</span>
    <span className="metric-legend__label">{label}</span>
  </div>
);

const ResourceSection: React.FC<ResourceSectionProps> = ({ title, data, type, mode }) => {
  const metrics = calculateResourceMetrics(data, type);
  const formatValue = type === 'cpu' ? formatCpuValue : formatMemoryValue;

  // Suffix denominator: prefer allocatable, fall back to limit (matches the
  // existing per-row percentage logic).
  const pctDenominator = metrics.allocatable > 0 ? metrics.allocatable : metrics.limit;
  const usageSuffix = formatPercentSuffix(metrics.usage, pctDenominator);
  const requestSuffix = formatPercentSuffix(metrics.request, pctDenominator);
  const limitSuffix = formatPercentSuffix(metrics.limit, metrics.allocatable);

  const showAllocatableRow = mode === 'nodeMetrics' && Boolean(data.allocatable);

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
            count={
              <>
                {data.usage || 'not set'}
                {usageSuffix}
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
          {metrics.consumption !== null && (
            <LegendItem
              count={
                <>
                  {formatValue(metrics.usage)} (
                  <span className={metrics.consumption > 100 ? 'overcommitted-text' : ''}>
                    {metrics.consumption}%
                  </span>
                  )
                </>
              }
              label="consumption"
            />
          )}
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
