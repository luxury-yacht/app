/**
 * frontend/src/modules/namespace/components/NsViewAutoscaling.tsx
 *
 * UI component for NsViewAutoscaling.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewAutoscaling.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useState, useCallback } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { formatBuiltinApiVersion } from '@shared/constants/builtinGroupVersions';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  buildRelatedObjectReference,
} from '@shared/utils/objectIdentity';

const NAMESPACE_AUTOSCALING_KIND_OPTIONS = ['HorizontalPodAutoscaler'];

// Data interface for autoscaling resources
export interface AutoscalingData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  // Multi-cluster metadata used for per-tab actions and stable row keys.
  clusterId?: string;
  clusterName?: string;
  // HorizontalPodAutoscaler-specific fields
  scaleTargetRef?: {
    kind: string;
    name: string;
    /**
     * Wire-form apiVersion of the scale target. Threaded from the
     * backend via NamespaceAutoscalingSummary.targetApiVersion so the
     * panel can open CRD scale targets correctly.
     */
    apiVersion?: string;
  };
  target?: string;
  min?: number;
  max?: number;
  current?: number;
  targetCPUUtilizationPercentage?: number;
  metrics?: Array<{
    type: string;
    target: string;
  }>;
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  // VerticalPodAutoscaler-specific fields
  updatePolicy?: {
    updateMode?: string;
  };
  status?: string;
  age?: string;
  [key: string]: any; // Allow additional fields
}

interface AutoscalingViewProps {
  namespace: string;
  data: AutoscalingData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace autoscaling resources
 * Aggregates HorizontalPodAutoscalers and VerticalPodAutoscalers
 */
const AutoscalingViewGrid: React.FC<AutoscalingViewProps> = React.memo(
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
    const namespaceColumnLink = useNamespaceColumnLink<AutoscalingData>('autoscaling');
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: AutoscalingData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: AutoscalingData) => {
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
      (resource: AutoscalingData) =>
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

    const buildScaleTargetReference = useCallback((resource: AutoscalingData) => {
      if (!resource.scaleTargetRef) {
        return null;
      }
      try {
        return buildRelatedObjectReference({
          kind: resource.scaleTargetRef.kind,
          name: resource.scaleTargetRef.name,
          namespace: resource.namespace,
          apiVersion: resource.scaleTargetRef.apiVersion,
          clusterId: resource.clusterId ?? undefined,
          clusterName: resource.clusterName ?? undefined,
        });
      } catch {
        return null;
      }
    }, []);

    const columns: GridColumnDefinition<AutoscalingData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<AutoscalingData>[] = [];

      baseColumns.push(
        cf.createKindColumn<AutoscalingData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) =>
            getDisplayKind(
              resource.kind || resource.kindAlias || 'Autoscaler',
              useShortResourceNames
            ),
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
        })
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>('name', 'Name', {
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
        })
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>(
          'scaleTarget',
          'Scale Target',
          (resource) => {
            if (resource.scaleTargetRef) {
              const ref = resource.scaleTargetRef;
              return `${ref.kind}/${ref.name}`;
            }
            if (resource.target) {
              return resource.target;
            }
            return '-';
          },
          {
            onClick: (resource) => {
              const targetRef = buildScaleTargetReference(resource);
              if (targetRef) {
                openWithObject(targetRef);
              }
            },
            onAltClick: (resource) => {
              const targetRef = buildScaleTargetReference(resource);
              if (targetRef) {
                navigateToView(targetRef);
              }
            },
            isInteractive: (resource) => Boolean(resource.scaleTargetRef),
            getClassName: (resource) =>
              ['scale-reference', resource.scaleTargetRef ? 'object-panel-link' : undefined]
                .filter(Boolean)
                .join(' '),
          }
        )
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>(
          'replicas',
          'Min/Max',
          (resource) => {
            if (resource.kind === 'HorizontalPodAutoscaler') {
              const minValue = resource.minReplicas ?? resource.min;
              const min = minValue !== undefined && minValue !== null ? minValue : 1;
              const maxValue = resource.maxReplicas ?? resource.max;
              return `${min}/${maxValue !== undefined && maxValue !== null ? maxValue : '-'}`;
            }
            return '-';
          },
          {
            getClassName: (resource) =>
              resource.kind === 'HorizontalPodAutoscaler' ? 'replica-range' : undefined,
          }
        )
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>(
          'current',
          'Current',
          (resource) => {
            if (resource.kind === 'HorizontalPodAutoscaler') {
              const current = resource.currentReplicas ?? resource.current;
              return `${current !== undefined && current !== null ? current : 0}`;
            }
            if (resource.kind === 'VerticalPodAutoscaler') {
              return resource.status || 'Unknown';
            }
            return '-';
          },
          {
            getClassName: (resource) => {
              if (resource.kind === 'HorizontalPodAutoscaler') {
                return 'current-replicas';
              }
              if (resource.kind === 'VerticalPodAutoscaler') {
                const status = resource.status || 'Unknown';
                return `vpa-status ${status.toLowerCase()}`;
              }
              return undefined;
            },
          }
        )
      );

      baseColumns.push(cf.createAgeColumn());

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        scaleTarget: { autoWidth: true },
        replicas: { autoWidth: true },
        current: { autoWidth: true },
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
      buildScaleTargetReference,
      handleResourceClick,
      namespaceColumnLink,
      navigateToView,
      openWithObject,
      selectedClusterId,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<AutoscalingData>({
      viewId: 'namespace-autoscaling',
      namespace,
      data,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      diagnosticsLabel:
        namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Autoscaling' : 'Namespace Autoscaling',
      availableKinds:
        kindOptions && kindOptions.length > 0 ? kindOptions : NAMESPACE_AUTOSCALING_KIND_OPTIONS,
      showNamespaceFilters: showNamespaceFilter,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
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
        // Built-in HPA resolves via the lookup table. A miss means a
        // non-built-in kind slipped into this view — fail loud.
        //
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
      (resource: AutoscalingData): ContextMenuItem[] => {
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(resource.kind, 'delete', resource.namespace, null, resource.clusterId)
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
            onDelete: () => setDeleteConfirm({ show: true, resource }),
          },
          permissions: {
            delete: deleteStatus,
          },
        });
      },
      [handleResourceClick, permissionMap, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No autoscaling objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading}
          loaded={loaded}
          spinnerMessage="Loading autoscaling resources..."
          favModal={favModal}
            columns={columns}
            diagnosticsLabel={
              namespace === ALL_NAMESPACES_SCOPE
                ? 'All Namespaces Autoscaling'
                : 'Namespace Autoscaling'
            }
            diagnosticsMode="live"
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            tableClassName="ns-autoscaling-table"
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
      </>
    );
  }
);

AutoscalingViewGrid.displayName = 'NsViewAutoscaling';

export default AutoscalingViewGrid;
