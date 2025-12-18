import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';

interface WorkloadOverviewProps {
  kind: string;
  name: string;
  age: string;
  namespace?: string;

  // Common workload fields
  ready?: string;

  // Deployment/StatefulSet fields
  replicas?: string;
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
  labels,
  annotations,
}) => {
  const normalizedKind = kind.toLowerCase();
  const isDeployment = normalizedKind === 'deployment';
  const isDaemonSet = normalizedKind === 'daemonset';
  const isStatefulSet = normalizedKind === 'statefulset';
  const { openWithObject } = useObjectPanel();

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind={kind} name={name} namespace={namespace} age={age} />

      {/* Use composed component for ready status */}
      <ResourceStatus ready={ready} />

      {/* Deployment/StatefulSet fields */}
      {(isDeployment || isStatefulSet) && (
        <>
          <OverviewItem label="Replicas" value={replicas} />
          <OverviewItem label="Up-to-date" value={upToDate} />
          <OverviewItem label="Available" value={available} />
        </>
      )}

      {/* Deployment-specific fields */}
      {isDeployment && (
        <>
          {/* Important status indicators first */}
          {paused && (
            <OverviewItem
              label="Status"
              value={<span className="status-badge warning">Paused</span>}
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
                    <span className={`status-badge ${rolloutStatus.toLowerCase()}`}>
                      {rolloutStatus}
                    </span>
                  }
                />
                {rolloutMessage && <OverviewItem label="Message" value={rolloutMessage} />}
              </>
            );
          })()}

          {/* Update strategy - combine related fields */}
          {strategy && (
            <OverviewItem
              label="Strategy"
              value={
                strategy === 'RollingUpdate'
                  ? `Rolling (max surge: ${maxSurge || '25%'}, max unavailable: ${maxUnavailable || '25%'})`
                  : strategy
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
          <OverviewItem label="Desired" value={desired} />
          <OverviewItem label="Current" value={current} />

          {/* Update strategy */}
          {updateStrategy && (
            <OverviewItem
              label="Strategy"
              value={
                updateStrategy === 'RollingUpdate' && maxUnavailable
                  ? `Rolling (max unavailable: ${maxUnavailable})`
                  : updateStrategy
              }
            />
          )}

          {/* Only show if there are issues */}
          {numberMisscheduled !== undefined && numberMisscheduled > 0 && (
            <OverviewItem
              label="Misscheduled"
              value={<span className="status-badge warning">{numberMisscheduled}</span>}
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
                <span
                  className="object-panel-link"
                  onClick={() =>
                    openWithObject &&
                    openWithObject({
                      kind: 'Service',
                      name: serviceName,
                      namespace: namespace,
                    })
                  }
                  title="Click to view service"
                >
                  {serviceName}
                </span>
              ) : undefined
            }
          />

          {/* Update strategy */}
          {updateStrategy && (
            <OverviewItem
              label="Strategy"
              value={
                updateStrategy === 'RollingUpdate' && maxUnavailable
                  ? `Rolling (partition: ${maxUnavailable || '0'})`
                  : updateStrategy
              }
            />
          )}

          {/* Only show if non-default */}
          {podManagementPolicy && podManagementPolicy !== 'OrderedReady' && (
            <OverviewItem label="Pod Management" value={podManagementPolicy} />
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
        showSelector={isDeployment || isDaemonSet || isStatefulSet}
      />
    </>
  );
};
