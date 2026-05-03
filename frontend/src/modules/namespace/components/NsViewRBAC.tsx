/**
 * frontend/src/modules/namespace/components/NsViewRBAC.tsx
 *
 * UI component for NsViewRBAC.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewRBAC.css';
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
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

// Data interface for RBAC resources
export interface RBACData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  // Role-specific fields
  rulesCount?: number;
  rules?: Array<{
    verbs?: string[];
    resources?: string[];
    apiGroups?: string[];
  }>;
  // RoleBinding-specific fields
  roleRef?: {
    kind?: string;
    name: string;
  };
  subjects?: Array<{
    kind: string;
    name: string;
    namespace?: string;
  }>;
  // ServiceAccount-specific fields
  secrets?: Array<{ name: string }>;
  automountServiceAccountToken?: boolean;
  roleBindings?: any[];
  labels?: Record<string, string>;
  age?: string;
}

interface RBACViewProps {
  namespace: string;
  data: RBACData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace RBAC resources
 * Aggregates Roles, RoleBindings, and ServiceAccounts
 */
const RBACViewGrid: React.FC<RBACViewProps> = React.memo(
  ({
    namespace,
    data,
    availableKinds: kindOptions,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<RBACData>('rbac');

    const handleResourceClick = useCallback(
      (resource: RBACData) => {
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
      (resource: RBACData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: resource.kind || resource.kindAlias,
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

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
                  namespace: resource.namespace,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName ?? undefined,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<RBACData>('name', 'Name', {
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
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
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
      selectedClusterId,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces RBAC' : 'Namespace RBAC';

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<RBACData>({
      viewId: 'namespace-rbac',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      availableKinds: kindOptions,
      showKindDropdown: true,
      showNamespaceFilters: namespace === ALL_NAMESPACES_SCOPE,
      diagnosticsLabel,
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
    });

    const getContextMenuItems = useCallback(
      (resource: RBACData): ContextMenuItem[] => {
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
          `No RBAC objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading}
          loaded={loaded}
          spinnerMessage="Loading RBAC resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="ns-rbac-table"
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

RBACViewGrid.displayName = 'NsViewRBAC';

export default RBACViewGrid;
