/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/WorkloadOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { buildObjectReference } from '@shared/utils/objectIdentity';
import './shared/OverviewBlocks.css';
import './WorkloadOverview.css';

/** Parse the leading integer from a Kubernetes count string ("3" or "3/5").
 *  Returns null if the string isn't recognisable as a count.
 *  Real wire payload formats `Status.Replicas/desired` here, but tests
 *  often pass just `'3'` — handle both. */
const parseLeadingCount = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const match = value.trim().match(/^(\d+)/);
  return match ? Number(match[1]) : null;
};

/** Compose the headline caption for the pod-state bar. The segment
 *  ordering is intentional: available is the goal, the rest narrate the
 *  most likely failure mode in priority order. */
const composePodStateCaption = (
  desired: number,
  created: number,
  ready: number,
  available: number
): { headline: string; drift?: string } => {
  const headline = `${available} of ${desired} available`;
  if (available >= desired) return { headline };
  if (created < desired) {
    const n = desired - created;
    return { headline, drift: `${n} unscheduled` };
  }
  if (ready < created) {
    const n = created - ready;
    return { headline, drift: `${n} not ready` };
  }
  if (available < ready) {
    const n = ready - available;
    return { headline, drift: `${n} waiting` };
  }
  return { headline };
};

interface PodStateBarProps {
  desired: number;
  created: number;
  ready: number;
  available: number;
}

const PodStateBar: React.FC<PodStateBarProps> = ({ desired, created, ready, available }) => {
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

  const { headline, drift } = composePodStateCaption(desired, created, ready, available);

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
        {drift && <span className="podstate-caption-drift">· {drift}</span>}
      </div>
    </div>
  );
};

// Map Deployment.status.conditions[type=Progressing].reason / rolloutStatus
// to a chip variant. Complete states are filtered out at the call site so
// they don't render at all; this helper handles the rest.
const rolloutStatusVariant = (status: string): StatusChipVariant => {
  const s = status.toLowerCase();
  if (s.includes('fail') || s === 'replicafailure') return 'unhealthy';
  if (s.includes('progress')) return 'info';
  return 'info';
};

/** Per-strategy tooltips. The semantics of `RollingUpdate` differ across
 *  kinds (Deployment respects maxSurge+maxUnavailable; DaemonSet replaces
 *  per-node respecting maxUnavailable; StatefulSet replaces in reverse
 *  ordinal order respecting `partition`), so the kind disambiguates. */
type StrategyKind = 'deployment' | 'daemonset' | 'statefulset';

const strategyTooltip = (strategy: string, kind: StrategyKind): string | undefined => {
  switch (strategy) {
    case 'RollingUpdate':
      if (kind === 'deployment')
        return 'Pods are replaced incrementally, controlled by maxSurge and maxUnavailable. Zero-downtime when configured correctly.';
      if (kind === 'daemonset')
        return 'Pods are replaced one node at a time, respecting maxUnavailable.';
      if (kind === 'statefulset')
        return 'Pods are replaced in reverse ordinal order, one at a time. Pods at indices below `partition` are not updated.';
      return undefined;
    case 'Recreate':
      return 'All existing pods are terminated before new ones start. Causes downtime during the transition.';
    case 'OnDelete':
      return 'Pods are not automatically replaced when the spec changes. Manual pod deletion is required to trigger an update.';
    default:
      return undefined;
  }
};

interface WorkloadOverviewProps {
  kind: string;
  name: string;
  age: string;
  namespace?: string;

  // Common workload fields
  ready?: string;

  // Deployment/StatefulSet fields
  replicas?: string;
  desiredReplicas?: number;
  upToDate?: number;
  available?: number;

  // Deployment-specific
  strategy?: string;
  maxSurge?: string;
  maxUnavailable?: string;
  minReadySeconds?: number;
  revisionHistory?: number;
  progressDeadline?: number;
  paused?: boolean;
  rolloutStatus?: string;
  rolloutMessage?: string;
  observedGeneration?: number;
  currentRevision?: string;
  selector?: Record<string, string>;
  deploymentConditions?: string[];
  replicaSets?: string[];

  // DaemonSet-specific
  desired?: number;
  current?: number;
  updateStrategy?: string;
  numberMisscheduled?: number;

  // StatefulSet-specific
  serviceName?: string;
  podManagementPolicy?: string;

  // Actions
  canRestart?: boolean;
  canScale?: boolean;
  canDelete?: boolean;
  onRestart?: () => void;
  onScale?: () => void;

