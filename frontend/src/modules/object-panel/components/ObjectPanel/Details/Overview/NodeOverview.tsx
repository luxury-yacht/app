/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/NodeOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import './shared/OverviewBlocks.css';

// For pressure-style conditions (MemoryPressure, DiskPressure, PIDPressure,
// NetworkUnavailable), `True` means the bad state exists; for the rest
// (Ready, etc.), `True` is healthy.
const PRESSURE_CONDITION_TYPES = new Set([
  'MemoryPressure',
  'DiskPressure',
  'PIDPressure',
  'NetworkUnavailable',
]);

const nodeConditionVariant = (type: string, status: string): StatusChipVariant => {
  if (status === 'Unknown') return 'warning';
  const healthyStatus = PRESSURE_CONDITION_TYPES.has(type) ? 'False' : 'True';
  return status === healthyStatus ? 'healthy' : 'unhealthy';
};

interface NodeOverviewProps {
  name: string;
  age: string;
  status?: string;
  roles?: string;
  version?: string;
  os?: string;
  osImage?: string;
  architecture?: string;
  containerRuntime?: string;
  kernelVersion?: string;
  kubeletVersion?: string;
  hostname?: string;
  internalIP?: string;
  externalIP?: string;
  podsCapacity?: string;
  podsCount?: number;
  storageCapacity?: string;
  taints?: any[];
  conditions?: any[];
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export const NodeOverview: React.FC<NodeOverviewProps> = ({
  name,
  age,
  status,
  roles,
  version,
  os,
  osImage,
  architecture,
  containerRuntime,
  kernelVersion,
  hostname,
  internalIP,
  externalIP,
  podsCapacity,
  podsCount,
  storageCapacity,
  taints,
  conditions,
  labels,
  annotations,
}) => {
  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind="Node" name={name} age={age} />

      {/* Use composed component for status */}
      {status && <ResourceStatus status={status} />}
      {roles && <OverviewItem label="Roles" value={roles} />}

      {/* Network information */}
      {internalIP && <OverviewItem label="Internal IP" value={internalIP} />}
      {externalIP && <OverviewItem label="External IP" value={externalIP} />}
      {hostname && hostname !== name && <OverviewItem label="Hostname" value={hostname} />}

      {/* Pod count and capacity. If either value is unknown, display `unknown` */}
      <OverviewItem label="Pods" value={`${podsCount ?? 'unknown'}/${podsCapacity ?? 'unknown'}`} />

      {/* Version information - combine related fields */}
      {version && <OverviewItem label="Kubernetes" value={version} />}

      {/* System information - only show if different from defaults or important */}
      {os && osImage && <OverviewItem label="OS" value={`${os}/${architecture || 'unknown'}`} />}

      {osImage && <OverviewItem label="OS Image" value={osImage} />}

      {containerRuntime && <OverviewItem label="Runtime" value={containerRuntime} />}

      {/* Only show kernel if provided */}
      {kernelVersion && <OverviewItem label="Kernel" value={kernelVersion} />}

      {/* Storage capacity if available */}
      {storageCapacity && <OverviewItem label="Storage" value={storageCapacity} />}

      {taints && taints.length > 0 && (
        <OverviewItem
          label="Taints"
          value={
            <div>
              {taints.map((taint: any, index: number) => (
                <span key={index} style={{ marginRight: index < taints.length - 1 ? '8px' : 0 }}>
                  <span className="status-badge warning">
                    {taint.key}
                    {taint.value && `=${taint.value}`}:{taint.effect}
                  </span>
                </span>
              ))}
            </div>
          }
        />
      )}

      {conditions && conditions.length > 0 && (
        <OverviewItem
          label="Conditions"
          value={
            <div className="overview-condition-list">
              {conditions
                .filter((condition: any) => Boolean(condition.kind))
                .map((condition: any) => (
                  <StatusChip
                    key={condition.kind}
                    variant={nodeConditionVariant(condition.kind, condition.status)}
                    tooltip={condition.message || condition.reason || undefined}
                  >
                    {condition.kind}
                  </StatusChip>
                ))}
            </div>
          }
        />
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata labels={labels} annotations={annotations} />
    </>
  );
};
