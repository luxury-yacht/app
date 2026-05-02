/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PodOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import {
  buildObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';
import {
  DEFAULT_TOLERATION_RE,
  parseToleration,
  type ParsedToleration,
} from './shared/tolerations';
import '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewBlocks.css';

const qosVariant = (qosClass: string): StatusChipVariant => {
  if (qosClass === 'Guaranteed') return 'healthy';
  if (qosClass === 'BestEffort') return 'warning';
  return 'info';
};

const qosTooltip = (qosClass: string): string | undefined => {
  if (qosClass === 'Guaranteed') {
    return 'Every container has equal CPU and memory requests and limits. Last to be evicted under node resource pressure.';
  }
  if (qosClass === 'Burstable') {
    return 'At least one container has CPU or memory requests/limits set, but the pod does not meet the Guaranteed criteria. Evicted before Guaranteed pods under node resource pressure.';
  }
  if (qosClass === 'BestEffort') {
    return 'No container has any CPU or memory requests or limits set. First to be evicted under node resource pressure.';
  }
  return undefined;
};

interface PodOverviewProps {
  name: string;
  age: string;
  namespace?: string;
  node?: string;
  nodeIP?: string;
  podIP?: string;
  owner?: string | { kind: string; name: string; apiVersion?: string };
  status?: string;
  statusSeverity?: string;
  ready?: string;
  restarts?: number;
  qosClass?: string;
  priorityClass?: string;
  serviceAccount?: string;
  hostNetwork?: boolean;
  hostPID?: boolean;
  hostIPC?: boolean;
  tolerations?: string[];
  restartPolicy?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export const PodOverview: React.FC<PodOverviewProps> = ({
  name,
  age,
  namespace,
  node,
  nodeIP,
  podIP,
  owner,
  status,
  statusSeverity,
  ready,
  restarts,
  qosClass,
  priorityClass,
  serviceAccount,
  hostNetwork,
  hostPID,
  hostIPC,
  tolerations,
  restartPolicy,
  labels,
  annotations,
}) => {
  const { objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };
  const ownerRef =
    owner && typeof owner !== 'string'
      ? (() => {
          try {
            return buildRequiredRelatedObjectReference({
              kind: owner.kind.toLowerCase(),
              // Prefer the OwnerReference apiVersion when present so
              // CRD-backed owners keep their real GVK.
              apiVersion: owner.apiVersion,
              name: owner.name,
              namespace,
              ...clusterMeta,
            });
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind="Pod" name={name} namespace={namespace} age={age} />

      {/* Use composed component for status */}
      <ResourceStatus status={status} statusSeverity={statusSeverity} ready={ready} />

      {((restarts !== undefined && restarts > 0) || owner || node || nodeIP || podIP) && (
        <div className="metadata-section-separator" />
      )}

      {/* Restarts - highlight if there are any */}
      {restarts !== undefined && restarts > 0 && (
        <OverviewItem
          label="Restarts"
          value={<span className="status-badge warning">{restarts}</span>}
        />
      )}

      {/* Owner - important relationship */}
      {owner && (
        <OverviewItem
          label="Owner"
          value={
            typeof owner === 'string' ? (
              owner
            ) : !ownerRef ? (
              `${owner.kind}/${owner.name}`
            ) : (
              <ObjectPanelLink objectRef={ownerRef}>
                {owner.kind}/{owner.name}
              </ObjectPanelLink>
            )
          }
        />
      )}

      {/* Node information */}
      {node && (
        <OverviewItem
          label="Node"
          value={
            <ObjectPanelLink
              objectRef={buildObjectReference({
                kind: 'node',
                name: node,
                ...clusterMeta,
              })}
              title="Click to view node"
            >
              {node}
            </ObjectPanelLink>
          }
        />
      )}

      {/* Node IP */}
      {nodeIP && <OverviewItem label="Node IP" value={nodeIP} />}

      {/* Pod IP */}
      {podIP && <OverviewItem label="Pod IP" value={podIP} />}

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

      {/* Runtime / security group — visually separated from the identity
          rows above (Owner / Node / IPs). */}
      {(qosClass ||
        priorityClass ||
        (restartPolicy && restartPolicy !== 'Always') ||
        (serviceAccount && serviceAccount !== 'default') ||
        hostNetwork ||
        hostPID ||
        hostIPC) && (
        <>
          <div className="metadata-section-separator" />
          {qosClass && (
            <OverviewItem
              label="QoS"
              value={
                <StatusChip variant={qosVariant(qosClass)} tooltip={qosTooltip(qosClass)}>
                  {qosClass}
                </StatusChip>
              }
            />
          )}
          {priorityClass && <OverviewItem label="Priority" value={priorityClass} />}
          {restartPolicy && restartPolicy !== 'Always' && (
            <OverviewItem label="Restart Policy" value={restartPolicy} />
          )}
          {serviceAccount && serviceAccount !== 'default' && (
            <OverviewItem
              label="Service Account"
              value={
                <ObjectPanelLink
                  objectRef={buildObjectReference({
                    kind: 'serviceaccount',
                    name: serviceAccount,
                    namespace: namespace,
                    ...clusterMeta,
                  })}
                  title="Click to view service account"
                >
                  {serviceAccount}
                </ObjectPanelLink>
              }
            />
          )}
          {(hostNetwork || hostPID || hostIPC) && (
            <OverviewItem
              label="Host"
              value={
                <div className="overview-condition-list">
                  {hostNetwork && (
                    <StatusChip
                      variant="warning"
                      tooltip="Shares the host's network namespace. Bypasses network policies and can bind to host ports or sniff host traffic."
                    >
                      Network
                    </StatusChip>
                  )}
                  {hostPID && (
                    <StatusChip
                      variant="warning"
                      tooltip="Shares the host's process namespace. The pod can see, signal, and attach to every process running on the node."
                    >
                      PID
                    </StatusChip>
                  )}
                  {hostIPC && (
                    <StatusChip
                      variant="warning"
                      tooltip="Shares the host's IPC namespace. The pod can access shared memory and message queues used by host processes."
                    >
                      IPC
                    </StatusChip>
                  )}
                </div>
              }
            />
          )}
        </>
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata labels={labels} annotations={annotations} />
    </>
  );
};
