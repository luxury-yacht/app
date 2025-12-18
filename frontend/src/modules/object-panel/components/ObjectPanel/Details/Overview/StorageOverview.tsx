import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';

interface StorageOverviewProps {
  kind?: string;
  name?: string;
  namespace?: string;
  age?: string;
  status?: string;
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
  const { kind, name, namespace, age, status } = props;

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age || ''} />

      {/* Use composed component for status */}
      {status && <ResourceStatus status={status} />}

      {/* PVC-specific fields */}
      {props.kind?.toLowerCase() === 'persistentvolumeclaim' && (
        <>
          <OverviewItem label="Volume" value={props.volumeName} />
          <OverviewItem label="Capacity" value={props.capacity} />
          <OverviewItem label="Access Modes" value={props.accessModes?.join(', ')} />
          <OverviewItem label="Storage Class" value={props.storageClass} />
          <OverviewItem label="Volume Mode" value={props.volumeMode} />
          {props.mountedBy && props.mountedBy.length > 0 && (
            <OverviewItem label="Mounted By" value={props.mountedBy.join(', ')} fullWidth />
          )}
        </>
      )}

      {/* PV-specific fields */}
      {props.kind?.toLowerCase() === 'persistentvolume' && (
        <>
          <OverviewItem label="Capacity" value={props.capacity} />
          <OverviewItem label="Access Modes" value={props.accessModes?.join(', ')} />
          <OverviewItem label="Reclaim Policy" value={props.reclaimPolicy} />
          <OverviewItem label="Storage Class" value={props.storageClass} />
          <OverviewItem label="Volume Mode" value={props.volumeMode} />
          {props.claimRef && (
            <OverviewItem
              label="Claim"
              value={`${props.claimRef.namespace}/${props.claimRef.name}`}
            />
          )}
        </>
      )}

      {/* StorageClass-specific fields */}
      {props.kind?.toLowerCase() === 'storageclass' && (
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
        </>
      )}
    </>
  );
};
