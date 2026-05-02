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
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import {
  DEFAULT_TOLERATION_RE,
  parseToleration,
  type ParsedToleration,
} from './shared/tolerations';
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
  hpaManaged?: boolean;
}

const PodStateBar: React.FC<PodStateBarProps> = ({
  desired,
  created,
  ready,
  available,
  hpaManaged,
}) => {
  // Scaled to 0 — render plain text rather than an empty bar with
  // "0 of 0 available", which is hard to spot.
  if (desired === 0) {
    return (
      <div className="podstate-summary">
        <div className="podstate-caption">
          <span className="podstate-caption-zero">Scaled to 0</span>
          {hpaManaged && <span className="podstate-caption-hpa">(HPA managed)</span>}
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
        {hpaManaged && <span className="podstate-caption-hpa">(HPA managed)</span>}
      </div>
    </div>
  );
};

/** Parse one of the backend's pre-formatted condition strings, e.g.
 *    "Available: True"
 *    "Progressing: True (NewReplicaSetAvailable)"
 *    "ReplicaFailure: True (FailedCreate) - pods \"...\" is forbidden"
 *  Returns the structured pieces. Returns null if the string doesn't
 *  start with the expected `Type: Status` shape. */
interface ParsedCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}
const parseCondition = (raw: string): ParsedCondition | null => {
  // Type: Status [(Reason)] [- Message]
  const m = raw.match(/^([A-Za-z]+):\s*([A-Za-z]+)\s*(?:\(([^)]+)\))?(?:\s*-\s*(.+))?$/);
  if (!m) return null;
  return {
    type: m[1],
    status: m[2],
    reason: m[3],
    message: m[4]?.trim(),
  };
};

