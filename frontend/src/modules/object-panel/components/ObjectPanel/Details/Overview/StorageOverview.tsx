/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/StorageOverview.tsx
 */

import React from 'react';
import type { resourcemodel } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
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

interface VolumeSourceLike {
  type: string;
  details?: Record<string, string>;
}

interface DataSourceLike {
  kind: string;
  name: string;
}

// Kubernetes access mode semantics. ReadWriteOncePod was added in 1.22 and
// is stricter than ReadWriteOnce (single pod cluster-wide vs. single node).
const accessModeTooltip = (mode: string): string | undefined => {
  switch (mode) {
    case 'ReadWriteOnce':
      return 'Mounted read-write by a single node. Multiple pods on the same node can share the volume.';
    case 'ReadOnlyMany':
      return 'Mounted read-only by many nodes simultaneously.';
    case 'ReadWriteMany':
      return 'Mounted read-write by many nodes simultaneously.';
    case 'ReadWriteOncePod':
      return 'Mounted read-write by a single pod across the entire cluster. Stricter than ReadWriteOnce. Available on Kubernetes 1.22+.';
    default:
      return undefined;
  }
};

interface StorageOverviewProps {
  kind?: string;
  name?: string;
  namespace?: string;
  age?: string;
  status?: string;
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  // PVC fields
  volumeName?: string;
  capacity?: string;
  accessModes?: string[];
  storageClass?: string;
  volumeMode?: string;
  mountedBy?: resourcemodel.ResourceRef[];
  dataSource?: DataSourceLike;
  // PV fields
  claimRef?: any;
  reclaimPolicy?: string;
  volumeSource?: VolumeSourceLike;
  nodeAffinity?: string[];
  // mountOptions also lives on StorageClass — declared below.
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
  const { kind, name, namespace, age, status, statusState, statusPresentation } = props;
  const normalizedKind = kind?.toLowerCase();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age || ''} />

      <ResourceStatus
        status={status}
        statusState={statusState}
        statusPresentation={statusPresentation}
      />

      {/* PVC-specific fields */}
      {normalizedKind === 'persistentvolumeclaim' && (
        <>
          <OverviewItem
            label="Volume"
            value={
              props.volumeName ? (
                <ObjectPanelLink
                  objectRef={buildRequiredObjectReference({
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
          {props.accessModes && props.accessModes.length > 0 && (
            <OverviewItem
              label="Access Modes"
              value={
                <div className="overview-condition-list">
                  {props.accessModes.map((mode) => (
                    <StatusChip key={mode} variant="info" tooltip={accessModeTooltip(mode)}>
                      {mode}
                    </StatusChip>
                  ))}
                </div>
              }
            />
          )}
          <OverviewItem
            label="Storage Class"
            value={
              props.storageClass ? (
                <ObjectPanelLink
                  objectRef={buildRequiredObjectReference({
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
          {/* Data Source — set when the PVC was created from a clone
              (kind=PersistentVolumeClaim) or a snapshot restore
              (kind=VolumeSnapshot). Linkable when we can resolve the kind. */}
          {props.dataSource &&
            (() => {
              const ds = props.dataSource;
              const label = `${ds.kind}/${ds.name}`;
              let ref;
              try {
                ref = buildRequiredObjectReference({
                  kind: ds.kind.toLowerCase(),
                  name: ds.name,
                  // PVC clones are namespaced (same namespace as this PVC);
                  // VolumeSnapshots are also namespaced.
                  namespace,
                  ...clusterMeta,
                });
              } catch {
                ref = null;
              }
              return (
                <OverviewItem
                  label="Data Source"
                  value={ref ? <ObjectPanelLink objectRef={ref}>{label}</ObjectPanelLink> : label}
                />
              );
            })()}
          {props.mountedBy && props.mountedBy.length > 0 && (
            <OverviewItem
              label="Mounted By"
              value={
                <div>
                  {props.mountedBy.map((podRef, index) => (
                    <div
                      key={`${podRef.clusterId}-${podRef.group}-${podRef.version}-${podRef.kind}-${podRef.namespace ?? ''}-${podRef.name ?? index}`}
                    >
                      <ObjectPanelLink
                        objectRef={{ ...podRef, group: podRef.group, version: podRef.version }}
                        title={`Click to view pod: ${podRef.name ?? podRef.kind}`}
                      >
                        {podRef.name ?? podRef.kind}
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
          {props.claimRef && (
            <OverviewItem
              label="Claim"
              value={
                <ObjectPanelLink
                  objectRef={buildRequiredObjectReference({
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
          <OverviewItem label="Capacity" value={props.capacity} />
          {props.accessModes && props.accessModes.length > 0 && (
            <OverviewItem
              label="Access Modes"
              value={
                <div className="overview-condition-list">
                  {props.accessModes.map((mode) => (
                    <StatusChip key={mode} variant="info" tooltip={accessModeTooltip(mode)}>
                      {mode}
                    </StatusChip>
                  ))}
                </div>
              }
            />
          )}
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
            label="Storage Class"
            value={
              props.storageClass ? (
                <ObjectPanelLink
                  objectRef={buildRequiredObjectReference({
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
          {/* Volume Source — what does this PV actually point to. The type
              (e.g. "CSI", "NFS", "HostPath") leads as a chip, with provider-
              specific key/value details rendered beneath when present. */}
          {props.volumeSource && props.volumeSource.type && (
            <OverviewItem
              label="Source"
              fullWidth
              value={
                <div className="overview-stacked">
                  <div>
                    <StatusChip variant="info">{props.volumeSource.type}</StatusChip>
                  </div>
                  {props.volumeSource.details &&
                    Object.keys(props.volumeSource.details).length > 0 && (
                      <div className="storage-parameters-list">
                        {Object.entries(props.volumeSource.details).map(([key, value]) => (
                          <div key={key} className="storage-parameters-item">
                            <span className="storage-parameters-key">{key}:</span>
                            <span className="storage-parameters-value">{value || '-'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              }
            />
          )}
          {props.mountOptions && props.mountOptions.length > 0 && (
            <OverviewItem
              label="Mount Options"
              value={<span className="overview-value-mono">{props.mountOptions.join(', ')}</span>}
            />
          )}
          {props.nodeAffinity && props.nodeAffinity.length > 0 && (
            <OverviewItem
              label="Node Affinity"
              fullWidth
              value={
                <div className="overview-stacked">
                  {props.nodeAffinity.map((entry, i) => (
                    <span key={i}>{entry}</span>
                  ))}
                </div>
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
