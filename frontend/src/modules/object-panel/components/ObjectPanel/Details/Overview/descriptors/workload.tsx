/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/workload.tsx
 *
 * Workload Overview descriptors (X1) for Deployment, DaemonSet, StatefulSet, and ReplicaSet.
 * Presentation ported verbatim from WorkloadOverview.tsx. Each kind gets its OWN descriptor — no
 * `kind ===` branching inside a schema — and they share the irreducible widgets (pod-state bar,
 * strategy chips, pod-template group) through helper factories below.
 *
 * The descriptors read the RAW per-kind DTO. Fields the WorkloadOverview component received in a
 * flat/renamed shape (e.g. `podCount`/`readyPodCount`) are read here from their DTO home
 * (`podMetricsSummary.pods` / `.readyPods`). The HPA-managed flag is NOT on the DTO; it is read
 * from the renderer context (`context.hpaManaged`).
 */

import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { daemonset, deployment, replicaset, statefulset } from '@wailsjs/go/models';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor, OverviewItemSpec } from '../schema';
import { OverviewItem } from '../shared/OverviewItem';
import {
  DEFAULT_TOLERATION_RE,
  type ParsedToleration,
  parseToleration,
} from '../shared/tolerations';
import '../shared/OverviewBlocks.css';
import '../WorkloadOverview.css';

type DeploymentDetails = deployment.DeploymentDetails;
type DaemonSetDetails = daemonset.DaemonSetDetails;
type StatefulSetDetails = statefulset.StatefulSetDetails;
type ReplicaSetDetails = replicaset.ReplicaSetDetails;

// Cluster identity threaded through the renderer context so links resolve to the active cluster.
const clusterMeta = (context: OverviewContext) => ({
  clusterId: context.clusterId ?? undefined,
  clusterName: context.clusterName ?? undefined,
});

// ---------------------------------------------------------------------------
// Pod-state bar — multi-segment replica visualization.
// ---------------------------------------------------------------------------

/** Parse the leading integer from a Kubernetes count string ("3" or "3/5") or a
 *  raw numeric count. Returns null if the value isn't recognisable as a count.
 *  Real wire payload formats `Status.Replicas/desired` as a string here; the
 *  DaemonSet DTO reports `ready` as a plain number. */
const parseLeadingCount = (value: string | number | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const match = value.trim().match(/^(\d+)/);
  return match ? Number(match[1]) : null;
};

/** Compose the headline caption for the pod-state bar. The segment ordering is
 *  intentional: available is the goal, the rest narrate the most likely failure
 *  mode in priority order. */
const composePodStateCaption = (
  desired: number,
  created: number,
  ready: number,
  available: number,
  statusLabel: 'available' | 'ready' = 'available'
): { headline: string; drift?: string } => {
  const headline = `${available} of ${desired} ${statusLabel}`;
  if (available >= desired) {
    return { headline };
  }
  if (created < desired) {
    const n = desired - created;
    return { headline, drift: `${n} unscheduled` };
  }
  if (ready < created) {
    const n = created - ready;
    return { headline, drift: `${n} not ready` };
  }
  // Reaching here implies ready >= created >= desired > available, so the
  // remaining gap is pods that are ready but not yet available.
  const n = ready - available;
  return { headline, drift: `${n} waiting` };
};

interface PodStateBarProps {
  desired: number;
  created: number;
  ready: number;
  available: number;
  hpaManaged?: boolean;
  statusLabel?: 'available' | 'ready';
}