const findCondition = (conditions: string[] | undefined, type: string): ParsedCondition | null => {
  if (!conditions) return null;
  for (const raw of conditions) {
    const parsed = parseCondition(raw);
    if (parsed && parsed.type === type) return parsed;
  }
  return null;
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

/** PVC accessMode tooltips. These describe how many nodes/pods can
 *  mount the volume simultaneously, which directly affects scheduling
 *  and is a frequent source of "PV won't bind" / "pods stuck pending"
 *  troubleshooting. */
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

/** StatefulSet `podManagementPolicy` tooltips. The default `OrderedReady`
 *  is normally not surfaced (filtered at the call site), but we cover it
 *  so the helper is complete. */
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
      if (kind === 'deployment')
        return 'Pods are replaced incrementally, controlled by maxSurge and maxUnavailable.';
      if (kind === 'daemonset')
        return 'Pods are replaced one node at a time, respecting maxUnavailable.';
      if (kind === 'statefulset')
        return (
          <>
            Pods are replaced in reverse ordinal order, one at a time.
            <br />
            <br />
            If a <code>partition</code> is set, pods with an ordinal below it stay on the old spec —
            allowing staged rollouts.
          </>
        );
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
  conditions?: string[];
  currentReplicaSet?: string;

  // DaemonSet-specific
  desired?: number;
  current?: number;
  updateStrategy?: string;
  numberMisscheduled?: number;

  // StatefulSet-specific
  podManagementPolicy?: string;
  partition?: number | null;
  volumeClaimTemplates?: Array<{
    name: string;
    storageRequest?: string;
    storageClass?: string;
    accessModes?: string[];
    volumeMode?: string;
  }>;
  pvcRetentionPolicy?: Record<string, string>;

  // Pod template
  serviceAccount?: string;
  nodeSelector?: Record<string, string>;
  tolerations?: string[];

  // Indicates an HPA is driving the replica count for this workload.
  hpaManaged?: boolean;

  // Actions
  canRestart?: boolean;
  canScale?: boolean;
  canDelete?: boolean;
  onRestart?: () => void;
  onRollback?: () => void;
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
  currentRevision,
  conditions,
  selector,
  desired,
  current,
  updateStrategy,
  numberMisscheduled,
  podManagementPolicy,
  partition,
  volumeClaimTemplates,
  pvcRetentionPolicy,
  serviceAccount,
  nodeSelector,
  tolerations,
  currentReplicaSet,
  hpaManaged,
  onRollback,
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
          <>
            <OverviewItem
              label="Pods"
              fullWidth
              value={
                <PodStateBar
                  desired={desiredCount}
                  created={createdCount}
                  ready={readyCount}
                  available={availableCount}
                  hpaManaged={hpaManaged}
                />
              }
            />
            <div className="metadata-section-separator" />
          </>
        );
      })()}

      {/* ReplicaSet — surface min-ready when configured. */}
      {isReplicaSet && minReadySeconds && minReadySeconds > 0 && (
        <OverviewItem label="Min Ready" value={`${minReadySeconds}s`} />
      )}

      {/* Deployment-specific fields */}
      {isDeployment && (
        <>
          {/* Up-to-date — only surface when there's revision drift
              (rollout in progress). Steady-state, every created pod is
              already on the current revision and this row is noise. */}
          {(() => {
            const createdCount = parseLeadingCount(replicas);
            if (
              typeof upToDate === 'number' &&
              typeof createdCount === 'number' &&
              upToDate < createdCount
            ) {
              return <OverviewItem label="Up-to-date" value={`${upToDate} of ${createdCount}`} />;
            }
            return null;
          })()}

          {/* Important status indicators first */}
          {paused && (
            <OverviewItem
              label="Status"
              value={<StatusChip variant="warning">Paused</StatusChip>}
            />
          )}

          {/* `Available=False` — no ready replicas at all, even if the
              rollout-status row reads "progressing." Distinct enough
              from rollout state to deserve its own chip. */}
          {(() => {
            const c = findCondition(conditions, 'Available');
            if (!c || c.status !== 'False') return null;
            const tip = [c.reason, c.message].filter(Boolean).join(' — ') || undefined;
            return (
              <OverviewItem
                label="Availability"
                value={
                  <StatusChip variant="unhealthy" tooltip={tip}>
                    Unavailable
                  </StatusChip>
                }
              />
            );
          })()}

          {/* `ReplicaFailure=True` — the controller couldn't create
              pods (quota exceeded, admission denied, etc). Currently
              invisible despite being a clear-cut error state. */}
          {(() => {
            const c = findCondition(conditions, 'ReplicaFailure');
            if (!c || c.status !== 'True') return null;
            const tip = [c.reason, c.message].filter(Boolean).join(' — ') || undefined;
            return (
              <OverviewItem
                label="Replica Failure"
                value={
                  <StatusChip variant="unhealthy" tooltip={tip}>
                    {c.reason || 'Failed'}
                  </StatusChip>
                }
              />
            );
          })()}

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
                    <span className="overview-value" style={{ marginLeft: '0.5rem' }}>
                      surge {maxSurge || '25%'} / unavailable {maxUnavailable || '25%'}
                    </span>
                  )}
                </>
              }
            />
          )}

          {/* Current ReplicaSet — link to the active RS, with a rollback
              shortcut. A non-default `revisionHistoryLimit` is surfaced
              as a warning chip since it changes how far back rollback
              can reach; the default of 10 is silent. */}
          {currentReplicaSet && (
            <OverviewItem
              label="ReplicaSet"
              fullWidth
              value={
                <div className="workload-replicaset">
                  <ObjectPanelLink
                    objectRef={buildRequiredObjectReference({
                      kind: 'replicaset',
                      name: currentReplicaSet,
                      namespace,
                      ...clusterMeta,
                    })}
                  >
                    {currentReplicaSet}
                  </ObjectPanelLink>
                  {(currentRevision || onRollback) && (
                    <span className="workload-replicaset-meta">
                      {currentRevision && <span>Revision {currentRevision}</span>}
                      {typeof revisionHistory === 'number' &&
                        revisionHistory > 0 &&
                        revisionHistory !== 10 && (
                          <StatusChip
                            variant="warning"
                            tooltip="The maximum number of replicasets is set to a non-default value (default is 10)."
                          >
                            Limit {revisionHistory}
                          </StatusChip>
                        )}
                      {onRollback && <span aria-hidden>•</span>}
                      {onRollback && (
                        <button
                          type="button"
                          className="object-panel-link workload-inline-action"
                          onClick={onRollback}
                        >
                          Rollback
                        </button>
                      )}
                    </span>
                  )}
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
        </>
      )}

      {/* DaemonSet-specific fields */}
      {isDaemonSet && (
        <>
          {/* Up-to-date — only surface when there's revision drift. */}
          {typeof upToDate === 'number' && typeof current === 'number' && upToDate < current && (
            <OverviewItem label="Up-to-date" value={`${upToDate} of ${current}`} />
          )}

          {/* Update strategy — chip + params */}
          {updateStrategy && (
            <OverviewItem
              label="Strategy"
              value={
                <>
                  <StatusChip variant="info" tooltip={strategyTooltip(updateStrategy, 'daemonset')}>
                    {updateStrategy}
                  </StatusChip>
                  {updateStrategy === 'RollingUpdate' && (
                    <span className="overview-value" style={{ marginLeft: '0.5rem' }}>
                      surge {maxSurge || '0'} / unavailable {maxUnavailable || '1'}
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
          {/* Up-to-date — only surface when there's revision drift. */}
          {(() => {
            const createdCount = parseLeadingCount(replicas);
            if (
              typeof upToDate === 'number' &&
              typeof createdCount === 'number' &&
              upToDate < createdCount
            ) {
              return <OverviewItem label="Up-to-date" value={`${upToDate} of ${createdCount}`} />;
            }
            return null;
          })()}

          {/* Update strategy — chip + params. StatefulSet RollingUpdate
              has *two* independent params: `partition` (ordinal cutoff
              for staged rollouts; default 0 = update everything) and
              `maxUnavailable` (alpha gate, default 1). They were
              previously conflated under the wrong label. */}
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
                  {updateStrategy === 'RollingUpdate' && (
                    <span style={{ marginLeft: '0.5rem' }}>
                      {typeof partition === 'number' && partition > 0 && (
                        <>partition {partition} / </>
                      )}
                      unavailable {maxUnavailable || '1'}
                    </span>
                  )}
                </>
              }
            />
          )}

          {/* Only show if non-default */}
          {podManagementPolicy && podManagementPolicy !== 'OrderedReady' && (
            <OverviewItem
              label="Pod Mgmt"
              value={
                <StatusChip variant="info" tooltip={podManagementTooltip(podManagementPolicy)}>
                  {podManagementPolicy}
                </StatusChip>
              }
            />
          )}

          {/* Min ready seconds if set */}
          {minReadySeconds && minReadySeconds > 0 && (
            <OverviewItem label="Min Ready" value={`${minReadySeconds}s`} />
          )}

          {/* Visual separator before the volumes group, so persistent
              storage info reads as its own section instead of mixing
              with rollout/strategy rows. Only emitted when there's at
              least one volume-related row to render. */}
          {((volumeClaimTemplates && volumeClaimTemplates.length > 0) ||
            (pvcRetentionPolicy && Object.keys(pvcRetentionPolicy).length > 0)) && (
            <div className="metadata-section-separator" />
          )}

          {/* Volume claim templates — definitions from the
              StatefulSet's `spec.volumeClaimTemplates`. Each row
              captures name, requested size, storage class, and access
              mode; volume mode is shown as a chip when set to `Block`
              (Filesystem is the default and stays silent). The
              actual per-replica PVCs are separate cluster resources
              and aren't included here. */}
          {volumeClaimTemplates && volumeClaimTemplates.length > 0 && (
            <OverviewItem
              label="Vol Templates"
              fullWidth
              value={
                <div className="workload-volume-templates">
                  {volumeClaimTemplates.map((tmpl) => (
                    <div key={tmpl.name} className="workload-volume-template">
                      <span className="workload-volume-template-name">{tmpl.name}</span>
                      <span className="workload-volume-template-meta">
                        {tmpl.storageRequest && <span>{tmpl.storageRequest}</span>}
                        {tmpl.storageClass && <span>{tmpl.storageClass}</span>}
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

          {/* PVC retention — `whenScaled` and `whenDeleted` control
              what happens to the per-pod PVCs when the StatefulSet
              scales down or is deleted. Default is `Retain` for both;
              non-default `Delete` is a destructive choice that loses
              data, so it gets a warning chip. */}
          {pvcRetentionPolicy && Object.keys(pvcRetentionPolicy).length > 0 && (
            <OverviewItem
              label="PVC Retention"
              fullWidth
              value={
                <div className="overview-condition-list">
                  {Object.entries(pvcRetentionPolicy).map(([phase, policy]) => (
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
      )}

      {/* Pod-template properties (SA, placement) live below the
          rollout/config block, separated for clarity — these describe
          the pods themselves, not how the controller manages them. */}
      {((serviceAccount && serviceAccount !== 'default') ||
        (nodeSelector && Object.keys(nodeSelector).length > 0) ||
        (tolerations && tolerations.some((tol) => !DEFAULT_TOLERATION_RE.test(tol)))) && (
        <div className="metadata-section-separator" />
      )}

      {/* ServiceAccount — only when explicitly set to a non-default SA.
          The implicit `default` SA is noise. */}
      {serviceAccount && serviceAccount !== 'default' && (
        <OverviewItem
          label="Svc Account"
          value={
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'ServiceAccount',
                name: serviceAccount,
                namespace,
                ...clusterMeta,
              })}
            >
              {serviceAccount}
            </ObjectPanelLink>
          }
        />
      )}

      {/* Pod placement constraints from the pod template — surfaced
          here (not in metadata) because they directly determine which
          nodes pods can land on, and are common answers to "why is
          this pod Pending". */}
      {nodeSelector && Object.keys(nodeSelector).length > 0 && (
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

      {(() => {
        const parsed =
          tolerations
            ?.filter((tol) => !DEFAULT_TOLERATION_RE.test(tol))
            .map(parseToleration)
            .filter((p): p is ParsedToleration => p !== null) ?? [];
        if (parsed.length === 0) return null;
        return (
          <OverviewItem
            label="Tolerations"
            fullWidth
            value={
              <div className="overview-condition-list">
                {parsed.map((p, i) => (
                  <StatusChip key={`${p.label}-${i}`} variant="info" tooltip={p.tooltip}>
                    {p.label}
                  </StatusChip>
                ))}
              </div>
            }
          />
        );
      })()}

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
