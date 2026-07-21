/**
 * frontend/src/modules/cluster/components/ClusterViewStorage.tsx
 *
 * UI component for ClusterViewStorage.
 * Handles rendering and interactions for the cluster feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  ClusterAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import React from 'react';
import type { ClusterStorageEntry, ClusterStorageSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

type StorageData = ClusterStorageEntry & { kindAlias?: string };

// Define props for StorageViewGrid component
interface StorageViewProps {
  error?: string | null;
}

const getClaimTarget = (pv: StorageData) => {
  if (!pv.claim) {
    return null;
  }
  const [namespace, name] = pv.claim.split('/');
  if (!namespace || !name) {
    return null;
  }
  return { namespace, name };
};

const storageSpec: AggregatedResourceGridViewSpec<StorageData> = {
  domain: 'cluster-storage',
  viewId: 'cluster-storage',
  labels: { cluster: 'Cluster Storage' },
  emptyMessage: () => 'No cluster-scoped storage objects found',
  spinnerMessage: 'Loading storage resources...',
  tableClassName: 'gridtable-pvs',
  buildColumns: ({ identity, openObject, navigateObject, useShortResourceNames }) => {
    const claimReference = (pv: StorageData) => {
      const target = getClaimTarget(pv);
      if (!target) {
        return null;
      }
      return {
        kind: 'PersistentVolumeClaim',
        namespace: target.namespace,
        name: target.name,
        clusterId: pv.clusterId ?? undefined,
        clusterName: pv.clusterName ?? undefined,
      };
    };
    const storageClassReference = (pv: StorageData) =>
      pv.storageClass
        ? {
            kind: 'StorageClass',
            name: pv.storageClass,
            clusterId: pv.clusterId ?? undefined,
            clusterName: pv.clusterName ?? undefined,
          }
        : null;

    return [
      cf.createKindColumn<StorageData>({
        key: 'kind',
        getKind: (pv) => pv.kind || 'PersistentVolume',
        getDisplayText: (pv) =>
          getDisplayKind(pv.kind || 'PersistentVolume', useShortResourceNames),
        onClick: identity.open,
        onAltClick: identity.navigate,
      }),
      cf.createTextColumn<StorageData>('name', 'Name', {
        onClick: identity.open,
        onAltClick: identity.navigate,
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn('capacity', 'Capacity', (pv) => pv.capacity || '-'),
      cf.createTextColumn('accessModes', 'Access Modes', (pv) => pv.accessModes || '-'),
      cf.createTextColumn<StorageData>('status', 'Status', (pv) => pv.status || 'Unknown', {
        getClassName: (pv) => backendStatusTextClass(pv.statusPresentation),
      }),
      cf.createTextColumn<StorageData>(
        'storageClass',
        'Class',
        (pv) => pv.storageClass || 'default',
        {
          onClick: (pv) => {
            const reference = storageClassReference(pv);
            if (reference) {
              openObject(reference);
            }
          },
          onAltClick: (pv) => {
            const reference = storageClassReference(pv);
            if (reference) {
              navigateObject(reference);
            }
          },
          isInteractive: (pv) => Boolean(pv.storageClass),
          getClassName: (pv) =>
            pv.storageClass ? 'storage-class-link object-panel-link' : 'default-class',
        }
      ),
      cf.createTextColumn<StorageData>('claim', 'Claim', (pv) => pv.claim || '-', {
        onClick: (pv) => {
          const reference = claimReference(pv);
          if (reference) {
            openObject(reference);
          }
        },
        onAltClick: (pv) => {
          const reference = claimReference(pv);
          if (reference) {
            navigateObject(reference);
          }
        },
        isInteractive: (pv) => Boolean(getClaimTarget(pv)),
        getClassName: (pv) => (getClaimTarget(pv) ? 'object-panel-link' : undefined),
      }),
      cf.createAgeColumn(),
    ];
  },
};

/**
 * GridTable component for cluster storage resources
 * Displays Persistent Volumes
 */
const StorageViewGrid: React.FC<StorageViewProps> = React.memo(({ error }) => (
  <ClusterAggregatedResourceGridView<ClusterStorageSnapshotPayload, StorageData>
    spec={storageSpec}
    error={error}
  />
));

StorageViewGrid.displayName = 'ClsPVsTableGrid';

export default StorageViewGrid;