const PodStateBar: React.FC<PodStateBarProps> = ({
  desired,
  created,
  ready,
  available,
  hpaManaged,
  statusLabel = 'available',
}) => {
  // Scaled to 0 — render plain text rather than an empty bar with
  // "0 of 0 available", which is hard to spot.
  if (desired === 0) {
    return (
      <div className="podstate-summary">
        <div className="podstate-caption">
          <span className="podstate-caption-zero">None</span>
          {!!hpaManaged && <span className="podstate-caption-hpa">(HPA managed)</span>}
        </div>
      </div>
    );
  }

  // Clamp every band so a single misreported number can't blow out the bar.
  // The bar's denominator is `desired`; if anything exceeds desired we cap
  // it at desired so the bar never overflows.
  const cappedAvailable = Math.min(available, desired);
  const cappedReady = Math.min(ready, desired);
  const cappedCreated = Math.min(created, desired);

  const availableSeg = Math.max(0, cappedAvailable);
  const readyNotAvailableSeg = Math.max(0, cappedReady - cappedAvailable);
  const createdNotReadySeg = Math.max(0, cappedCreated - cappedReady);
  const unscheduledSeg = Math.max(0, desired - cappedCreated);

  const { headline, drift } = composePodStateCaption(
    desired,
    created,
    ready,
    available,
    statusLabel
  );

  return (
    <div className="podstate-summary">
      <div className="podstate-bar">
        {availableSeg > 0 && (
          <div className="podstate-bar-seg podstate-bar-available" style={{ flex: availableSeg }} />
        )}
        {readyNotAvailableSeg > 0 && (
          <div
            className="podstate-bar-seg podstate-bar-ready"
            style={{ flex: readyNotAvailableSeg }}
          />
        )}
        {createdNotReadySeg > 0 && (
          <div
            className="podstate-bar-seg podstate-bar-progressing"
            style={{ flex: createdNotReadySeg }}
          />
        )}
        {unscheduledSeg > 0 && (
          <div className="podstate-bar-seg" style={{ flex: unscheduledSeg }} />
        )}
      </div>
      <div className="podstate-caption">
        {headline}
        {!!drift && <span className="podstate-caption-drift">· {drift}</span>}
        {!!hpaManaged && <span className="podstate-caption-hpa">(HPA managed)</span>}
      </div>
    </div>
  );
};

/** The four pipeline counts for the pod-state bar, resolved from a DTO's count
 *  fields plus the live pod summary. Returns null when the bar can't be rendered. */
interface PodStateCounts {
  desired: number;
  created: number;
  ready: number;
  available: number;
  statusLabel: 'available' | 'ready';
}

interface RawCounts {
  desiredCount: number | null;
  createdCount: number | null;
}

const resolvePodStateCounts = (
  raw: RawCounts,
  ready: string | number | undefined,
  available: number | undefined,
  podMetricsSummary: { pods?: number; readyPods?: number } | undefined
): PodStateCounts | null => {
  let { desiredCount, createdCount } = raw;

  const podCount = podMetricsSummary?.pods;
  const readyPodCount = podMetricsSummary?.readyPods;
  const hasPodSummary =
    typeof podCount === 'number' &&
    Number.isFinite(podCount) &&
    typeof readyPodCount === 'number' &&
    Number.isFinite(readyPodCount);
  const normalizedPodCount = hasPodSummary ? podCount : null;
  const normalizedReadyPodCount = hasPodSummary ? readyPodCount : null;
  const usePodSummary =
    normalizedPodCount !== null &&
    normalizedReadyPodCount !== null &&
    (normalizedPodCount > 0 || desiredCount === 0);

  const readyCount = usePodSummary ? normalizedReadyPodCount : parseLeadingCount(ready);
  if (usePodSummary) {
    createdCount = normalizedPodCount;
    if (desiredCount !== null) {
      desiredCount = Math.max(desiredCount, normalizedPodCount);
    }
  }
  const availableCount = usePodSummary
    ? normalizedReadyPodCount
    : typeof available === 'number'
      ? available
      : null;

  if (
    desiredCount === null ||
    createdCount === null ||
    readyCount === null ||
    availableCount === null
  ) {
    return null;
  }
  return {
    desired: desiredCount,
    created: createdCount,
    ready: readyCount,
    available: availableCount,
    statusLabel: usePodSummary ? 'ready' : 'available',
  };
};

/** Pod-state bar widget — `Pods` row + trailing separator, only when counts resolve. */
const renderPodStateWidget = (
  counts: PodStateCounts | null,
  context: OverviewContext
): React.ReactNode => {
  if (!counts) {
    return null;
  }
  return (
    <>
      <OverviewItem
        label="Pods"
        fullWidth
        value={
          <PodStateBar
            desired={counts.desired}
            created={counts.created}
            ready={counts.ready}
            available={counts.available}
            hpaManaged={context.hpaManaged}
            statusLabel={counts.statusLabel}
          />
        }
      />
      <div className="metadata-section-separator" />
    </>
  );
};

// ---------------------------------------------------------------------------
// Deployment condition parsing.
// ---------------------------------------------------------------------------

/** Parse one of the backend's pre-formatted condition strings, e.g.
 *    "Available: True"
 *    "Progressing: True (NewReplicaSetAvailable)"
 *    "ReplicaFailure: True (FailedCreate) - pods \"...\" is forbidden"
 *  Returns null if the string doesn't start with the expected `Type: Status` shape. */
