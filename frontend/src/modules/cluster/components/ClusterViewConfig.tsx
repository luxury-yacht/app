/**
 * frontend/src/modules/cluster/components/ClusterViewConfig.tsx
 *
 * GridTable view for cluster configuration resources such as Storage Classes,
 * Ingress Classes, and Admission Control resources.
 */

import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import React, { useMemo, useCallback, useState } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { formatBuiltinApiVersion } from '@shared/constants/builtinGroupVersions';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useClusterResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

// Define the data structure for configuration resources
interface ConfigData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId: string;
  clusterName?: string;
  age?: string;
}

// Define props for ConfigViewGrid component
interface ConfigViewProps {
  data: ConfigData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

const supportsObjectMap = (kind: string): boolean =>
  kind === 'StorageClass' || kind === 'IngressClass';

/**
 * GridTable component for cluster configuration resources
 * Displays Storage Classes, Ingress Classes, and Admission Control resources
 */
const ConfigViewGrid: React.FC<ConfigViewProps> = React.memo(
  ({ data, availableKinds: kindOptions, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: ConfigData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: ConfigData) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
              clusterId: resource.clusterId ?? undefined,
              clusterName: resource.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (resource: ConfigData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: resource.kind,
            name: resource.name,
            clusterId: resource.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    // Define columns for config resources
    const columns: GridColumnDefinition<ConfigData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<ConfigData>[] = [
        cf.createKindColumn<ConfigData>({
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
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<ConfigData>('name', 'Name', (resource) => resource.name, {
          sortable: true,
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: resource.kind,
                  name: resource.name,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          getClassName: () => 'object-panel-link',
        }),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [handleResourceClick, navigateToView, selectedClusterId, useShortResourceNames]);

    const { gridTableProps, favModal } = useClusterResourceGridTable<ConfigData>({
      viewId: 'cluster-config',
      columns,
      data,
      keyExtractor,
      availableKinds: kindOptions,
      showKindDropdown: true,
      diagnosticsLabel: 'Cluster Configuration',
    });

    // Handle delete confirmation
    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;
      const resource = deleteConfirm.resource;

      try {
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        const clusterId = resource.clusterId ?? selectedClusterId ?? null;
        if (!clusterId) {
          throw new Error(`Cannot delete ${resource.kind}/${resource.name}: clusterId is missing`);
        }
        // Built-in admission/storage/etc. kinds resolve via the lookup table.
        // A miss means a non-built-in kind slipped in — fail loud.
        //
        const apiVersion = formatBuiltinApiVersion(resource.kind);
        if (!apiVersion) {
          throw new Error(
            `Cannot delete ${resource.kind}/${resource.name}: not a known built-in kind`
          );
        }
        await DeleteResourceByGVK(clusterId, apiVersion, resource.kind, '', resource.name);
      } catch (err) {
        errorHandler.handle(err, {
          action: 'delete',
          kind: deleteConfirm.resource.kind,
          name: deleteConfirm.resource.name,
        });
      } finally {
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource, selectedClusterId]);

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: ConfigData): ContextMenuItem[] => {
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(resource.kind, 'delete', null, null, resource.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: buildRequiredObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          ),
          context: 'gridtable',
          handlers: {
            onOpen: () => handleResourceClick(resource),
            onObjectMap: supportsObjectMap(resource.kind)
              ? () =>
                  openWithObject(
                    buildRequiredObjectReference(
                      {
                        kind: resource.kind,
                        name: resource.name,
                        clusterId: resource.clusterId,
                        clusterName: resource.clusterName,
                      },
                      { fallbackClusterId: selectedClusterId }
                    ),
                    { initialTab: 'map' }
                  )
              : undefined,
            onDelete: () => setDeleteConfirm({ show: true, resource }),
          },
          permissions: {
            delete: deleteStatus,
          },
        });
      },
      [handleResourceClick, openWithObject, permissionMap, selectedClusterId]
    );

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped config objects found'),
      [error]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading configuration resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster Configuration"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="gridtable-config"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />

        <ConfirmationModal
          isOpen={deleteConfirm.show}
          title={`Delete ${deleteConfirm.resource?.kind ?? 'Resource'}`}
          message={`Are you sure you want to delete ${deleteConfirm.resource?.kind} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm({ show: false, resource: null })}
        />
      </>
    );
  }
);

ConfigViewGrid.displayName = 'ClusterViewConfig';

export default ConfigViewGrid;
