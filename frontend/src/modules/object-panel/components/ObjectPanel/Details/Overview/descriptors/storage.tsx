/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/storage.tsx
 *
 * Storage Overview descriptors (X1 P3b). One descriptor per kind — PersistentVolumeClaim,
 * PersistentVolume, StorageClass — split out from the kind-branching StorageOverview.tsx.
 * Presentation ported verbatim; the renderer owns the frame (ResourceHeader / ResourceMetadata)
 * and the shared status block.
 */

import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { persistentvolume, persistentvolumeclaim, storageclass } from '@wailsjs/go/models';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import '../shared/OverviewBlocks.css';

type PersistentVolumeClaimDetails = persistentvolumeclaim.PersistentVolumeClaimDetails;
type PersistentVolumeDetails = persistentvolume.PersistentVolumeDetails;
type StorageClassDetails = storageclass.StorageClassDetails;

// Cluster identity threaded through the renderer context so links resolve to the active cluster.
const clusterMeta = (context: OverviewContext) => ({
  clusterId: context.clusterId ?? undefined,
  clusterName: context.clusterName ?? undefined,
});

const reclaimPolicyVariant = (policy?: string): StatusChipVariant => {
  if (policy === 'Delete') {
    return 'warning';
  }
  return 'info';
};

const reclaimPolicyTooltip = (policy?: string): string | undefined => {
  if (policy === 'Delete') {
    return 'Volumes are destroyed when their PVC is deleted. Data is not recoverable.';
  }
  if (policy === 'Retain') {
    return 'Volumes are kept after their PVC is deleted. Manual cleanup required.';
  }
  return undefined;
};

const bindingModeVariant = (mode?: string): StatusChipVariant => {
  if (mode === 'Immediate') {
    return 'warning';
  }
  return 'info';
};

const bindingModeTooltip = (mode?: string): string | undefined => {
  if (mode === 'Immediate') {
    return 'Volumes are bound as soon as the PVC is created, without considering where pods will be scheduled. In multi-zone clusters this can result in volumes that can’t actually be used by their pods.';
  }
  if (mode === 'WaitForFirstConsumer') {
    return 'Volume binding is delayed until a pod is scheduled, so the provisioner can match the pod’s zone and topology constraints.';
  }
  return undefined;
};

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

const renderAccessModes = (modes: string[]): React.ReactNode => (
  <div className="overview-condition-list">
    {withStableListKeys(modes, (mode) => mode).map(({ key, value: mode }) => (
      <StatusChip key={key} variant="info" tooltip={accessModeTooltip(mode)}>
        {mode}
      </StatusChip>
    ))}
  </div>
);

const renderReclaimPolicy = (policy?: string): React.ReactNode => (
  <StatusChip variant={reclaimPolicyVariant(policy)} tooltip={reclaimPolicyTooltip(policy)}>
    {policy}
  </StatusChip>
);

const renderKeyValueDetails = (details: Record<string, string>): React.ReactNode => (
  <div className="storage-parameters-list">
    {Object.entries(details).map(([key, value]) => (
      <div key={key} className="storage-parameters-item">
        <span className="storage-parameters-key">{key}:</span>
        <span className="storage-parameters-value">{value || '-'}</span>
      </div>
    ))}
  </div>
);

const renderStorageClassLink = (
  storageClass: string | undefined,
  context: OverviewContext
): React.ReactNode => {
  if (!storageClass) {
    return storageClass;
  }
  return (
    <ObjectPanelLink
      objectRef={buildRequiredObjectReference({
        kind: 'storageclass',
        name: storageClass,
        ...clusterMeta(context),
      })}
      title={`Click to view storage class: ${storageClass}`}
    >
      {storageClass}
    </ObjectPanelLink>
  );
};

// ---------------------------------------------------------------------------
// PersistentVolumeClaim
// ---------------------------------------------------------------------------

