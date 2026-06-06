/**
 * frontend/src/modules/namespace/components/NsViewStorage.tsx
 *
 * UI component for NsViewStorage.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewStorage.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectLink } from '@shared/hooks/useObjectLink';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import {
  buildLocalPartialDataLabel,
  localTableModeForStats,
} from '@modules/resource-grid/tablePartialState';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import type { SnapshotStats } from '@/core/refresh/client';
import type { NamespaceStorageSnapshotPayload } from '@/core/refresh/types';

const NAMESPACE_STORAGE_KIND_OPTIONS = ['PersistentVolumeClaim'];

// Data interface for storage resources (PVCs, VolumeAttachments, etc.)
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
  data: StorageData[];
  stats?: SnapshotStats | null;
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace storage resources
 * Aggregates PersistentVolumeClaims, VolumeAttachments, and related storage resources
 */
const StorageViewGrid: React.FC<StorageViewProps> = React.memo(
  ({
    namespace,
    data,
    stats = null,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const queryClusterId = selectedClusterId;
    const objectLink = useObjectLink();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<StorageData>('storage');

    const handleResourceClick = useCallback(
      (resource: StorageData) => {
        const resolvedKind = resource.kind || resource.kindAlias;
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: resolvedKind,
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (resource: StorageData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: resource.kind,
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    const columns: GridColumnDefinition<StorageData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<StorageData>[] = [
        cf.createKindColumn<StorageData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: resource.kind,
                  name: resource.name,
                  namespace: resource.namespace,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName ?? undefined,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<StorageData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: resource.kind,
                  name: resource.name,
                  namespace: resource.namespace,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName ?? undefined,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
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
            getClassName: (resource) => (resource.capacity ? 'capacity' : undefined),
          }
        ),
        cf.createTextColumn<StorageData>(
          'storageClass',
          'Storage Class',
          (resource) => resource.storageClass || 'default',
          {
            ...objectLink((resource) =>
              resource.storageClass
                ? buildRequiredObjectReference(
                    {
                      kind: 'StorageClass',
                      name: resource.storageClass,
                      clusterId: resource.clusterId,
                      clusterName: resource.clusterName ?? undefined,
                    },
                    { fallbackClusterId: selectedClusterId }
                  )
                : undefined
            ),
            isInteractive: (resource) => Boolean(resource.storageClass),
            getClassName: (resource) =>
              resource.storageClass ? 'storage-class-link' : 'default-class',
          }
        ),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        status: { autoWidth: true },
        capacity: { autoWidth: true },
        storageClass: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (resource) => resource.namespace,
          sortValue: (resource) => (resource.namespace || '').toLowerCase(),
          ...namespaceColumnLink,
        });
      }

      return baseColumns;
    }, [
      handleResourceClick,
      namespaceColumnLink,
      navigateToView,
      objectLink,
      selectedClusterId,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Storage' : 'Namespace Storage';
    const localTableMode = localTableModeForStats(stats);

    const selectRows = useCallback(
      (payload: NamespaceStorageSnapshotPayload) => payload.rows ?? [],
      []
    );
    const { gridTableProps, favModal, source } = useQueryBackedNamespaceResourceGridTable<
      NamespaceStorageSnapshotPayload,
      StorageData
    >({
      enabled: namespace === ALL_NAMESPACES_SCOPE,
      queryTableMode: 'Query Backed Static',
      clusterId: queryClusterId,
      domain: 'namespace-storage',
      label: 'All Namespaces Storage',
      localData: data,
      localLoading: loading,
      localLoaded: loaded,
      localTableMode,
      selectRows,
      viewId: 'namespace-storage',
      namespace,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      availableKinds: NAMESPACE_STORAGE_KIND_OPTIONS,
      showKindDropdown: true,
      showNamespaceFilters: namespace === ALL_NAMESPACES_SCOPE,
      filterOptionOverrides:
        namespace === ALL_NAMESPACES_SCOPE || localTableMode !== 'Local Partial'
          ? undefined
          : {
              partialDataLabel: buildLocalPartialDataLabel({
                stats,
                fallback: `${diagnosticsLabel} is loaded as a bounded local snapshot.`,
                sourceLabel: diagnosticsLabel,
              }),
            },
      diagnosticsLabel,
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    const getContextMenuItems = useCallback(
      (resource: StorageData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [objectActions, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No storage objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading storage resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          onRowClick={handleResourceClick}
          tableClassName="ns-storage-table"
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

StorageViewGrid.displayName = 'NsViewStorage';

export default StorageViewGrid;
