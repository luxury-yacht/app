/**
 * frontend/src/modules/namespace/components/NsViewConfig.tsx
 *
 * UI component for NsViewConfig.
 * Handles rendering and interactions for the namespace feature.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { useResourceGridObjectIdentity } from '@modules/resource-grid/useResourceGridObjectIdentity';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import React, { useCallback, useMemo } from 'react';
import type { NamespaceConfigSnapshotPayload } from '@/core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getDisplayKind } from '@/utils/kindAliasMap';

// Data interface for configuration resources (ConfigMaps, Secrets)
export interface ConfigData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  data: number; // Count of data items from backend
  age?: string;
}

interface ConfigViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace configuration resources
 * Aggregates ConfigMaps and Secrets
 */
const ConfigViewGrid: React.FC<ConfigViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const queryClusterId = selectedClusterId;
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<ConfigData>('config');

    const getResourceIdentity = useCallback(
      (resource: ConfigData) => ({
        kind: resource.kind || resource.kindAlias,
        name: resource.name,
        namespace: resource.namespace,
        clusterId: resource.clusterId,
        clusterName: resource.clusterName ?? undefined,
      }),
      []
    );

    const resourceIdentity = useResourceGridObjectIdentity({
      fallbackClusterId: selectedClusterId,
      getObject: getResourceIdentity,
      openWithObject,
      navigateToView,
    });
    const { ref: resourceRef, open: openResource, navigate: navigateResource } = resourceIdentity;

    const columns: GridColumnDefinition<ConfigData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<ConfigData>[] = [
        cf.createKindColumn<ConfigData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: openResource,
          onAltClick: navigateResource,
        }),
        cf.createTextColumn<ConfigData>('name', 'Name', {
          onClick: openResource,
          onAltClick: navigateResource,
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn<ConfigData>(
          'data',
          'Data Items',
          (resource) => {
            const count = resource.data || 0;
            return `${count} ${count === 1 ? 'item' : 'items'}`;
          },
          {
            getClassName: () => 'data-count',
          }
        ),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        namespace: { autoWidth: true },
        name: { autoWidth: true },
        data: { autoWidth: true },
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
      namespaceColumnLink,
      navigateResource,
      openResource,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE
        ? 'All Namespaces Configuration'
        : 'Namespace Configuration';

    const { gridTableProps, favModal, source } = useQueryBackedNamespaceResourceGridTable<
      NamespaceConfigSnapshotPayload,
      ConfigData
    >({
      queryTableMode: 'Query Backed Static',
      clusterId: queryClusterId,
      domain: 'namespace-config',
      label: diagnosticsLabel,
      selectRows: selectPayloadRows,
      viewId: 'namespace-config',
      namespace,
      columns,
      objectIdentity: resourceIdentity,
      defaultSort: { key: 'name', direction: 'asc' },
      showKindDropdown: true,
      showNamespaceFilters: namespace === ALL_NAMESPACES_SCOPE,
      diagnosticsLabel,
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    const getContextMenuItems = useCallback(
      (resource: ConfigData): ContextMenuItem[] => {
        return objectActions.getMenuItems(resourceRef(resource));
      },
      [objectActions, resourceRef]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No config objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading configuration resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          onRowClick={openResource}
          tableClassName="ns-config-table"
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

ConfigViewGrid.displayName = 'NsViewConfig';

export default ConfigViewGrid;