export const pvcDescriptor: OverviewDescriptor<PersistentVolumeClaimDetails> = {
  displayKind: 'PersistentVolumeClaim',
  dtoClass: persistentvolumeclaim.PersistentVolumeClaimDetails,
  schema: {
    items: [
      { kind: 'status' },
      {
        field: 'volumeName',
        label: 'Volume',
        render: (d, context) =>
          d.volumeName ? (
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'persistentvolume',
                name: d.volumeName,
                ...clusterMeta(context),
              })}
              title={`Click to view volume: ${d.volumeName}`}
            >
              {d.volumeName}
            </ObjectPanelLink>
          ) : (
            d.volumeName
          ),
      },
      { field: 'capacity', label: 'Capacity' },
      {
        field: 'accessModes',
        label: 'Access Modes',
        hidden: (d) => !(d.accessModes && d.accessModes.length > 0),
        render: (d) => renderAccessModes(d.accessModes ?? []),
      },
      {
        field: 'storageClass',
        label: 'Storage Class',
        render: (d, context) => renderStorageClassLink(d.storageClass, context),
      },
      { field: 'volumeMode', label: 'Volume Mode' },
      {
        // Data Source — set when the PVC was created from a clone
        // (kind=PersistentVolumeClaim) or a snapshot restore (kind=VolumeSnapshot).
        // Linkable when we can resolve the kind.
        field: 'dataSource',
        label: 'Data Source',
        hidden: (d) => !d.dataSource,
        render: (d, context) => {
          const ds = d.dataSource;
          if (!ds) {
            return undefined;
          }
          const label = `${ds.kind}/${ds.name}`;
          let ref: ReturnType<typeof buildRequiredObjectReference> | null;
          try {
            ref = buildRequiredObjectReference({
              kind: ds.kind.toLowerCase(),
              name: ds.name,
              // PVC clones are namespaced (same namespace as this PVC);
              // VolumeSnapshots are also namespaced.
              namespace: d.namespace,
              ...clusterMeta(context),
            });
          } catch {
            ref = null;
          }
          return ref ? <ObjectPanelLink objectRef={ref}>{label}</ObjectPanelLink> : label;
        },
      },
      {
        field: 'mountedBy',
        label: 'Mounted By',
        fullWidth: true,
        hidden: (d) => !(d.mountedBy && d.mountedBy.length > 0),
        render: (d) => (
          <div>
            {withStableListKeys(
              d.mountedBy ?? [],
              (podRef) =>
                `${podRef.clusterId}-${podRef.group}-${podRef.version}-${podRef.kind}-${podRef.namespace ?? ''}-${podRef.name ?? ''}`
            ).map(({ key, value: podRef }) => (
              <div key={key}>
                <ObjectPanelLink
                  objectRef={{ ...podRef, group: podRef.group, version: podRef.version }}
                  title={`Click to view pod: ${podRef.name ?? podRef.kind}`}
                >
                  {podRef.name ?? podRef.kind}
                </ObjectPanelLink>
              </div>
            ))}
          </div>
        ),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string), `selector` (not shown for
  // PVCs), and `conditions` (not rendered).
  coveredElsewhere: ['details', 'selector', 'conditions'],
};

// ---------------------------------------------------------------------------
// PersistentVolume (cluster-scoped — frame namespace stays undefined)
// ---------------------------------------------------------------------------

export const pvDescriptor: OverviewDescriptor<PersistentVolumeDetails> = {
  displayKind: 'PersistentVolume',
  dtoClass: persistentvolume.PersistentVolumeDetails,
  schema: {
    items: [
      { kind: 'status' },
      {
        field: 'claimRef',
        label: 'Claim',
        hidden: (d) => !d.claimRef,
        render: (d, context) =>
          d.claimRef ? (
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'persistentvolumeclaim',
                name: d.claimRef.name,
                namespace: d.claimRef.namespace,
                ...clusterMeta(context),
              })}
              title={`Click to view claim: ${d.claimRef.namespace}/${d.claimRef.name}`}
            >
              {`${d.claimRef.namespace}/${d.claimRef.name}`}
            </ObjectPanelLink>
          ) : undefined,
      },
      { field: 'capacity', label: 'Capacity' },
      {
        field: 'accessModes',
        label: 'Access Modes',
        hidden: (d) => !(d.accessModes && d.accessModes.length > 0),
        render: (d) => renderAccessModes(d.accessModes ?? []),
      },
      {
        field: 'reclaimPolicy',
        label: 'Reclaim Policy',
        render: (d) => renderReclaimPolicy(d.reclaimPolicy),
      },
      {
        field: 'storageClass',
        label: 'Storage Class',
        render: (d, context) => renderStorageClassLink(d.storageClass, context),
      },
      { field: 'volumeMode', label: 'Volume Mode' },
      {
        // Volume Source — what does this PV actually point to. The type (e.g. "CSI", "NFS",
        // "HostPath") leads as a chip, with provider-specific key/value details beneath.
        field: 'volumeSource',
        label: 'Source',
        fullWidth: true,
        hidden: (d) => !d.volumeSource?.type,
        render: (d) => {
          const source = d.volumeSource;
          if (!source?.type) {
            return undefined;
          }
          return (
            <div className="overview-stacked">
              <div>
                <StatusChip variant="info">{source.type}</StatusChip>
              </div>
              {source.details &&
                Object.keys(source.details).length > 0 &&
                renderKeyValueDetails(source.details)}
            </div>
          );
        },
      },
      {
        field: 'mountOptions',
        label: 'Mount Options',
        mono: true,
        hidden: (d) => !(d.mountOptions && d.mountOptions.length > 0),
        render: (d) => (d.mountOptions ?? []).join(', '),
      },
      {
        field: 'nodeAffinity',
        label: 'Node Affinity',
        fullWidth: true,
        hidden: (d) => !(d.nodeAffinity && d.nodeAffinity.length > 0),
        render: (d) => (
          <div className="overview-stacked">
            {withStableListKeys(d.nodeAffinity ?? [], (entry) => entry).map(
              ({ key, value: entry }) => (
                <span key={key}>{entry}</span>
              )
            )}
          </div>
        ),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string) and `conditions` (not rendered).
  coveredElsewhere: ['details', 'conditions'],
};

