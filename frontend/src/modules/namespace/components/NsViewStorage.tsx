/**
 * frontend/src/modules/namespace/components/NsViewStorage.tsx
 *
 * UI component for NsViewStorage.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import React from 'react';
import type { NamespaceStorageSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

// Data interface for PersistentVolumeClaim rows.
export interface StorageData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  status: string;
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  capacity: string;
  storageClass?: string;
  age?: string;
}

interface StorageViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const storageSpec: AggregatedResourceGridViewSpec<StorageData> = {
  domain: 'namespace-storage',
  viewId: 'namespace-storage',
  labels: {
    namespace: 'Namespace Storage',
    allNamespaces: 'All Namespaces Storage',
  },
  emptyMessage: (scopeSuffix) => `No storage objects found ${scopeSuffix}`,
  spinnerMessage: 'Loading storage resources...',
  tableClassName: 'ns-storage-table',
  defaultSort: { key: 'name', direction: 'asc' },
  namespaceLinkTab: 'storage',
  getIdentity: (resource) => ({
    kind: resource.kind || resource.kindAlias,
    name: resource.name,
    namespace: resource.namespace,
    clusterId: resource.clusterId,
    clusterName: resource.clusterName ?? undefined,
  }),
  buildColumns: ({ identity, openObject, navigateObject, useShortResourceNames }) => {
    const storageClassReference = (resource: StorageData) =>
      resource.storageClass
        ? {
            kind: 'StorageClass',
            name: resource.storageClass,
            clusterId: resource.clusterId,
            clusterName: resource.clusterName ?? undefined,
          }
        : null;

    return [
      cf.createKindColumn<StorageData>({
        key: 'kind',
        getKind: (resource) => resource.kind,
        getAlias: (resource) => resource.kindAlias,
        getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
        onClick: identity.open,
        onAltClick: identity.navigate,
      }),
      cf.createTextColumn<StorageData>('name', 'Name', {
        onClick: identity.open,
        onAltClick: identity.navigate,
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn<StorageData>(
        'status',
        'Status',
        (resource) => resource.status || 'Unknown',
        {
          getClassName: (resource) => backendStatusTextClass(resource.statusPresentation),
        }
      ),
      cf.createTextColumn<StorageData>(
        'capacity',
        'Capacity',
        (resource) => resource.capacity || '-',
        {
          alignHeader: 'right',
          alignData: 'right',
          getClassName: (resource) => (resource.capacity ? 'capacity' : undefined),
        }
      ),
      cf.createTextColumn<StorageData>(
        'storageClass',
        'Storage Class',
        (resource) => resource.storageClass || 'default',
        {
          onClick: (resource) => {
            const reference = storageClassReference(resource);
            if (reference) {
              openObject(reference);
            }
          },
          onAltClick: (resource) => {
            const reference = storageClassReference(resource);
            if (reference) {
              navigateObject(reference);
            }
          },
          isInteractive: (resource) => Boolean(resource.storageClass),
          getClassName: (resource) =>
            resource.storageClass ? 'storage-class-link' : 'default-class',
        }
      ),
      cf.createAgeColumn(),
    ];
  },
};

/**
 * GridTable component for namespace storage resources
 * Displays PersistentVolumeClaims for one namespace or all namespaces.
 */
const StorageViewGrid: React.FC<StorageViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => (
    <NamespaceAggregatedResourceGridView<NamespaceStorageSnapshotPayload, StorageData>
      spec={storageSpec}
      namespace={namespace}
      showNamespaceColumn={showNamespaceColumn}
    />
  )
);

StorageViewGrid.displayName = 'NsViewStorage';

export default StorageViewGrid;
