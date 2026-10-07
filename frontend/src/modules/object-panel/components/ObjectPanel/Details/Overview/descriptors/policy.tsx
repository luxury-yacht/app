/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/policy.tsx
 *
 * Autoscaling & Policy Overview descriptors (X1). One descriptor per kind —
 * HorizontalPodAutoscaler, LimitRange, PodDisruptionBudget, ResourceQuota — split out from the
 * kind-branching PolicyOverview.tsx. PodDisruptionBudget groups its rows into Health and Budget
 * sections; the renderer owns the frame (ResourceHeader / ResourceMetadata).
 */

import type { hpa, limitrange, poddisruptionbudget, resourcequota } from '@core/backend-api/models';
import { LiveAgeText } from '@shared/components/LiveAgeText';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { buildRequiredRelatedObjectReference } from '@shared/utils/objectIdentity';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import { OperatorList, OperatorSection, operatorSelectorValues } from '../shared/OperatorOverview';
import { OverviewItem } from '../shared/OverviewItem';
import '../PolicyOverview.css';
// PDB health reuses the workload pod-state bar.
import '../WorkloadOverview.css';

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
const metricStatusMatchesSpec = (metric: hpa.MetricSpec, candidate: hpa.MetricStatus): boolean => {
  const kind = metric.kind?.toLowerCase();
  if (candidate.kind?.toLowerCase() !== kind) {
    return false;
  }

  const target = metric.target ?? {};
  const currentData = candidate.current ?? {};
  if (kind === 'resource') {
    return target.resource && currentData.resource
      ? target.resource.toLowerCase() === currentData.resource.toLowerCase()
      : true;
  }
  if (target.metric && currentData.metric) {
    return target.metric === currentData.metric;
  }
  return target.object && currentData.object ? target.object === currentData.object : true;
};

const findCurrentMetric = (
  metric: hpa.MetricSpec,
  currentMetrics: hpa.MetricStatus[]
): hpa.MetricStatus | undefined =>
  currentMetrics.find((candidate) => metricStatusMatchesSpec(metric, candidate));

type MetricValueMap = Record<string, string>;

type MetricDisplay = {
  name: string;
  containerName: string | null;
};

const objectMetricName = (target: MetricValueMap): string => {
  const objectName = target.object || target.describedObject || '';
  const objectSuffix = objectName ? ` (${objectName})` : '';
  return target.metric ? `${target.metric}${objectSuffix}` : objectName || 'Object Metric';
};

const metricDisplay = (
  kind: string | undefined,
  target: MetricValueMap,
  current: MetricValueMap
): MetricDisplay => {
  switch (kind) {
    case 'resource':
      return {
        name: (target.resource || current.resource || 'Unknown').toUpperCase(),
        containerName: null,
      };
    case 'containerresource':
      return {
        name: (target.resource || current.resource || 'Unknown').toUpperCase(),
        containerName: target.container || current.container || null,
      };
    case 'pods':
      return { name: target.metric || 'Pods Metric', containerName: null };
    case 'object':
      return { name: objectMetricName(target), containerName: null };
    case 'external':
      return { name: target.metric || 'External Metric', containerName: null };
    default:
      return { name: target.metric || kind || 'Unknown', containerName: null };
  }
};

type TargetMetricValue = { type: string; value: string };

const targetMetricValue = (target: MetricValueMap): TargetMetricValue | null => {
  if (target.averageUtilization) {
    return {
      type: 'Utilization',
      value: target.averageUtilization.includes('%')
        ? target.averageUtilization
        : `${target.averageUtilization}%`,
    };
  }
  if (target.averageValue) {
    return { type: 'Average', value: target.averageValue };
  }
  const value = target.value || target.targetValue;
  return value ? { type: 'Value', value } : null;
};

const currentMetricValue = (current: MetricValueMap): string | null => {
  if (current.averageUtilization) {
    return current.averageUtilization.includes('%')
      ? current.averageUtilization
      : `${current.averageUtilization}%`;
  }
  return current.averageValue || current.value || null;
};

