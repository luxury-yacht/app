/**
 * frontend/src/modules/cluster/components/ClusterViewStorage.tsx
 *
 * UI component for ClusterViewStorage.
 * Handles rendering and interactions for the cluster feature.
 */

import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useClusterResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

const CLUSTER_STORAGE_KIND_OPTIONS = ['PersistentVolume'];

// Define the data structure for Persistent Volumes
interface StorageData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId: string;
  clusterName?: string;
  capacity: string;
  accessModes: string;
  status: string;
  claim: string;
  storageClass?: string;
  age?: string;
}

// Define props for StorageViewGrid component
interface StorageViewProps {
  data: StorageData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster storage resources
 * Displays Persistent Volumes
 */
const StorageViewGrid: React.FC<StorageViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();

    const handleResourceClick = useCallback(
      (pv: StorageData) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'PersistentVolume',
              name: pv.name,
              clusterId: pv.clusterId ?? undefined,
              clusterName: pv.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const getClaimTarget = useCallback((pv: StorageData) => {
      if (!pv.claim) {
        return null;
      }
      const [namespace, name] = pv.claim.split('/');
      if (!namespace || !name) {
        return null;
      }
      return { namespace, name };
    }, []);

    const handleClaimClick = useCallback(
      (pv: StorageData) => {
        const target = getClaimTarget(pv);
        if (!target) {
          return;
        }
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'PersistentVolumeClaim',
              namespace: target.namespace,
              name: target.name,
              clusterId: pv.clusterId ?? undefined,
              clusterName: pv.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [getClaimTarget, openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (pv: StorageData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: 'PersistentVolume',
            name: pv.name,
            clusterId: pv.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    // Define columns for PVs
    const columns: GridColumnDefinition<StorageData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<StorageData>[] = [
        cf.createKindColumn<StorageData>({
          key: 'kind',
          getKind: (pv) => pv.kind || 'PersistentVolume',
          getDisplayText: (pv) =>
            getDisplayKind(pv.kind || 'PersistentVolume', useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (pv) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: pv.kind || 'PersistentVolume',
                  name: pv.name,
                  clusterId: pv.clusterId,
                  clusterName: pv.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<StorageData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (pv) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: pv.kind || 'PersistentVolume',
                  name: pv.name,
                  clusterId: pv.clusterId,
                  clusterName: pv.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn('capacity', 'Capacity', (pv) => pv.capacity || '-'),
        cf.createTextColumn('accessModes', 'Access Modes', (pv) => pv.accessModes || '-'),
        cf.createTextColumn<StorageData>('status', 'Status', (pv) => pv.status || 'Unknown', {
          getClassName: (pv) => {
            const normalized = (pv.status || 'unknown').toLowerCase();
            return `status-badge ${normalized}`;
          },
        }),
        cf.createTextColumn<StorageData>(
          'storageClass',
          'Class',
          (pv) => pv.storageClass || 'default',
          {
            onClick: (pv) => {
              if (!pv.storageClass) {
                return;
              }
              openWithObject(
                buildRequiredObjectReference(
                  {
                    kind: 'StorageClass',
                    name: pv.storageClass,
                    clusterId: pv.clusterId ?? undefined,
                    clusterName: pv.clusterName ?? undefined,
                  },
                  { fallbackClusterId: selectedClusterId }
                )
              );
            },
            onAltClick: (pv) => {
              if (!pv.storageClass) {
                return;
              }
              navigateToView(
                buildRequiredObjectReference(
                  {
                    kind: 'StorageClass',
                    name: pv.storageClass,
                    clusterId: pv.clusterId,
                    clusterName: pv.clusterName,
                  },
                  { fallbackClusterId: selectedClusterId }
                )
              );
            },
            isInteractive: (pv) => Boolean(pv.storageClass),
            getClassName: (pv) =>
              pv.storageClass ? 'storage-class-link object-panel-link' : 'default-class',
          }
        ),
        cf.createTextColumn<StorageData>('claim', 'Claim', (pv) => pv.claim || '-', {
          onClick: handleClaimClick,
          onAltClick: (pv) => {
            const target = getClaimTarget(pv);
            if (!target) {
              return;
            }
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: 'PersistentVolumeClaim',
                  namespace: target.namespace,
                  name: target.name,
                  clusterId: pv.clusterId,
                  clusterName: pv.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            );
          },
          isInteractive: (pv) => Boolean(getClaimTarget(pv)),
          getClassName: (pv) => (getClaimTarget(pv) ? 'object-panel-link' : undefined),
        }),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        capacity: { autoWidth: true },
        accessModes: { autoWidth: true },
        status: { autoWidth: true },
        storageClass: { autoWidth: true },
        claim: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [
      getClaimTarget,
      handleClaimClick,
      handleResourceClick,
      navigateToView,
      openWithObject,
      selectedClusterId,
      useShortResourceNames,
    ]);

    const { gridTableProps, favModal } = useClusterResourceGridTable<StorageData>({
      viewId: 'cluster-storage',
      columns,
      data,
      keyExtractor,
      availableKinds: CLUSTER_STORAGE_KIND_OPTIONS,
      showKindDropdown: true,
      diagnosticsLabel: 'Cluster Storage',
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (pv: StorageData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind: 'PersistentVolume',
              name: pv.name,
              clusterId: pv.clusterId,
              clusterName: pv.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [objectActions, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped storage objects found'),
      [error]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading storage resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster Storage"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="gridtable-pvs"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />

        {objectActions.modals}
      </>
    );
  }
);

StorageViewGrid.displayName = 'ClsPVsTableGrid';

export default StorageViewGrid;
