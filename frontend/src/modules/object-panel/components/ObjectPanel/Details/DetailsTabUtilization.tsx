/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabUtilization.tsx
 *
 * Module source for DetailsTabUtilization.
 */
import React from 'react';
import { useDetailsSectionContext } from '@/core/contexts/ObjectPanelDetailsSectionContext';
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
}

interface ResourceSectionProps {
  title: string;
  usage: string;
  data: {
    usage?: string;
    request?: string;
    limit?: string;
    allocatable?: string;
  };
  type: 'cpu' | 'memory';
  mode: 'podMetrics' | 'nodeMetrics' | 'nodePods';
}

const ResourceSection: React.FC<ResourceSectionProps> = ({ title, usage, data, type, mode }) => {
  const metrics = calculateResourceMetrics(data, type);
  const formatValue = type === 'cpu' ? formatCpuValue : formatMemoryValue;

  return (
    <div className="utilization-resource">
      <div className="utilization-header">
        <div className="utilization-title">{title}</div>
        <div className="utilization-usage">{usage}</div>
      </div>
      <ResourceBarErrorBoundary>
        <ResourceBar
          usage={data.usage}
          request={data.request}
          limit={data.limit}
          allocatable={data.allocatable}
          type={type}
        />
      </ResourceBarErrorBoundary>
      <div className="utilization-details">
        {/* Top row: Usage, Allocatable */}
        <div className="utilization-detail">
          <span className="utilization-detail-label">Usage</span>
          <span className="utilization-detail-value">
            {data.usage || 'not set'}
            {metrics.usage > 0 &&
              metrics.allocatable > 0 &&
              ` (${Math.round((metrics.usage / metrics.allocatable) * 100)}%)`}
            {metrics.usage > 0 &&
              !metrics.allocatable &&
              metrics.limit > 0 &&
              ` (${Math.round((metrics.usage / metrics.limit) * 100)}%)`}
          </span>
        </div>
        {mode === 'nodeMetrics' && data.allocatable && (
          <div className="utilization-detail">
            <span className="utilization-detail-label">Allocatable</span>
            <span className="utilization-detail-value">{data.allocatable}</span>
          </div>
        )}

        {/* Middle row: Requests, Limits */}
        <div className="utilization-detail">
          <span className="utilization-detail-label">Requests</span>
          <span className="utilization-detail-value">
            {data.request || 'not set'}
            {metrics.request > 0 &&
              metrics.allocatable > 0 &&
              ` (${Math.round((metrics.request / metrics.allocatable) * 100)}%)`}
            {metrics.request > 0 &&
              !metrics.allocatable &&
              metrics.limit > 0 &&
              ` (${Math.round((metrics.request / metrics.limit) * 100)}%)`}
          </span>
        </div>
        <div className="utilization-detail">
          <span className="utilization-detail-label">Limits</span>
          <span className="utilization-detail-value">
            {data.limit || 'not set'}
            {metrics.limit > 0 && metrics.allocatable > 0 && (
              <span className={metrics.limitPercent > 100 ? 'overcommitted-text' : ''}>
                {` (${Math.round((metrics.limit / metrics.allocatable) * 100)}%)`}
              </span>
            )}
          </span>
        </div>

        {/* Bottom row: Consumption, Overcommitted */}
        {metrics.consumption !== null && (
          <div className="utilization-detail">
            <span className="utilization-detail-label">Consumption</span>
            <span className="utilization-detail-value">
              {formatValue(metrics.usage)} (
              <span className={metrics.consumption > 100 ? 'overcommitted-text' : ''}>
                {metrics.consumption}%
              </span>
              )
            </span>
          </div>
        )}
        <div className="utilization-detail">
          <span className="utilization-detail-label">Overcommitted</span>
          <span className="utilization-detail-value">
            {metrics.overcommittedAmount > 0 ? (
              <span className="overcommitted-text">
                {formatValue(metrics.overcommittedAmount)} ({metrics.overcommittedPercent}%)
              </span>
            ) : (
              `${formatValue(0)} (0%)`
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

const Utilization: React.FC<UtilizationProps> = ({ cpu, memory, pods, mode = 'podMetrics' }) => {
  const { sectionStates, setSectionExpanded } = useDetailsSectionContext();
  const expanded = sectionStates.utilization;

  return (
    <div className="object-panel-section">
      <div
        className={`object-panel-section-title collapsible${!expanded ? ' collapsed' : ''}`}
        onClick={() => setSectionExpanded('utilization', !expanded)}
      >
        <span className="collapse-icon">{expanded ? '▼' : '▶'}</span>
        Resource Utilization
      </div>

      {expanded && (
        <div className="utilization-content">
          {cpu || memory || pods ? (
            <div className="utilization-resources-grid">
              {cpu && (
                <ResourceSection
                  title="CPU"
                  usage={cpu.usage || 'not set'}
                  data={cpu}
                  type="cpu"
                  mode={mode}
                />
              )}

              {memory && (
                <ResourceSection
                  title="Memory"
                  usage={memory.usage || 'not set'}
                  data={memory}
                  type="memory"
                  mode={mode}
                />
              )}
            </div>
          ) : (
            <div className="utilization-empty">No resource utilization data available</div>
          )}
        </div>
      )}
    </div>
  );
};

export default Utilization;