  // Metadata
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  onScaleCancel?: () => void;
  onScaleReplicasChange?: (value: number) => void;
  onShowScaleInput?: () => void;
  onDelete?: () => void;
  scaleReplicas?: number;
  showScaleInput?: boolean;
  actionLoading?: boolean;
  deleteLoading?: boolean;
}

export const WorkloadOverview: React.FC<WorkloadOverviewProps> = ({
  kind,
  name,
  age,
  namespace,
  ready,
  replicas,
  desiredReplicas,
  upToDate,
  available,
  strategy,
  maxSurge,
  maxUnavailable,
  minReadySeconds,
  revisionHistory,
  progressDeadline,
  paused,
  rolloutStatus,
  rolloutMessage,
  selector,
  desired,
  current,
  updateStrategy,
  numberMisscheduled,
  serviceName,
  podManagementPolicy,
  replicaSets,
  labels,
  annotations,
}) => {
  const normalizedKind = kind.toLowerCase();
  const isDeployment = normalizedKind === 'deployment';
  const isDaemonSet = normalizedKind === 'daemonset';
  const isStatefulSet = normalizedKind === 'statefulset';
  const isReplicaSet = normalizedKind === 'replicaset';
  const { objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind={kind} name={name} namespace={namespace} age={age} />

      {/* Pod-state bar — single visualization replacing the previous
          Replicas / Ready / Up-to-date / Available rows. The four numeric
          fields collapse to a segmented bar with an "X of Y available"
          caption, so the steady-state case reads as one tidy row and any
          drift is immediately visible as colored segments or empty space. */}
      {(() => {
        // Resolve the four pipeline counts per kind.
        let desiredCount: number | null = null;
        let createdCount: number | null = null;
        if (isDaemonSet) {
          desiredCount = typeof desired === 'number' ? desired : null;
          createdCount = typeof current === 'number' ? current : null;
        } else if (isDeployment || isStatefulSet || isReplicaSet) {
          desiredCount = typeof desiredReplicas === 'number' ? desiredReplicas : null;
          createdCount = parseLeadingCount(replicas);
        }
        const readyCount = parseLeadingCount(ready);
        const availableCount = typeof available === 'number' ? available : null;

        if (
          desiredCount === null ||
          createdCount === null ||
          readyCount === null ||
          availableCount === null
        ) {
          return null;
        }
        return (
          <OverviewItem
            label="Pods"
            fullWidth
            value={
              <PodStateBar
                desired={desiredCount}
                created={createdCount}
                ready={readyCount}
                available={availableCount}
              />
            }
          />
        );
      })()}

      {/* Up-to-date — only surface when there's revision drift (rollout in
          progress). When all created pods are on the current revision this
          row is just noise. */}
      {(() => {
        const createdCount = isDaemonSet ? current : parseLeadingCount(replicas);
        if (
          typeof upToDate === 'number' &&
          typeof createdCount === 'number' &&
          upToDate < createdCount
        ) {
          return <OverviewItem label="Up-to-date" value={`${upToDate} of ${createdCount}`} />;
        }
        return null;
      })()}

      {/* ReplicaSet — surface min-ready when configured. */}
      {isReplicaSet && minReadySeconds && minReadySeconds > 0 && (
        <OverviewItem label="Min Ready" value={`${minReadySeconds}s`} />
      )}

      {/* Deployment-specific fields */}
      {isDeployment && (
        <>
          {/* Important status indicators first */}
          {paused && (
            <OverviewItem
              label="Status"
              value={<StatusChip variant="warning">Paused</StatusChip>}
            />
          )}

          {/* Rollout status - only show if actually progressing or failed */}
          {(() => {
            // Check if actually complete despite what status says
            const isActuallyComplete =
              rolloutStatus === 'Complete' ||
              rolloutStatus === 'complete' ||
              (rolloutStatus === 'progressing' &&
                rolloutMessage?.includes('successfully progressed'));

            if (!rolloutStatus || isActuallyComplete) return null;

            return (
              <>
                <OverviewItem
                  label="Rollout Status"
                  value={
                    <StatusChip variant={rolloutStatusVariant(rolloutStatus)}>
                      {rolloutStatus}
                    </StatusChip>
                  }
                />
                {rolloutMessage && <OverviewItem label="Message" value={rolloutMessage} />}
              </>
            );
          })()}

          {/* Update strategy — chip for the strategy name, params follow
              in mono when the strategy is RollingUpdate. */}
          {strategy && (
            <OverviewItem
              label="Strategy"
              value={
                <>
                  <StatusChip variant="info" tooltip={strategyTooltip(strategy, 'deployment')}>
                    {strategy}
                  </StatusChip>
                  {strategy === 'RollingUpdate' && (
                    <span className="overview-value-mono" style={{ marginLeft: '0.5rem' }}>
                      surge {maxSurge || '25%'} / unavailable {maxUnavailable || '25%'}
                    </span>
                  )}
                </>
              }
            />
          )}

          {/* ReplicaSets — revision history. Each entry links to its panel. */}
          {replicaSets && replicaSets.length > 0 && (
            <OverviewItem
              label="ReplicaSets"
              fullWidth
              value={
                <div className="overview-stacked">
                  {replicaSets.map((rsName, i) => (
                    <div key={`${rsName}-${i}`}>
                      <ObjectPanelLink
                        objectRef={buildObjectReference({
                          kind: 'replicaset',
                          name: rsName,
                          namespace,
                          ...clusterMeta,
                        })}
                      >
                        {rsName}
                      </ObjectPanelLink>
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {/* Only show non-default configuration values */}
          {minReadySeconds && minReadySeconds > 0 && (
            <OverviewItem label="Min Ready" value={`${minReadySeconds}s`} />
          )}

          {progressDeadline && progressDeadline !== 600 && (
            <OverviewItem label="Deadline" value={`${progressDeadline}s`} />
          )}

          {revisionHistory && revisionHistory !== 10 && (
            <OverviewItem label="History Limit" value={revisionHistory} />
          )}
        </>
      )}

      {/* DaemonSet-specific fields */}
      {isDaemonSet && (
        <>
          {/* Update strategy — chip + params */}
          {updateStrategy && (
            <OverviewItem
              label="Strategy"
              value={
                <>
                  <StatusChip variant="info" tooltip={strategyTooltip(updateStrategy, 'daemonset')}>
                    {updateStrategy}
                  </StatusChip>
                  {updateStrategy === 'RollingUpdate' && maxUnavailable && (
                    <span className="overview-value-mono" style={{ marginLeft: '0.5rem' }}>
                      max unavailable {maxUnavailable}
                    </span>
                  )}
                </>
              }
            />
          )}

          {/* Only show if there are issues */}
          {numberMisscheduled !== undefined && numberMisscheduled > 0 && (
            <OverviewItem
              label="Misscheduled"
              value={<StatusChip variant="warning">{numberMisscheduled}</StatusChip>}
            />
          )}
        </>
      )}

      {/* StatefulSet-specific fields */}
      {isStatefulSet && (
        <>
          {/* Service name is essential for StatefulSets - make it clickable */}
          <OverviewItem
            label="Service"
            value={
              serviceName ? (
                <ObjectPanelLink
                  objectRef={buildObjectReference({
                    kind: 'Service',
                    name: serviceName,
                    namespace: namespace,
                    ...clusterMeta,
                  })}
                  title="Click to view service"
                >
                  {serviceName}
                </ObjectPanelLink>
              ) : undefined
            }
          />

          {/* Update strategy — chip + params */}
          {updateStrategy && (
            <OverviewItem
              label="Strategy"
              value={
                <>
                  <StatusChip
                    variant="info"
                    tooltip={strategyTooltip(updateStrategy, 'statefulset')}
                  >
                    {updateStrategy}
                  </StatusChip>
                  {updateStrategy === 'RollingUpdate' && maxUnavailable && (
                    <span className="overview-value-mono" style={{ marginLeft: '0.5rem' }}>
                      partition {maxUnavailable}
                    </span>
                  )}
                </>
              }
            />
          )}

          {/* Only show if non-default */}
          {podManagementPolicy && podManagementPolicy !== 'OrderedReady' && (
            <OverviewItem
              label="Pod Management"
              value={<StatusChip variant="info">{podManagementPolicy}</StatusChip>}
            />
          )}

          {/* Min ready seconds if set */}
          {minReadySeconds && minReadySeconds > 0 && (
            <OverviewItem label="Min Ready" value={`${minReadySeconds}s`} />
          )}
        </>
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata
        labels={labels}
        annotations={annotations}
        selector={selector}
        showSelector={isDeployment || isDaemonSet || isStatefulSet || isReplicaSet}
      />
    </>
  );
};
