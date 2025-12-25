/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PodOverview.tsx
 *
 * Module source for PodOverview.
 */
import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';

interface PodOverviewProps {
  name: string;
  age: string;
  namespace?: string;
  node?: string;
  nodeIP?: string;
  podIP?: string;
  owner?: string | { kind: string; name: string };
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
  const { openWithObject } = useObjectPanel();

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind="Pod" name={name} namespace={namespace} age={age} />

      {/* Use composed component for status */}
      <ResourceStatus status={status} statusSeverity={statusSeverity} ready={ready} />

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
            ) : (
              <span
                className="object-panel-link"
                onClick={() =>
                  openWithObject?.({
                    kind: owner.kind.toLowerCase(),
                    name: owner.name,
                    namespace: namespace,
                  })
                }
              >
                {owner.kind}/{owner.name}
              </span>
            )
          }
        />
      )}

      {/* Node information */}
      {node && (
        <OverviewItem
          label="Node"
          value={
            <span
              className="object-panel-link"
              onClick={() => openWithObject?.({ kind: 'node', name: node })}
              title="Click to view node"
            >
              {node}
            </span>
          }
        />
      )}

      {/* Node IP */}
      {nodeIP && <OverviewItem label="Node IP" value={nodeIP} />}

      {/* Pod IP */}
      {podIP && <OverviewItem label="Pod IP" value={podIP} />}

      {/* QoS and Priority - only show if not default */}
      {qosClass && qosClass !== 'BestEffort' && (
        <OverviewItem
          label="QoS"
          value={
            <span className={`status-badge ${qosClass === 'Guaranteed' ? 'success' : 'info'}`}>
              {qosClass}
            </span>
          }
        />
      )}

      {priorityClass && <OverviewItem label="Priority" value={priorityClass} />}

      {/* Service Account - only show if not default */}
      {serviceAccount && serviceAccount !== 'default' && (
        <OverviewItem
          label="Service Account"
          value={
            <span
              className="object-panel-link"
              onClick={() =>
                openWithObject?.({
                  kind: 'serviceaccount',
                  name: serviceAccount,
                  namespace: namespace,
                })
              }
              title="Click to view service account"
            >
              {serviceAccount}
            </span>
          }
        />
      )}

      {/* Special configurations */}
      {hostNetwork && (
        <OverviewItem
          label="Host Network"
          value={<span className="status-badge warning">Enabled</span>}
        />
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata labels={labels} annotations={annotations} />
    </>
  );
};