// Render a single metric with detailed target information.
const renderMetric = (
  metric: hpa.MetricSpec,
  currentMetrics: hpa.MetricStatus[]
): React.ReactNode => {
  const kind = metric.kind?.toLowerCase();
  const target = (metric.target ?? {}) as MetricValueMap;
  const current = findCurrentMetric(metric, currentMetrics);
  const currentData = (current?.current ?? {}) as MetricValueMap;
  const display = metricDisplay(kind, target, currentData);
  const targetValue = targetMetricValue(target);
  const currentValue = currentMetricValue(currentData);

  return (
    <div key={`metric:${display.name}`} className="policy-metric-block">
      <div className="policy-metric-name">
        {display.name}
        {!!display.containerName && (
          <span className="policy-detail-muted"> (container: {display.containerName})</span>
        )}
        {kind && kind !== 'resource' && kind !== 'containerresource' && (
          <span className="policy-detail-muted"> ({kind})</span>
        )}
      </div>
      <div className="policy-metric-details">
        {!!targetValue && (
          <div className="policy-detail-row">
            <span className="policy-detail-label--medium">Target:</span>
            {targetValue.value} ({targetValue.type.toLowerCase()})
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
  dtoName: 'HorizontalPodAutoscalerDetails',
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
        render: renderReplicasSummary,
      },
      {
        kind: 'widget',
        consumes: ['metrics', 'currentMetrics'],
        render: renderMetricsWidget,
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
  dtoName: 'LimitRangeDetails',
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

interface DisruptionVerdict {
  variant: StatusChipVariant;
  label: string;
  detail?: string;
  message?: string;
}

// Why no disruption is allowed. Each cause needs a different fix: wait for pods to recover, relax a
// budget that can never be met, or let in-flight evictions finish.
const blockedDetail = (d: PodDisruptionBudgetDetails): string | undefined => {
  if (d.desiredHealthy >= d.expectedPods) {
    return `The budget requires all ${d.expectedPods} pods to stay healthy, so evictions never proceed`;
  }
  const unhealthy = d.expectedPods - d.currentHealthy;
  if (unhealthy > 0) {
    return `${unhealthy} of ${d.expectedPods} pods not healthy; ${d.desiredHealthy} healthy pods required`;
  }
  // The eviction API spends the budget before the controller sees the evicted pod go.
  return d.disruptedPods?.length ? 'Recent evictions are using the budget' : undefined;
};

// A SyncFailed condition wins: the controller could not compute the budget, so the counts may be stale.
const disruptionVerdict = (d: PodDisruptionBudgetDetails): DisruptionVerdict => {
  const syncFailure = d.conditions?.find(
    (condition) => condition.type === 'DisruptionAllowed' && condition.reason === 'SyncFailed'
  );
  if (syncFailure) {
    return {
      variant: 'unhealthy',
      label: 'Blocked',
      detail: 'The disruption controller could not compute this budget',
      message: syncFailure.message,
    };
  }
  if (d.expectedPods <= 0) {
    return {
      variant: 'warning',
      label: 'No pods',
      detail: 'The selector matches no pods, so this budget protects nothing',
    };
  }
  if (d.disruptionsAllowed > 0) {
    return { variant: 'healthy', label: `${d.disruptionsAllowed} allowed` };
  }
  return { variant: 'warning', label: 'Blocked', detail: blockedDetail(d) };
};

const clampCount = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

// Healthy pods against the pods the budget counts, with a marker at the number that must stay healthy.
// Reuses the workload pod-state bar.
const PdbHealthBar: React.FC<{ data: PodDisruptionBudgetDetails }> = ({ data }) => {
  const expected = data.expectedPods;
  if (expected <= 0) {
    return (
      <div className="podstate-summary">
        <div className="podstate-caption">
          <span className="podstate-caption-zero">No matching pods</span>
        </div>
      </div>
    );
  }
  const healthy = clampCount(data.currentHealthy, expected);
  const required = clampCount(data.desiredHealthy, expected);
  const fill =
    data.disruptionsAllowed > 0 ? 'pdb-health-fill--allowed' : 'pdb-health-fill--blocked';
  return (
    <div className="podstate-summary">
      <div className="pdb-health-track">
        <div className="podstate-bar">
          {healthy > 0 && <div className={`podstate-bar-seg ${fill}`} style={{ flex: healthy }} />}
          {healthy < expected && (
            <div className="podstate-bar-seg" style={{ flex: expected - healthy }} />
          )}
        </div>
        {required > 0 && (
          <div
            className="pdb-health-required"
            style={{ left: `${(required / expected) * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="podstate-caption">
        {data.currentHealthy} of {expected} healthy · {data.desiredHealthy} required
      </div>
    </div>
  );
};

const renderDisruptions = (d: PodDisruptionBudgetDetails): React.ReactNode => {
  const verdict = disruptionVerdict(d);
  return (
    <div className="operator-status">
      <div className="operator-status-line">
        <StatusChip variant={verdict.variant}>{verdict.label}</StatusChip>
        {!!verdict.detail && <span className="operator-status-detail">{verdict.detail}</span>}
      </div>
      {!!verdict.message && <p className="operator-note">{verdict.message}</p>}
    </div>
  );
};

const disruptedPodLink = (
  pod: poddisruptionbudget.DisruptedPod['pod'],
  clusterName: string | undefined
): React.ReactNode => {
  const name = pod.ref?.name ?? pod.display?.name;
  const ref = resourceLinkToObjectReference(pod, clusterName);
  return ref ? <ObjectPanelLink objectRef={ref}>{name}</ObjectPanelLink> : name;
};

const renderDisruptedPods = (
  d: PodDisruptionBudgetDetails,
  context: OverviewContext
): React.ReactNode => {
  if (!d.disruptedPods?.length) {
    return undefined;
  }
  return (
    <div className="overview-ref-list">
      {d.disruptedPods.map(({ pod, disruptionTime }) => {
        const name = pod.ref?.name ?? pod.display?.name;
        return (
          <span key={name} className="overview-ref-item">
            {disruptedPodLink(pod, context.clusterName)}{' '}
            <span className="policy-detail-muted">
              evicted <LiveAgeText timestamp={disruptionTime} fullDateTitle /> ago
            </span>
          </span>
        );
      })}
    </div>
  );
};

const budgetRule = (d: PodDisruptionBudgetDetails): { label: string; value: string } | null => {
  if (d.minAvailable) {
    return { label: 'Min Available', value: d.minAvailable };
  }
  if (d.maxUnavailable) {
    return { label: 'Max Unavailable', value: d.maxUnavailable };
  }
  return null;
};

const UNHEALTHY_POD_POLICY_NOTES: Record<string, string> = {
  IfHealthyBudget: 'not-ready pods can be evicted only while the budget is met',
  AlwaysAllow: 'not-ready pods can always be evicted',
};

// Kubernetes applies IfHealthyBudget when the policy is unset; unknown future policies show as-is.
const renderUnhealthyPodPolicy = (d: PodDisruptionBudgetDetails): React.ReactNode => {
  const policy = d.unhealthyPodEvictionPolicy || 'IfHealthyBudget';
  const note = UNHEALTHY_POD_POLICY_NOTES[policy];
  return (
    <span>
      {policy}
      {!d.unhealthyPodEvictionPolicy && <span className="policy-detail-muted"> (default)</span>}
      {!!note && <span className="policy-detail-muted"> · {note}</span>}
    </span>
  );
};

const PdbBudget: React.FC<{ data: PodDisruptionBudgetDetails }> = ({ data }) => {
  const rule = budgetRule(data);
  return (
    <OperatorSection title="Budget">
      {!!rule && (
        <OverviewItem
          label={rule.label}
          value={
            <span>
              {rule.value}
              {data.expectedPods > 0 && (
                <span className="policy-detail-muted">
                  {' '}
                  · {data.desiredHealthy} of {data.expectedPods} pods must stay healthy
                </span>
              )}
            </span>
          }
        />
      )}
      <OverviewItem
        label="Selector"
        value={
          <OperatorList
            values={operatorSelectorValues(data.selector, {
              absent: 'None (matches no pods)',
              empty: 'All pods in the namespace',
            })}
          />
        }
      />
      <OverviewItem label="Unhealthy Pods" value={renderUnhealthyPodPolicy(data)} />
    </OperatorSection>
  );
};

// Health leads because the operational question is whether pods can be evicted right now; Budget
// follows with the rule that decides it.
const PdbOverview: React.FC<{ data: PodDisruptionBudgetDetails; context: OverviewContext }> = ({
  data,
  context,
}) => (
  <div className="operator-overview">
    <OperatorSection title="Health">
      <OverviewItem label="Pods" value={<PdbHealthBar data={data} />} />
      <OverviewItem label="Disruptions" value={renderDisruptions(data)} />
      <OverviewItem label="Disrupted" value={renderDisruptedPods(data, context)} />
    </OperatorSection>
    <PdbBudget data={data} />
  </div>
);

export const pdbDescriptor: OverviewDescriptor<PodDisruptionBudgetDetails> = {
  displayKind: 'PodDisruptionBudget',
  dtoName: 'PodDisruptionBudgetDetails',
  schema: {
    items: [
      {
        kind: 'widget',
        consumes: [
          'currentHealthy',
          'desiredHealthy',
          'disruptionsAllowed',
          'expectedPods',
          'disruptedPods',
          'conditions',
          'minAvailable',
          'maxUnavailable',
          'selector',
          'unhealthyPodEvictionPolicy',
        ],
        render: (d, context) => <PdbOverview data={d} context={context} />,
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string) and `observedGeneration`.
  coveredElsewhere: ['details', 'observedGeneration'],
};

// ---------------------------------------------------------------------------
// ResourceQuota
// ---------------------------------------------------------------------------

const renderQuotaMap = (entries: Record<string, string | undefined>): React.ReactNode =>
  Object.entries(entries).map(([key, value]) => (
    <div key={key}>
      {key}: {value}
    </div>
  ));

export const resourceQuotaDescriptor: OverviewDescriptor<ResourceQuotaDetails> = {
  displayKind: 'ResourceQuota',
  dtoName: 'ResourceQuotaDetails',
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
