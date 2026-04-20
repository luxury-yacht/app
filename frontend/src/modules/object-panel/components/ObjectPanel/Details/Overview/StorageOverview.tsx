/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/StorageOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildObjectReference } from '@shared/utils/objectIdentity';

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
          <OverviewItem label="Provisioner" value={props.provisioner} />
          <OverviewItem label="Reclaim Policy" value={props.reclaimPolicy} />
          <OverviewItem label="Binding Mode" value={props.volumeBindingMode} />
          <OverviewItem label="Allow Expansion" value={props.allowVolumeExpansion ? 'Yes' : 'No'} />
          <OverviewItem label="Default Class" value={props.isDefault ? 'Yes' : 'No'} />
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