// ---------------------------------------------------------------------------
// StorageClass (cluster-scoped — frame namespace stays undefined)
// ---------------------------------------------------------------------------

export const storageClassDescriptor: OverviewDescriptor<StorageClassDetails> = {
  displayKind: 'StorageClass',
  dtoClass: storageclass.StorageClassDetails,
  schema: {
    items: [
      { kind: 'status' },
      {
        field: 'isDefault',
        label: 'Default',
        render: (d) => (
          <StatusChip
            variant={d.isDefault ? 'healthy' : 'unhealthy'}
            tooltip={
              d.isDefault
                ? 'PVCs that omit storageClassName are bound to this StorageClass.'
                : 'PVCs that omit storageClassName are not bound to this StorageClass.'
            }
          >
            {d.isDefault ? 'True' : 'False'}
          </StatusChip>
        ),
      },
      {
        field: 'provisioner',
        label: 'Provisioner',
        mono: true,
      },
      {
        field: 'reclaimPolicy',
        label: 'Reclaim Policy',
        render: (d) => renderReclaimPolicy(d.reclaimPolicy),
      },
      {
        field: 'volumeBindingMode',
        label: 'Binding Mode',
        render: (d) => (
          <StatusChip
            variant={bindingModeVariant(d.volumeBindingMode)}
            tooltip={bindingModeTooltip(d.volumeBindingMode)}
          >
            {d.volumeBindingMode}
          </StatusChip>
        ),
      },
      {
        field: 'allowVolumeExpansion',
        label: 'Expansion',
        render: (d) => (
          <StatusChip
            variant={d.allowVolumeExpansion ? 'healthy' : 'unhealthy'}
            tooltip={
              d.allowVolumeExpansion
                ? 'PVCs using this StorageClass can be resized after creation.'
                : 'PVCs using this StorageClass cannot be resized after creation.'
            }
          >
            {d.allowVolumeExpansion ? 'True' : 'False'}
          </StatusChip>
        ),
      },
      {
        // Count of provisioned PersistentVolumes — derived from the `persistentVolumes` list.
        field: 'persistentVolumes',
        label: 'Provisioned',
        hidden: (d) => (d.persistentVolumes?.length ?? 0) === 0,
        render: (d) => {
          const count = d.persistentVolumes?.length ?? 0;
          return count === 1 ? '1 PersistentVolume' : `${count} PersistentVolumes`;
        },
      },
      {
        field: 'mountOptions',
        label: 'Mount Options',
        mono: true,
        hidden: (d) => !(d.mountOptions && d.mountOptions.length > 0),
        render: (d) => (d.mountOptions ?? []).join(', '),
      },
      {
        field: 'allowedTopologies',
        label: 'Allowed Topologies',
        fullWidth: true,
        hidden: (d) => !(d.allowedTopologies && d.allowedTopologies.length > 0),
        render: (d) => (
          <div className="overview-stacked">
            {withStableListKeys(d.allowedTopologies ?? [], (selector) =>
              JSON.stringify(selector)
            ).map(({ key, value: selector }) => (
              <div key={key} className="overview-condition-list">
                {withStableListKeys(
                  selector.matchLabelExpressions,
                  (req) => `${req.key}:${req.values.join(',')}`
                ).map(({ key: requirementKey, value: req }) => (
                  <StatusChip key={requirementKey} variant="info">
                    {req.key}: {req.values.join(', ')}
                  </StatusChip>
                ))}
              </div>
            ))}
          </div>
        ),
      },
      {
        field: 'parameters',
        label: 'Parameters',
        fullWidth: true,
        hidden: (d) => !(d.parameters && Object.keys(d.parameters).length > 0),
        render: (d) => renderKeyValueDetails(d.parameters ?? {}),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string).
  coveredElsewhere: ['details'],
};