interface ParsedCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}
const parseCondition = (raw: string): ParsedCondition | null => {
  // Type: Status [(Reason)] [- Message]
  const m = raw.match(/^([A-Za-z]+):\s*([A-Za-z]+)\s*(?:\(([^)]+)\))?(?:\s*-\s*(.+))?$/);
  if (!m) {
    return null;
  }
  return {
    type: m[1],
    status: m[2],
    reason: m[3],
    message: m[4]?.trim(),
  };
};

const findCondition = (conditions: string[] | undefined, type: string): ParsedCondition | null => {
  if (!conditions) {
    return null;
  }
  for (const raw of conditions) {
    const parsed = parseCondition(raw);
    if (parsed && parsed.type === type) {
      return parsed;
    }
  }
  return null;
};

// Map Deployment.status.conditions[type=Progressing].reason / rolloutStatus to a
// chip variant. Complete states are filtered out at the call site.
const rolloutStatusVariant = (status: string): StatusChipVariant => {
  const s = status.toLowerCase();
  if (s.includes('fail') || s === 'replicafailure') {
    return 'unhealthy';
  }
  if (s.includes('progress')) {
    return 'info';
  }
  return 'info';
};

// ---------------------------------------------------------------------------
// Per-strategy tooltips.
// ---------------------------------------------------------------------------

/** The semantics of `RollingUpdate` differ across kinds (Deployment respects
 *  maxSurge+maxUnavailable; DaemonSet replaces per-node respecting maxUnavailable;
 *  StatefulSet replaces in reverse ordinal order respecting `partition`), so the
 *  kind disambiguates. */
type StrategyKind = 'deployment' | 'daemonset' | 'statefulset';

/** PVC accessMode tooltips. These describe how many nodes/pods can mount the
 *  volume simultaneously, which directly affects scheduling. */
const accessModeTooltip = (mode: string): string | undefined => {
  switch (mode) {
    case 'ReadWriteOnce':
      return 'Only one node can mount the volume read/write at a time.';
    case 'ReadOnlyMany':
      return 'Many nodes can mount the volume read-only. Useful for shared static content.';
    case 'ReadWriteMany':
      return 'Many nodes can mount the volume read/write at the same time. Requires a backing storage class that supports it.';
    case 'ReadWriteOncePod':
      return 'Only one pod can mount the volume read/write at a time. Stricter than ReadWriteOnce, which is per-node.';
    default:
      return undefined;
  }
};

/** StatefulSet `podManagementPolicy` tooltips. The default `OrderedReady` is
 *  normally not surfaced (filtered at the call site), but we cover it so the
 *  helper is complete. */
const podManagementTooltip = (policy: string): string | undefined => {
  switch (policy) {
    case 'OrderedReady':
      return 'Pods are created and scaled one at a time, in order. The next pod only starts once the previous one is Ready, and pods are terminated in reverse order.';
    case 'Parallel':
      return 'Pods are created and terminated in parallel without waiting for ordering or readiness. Faster scaling, but the workload must tolerate non-sequential startup.';
    default:
      return undefined;
  }
};

const strategyTooltip = (strategy: string, kind: StrategyKind): React.ReactNode | undefined => {
  switch (strategy) {
    case 'RollingUpdate':
      if (kind === 'deployment') {
        return 'Pods are replaced incrementally, controlled by maxSurge and maxUnavailable.';
      }
      if (kind === 'daemonset') {
        return 'Pods are replaced one node at a time, respecting maxUnavailable.';
      }
      if (kind === 'statefulset') {
        return (
          <>
            Pods are replaced in reverse ordinal order, one at a time.
            <br />
            <br />
            If a <code>partition</code> is set, pods with an ordinal below it stay on the old spec —
            allowing staged rollouts.
          </>
        );
      }
      return undefined;
    case 'Recreate':
      return (
        <>
          All existing pods are terminated before new ones start.
          <br />
          <br />
          Causes downtime during the transition.
        </>
      );
    case 'OnDelete':
      return 'Pods are not automatically replaced when the spec changes. Existing pods must be manually deleted.';
    default:
      return undefined;
  }
};

// ---------------------------------------------------------------------------
// Pod-template group (Service Account / Node Selector / Tolerations).
// These describe the pods themselves, not how the controller manages them.
// Shared verbatim across all four kinds via this widget factory.
// ---------------------------------------------------------------------------

interface PodTemplate {
  serviceAccount?: string;
  nodeSelector?: Record<string, string>;
  tolerations?: string[];
  namespace?: string;
}

