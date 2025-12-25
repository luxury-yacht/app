/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PolicyOverview.tsx
 *
 * Module source for PolicyOverview.
 */
import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { types } from '@wailsjs/go/models';
import './PolicyOverview.css';

interface PolicyOverviewProps {
  kind?: string;
  name?: string;
  namespace?: string;
  age?: string;
  // HPA fields
  scaleTargetRef?: types.ScaleTargetReference | null;
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  desiredReplicas?: number;
  metrics?: types.MetricSpec[] | null;
  currentMetrics?: types.MetricStatus[] | null;
  behavior?: types.ScalingBehavior | null;
  // PDB fields
  minAvailable?: string;
  maxUnavailable?: string;
  currentHealthy?: number;
  desiredHealthy?: number;
  disruptionsAllowed?: number;
  selector?: Record<string, string>;
  // ResourceQuota fields
  hard?: Record<string, string>;
  used?: Record<string, string>;
  // LimitRange fields
  limits?: any[];
  // Metadata fields
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// Policy resources Overview
export const PolicyOverview: React.FC<PolicyOverviewProps> = (props) => {
  const { kind, name, namespace, age } = props;
  const { openWithObject } = useObjectPanel();

  const handleTargetClick = () => {
    if (!props.scaleTargetRef || !openWithObject) {
      return;
    }

    openWithObject({
      kind: props.scaleTargetRef.kind,
      name: props.scaleTargetRef.name,
      namespace,
    });
  };

  // Parse policy string like "type:Pods, value:4, periodSeconds:60" into key-value pairs
  const parsePolicyString = (policy: string): Record<string, string> => {
    const result: Record<string, string> = {};
    policy.split(',').forEach((part) => {
      const colonIndex = part.indexOf(':');
      if (colonIndex > 0) {
        const key = part.slice(0, colonIndex).trim();
        const value = part.slice(colonIndex + 1).trim();
        if (key && value) {
          result[key] = value;
        }
      }
    });
    return result;
  };

  // Format a single scaling policy as a readable string
  const formatPolicy = (policy: string): string => {
    const parsed = parsePolicyString(policy);
    const type = parsed.type || parsed.Type;
    const value = parsed.value || parsed.Value;
    const period = parsed.periodSeconds || parsed.PeriodSeconds;

    if (type && value) {
      let result = `${value} ${type.toLowerCase()}`;
      if (period) {
        result += ` per ${period}s`;
      }
      return result;
    }
    return policy; // fallback to original string
  };

  // Render behavior rules as a structured display
  const renderBehaviorRules = (
    rules: types.ScalingRules | null | undefined,
    direction: 'up' | 'down'
  ): React.ReactNode => {
    // Default stabilization windows per Kubernetes docs
    const defaultStabilization = direction === 'up' ? 0 : 300;

    const stabilization = rules?.stabilizationWindowSeconds ?? defaultStabilization;
    const selectPolicy = rules?.selectPolicy || 'Max';
    const policies = rules?.policies ?? [];

    return (
      <div className="policy-detail-rows">
        {policies.length > 0 ? (
          <div className="policy-detail-row">
            <span className="policy-detail-label">Rules:</span>
            {policies.map((p, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {formatPolicy(p)}
              </span>
            ))}
          </div>
        ) : (
          <div className="policy-detail-row policy-detail-muted">
            <span className="policy-detail-label">Rules:</span>(default)
          </div>
        )}
        <div className="policy-detail-row">
          <span className="policy-detail-label">Stabilization:</span>
          {stabilization}s
        </div>
        <div className="policy-detail-row">
          <span className="policy-detail-label">Select Policy:</span>
          {selectPolicy}
        </div>
      </div>
    );
  };

  // Render replicas as aligned rows
  const renderReplicasSummary = (): React.ReactNode => {
    const hasData =
      props.currentReplicas !== undefined ||
      props.minReplicas !== undefined ||
      props.maxReplicas !== undefined;

    if (!hasData) return undefined;

    return (
      <div className="policy-detail-rows">
        {props.currentReplicas !== undefined && (
          <div className="policy-detail-row">
            <span className="policy-detail-label--narrow">Current:</span>
            {props.currentReplicas}
            {props.desiredReplicas !== undefined &&
              props.desiredReplicas !== props.currentReplicas && (
                <span className="policy-detail-muted"> (desired: {props.desiredReplicas})</span>
              )}
          </div>
        )}
        {props.minReplicas !== undefined && (
          <div className="policy-detail-row">
            <span className="policy-detail-label--narrow">Min:</span>
            {props.minReplicas}
          </div>
        )}
        {props.maxReplicas !== undefined && (
          <div className="policy-detail-row">
            <span className="policy-detail-label--narrow">Max:</span>
            {props.maxReplicas}
          </div>
        )}
      </div>
    );
  };

  const scaleUpContent = renderBehaviorRules(props.behavior?.scaleUp, 'up');
  const scaleDownContent = renderBehaviorRules(props.behavior?.scaleDown, 'down');

  const currentMetrics = props.currentMetrics ?? [];

  const findCurrentMetric = (metric: types.MetricSpec) => {
    const kind = metric.kind?.toLowerCase();
    const target = metric.target ?? {};

    return currentMetrics.find((candidate) => {
      if (candidate.kind?.toLowerCase() !== kind) return false;

      const currentData = candidate.current ?? {};
      if (kind === 'resource') {
        if (target.resource && currentData.resource) {
          return target.resource.toLowerCase() === currentData.resource.toLowerCase();
        }
        return true;
      }

      if (target.metric && currentData.metric) {
        return target.metric === currentData.metric;
      }

      if (target.object && currentData.object) {
        return target.object === currentData.object;
      }

      return true;
    });
  };

  // Render a single metric with detailed target information
  const renderMetric = (metric: types.MetricSpec, index: number): React.ReactNode => {
    const kind = metric.kind?.toLowerCase();
    const target = metric.target ?? {};
    const current = findCurrentMetric(metric);
    const currentData = current?.current ?? {};

    // Determine the metric name/resource
    let metricName: string;
    let containerName: string | null = null;
    if (kind === 'resource') {
      metricName = (target.resource || currentData.resource || 'Unknown').toUpperCase();
    } else if (kind === 'containerresource') {
      metricName = (target.resource || currentData.resource || 'Unknown').toUpperCase();
      containerName = target.container || currentData.container || null;
    } else if (kind === 'pods') {
      metricName = target.metric || 'Pods Metric';
    } else if (kind === 'object') {
      const objName = target.object || target.describedObject || '';
      metricName = target.metric
        ? `${target.metric}${objName ? ` (${objName})` : ''}`
        : objName || 'Object Metric';
    } else if (kind === 'external') {
      metricName = target.metric || 'External Metric';
    } else {
      metricName = target.metric || kind || 'Unknown';
    }

    // Determine target type and value
    let targetType: string | null = null;
    let targetValue: string | null = null;

    if (target.averageUtilization) {
      targetType = 'Utilization';
      targetValue = target.averageUtilization.includes('%')
        ? target.averageUtilization
        : `${target.averageUtilization}%`;
    } else if (target.averageValue) {
      targetType = 'Average';
      targetValue = target.averageValue;
    } else if (target.value || target.targetValue) {
      targetType = 'Value';
      targetValue = target.value || target.targetValue;
    }

    // Get current value
    let currentValue: string | null = null;
    if (currentData.averageUtilization) {
      currentValue = currentData.averageUtilization.includes('%')
        ? currentData.averageUtilization
        : `${currentData.averageUtilization}%`;
    } else if (currentData.averageValue) {
      currentValue = currentData.averageValue;
    } else if (currentData.value) {
      currentValue = currentData.value;
    }

    return (
      <div key={`metric-${index}`} className="policy-metric-block">
        <div className="policy-metric-name">
          {metricName}
          {containerName && (
            <span className="policy-detail-muted"> (container: {containerName})</span>
          )}
          {kind && kind !== 'resource' && kind !== 'containerresource' && (
            <span className="policy-detail-muted"> ({kind})</span>
          )}
        </div>
        <div className="policy-metric-details">
          {targetType && targetValue && (
            <div className="policy-detail-row">
              <span className="policy-detail-label--medium">Target:</span>
              {targetValue} ({targetType.toLowerCase()})
            </div>
          )}
          {currentValue && (
            <div className="policy-detail-row">
              <span className="policy-detail-label--medium">Current:</span>
              {currentValue}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age} />

      {/* HPA-specific fields */}
      {props.kind?.toLowerCase() === 'horizontalpodautoscaler' && (
        <>
          <OverviewItem
            label="Target"
            value={
              props.scaleTargetRef ? (
                <span className="object-panel-link" onClick={handleTargetClick}>
                  {`${props.scaleTargetRef.kind}/${props.scaleTargetRef.name}`}
                </span>
              ) : undefined
            }
          />
          <OverviewItem label="Replicas" value={renderReplicasSummary()} />
          <OverviewItem
            label="Metrics"
            value={
              props.metrics && props.metrics.length > 0 ? (
                <div className="policy-detail-rows">
                  {props.metrics.map((metric, index) => renderMetric(metric, index))}
                </div>
              ) : (
                <span className="policy-detail-muted">(none configured)</span>
              )
            }
            fullWidth
          />
          <OverviewItem label="Scale Up" value={scaleUpContent} />
          <OverviewItem label="Scale Down" value={scaleDownContent} />
          <ResourceMetadata labels={props.labels} annotations={props.annotations} />
        </>
      )}

      {/* PDB-specific fields */}
      {props.kind?.toLowerCase() === 'poddisruptionbudget' && (
        <>
          <OverviewItem label="Min Available" value={props.minAvailable} />
          <OverviewItem label="Max Unavailable" value={props.maxUnavailable} />
          <OverviewItem label="Current Healthy" value={props.currentHealthy} />
          <OverviewItem label="Desired Healthy" value={props.desiredHealthy} />
          <OverviewItem label="Disruptions Allowed" value={props.disruptionsAllowed} />
          {/* Surface selector metadata for PDBs. */}
          <ResourceMetadata
            labels={props.labels}
            annotations={props.annotations}
            selector={props.selector}
            showSelector
          />
        </>
      )}

      {/* ResourceQuota-specific fields */}
      {props.kind?.toLowerCase() === 'resourcequota' && (
        <>
          {props.hard && Object.keys(props.hard).length > 0 && (
            <OverviewItem
              label="Hard Limits"
              value={Object.entries(props.hard).map(([key, value]) => (
                <div key={key}>
                  {key}: {value}
                </div>
              ))}
              fullWidth
            />
          )}
          {props.used && Object.keys(props.used).length > 0 && (
            <OverviewItem
              label="Used"
              value={Object.entries(props.used).map(([key, value]) => (
                <div key={key}>
                  {key}: {value}
                </div>
              ))}
              fullWidth
            />
          )}
        </>
      )}

      {/* LimitRange-specific fields */}
      {props.kind?.toLowerCase() === 'limitrange' && (
        <>
          <OverviewItem
            label="Limits"
            value={props.limits ? `${props.limits.length} limit(s)` : undefined}
          />
        </>
      )}
    </>
  );
};
