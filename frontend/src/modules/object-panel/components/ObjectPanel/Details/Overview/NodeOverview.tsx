/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/NodeOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';

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
            <div className="node-conditions">
              {conditions
                .filter((condition: any) => {
                  // Only show conditions that are not in their default healthy state
                  const isPressureCondition = condition.type?.includes('Pressure');
                  if (isPressureCondition) {
                    return condition.status === 'True'; // Show if pressure exists
                  } else if (condition.type === 'Ready') {
                    return condition.status !== 'True'; // Show if not ready
                  }
                  return condition.status !== 'True'; // Show other non-healthy conditions
                })
                .map((condition: any, index: number) => {
                  // For pressure conditions, True is bad
                  const isPressureCondition = condition.type?.includes('Pressure');
                  let statusClass = 'warning';
                  let displayText = condition.type;

                  if (condition.status === 'Unknown') {
                    statusClass = 'unknown';
                  } else if (isPressureCondition && condition.status === 'True') {
                    statusClass = 'error';
                  }

                  return (
                    <span
                      key={index}
                      style={{ marginRight: index < conditions.length - 1 ? '8px' : 0 }}
                    >
                      <span
                        className={`status-badge ${statusClass}`}
                        style={{ fontSize: '0.85em' }}
                      >
                        {displayText}
                      </span>
                    </span>
                  );
                })}
              {/* If all conditions are healthy, show a simple message */}
              {conditions.every((condition: any) => {
                const isPressureCondition = condition.kind?.includes('Pressure');
                if (isPressureCondition) {
                  return condition.status === 'False';
                }
                return condition.status === 'True';
              }) && <span className="status-badge success">All Healthy</span>}
            </div>
          }
        />
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata labels={labels} annotations={annotations} />
    </>
  );
};
