/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/policy.tsx
 *
 * Autoscaling & Policy Overview descriptors (X1). One descriptor per kind —
 * HorizontalPodAutoscaler, LimitRange, PodDisruptionBudget, ResourceQuota — split out from the
 * kind-branching PolicyOverview.tsx. Presentation ported verbatim; the renderer owns the frame
 * (ResourceHeader / ResourceMetadata).
 */

import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildRequiredRelatedObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { hpa, limitrange, poddisruptionbudget, resourcequota } from '@wailsjs/go/models';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import '../PolicyOverview.css';

type HorizontalPodAutoscalerDetails = hpa.HorizontalPodAutoscalerDetails;
type LimitRangeDetails = limitrange.LimitRangeDetails;
type PodDisruptionBudgetDetails = poddisruptionbudget.PodDisruptionBudgetDetails;
type ResourceQuotaDetails = resourcequota.ResourceQuotaDetails;

// ---------------------------------------------------------------------------
// HorizontalPodAutoscaler
// ---------------------------------------------------------------------------

// Parse a policy string like "type:Pods, value:4, periodSeconds:60" into key-value pairs.
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

// Format a single scaling policy as a readable string.
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

// Render behavior rules as a structured display.
const renderBehaviorRules = (
  rules: hpa.ScalingRules | null | undefined,
  direction: 'up' | 'down'
): React.ReactNode => {
  // Default stabilization windows per Kubernetes docs.
  const defaultStabilization = direction === 'up' ? 0 : 300;

  const stabilization = rules?.stabilizationWindowSeconds ?? defaultStabilization;
  const selectPolicy = rules?.selectPolicy || 'Max';
  const policies = rules?.policies ?? [];

  return (
    <div className="policy-detail-rows">
      {policies.length > 0 ? (
        <div className="policy-detail-row">
          <span className="policy-detail-label">Rules:</span>
          {withStableListKeys(policies, formatPolicy).map(({ key, value: p }, i) => (
            <span key={key}>
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

// Render replicas as aligned rows.
const renderReplicasSummary = (d: HorizontalPodAutoscalerDetails): React.ReactNode => {
  const hasData =
    d.currentReplicas !== undefined || d.minReplicas !== undefined || d.maxReplicas !== undefined;

  if (!hasData) {
    return undefined;
  }

  return (
    <div className="policy-detail-rows">
      {d.currentReplicas !== undefined && (
        <div className="policy-detail-row">
          <span className="policy-detail-label--narrow">Current:</span>
          {d.currentReplicas}
          {d.desiredReplicas !== undefined && d.desiredReplicas !== d.currentReplicas && (
            <span className="policy-detail-muted"> (desired: {d.desiredReplicas})</span>
          )}
        </div>
      )}
      {d.minReplicas !== undefined && (
        <div className="policy-detail-row">
          <span className="policy-detail-label--narrow">Min:</span>
          {d.minReplicas}
        </div>
      )}
      {d.maxReplicas !== undefined && (
        <div className="policy-detail-row">
          <span className="policy-detail-label--narrow">Max:</span>
          {d.maxReplicas}
        </div>
      )}
    </div>
  );
};

// Match a configured metric spec to its current status entry. The generated MetricSpec.target and
// MetricStatus.current are flattened to string maps, so fields like `resource`/`metric`/`object`
// are read by key.
const findCurrentMetric = (
  metric: hpa.MetricSpec,
  currentMetrics: hpa.MetricStatus[]
): hpa.MetricStatus | undefined => {
  const kind = metric.kind?.toLowerCase();
  const target = metric.target ?? {};

  return currentMetrics.find((candidate) => {
    if (candidate.kind?.toLowerCase() !== kind) {
      return false;
    }

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

// Render a single metric with detailed target information.
const renderMetric = (
  metric: hpa.MetricSpec,
  currentMetrics: hpa.MetricStatus[]
): React.ReactNode => {
  const kind = metric.kind?.toLowerCase();
  const target = metric.target ?? {};
  const current = findCurrentMetric(metric, currentMetrics);
  const currentData = current?.current ?? {};

  // Determine the metric name/resource.
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

  // Determine target type and value.
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

  // Get current value.
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
    <div key={`metric:${metricName}`} className="policy-metric-block">
      <div className="policy-metric-name">
        {metricName}
        {!!containerName && (
          <span className="policy-detail-muted"> (container: {containerName})</span>
        )}
        {kind && kind !== 'resource' && kind !== 'containerresource' && (
          <span className="policy-detail-muted"> ({kind})</span>
        )}
      </div>
      <div className="policy-metric-details">
        {!!(targetType && targetValue) && (
          <div className="policy-detail-row">
            <span className="policy-detail-label--medium">Target:</span>
            {targetValue} ({targetType.toLowerCase()})
          </div>
        )}
        {!!currentValue && (
          <div className="policy-detail-row">
            <span className="policy-detail-label--medium">Current:</span>
            {currentValue}
          </div>
        )}
      </div>
    </div>
  );
};

// The Metrics block consumes both `metrics` (configured) and `currentMetrics` (observed), matching
// each spec to its current status when rendering.
const renderMetricsWidget = (d: HorizontalPodAutoscalerDetails): React.ReactNode => {
  const currentMetrics = d.currentMetrics ?? [];
  return (
    <div className="overview-item full-width">
      <span className="overview-label">Metrics</span>
      <span className="overview-value">
        {d.metrics && d.metrics.length > 0 ? (
          <div className="policy-detail-rows">
            {d.metrics.map((metric) => renderMetric(metric, currentMetrics))}
          </div>
        ) : (
          <span className="policy-detail-muted">(none configured)</span>
        )}
      </span>
    </div>
  );
};

// Build the scale-target link reference. Prefers the apiVersion the HPA explicitly references so
// CRD scale targets keep their real GVK. Returns null when the reference can't be resolved.
const scaleTargetReference = (d: HorizontalPodAutoscalerDetails, context: OverviewContext) => {
  if (!d.scaleTargetRef) {
    return null;
  }
  try {
    return buildRequiredRelatedObjectReference({
      kind: d.scaleTargetRef.kind,
      apiVersion: d.scaleTargetRef.apiVersion,
      name: d.scaleTargetRef.name,
      namespace: d.namespace,
      clusterId: context.clusterId ?? undefined,
      clusterName: context.clusterName ?? undefined,
    });
  } catch {
    return null;
  }
};

export const hpaDescriptor: OverviewDescriptor<HorizontalPodAutoscalerDetails> = {
  displayKind: 'HorizontalPodAutoscaler',
  dtoClass: hpa.HorizontalPodAutoscalerDetails,
  schema: {
    items: [
      {
        field: 'scaleTargetRef',
        label: 'Target',
        render: (d, context) => {
          if (!d.scaleTargetRef) {
            return undefined;
          }
          const ref = scaleTargetReference(d, context);
          const label = `${d.scaleTargetRef.kind}/${d.scaleTargetRef.name}`;
          return ref ? <ObjectPanelLink objectRef={ref}>{label}</ObjectPanelLink> : label;
        },
      },
      {
        field: 'currentReplicas',
        derivedFrom: ['minReplicas', 'maxReplicas', 'desiredReplicas'],
        label: 'Replicas',
        render: (d) => renderReplicasSummary(d),
      },
      {
        kind: 'widget',
        consumes: ['metrics', 'currentMetrics'],
        render: (d) => renderMetricsWidget(d),
      },
      {
        field: 'behavior',
        label: 'Scale Up',
        render: (d) => renderBehaviorRules(d.behavior?.scaleUp, 'up'),
      },
      {
        // `behavior` is fully covered by the Scale Up row above.
        label: 'Scale Down',
        render: (d) => renderBehaviorRules(d.behavior?.scaleDown, 'down'),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string), `conditions`, and
  // `lastScaleTime` (not rendered).
  coveredElsewhere: ['details', 'conditions', 'lastScaleTime'],
};

// ---------------------------------------------------------------------------
// LimitRange
// ---------------------------------------------------------------------------

export const limitRangeDescriptor: OverviewDescriptor<LimitRangeDetails> = {
  displayKind: 'LimitRange',
  dtoClass: limitrange.LimitRangeDetails,
  schema: {
    items: [
      {
        field: 'limits',
        label: 'Limits',
        render: (d) => (d.limits ? `${d.limits.length} limit(s)` : undefined),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string).
  coveredElsewhere: ['details'],
};

// ---------------------------------------------------------------------------
// PodDisruptionBudget
// ---------------------------------------------------------------------------

export const pdbDescriptor: OverviewDescriptor<PodDisruptionBudgetDetails> = {
  displayKind: 'PodDisruptionBudget',
  dtoClass: poddisruptionbudget.PodDisruptionBudgetDetails,
  schema: {
    // Surface selector metadata for PDBs.
    showSelector: true,
    items: [
      { field: 'minAvailable', label: 'Min Available' },
      { field: 'maxUnavailable', label: 'Max Unavailable' },
      { field: 'currentHealthy', label: 'Current Healthy' },
      { field: 'desiredHealthy', label: 'Desired Healthy' },
      { field: 'disruptionsAllowed', label: 'Disruptions Allowed' },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string), `expectedPods`,
  // `observedGeneration`, `disruptedPods`, and `conditions` (not rendered).
  coveredElsewhere: [
    'details',
    'expectedPods',
    'observedGeneration',
    'disruptedPods',
    'conditions',
  ],
};

// ---------------------------------------------------------------------------
// ResourceQuota
// ---------------------------------------------------------------------------

const renderQuotaMap = (entries: Record<string, string>): React.ReactNode =>
  Object.entries(entries).map(([key, value]) => (
    <div key={key}>
      {key}: {value}
    </div>
  ));

export const resourceQuotaDescriptor: OverviewDescriptor<ResourceQuotaDetails> = {
  displayKind: 'ResourceQuota',
  dtoClass: resourcequota.ResourceQuotaDetails,
  schema: {
    items: [
      {
        field: 'hard',
        label: 'Hard Limits',
        fullWidth: true,
        hidden: (d) => !(d.hard && Object.keys(d.hard).length > 0),
        render: (d) => renderQuotaMap(d.hard ?? {}),
      },
      {
        field: 'used',
        label: 'Used',
        fullWidth: true,
        hidden: (d) => !(d.used && Object.keys(d.used).length > 0),
        render: (d) => renderQuotaMap(d.used ?? {}),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string), `scopes`, `scopeSelector`, and
  // `usedPercentage` (not rendered).
  coveredElsewhere: ['details', 'scopes', 'scopeSelector', 'usedPercentage'],
};
