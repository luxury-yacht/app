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
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useState, useCallback } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  formatBuiltinApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { PortForwardModal, PortForwardTarget } from '@modules/port-forward';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

// Data interface for network resources
export interface NetworkData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  details: string; // Pre-formatted details from backend
  age?: string;
}

interface NetworkViewProps {
  namespace: string;
  data: NetworkData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace network configuration resources
 * Aggregates Services, Ingresses, NetworkPolicies, etc.
 */
const NetworkViewGrid: React.FC<NetworkViewProps> = React.memo(
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
    const namespaceColumnLink = useNamespaceColumnLink<NetworkData>('network');
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: NetworkData | null;
    }>({ show: false, resource: null });
    const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);

    const handleResourceClick = useCallback(
      (resource: NetworkData) => {
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
      (resource: NetworkData) =>
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

    const columns: GridColumnDefinition<NetworkData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<NetworkData>[] = [
        cf.createKindColumn<NetworkData>({
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
        cf.createTextColumn<NetworkData>('name', 'Name', {
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
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Network' : 'Namespace Network';

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<NetworkData>({
      viewId: 'namespace-network',
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
          clusterId,
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
    }, [deleteConfirm.resource, selectedClusterId]);

    const getContextMenuItems = useCallback(
      (resource: NetworkData): ContextMenuItem[] => {
        const clusterId = resource.clusterId ?? selectedClusterId ?? undefined;
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(resource.kind, 'delete', resource.namespace, null, clusterId)
          ) ?? null;
        const portForwardStatus =
          permissionMap.get(
            getPermissionKey('Pod', 'create', resource.namespace, 'portforward', clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: buildRequiredObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          ),
          context: 'gridtable',
          handlers: {
            onOpen: () => handleResourceClick(resource),
            onPortForward: () => {
              // Multi-cluster rule (AGENTS.md): port-forward is a backend
              // command and must carry a resolved clusterId.
              if (!clusterId) {
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
                clusterId,
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
      [handleResourceClick, permissionMap, selectedClusterId]
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
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading}
          loaded={loaded}
          spinnerMessage="Loading network resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="ns-network-table"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />

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
      </>
    );
  }
);

NetworkViewGrid.displayName = 'NsViewNetwork';

export default NetworkViewGrid;