const nonDefaultTolerations = (tolerations: string[] | undefined): ParsedToleration[] =>
  tolerations
    ?.filter((tol) => !DEFAULT_TOLERATION_RE.test(tol))
    .map(parseToleration)
    .filter((p): p is ParsedToleration => p !== null) ?? [];

const renderPodTemplateGroup = (d: PodTemplate, context: OverviewContext): React.ReactNode => {
  const tolerations = nonDefaultTolerations(d.tolerations);
  const serviceAccount = d.serviceAccount !== 'default' ? d.serviceAccount : undefined;
  const nodeSelector =
    d.nodeSelector && Object.keys(d.nodeSelector).length > 0 ? d.nodeSelector : undefined;
  if (!serviceAccount && !nodeSelector && tolerations.length === 0) {
    return null;
  }

  return (
    <>
      <div className="metadata-section-separator" />
      {/* ServiceAccount — only when explicitly set to a non-default SA. The
          implicit `default` SA is noise. */}
      {!!serviceAccount && (
        <OverviewItem
          label="Svc Account"
          value={
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'ServiceAccount',
                name: serviceAccount,
                namespace: d.namespace,
                ...clusterMeta(context),
              })}
            >
              {d.serviceAccount}
            </ObjectPanelLink>
          }
        />
      )}
      {/* Pod placement constraints — surfaced here (not in metadata) because
          they directly determine which nodes pods can land on. */}
      {!!nodeSelector && (
        <OverviewItem
          label="Node Selector"
          fullWidth
          value={
            <div className="overview-condition-list">
              {Object.entries(nodeSelector).map(([k, v]) => (
                <StatusChip key={k} variant="info">
                  {`${k}=${v}`}
                </StatusChip>
              ))}
            </div>
          }
        />
      )}
      {tolerations.length > 0 && (
        <OverviewItem
          label="Tolerations"
          fullWidth
          value={
            <div className="overview-condition-list">
              {withStableListKeys(tolerations, (toleration) => JSON.stringify(toleration)).map(
                ({ key, value: toleration }) => (
                  <StatusChip key={key} variant="info" tooltip={toleration.tooltip}>
                    {toleration.label}
                  </StatusChip>
                )
              )}
            </div>
          }
        />
      )}
    </>
  );
};

// The pod-template group reads serviceAccount/nodeSelector/tolerations (+ namespace
// for the SA link, already covered by the frame). Shared coverage list.
const POD_TEMPLATE_CONSUMES = ['serviceAccount', 'nodeSelector', 'tolerations'] as const;

// Common count/utilization/template DTO keys covered outside the Overview schema.
// containers/initContainers -> Containers section; cpu*/mem*/podMetricsSummary/pods ->
// Utilization section (podMetricsSummary is also consumed by the pod-state widget).
const COVERED_CONTAINERS = ['containers', 'initContainers'] as const;
const COVERED_UTILIZATION = [
  'cpuRequest',
  'cpuLimit',
  'cpuUsage',
  'memRequest',
  'memLimit',
  'memUsage',
  'pods',
] as const;

// ===========================================================================
// Deployment
// ===========================================================================

