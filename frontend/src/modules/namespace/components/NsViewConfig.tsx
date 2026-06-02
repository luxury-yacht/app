/**
 * frontend/src/modules/namespace/components/NsViewConfig.tsx
 *
 * UI component for NsViewConfig.
 * Handles rendering and interactions for the namespace feature.
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
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { useResourceGridObjectIdentity } from '@modules/resource-grid/useResourceGridObjectIdentity';
import { buildLocalPartialDataLabel } from '@modules/resource-grid/tablePartialState';
import type { SnapshotStats } from '@/core/refresh/client';
import type { NamespaceConfigSnapshotPayload } from '@/core/refresh/types';

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
  data: ConfigData[];
  stats?: SnapshotStats | null;
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace configuration resources
 * Aggregates ConfigMaps and Secrets
 */
const ConfigViewGrid: React.FC<ConfigViewProps> = React.memo(
  ({
    namespace,
    data,
    stats = null,
    availableKinds: kindOptions,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
  }) => {
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

    const selectRows = useCallback(
      (payload: NamespaceConfigSnapshotPayload) => payload.resources ?? [],
      []
    );
    const { gridTableProps, favModal } = useQueryBackedNamespaceResourceGridTable<
      NamespaceConfigSnapshotPayload,
      ConfigData
    >({
      enabled: namespace === ALL_NAMESPACES_SCOPE,
      queryTableMode: 'Query Backed Static',
      clusterId: queryClusterId,
      domain: 'namespace-config',
      label: 'All Namespaces Configuration',
      localData: data,
      localLoading: loading,
      localLoaded: loaded,
      selectRows,
      viewId: 'namespace-config',
      namespace,
      columns,
      objectIdentity: resourceIdentity,
      defaultSort: { key: 'name', direction: 'asc' },
      availableKinds: kindOptions,
      showKindDropdown: true,
      showNamespaceFilters: namespace === ALL_NAMESPACES_SCOPE,
      filterOptionOverrides:
        namespace === ALL_NAMESPACES_SCOPE
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
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading}
          loaded={loaded}
          spinnerMessage="Loading configuration resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          loading={loading}
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
