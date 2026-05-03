/**
 * frontend/src/modules/cluster/components/ClusterViewRBAC.tsx
 *
 * UI component for ClusterViewRBAC.
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

// Define the data structure for RBAC resources
interface RBACData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId: string;
  clusterName?: string;
  age?: string;
}

// Define props for RBACViewGrid component
interface RBACViewProps {
  data: RBACData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster RBAC resources
 * Shows ClusterRoles and ClusterRoleBindings in a single aggregated table
 */
const RBACViewGrid: React.FC<RBACViewProps> = React.memo(
  ({ data, availableKinds: kindOptions, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();

    const handleResourceClick = useCallback(
      (resource: RBACData) => {
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
      (resource: RBACData) =>
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

    // Define columns for RBAC resources
    const columns: GridColumnDefinition<RBACData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<RBACData>[] = [
        cf.createKindColumn<RBACData>({
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
        cf.createTextColumn<RBACData>('name', 'Name', (resource) => resource.name, {
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

    const { gridTableProps, favModal } = useClusterResourceGridTable<RBACData>({
      viewId: 'cluster-rbac',
      columns,
      data,
      keyExtractor,
      availableKinds: kindOptions,
      showKindDropdown: true,
      diagnosticsLabel: 'Cluster RBAC',
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: RBACData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [objectActions, selectedClusterId]
    );

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped RBAC objects found'),
      [error]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading RBAC resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster RBAC"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="gridtable-rbac"
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

RBACViewGrid.displayName = 'ClusterViewRBAC';

export default RBACViewGrid;
