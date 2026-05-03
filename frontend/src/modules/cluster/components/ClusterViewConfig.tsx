/**
 * frontend/src/modules/cluster/components/ClusterViewConfig.tsx
 *
 * GridTable view for cluster configuration resources such as Storage Classes,
 * Ingress Classes, and Admission Control resources.
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

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: ConfigData): ContextMenuItem[] => {
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

        {objectActions.modals}
      </>
    );
  }
);

ConfigViewGrid.displayName = 'ClusterViewConfig';

export default ConfigViewGrid;
