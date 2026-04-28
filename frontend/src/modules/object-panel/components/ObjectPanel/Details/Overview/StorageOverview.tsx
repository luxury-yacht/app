/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/StorageOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildObjectReference } from '@shared/utils/objectIdentity';
import './shared/OverviewBlocks.css';

interface TopologyLabelRequirement {
  key: string;
  values: string[];
}

interface TopologySelector {
  matchLabelExpressions: TopologyLabelRequirement[];
}

const reclaimPolicyVariant = (policy?: string): StatusChipVariant => {
  if (policy === 'Delete') return 'warning';
  return 'info';
};

const reclaimPolicyTooltip = (policy?: string): string | undefined => {
  if (policy === 'Delete')
    return 'Volumes are destroyed when their PVC is deleted. Data is not recoverable.';
  if (policy === 'Retain')
    return 'Volumes are kept after their PVC is deleted. Manual cleanup required.';
  return undefined;
};

const bindingModeVariant = (mode?: string): StatusChipVariant => {
  if (mode === 'Immediate') return 'warning';
  return 'info';
};

const bindingModeTooltip = (mode?: string): string | undefined => {
  if (mode === 'Immediate')
    return 'Volumes are bound as soon as the PVC is created, without considering where pods will be scheduled. In multi-zone clusters this can result in volumes that can’t actually be used by their pods.';
  if (mode === 'WaitForFirstConsumer')
    return 'Volume binding is delayed until a pod is scheduled, so the provisioner can match the pod’s zone and topology constraints.';
  return undefined;
};

interface StorageOverviewProps {
  kind?: string;
  name?: string;
  namespace?: string;
  age?: string;
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  // PVC fields
  volumeName?: string;
  capacity?: string;
  accessModes?: string[];
  storageClass?: string;
  volumeMode?: string;
  mountedBy?: string[];
  // PV fields
  claimRef?: any;
  reclaimPolicy?: string;
  // StorageClass fields
  provisioner?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
  isDefault?: boolean;
  parameters?: Record<string, string>;
  mountOptions?: string[];
  allowedTopologies?: TopologySelector[];
  persistentVolumesCount?: number;
}