const deploymentItems: OverviewItemSpec<DeploymentDetails>[] = [
  { kind: 'status' },
  // Pod-state bar — single visualization replacing Replicas/Ready/Up-to-date/Available rows.
  {
    kind: 'widget',
    consumes: ['replicas', 'desiredReplicas', 'ready', 'available', 'podMetricsSummary'],
    render: (d, context) =>
      renderPodStateWidget(
        resolvePodStateCounts(
          {
            desiredCount: typeof d.desiredReplicas === 'number' ? d.desiredReplicas : null,
            createdCount: parseLeadingCount(d.replicas),
          },
          d.ready,
          d.available,
          d.podMetricsSummary
        ),
        context
      ),
  },
  // Up-to-date — only surface when there's revision drift (rollout in progress).
  {
    field: 'upToDate',
    derivedFrom: ['replicas'],
    label: 'Up-to-date',
    render: (d) => {
      const createdCount = parseLeadingCount(d.replicas);
      if (
        typeof d.upToDate === 'number' &&
        typeof createdCount === 'number' &&
        d.upToDate < createdCount
      ) {
        return `${d.upToDate} of ${createdCount}`;
      }
      return null;
    },
  },
  // Paused — important status indicator, shown only when no backend status is set.
  {
    field: 'paused',
    derivedFrom: ['status'],
    label: 'Status',
    hidden: (d) => !(d.paused && !d.status),
    render: (d) =>
      d.paused && !d.status ? <StatusChip variant="warning">Paused</StatusChip> : null,
  },
  // `Available=False` — no ready replicas at all.
  {
    field: 'conditions',
    label: 'Availability',
    render: (d) => {
      const c = findCondition(d.conditions, 'Available');
      if (c?.status !== 'False') {
        return null;
      }
      const tip = [c.reason, c.message].filter(Boolean).join(' — ') || undefined;
      return (
        <StatusChip variant="unhealthy" tooltip={tip}>
          Unavailable
        </StatusChip>
      );
    },
  },
  // `ReplicaFailure=True` — the controller couldn't create pods.
  {
    label: 'Replica Failure',
    render: (d) => {
      const c = findCondition(d.conditions, 'ReplicaFailure');
      if (c?.status !== 'True') {
        return null;
      }
      const tip = [c.reason, c.message].filter(Boolean).join(' — ') || undefined;
      return (
        <StatusChip variant="unhealthy" tooltip={tip}>
          {c.reason || 'Failed'}
        </StatusChip>
      );
    },
  },
  // Rollout status — only show if actually progressing or failed.
  {
    field: 'rolloutStatus',
    derivedFrom: ['rolloutMessage'],
    label: 'Rollout Status',
    render: (d) => {
      const isActuallyComplete =
        d.rolloutStatus === 'Complete' ||
        d.rolloutStatus === 'complete' ||
        (d.rolloutStatus === 'progressing' &&
          d.rolloutMessage?.includes('successfully progressed'));
      if (!d.rolloutStatus || isActuallyComplete) {
        return null;
      }
      return (
        <StatusChip variant={rolloutStatusVariant(d.rolloutStatus)}>{d.rolloutStatus}</StatusChip>
      );
    },
  },
  {
    field: 'rolloutMessage',
    label: 'Message',
    render: (d) => {
      const isActuallyComplete =
        d.rolloutStatus === 'Complete' ||
        d.rolloutStatus === 'complete' ||
        (d.rolloutStatus === 'progressing' &&
          d.rolloutMessage?.includes('successfully progressed'));
      if (!d.rolloutStatus || isActuallyComplete || !d.rolloutMessage) {
        return null;
      }
      return d.rolloutMessage;
    },
  },
  // Update strategy — chip + mono params when RollingUpdate.
  {
    field: 'strategy',
    derivedFrom: ['maxSurge', 'maxUnavailable'],
    label: 'Strategy',
    hidden: (d) => !d.strategy,
    render: (d) =>
      !d.strategy ? null : (
        <>
          <StatusChip variant="info" tooltip={strategyTooltip(d.strategy, 'deployment')}>
            {d.strategy}
          </StatusChip>
          {d.strategy === 'RollingUpdate' && (
            <span className="overview-value" style={{ marginLeft: '0.5rem' }}>
              surge {d.maxSurge || '25%'} / unavailable {d.maxUnavailable || '25%'}
            </span>
          )}
        </>
      ),
  },
  // Current ReplicaSet — link to the active RS, with a rollback shortcut.
  {
    field: 'currentReplicaSet',
    derivedFrom: ['currentRevision', 'revisionHistory'],
    label: 'ReplicaSet',
    fullWidth: true,
    hidden: (d) => !d.currentReplicaSet,
    render: (d, context) =>
      !d.currentReplicaSet ? null : (
        <div className="workload-replicaset">
          <ObjectPanelLink
            objectRef={buildRequiredObjectReference({
              kind: 'replicaset',
              name: d.currentReplicaSet,
              namespace: d.namespace,
              ...clusterMeta(context),
            })}
          >
            {d.currentReplicaSet}
          </ObjectPanelLink>
          {!!d.currentRevision && (
            <span className="workload-replicaset-meta">
              <span>Revision {d.currentRevision}</span>
              {typeof d.revisionHistory === 'number' &&
                d.revisionHistory > 0 &&
                d.revisionHistory !== 10 && (
                  <StatusChip
                    variant="warning"
                    tooltip="The maximum number of replicasets is set to a non-default value (default is 10)."
                  >
                    Limit {d.revisionHistory}
                  </StatusChip>
                )}
            </span>
          )}
        </div>
      ),
  },
  // Only show non-default configuration values.
  {
    field: 'minReadySeconds',
    label: 'Min Ready',
    hidden: (d) => !(d.minReadySeconds && d.minReadySeconds > 0),
    render: (d) => (d.minReadySeconds && d.minReadySeconds > 0 ? `${d.minReadySeconds}s` : null),
  },
  {
    field: 'progressDeadline',
    label: 'Deadline',
    hidden: (d) => !(d.progressDeadline && d.progressDeadline !== 600),
    render: (d) =>
      d.progressDeadline && d.progressDeadline !== 600 ? `${d.progressDeadline}s` : null,
  },
  // Pod-template group (SA / placement).
  {
    kind: 'widget',
    consumes: [...POD_TEMPLATE_CONSUMES],
    render: (d, context) => renderPodTemplateGroup(d, context),
  },
];

