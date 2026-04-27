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
import { buildObjectReference, buildRelatedObjectReference } from '@shared/utils/objectIdentity';

const qosVariant = (qosClass: string): StatusChipVariant => {
  if (qosClass === 'Guaranteed') return 'healthy';
  if (qosClass === 'BestEffort') return 'warning';
  return 'info';
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
            return buildRelatedObjectReference({
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

      {/* Runtime / security group — visually separated from the identity
          rows above (Owner / Node / IPs). */}
      {(qosClass ||
        priorityClass ||
        (serviceAccount && serviceAccount !== 'default') ||
        hostNetwork) && (
        <>
          <div className="metadata-section-separator" />
          {qosClass && (
            <OverviewItem
              label="QoS"
              value={<StatusChip variant={qosVariant(qosClass)}>{qosClass}</StatusChip>}
            />
          )}
          {priorityClass && <OverviewItem label="Priority" value={priorityClass} />}
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
          {hostNetwork && (
            <OverviewItem
              label="Host Network"
              value={<span className="status-badge warning">Enabled</span>}
            />
          )}
        </>
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata labels={labels} annotations={annotations} />
    </>
  );
};