// Storage resources Overview
export const StorageOverview: React.FC<StorageOverviewProps> = (props) => {
  const { objectData } = useObjectPanel();
  const { kind, name, namespace, age, status } = props;
  const normalizedKind = kind?.toLowerCase();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age || ''} />

      {/* Use composed component for status */}
      {status && <ResourceStatus status={status} />}

      {/* PVC-specific fields */}
      {normalizedKind === 'persistentvolumeclaim' && (
        <>
          <OverviewItem
            label="Volume"
            value={
              props.volumeName ? (
                <ObjectPanelLink
                  objectRef={buildObjectReference({
                    kind: 'persistentvolume',
                    name: props.volumeName,
                    ...clusterMeta,
                  })}
                  title={`Click to view volume: ${props.volumeName}`}
                >
                  {props.volumeName}
                </ObjectPanelLink>
              ) : (
                props.volumeName
              )
            }
          />
          <OverviewItem label="Capacity" value={props.capacity} />
          <OverviewItem label="Access Modes" value={props.accessModes?.join(', ')} />
          <OverviewItem
            label="Storage Class"
            value={
              props.storageClass ? (
                <ObjectPanelLink
                  objectRef={buildObjectReference({
                    kind: 'storageclass',
                    name: props.storageClass,
                    ...clusterMeta,
                  })}
                  title={`Click to view storage class: ${props.storageClass}`}
                >
                  {props.storageClass}
                </ObjectPanelLink>
              ) : (
                props.storageClass
              )
            }
          />
          <OverviewItem label="Volume Mode" value={props.volumeMode} />
          {props.mountedBy && props.mountedBy.length > 0 && (
            <OverviewItem
              label="Mounted By"
              value={
                <div>
                  {props.mountedBy.map((podName, index) => (
                    <div key={`${podName}-${index}`}>
                      <ObjectPanelLink
                        objectRef={buildObjectReference({
                          kind: 'pod',
                          name: podName,
                          namespace: namespace,
                          ...clusterMeta,
                        })}
                        title={`Click to view pod: ${podName}`}
                      >
                        {podName}
                      </ObjectPanelLink>
                    </div>
                  ))}
                </div>
              }
              fullWidth
            />
          )}
          {/* Match ConfigMap/Secret metadata layout for PVCs. */}
          <ResourceMetadata labels={props.labels} annotations={props.annotations} />
        </>
      )}

      {/* PV-specific fields */}
      {normalizedKind === 'persistentvolume' && (
        <>
          <OverviewItem label="Capacity" value={props.capacity} />
          <OverviewItem label="Access Modes" value={props.accessModes?.join(', ')} />
          <OverviewItem label="Reclaim Policy" value={props.reclaimPolicy} />
          <OverviewItem
            label="Storage Class"
            value={
              props.storageClass ? (
                <ObjectPanelLink
                  objectRef={buildObjectReference({
                    kind: 'storageclass',
                    name: props.storageClass,
                    ...clusterMeta,
                  })}
                  title={`Click to view storage class: ${props.storageClass}`}
                >
                  {props.storageClass}
                </ObjectPanelLink>
              ) : (
                props.storageClass
              )
            }
          />
          <OverviewItem label="Volume Mode" value={props.volumeMode} />
          {props.claimRef && (
            <OverviewItem
              label="Claim"
              value={
                <ObjectPanelLink
                  objectRef={buildObjectReference({
                    kind: 'persistentvolumeclaim',
                    name: props.claimRef.name,
                    namespace: props.claimRef.namespace,
                    ...clusterMeta,
                  })}
                  title={`Click to view claim: ${props.claimRef.namespace}/${props.claimRef.name}`}
                >
                  {`${props.claimRef.namespace}/${props.claimRef.name}`}
                </ObjectPanelLink>
              }
            />
          )}
          {/* Match ConfigMap/Secret metadata layout for PersistentVolumes. */}
          <ResourceMetadata labels={props.labels} annotations={props.annotations} />
        </>
      )}

      {/* StorageClass-specific fields */}
      {normalizedKind === 'storageclass' && (
        <>
          <OverviewItem
            label="Default"
            value={
              <StatusChip
                variant={props.isDefault ? 'healthy' : 'unhealthy'}
                tooltip={
                  props.isDefault
                    ? 'PVCs that omit storageClassName are bound to this StorageClass.'
                    : 'PVCs that omit storageClassName are not bound to this StorageClass.'
                }
              >
                {props.isDefault ? 'True' : 'False'}
              </StatusChip>
            }
          />
          <OverviewItem
            label="Provisioner"
            value={<span className="overview-value-mono">{props.provisioner}</span>}
          />
          <OverviewItem
            label="Reclaim Policy"
            value={
              <StatusChip
                variant={reclaimPolicyVariant(props.reclaimPolicy)}
                tooltip={reclaimPolicyTooltip(props.reclaimPolicy)}
              >
                {props.reclaimPolicy}
              </StatusChip>
            }
          />
          <OverviewItem
            label="Binding Mode"
            value={
              <StatusChip
                variant={bindingModeVariant(props.volumeBindingMode)}
                tooltip={bindingModeTooltip(props.volumeBindingMode)}
              >
                {props.volumeBindingMode}
              </StatusChip>
            }
          />
          <OverviewItem
            label="Expansion"
            value={
              <StatusChip
                variant={props.allowVolumeExpansion ? 'healthy' : 'unhealthy'}
                tooltip={
                  props.allowVolumeExpansion
                    ? 'PVCs using this StorageClass can be resized after creation.'
                    : 'PVCs using this StorageClass cannot be resized after creation.'
                }
              >
                {props.allowVolumeExpansion ? 'True' : 'False'}
              </StatusChip>
            }
          />
          {typeof props.persistentVolumesCount === 'number' && props.persistentVolumesCount > 0 && (
            <OverviewItem
              label="Provisioned"
              value={
                props.persistentVolumesCount === 1
                  ? '1 PersistentVolume'
                  : `${props.persistentVolumesCount} PersistentVolumes`
              }
            />
          )}
          {props.mountOptions && props.mountOptions.length > 0 && (
            <OverviewItem
              label="Mount Options"
              value={<span className="overview-value-mono">{props.mountOptions.join(', ')}</span>}
            />
          )}
          {props.allowedTopologies && props.allowedTopologies.length > 0 && (
            <OverviewItem
              label="Allowed Topologies"
              fullWidth
              value={
                <div className="overview-stacked">
                  {props.allowedTopologies.map((selector, si) => (
                    <div key={si} className="overview-condition-list">
                      {selector.matchLabelExpressions.map((req, ri) => (
                        <StatusChip key={`${si}-${ri}`} variant="info">
                          {req.key}: {req.values.join(', ')}
                        </StatusChip>
                      ))}
                    </div>
                  ))}
                </div>
              }
            />
          )}
          {props.parameters && Object.keys(props.parameters).length > 0 && (
            <OverviewItem
              label="Parameters"
              value={
                <div className="storage-parameters-list">
                  {Object.entries(props.parameters).map(([key, value]) => (
                    <div key={key} className="storage-parameters-item">
                      <span className="storage-parameters-key">{key}:</span>
                      <span className="storage-parameters-value">{value || '-'}</span>
                    </div>
                  ))}
                </div>
              }
              fullWidth
            />
          )}
          {/* Match ConfigMap/Secret metadata layout for StorageClasses. */}
          <ResourceMetadata labels={props.labels} annotations={props.annotations} />
        </>
      )}
    </>
  );
};