export const deploymentDescriptor: OverviewDescriptor<DeploymentDetails> = {
  displayKind: 'Deployment',
  dtoClass: deployment.DeploymentDetails,
  schema: { showSelector: true, items: deploymentItems },
  // details/updated -> table-summary only; replicaSets/replicaSetSummaries/observedGeneration ->
  // not surfaced in the Overview; containers -> Containers section; cpu/mem/pods -> Utilization.
  coveredElsewhere: [
    'details',
    'updated',
    'replicaSets',
    'replicaSetSummaries',
    'observedGeneration',
    ...COVERED_CONTAINERS,
    ...COVERED_UTILIZATION,
  ],
};

// ===========================================================================
// DaemonSet
// ===========================================================================

const daemonSetItems: OverviewItemSpec<DaemonSetDetails>[] = [
  { kind: 'status' },
  // Pod-state bar — replaces Desired/Current rows.
  {
    kind: 'widget',
    consumes: ['desired', 'current', 'ready', 'available', 'podMetricsSummary'],
    render: (d, context) =>
      renderPodStateWidget(
        resolvePodStateCounts(
          {
            desiredCount: typeof d.desired === 'number' ? d.desired : null,
            createdCount: typeof d.current === 'number' ? d.current : null,
          },
          d.ready,
          d.available,
          d.podMetricsSummary
        ),
        context
      ),
  },
  // Up-to-date — only surface when there's revision drift.
  {
    field: 'upToDate',
    derivedFrom: ['current'],
    label: 'Up-to-date',
    render: (d) => {
      if (
        typeof d.upToDate === 'number' &&
        typeof d.current === 'number' &&
        d.upToDate < d.current
      ) {
        return `${d.upToDate} of ${d.current}`;
      }
      return null;
    },
  },
  // Update strategy — chip + params.
  {
    field: 'updateStrategy',
    derivedFrom: ['maxSurge', 'maxUnavailable'],
    label: 'Strategy',
    hidden: (d) => !d.updateStrategy,
    render: (d) =>
      !d.updateStrategy ? null : (
        <>
          <StatusChip variant="info" tooltip={strategyTooltip(d.updateStrategy, 'daemonset')}>
            {d.updateStrategy}
          </StatusChip>
          {d.updateStrategy === 'RollingUpdate' && (
            <span className="overview-value" style={{ marginLeft: '0.5rem' }}>
              surge {d.maxSurge || '0'} / unavailable {d.maxUnavailable || '1'}
            </span>
          )}
        </>
      ),
  },
  // Only show if there are issues.
  {
    field: 'numberMisscheduled',
    label: 'Misscheduled',
    hidden: (d) => !(d.numberMisscheduled !== undefined && d.numberMisscheduled > 0),
    render: (d) =>
      d.numberMisscheduled !== undefined && d.numberMisscheduled > 0 ? (
        <StatusChip variant="warning">{d.numberMisscheduled}</StatusChip>
      ) : null,
  },
  // Pod-template group (SA / placement).
  {
    kind: 'widget',
    consumes: [...POD_TEMPLATE_CONSUMES],
    render: (d, context) => renderPodTemplateGroup(d, context),
  },
];

export const daemonSetDescriptor: OverviewDescriptor<DaemonSetDetails> = {
  displayKind: 'DaemonSet',
  dtoClass: daemonset.DaemonSetDetails,
  schema: { showSelector: true, items: daemonSetItems },
  // details -> table summary; conditions/updated/minReadySeconds/revisionHistoryLimit/
  // observedGeneration/collisionCount -> not surfaced in the DaemonSet Overview; containers ->
  // Containers section; cpu/mem/pods -> Utilization section.
  coveredElsewhere: [
    'details',
    'conditions',
    'updated',
    'minReadySeconds',
    'revisionHistoryLimit',
    'observedGeneration',
    'collisionCount',
    ...COVERED_CONTAINERS,
    ...COVERED_UTILIZATION,
  ],
};

