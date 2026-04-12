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
import {
  parseApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';

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
              <ObjectPanelLink
                objectRef={{
                  kind: owner.kind.toLowerCase(),
                  // Prefer the apiVersion the OwnerReference explicitly
                  // declared (correct for any kind, including CRD-as-Pod-
                  // owner like Argo Rollout, KubeVirt VMI, Tekton TaskRun);
                  // fall back to the built-in lookup only when the backend
                  // somehow lacks one (legacy data without ownerApiVersion).
                  ...(owner.apiVersion
                    ? parseApiVersion(owner.apiVersion)
                    : resolveBuiltinGroupVersion(owner.kind)),
                  name: owner.name,
                  namespace: namespace,
                  ...clusterMeta,
                }}
              >
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
              objectRef={{
                kind: 'node',
                ...resolveBuiltinGroupVersion('Node'),
                name: node,
                ...clusterMeta,
              }}
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
            <ObjectPanelLink
              objectRef={{
                kind: 'serviceaccount',
                ...resolveBuiltinGroupVersion('ServiceAccount'),
                name: serviceAccount,
                namespace: namespace,
                ...clusterMeta,
              }}
              title="Click to view service account"
            >
              {serviceAccount}
            </ObjectPanelLink>
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
