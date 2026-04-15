/**
 * frontend/src/modules/namespace/components/NsViewNetwork.tsx
 *
 * UI component for NsViewNetwork.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewNetwork.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useState, useCallback } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import {
  formatBuiltinApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { PortForwardModal, PortForwardTarget } from '@modules/port-forward';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useFavToggle } from '@ui/favorites/FavToggle';

// Data interface for network resources
export interface NetworkData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId?: string;
  clusterName?: string;
  details: string; // Pre-formatted details from backend
  age?: string;
}

interface NetworkViewProps {
  namespace: string;
  data: NetworkData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace network configuration resources
 * Aggregates Services, Ingresses, NetworkPolicies, etc.
 */
const NetworkViewGrid: React.FC<NetworkViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: NetworkData | null;
    }>({ show: false, resource: null });
    const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);

    const handleResourceClick = useCallback(
      (resource: NetworkData) => {
        const resolvedKind = resource.kind || resource.kindAlias;
        openWithObject({
          kind: resolvedKind,
          name: resource.name,
          namespace: resource.namespace,
          ...resolveBuiltinGroupVersion(resolvedKind),
          clusterId: resource.clusterId ?? undefined,
          clusterName: resource.clusterName ?? undefined,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: NetworkData) =>
        buildClusterScopedKey(
          resource,
          [resource.namespace, resource.kind, resource.name].filter(Boolean).join('/')
        ),
      []
    );

    const columns: GridColumnDefinition<NetworkData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<NetworkData>[] = [
        cf.createKindColumn<NetworkData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView({
              kind: resource.kind,
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId ?? undefined,
              clusterName: resource.clusterName ?? undefined,
            }),
        }),
        cf.createTextColumn<NetworkData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView({
              kind: resource.kind,
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId ?? undefined,
              clusterName: resource.clusterName ?? undefined,
            }),
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn<NetworkData>(
          'details',
          'Details',
          (resource) => resource.details || '-',
          {
            getClassName: (resource) => (resource.details ? 'network-details' : undefined),
            sortable: false,
          }
        ),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        details: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (resource) => resource.namespace,
          sortValue: (resource) => (resource.namespace || '').toLowerCase(),
        });
      }

      return baseColumns;
    }, [handleResourceClick, navigateToView, showNamespaceColumn, useShortResourceNames]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;

    const {
      sortConfig: persistedSort,
      onSortChange,
      columnWidths,
      setColumnWidths,
      columnVisibility,
      setColumnVisibility,
      filters: persistedFilters,
      setFilters: setPersistedFilters,
      resetState: resetPersistedState,
      hydrated,
    } = useNamespaceGridTablePersistence<NetworkData>({
      viewId: 'namespace-network',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, undefined, 'asc', {
      columns,
      controlledSort: persistedSort,
      onChange: onSortChange,
    });

    const availableKinds = useMemo(
      () => [...new Set(data.map((r) => r.kind).filter(Boolean) as string[])].sort(),
      [data]
    );
    const availableFilterNamespaces = useMemo(
      () => [...new Set(data.map((r) => r.namespace).filter(Boolean))].sort(),
      [data]
    );

    const { item: favToggle, modal: favModal } = useFavToggle({
      filters: persistedFilters,
      sortColumn: sortConfig?.key ?? null,
      sortDirection: sortConfig?.direction ?? 'asc',
      columnVisibility: columnVisibility ?? {},
      setFilters: setPersistedFilters,
      setSortConfig: onSortChange,
      setColumnVisibility,
      hydrated,
      availableKinds,
      availableFilterNamespaces,
    });

    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;
      const resource = deleteConfirm.resource;

      try {
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!resource.clusterId) {
          throw new Error(`Cannot delete ${resource.kind}/${resource.name}: clusterId is missing`);
        }
        // Built-in network resources (Service/Ingress/NetworkPolicy/EndpointSlice)
        // resolve via the lookup table. A miss means a non-built-in kind
        // slipped into this view — fail loud.
        const apiVersion = formatBuiltinApiVersion(resource.kind);
        if (!apiVersion) {
          throw new Error(
            `Cannot delete ${resource.kind}/${resource.name}: not a known built-in kind`
          );
        }
        await DeleteResourceByGVK(
          resource.clusterId,
          apiVersion,
          resource.kind,
          resource.namespace,
          resource.name
        );
        setDeleteConfirm({ show: false, resource: null });
      } catch (error) {
        errorHandler.handle(error, {
          action: 'delete',
          kind: resource.kind,
          name: resource.name,
        });
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource]);

    const getContextMenuItems = useCallback(
      (resource: NetworkData): ContextMenuItem[] => {
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(resource.kind, 'delete', resource.namespace, null, resource.clusterId)
          ) ?? null;
        const portForwardStatus =
          permissionMap.get(
            getPermissionKey('Pod', 'create', resource.namespace, 'portforward', resource.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: {
            kind: resource.kind,
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId,
            clusterName: resource.clusterName,
          },
          context: 'gridtable',
          handlers: {
            onOpen: () => handleResourceClick(resource),
            onPortForward: () => {
              // Multi-cluster rule (AGENTS.md): port-forward is a backend
              // command and must carry a resolved clusterId.
              if (!resource.clusterId) {
                errorHandler.handle(
                  new Error(
                    `Cannot open port-forward for ${resource.kind}/${resource.name}: clusterId is missing`
                  ),
                  { action: 'portForward', kind: resource.kind, name: resource.name }
                );
                return;
              }
              const targetGVK = resolveBuiltinGroupVersion(resource.kind);
              setPortForwardTarget({
                kind: resource.kind,
                group: targetGVK.group ?? '',
                version: targetGVK.version ?? 'v1',
                name: resource.name,
                namespace: resource.namespace,
                clusterId: resource.clusterId,
                clusterName: resource.clusterName ?? '',
                ports: [],
              });
            },
            onDelete: () => setDeleteConfirm({ show: true, resource }),
          },
          permissions: {
            delete: deleteStatus,
            portForward: portForwardStatus,
          },
        });
      },
      [handleResourceClick, permissionMap]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No network objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading network resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="ns-network-table"
            enableContextMenu={true}
            getCustomContextMenuItems={getContextMenuItems}
            useShortNames={useShortResourceNames}
            emptyMessage={emptyMessage}
            filters={{
              enabled: true,
              value: persistedFilters,
              onChange: setPersistedFilters,
              onReset: resetPersistedState,
              options: {
                showKindDropdown: true,
                showNamespaceDropdown: showNamespaceFilter,
                preActions: [favToggle],
              },
            }}
            virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            allowHorizontalOverflow={true}
          />
        </ResourceLoadingBoundary>

        <ConfirmationModal
          isOpen={deleteConfirm.show}
          title={`Delete ${deleteConfirm.resource?.kind || 'Resource'}`}
          message={`Are you sure you want to delete ${deleteConfirm.resource?.kind.toLowerCase()} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm({ show: false, resource: null })}
        />

        <PortForwardModal target={portForwardTarget} onClose={() => setPortForwardTarget(null)} />
        {favModal}
      </>
    );
  }
);

NetworkViewGrid.displayName = 'NsViewNetwork';

export default NetworkViewGrid;