// ===========================================================================
// StatefulSet
// ===========================================================================

const statefulSetItems: OverviewItemSpec<StatefulSetDetails>[] = [
  { kind: 'status' },
  // Pod-state bar.
  {
    kind: 'widget',
    consumes: ['replicas', 'desiredReplicas', 'ready', 'available', 'podMetricsSummary'],
    render: (d, context) =>
      renderPodStateWidget(
        resolvePodStateCounts(
          {
            desiredCount: typeof d.desiredReplicas === 'number' ? d.desiredReplicas : null,
            createdCount: parseLeadingCount(d.replicas),
          },
          d.ready,
          d.available,
          d.podMetricsSummary
        ),
        context
      ),
  },
  // Up-to-date — only surface when there's revision drift.
  {
    field: 'upToDate',
    derivedFrom: ['replicas'],
    label: 'Up-to-date',
    render: (d) => {
      const createdCount = parseLeadingCount(d.replicas);
      if (
        typeof d.upToDate === 'number' &&
        typeof createdCount === 'number' &&
        d.upToDate < createdCount
      ) {
        return `${d.upToDate} of ${createdCount}`;
      }
      return null;
    },
  },
  // Update strategy — chip + params. RollingUpdate has two independent params:
  // `partition` (ordinal cutoff) and `maxUnavailable` (alpha gate, default 1).
  {
    field: 'updateStrategy',
    derivedFrom: ['partition', 'maxUnavailable'],
    label: 'Strategy',
    hidden: (d) => !d.updateStrategy,
    render: (d) =>
      !d.updateStrategy ? null : (
        <>
          <StatusChip variant="info" tooltip={strategyTooltip(d.updateStrategy, 'statefulset')}>
            {d.updateStrategy}
          </StatusChip>
          {d.updateStrategy === 'RollingUpdate' && (
            <span style={{ marginLeft: '0.5rem' }}>
              {typeof d.partition === 'number' && d.partition > 0 && (
                <>partition {d.partition} / </>
              )}
              unavailable {d.maxUnavailable || '1'}
            </span>
          )}
        </>
      ),
  },
  // Only show if non-default.
  {
    field: 'podManagementPolicy',
    label: 'Pod Mgmt',
    hidden: (d) => !(d.podManagementPolicy && d.podManagementPolicy !== 'OrderedReady'),
    render: (d) =>
      d.podManagementPolicy && d.podManagementPolicy !== 'OrderedReady' ? (
        <StatusChip variant="info" tooltip={podManagementTooltip(d.podManagementPolicy)}>
          {d.podManagementPolicy}
        </StatusChip>
      ) : null,
  },
  {
    field: 'minReadySeconds',
    label: 'Min Ready',
    hidden: (d) => !(d.minReadySeconds && d.minReadySeconds > 0),
    render: (d) => (d.minReadySeconds && d.minReadySeconds > 0 ? `${d.minReadySeconds}s` : null),
  },
  // Volume claim templates + PVC retention. The leading separator is emitted by
  // the widget only when there's at least one volume-related row to render.
  {
    kind: 'widget',
    consumes: ['volumeClaimTemplates', 'pvcRetentionPolicy'],
    render: (d) => {
      const templates = d.volumeClaimTemplates ?? [];
      const retention = d.pvcRetentionPolicy ?? {};
      const hasTemplates = templates.length > 0;
      const hasRetention = Object.keys(retention).length > 0;
      if (!hasTemplates && !hasRetention) {
        return null;
      }
      return (
        <>
          {/* Visual separator before the volumes group. */}
          <div className="metadata-section-separator" />
          {/* Volume claim templates — definitions from spec.volumeClaimTemplates. */}
          {hasTemplates && (
            <OverviewItem
              label="Vol Templates"
              fullWidth
              value={
                <div className="workload-volume-templates">
                  {templates.map((tmpl) => (
                    <div key={tmpl.name} className="workload-volume-template">
                      <span className="workload-volume-template-name">{tmpl.name}</span>
                      <span className="workload-volume-template-meta">
                        {!!tmpl.storageRequest && <span>{tmpl.storageRequest}</span>}
                        {!!tmpl.storageClass && <span>{tmpl.storageClass}</span>}
                        {tmpl.accessModes && tmpl.accessModes.length > 0 && (
                          <span className="workload-volume-template-modes">
                            {tmpl.accessModes.map((mode) => (
                              <StatusChip
                                key={mode}
                                variant="info"
                                tooltip={accessModeTooltip(mode)}
                              >
                                {mode}
                              </StatusChip>
                            ))}
                          </span>
                        )}
                        {tmpl.volumeMode === 'Block' && (
                          <StatusChip
                            variant="warning"
                            tooltip="Block devices are presented as an unformatted disk, bypassing the filesystem layer."
                          >
                            Block
                          </StatusChip>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              }
            />
          )}
          {/* PVC retention — non-default `Delete` is destructive, so it gets a warning chip. */}
          {hasRetention && (
            <OverviewItem
              label="PVC Retention"
              fullWidth
              value={
                <div className="overview-condition-list">
                  {Object.entries(retention).map(([phase, policy]) => (
                    <StatusChip
                      key={phase}
                      variant={policy === 'Delete' ? 'warning' : 'info'}
                      tooltip={
                        policy === 'Delete'
                          ? `PVCs are deleted when ${phase === 'whenScaled' ? 'pods are scaled down' : 'the StatefulSet is deleted'}. Data is lost.`
                          : `PVCs are kept when ${phase === 'whenScaled' ? 'pods are scaled down' : 'the StatefulSet is deleted'}.`
                      }
                    >
                      {phase}: {policy}
                    </StatusChip>
                  ))}
                </div>
              }
            />
          )}
        </>
      );
    },
  },
  // Pod-template group (SA / placement).
  {
    kind: 'widget',
    consumes: [...POD_TEMPLATE_CONSUMES],
    render: (d, context) => renderPodTemplateGroup(d, context),
  },
];

export const statefulSetDescriptor: OverviewDescriptor<StatefulSetDetails> = {
  displayKind: 'StatefulSet',
  dtoClass: statefulset.StatefulSetDetails,
  schema: { showSelector: true, items: statefulSetItems },
  // details -> table summary; conditions/revisionHistoryLimit/serviceName/currentRevision/
  // updateRevision/currentReplicas/updatedReplicas/observedGeneration/collisionCount -> not
  // surfaced in the StatefulSet Overview; containers -> Containers section; cpu/mem/pods ->
  // Utilization section.
  coveredElsewhere: [
    'details',
    'conditions',
    'revisionHistoryLimit',
    'serviceName',
    'currentRevision',
    'updateRevision',
    'currentReplicas',
    'updatedReplicas',
    'observedGeneration',
    'collisionCount',
    ...COVERED_CONTAINERS,
    ...COVERED_UTILIZATION,
  ],
};

// ===========================================================================
// ReplicaSet
// ===========================================================================

const replicaSetItems: OverviewItemSpec<ReplicaSetDetails>[] = [
  { kind: 'status' },
  // Pod-state bar.
  {
    kind: 'widget',
    consumes: ['replicas', 'desiredReplicas', 'ready', 'available', 'podMetricsSummary'],
    render: (d, context) =>
      renderPodStateWidget(
        resolvePodStateCounts(
          {
            desiredCount: typeof d.desiredReplicas === 'number' ? d.desiredReplicas : null,
            createdCount: parseLeadingCount(d.replicas),
          },
          d.ready,
          d.available,
          d.podMetricsSummary
        ),
        context
      ),
  },
  // Min-ready when configured.
  {
    field: 'minReadySeconds',
    label: 'Min Ready',
    hidden: (d) => !(d.minReadySeconds && d.minReadySeconds > 0),
    render: (d) => (d.minReadySeconds && d.minReadySeconds > 0 ? `${d.minReadySeconds}s` : null),
  },
];

export const replicaSetDescriptor: OverviewDescriptor<ReplicaSetDetails> = {
  displayKind: 'ReplicaSet',
  dtoClass: replicaset.ReplicaSetDetails,
  schema: { showSelector: true, items: replicaSetItems },
  // details -> table summary; conditions/observedGeneration/isActive -> not surfaced in the
  // ReplicaSet Overview; containers -> Containers section; cpu/mem/pods -> Utilization section.
  // The pod-template group does not run for ReplicaSet (legacy parity), so serviceAccount/
  // nodeSelector/tolerations are not on the ReplicaSet DTO at all.
  coveredElsewhere: [
    'details',
    'conditions',
    'observedGeneration',
    'isActive',
    ...COVERED_CONTAINERS,
    ...COVERED_UTILIZATION,
  ],
};
