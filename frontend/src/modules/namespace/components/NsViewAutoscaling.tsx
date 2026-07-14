/**
 * frontend/src/modules/namespace/components/NsViewAutoscaling.tsx
 *
 * UI component for NsViewAutoscaling.
 * Handles rendering and interactions for the namespace feature.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { parseAutoscalingTarget } from '@shared/resources/resourceDescriptorSelectors';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';
import React, { useCallback, useMemo } from 'react';
import type {
  NamespaceAutoscalingSnapshotPayload,
  NamespaceAutoscalingSummary,
} from '@/core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getDisplayKind } from '@/utils/kindAliasMap';

// Data interface for autoscaling resources
export interface AutoscalingData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  // Multi-cluster metadata used for per-tab actions and stable row keys.
  clusterId: string;
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
  ageTimestamp?: number;
  [key: string]: unknown; // Allow additional fields
}

interface AutoscalingViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace autoscaling resources
 * Aggregates HorizontalPodAutoscalers and VerticalPodAutoscalers
 */
const AutoscalingViewGrid: React.FC<AutoscalingViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const queryClusterId = selectedClusterId;
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<AutoscalingData>('autoscaling');

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

    const buildScaleTargetReference = useCallback(
      (resource: AutoscalingData) => {
        if (!resource.scaleTargetRef) {
          return null;
        }
        try {
          return buildRequiredRelatedObjectReference(
            {
              kind: resource.scaleTargetRef.kind,
              name: resource.scaleTargetRef.name,
              namespace: resource.namespace,
              apiVersion: resource.scaleTargetRef.apiVersion,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          );
        } catch {
          return null;
        }
      },
      [selectedClusterId]
    );

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
            alignHeader: 'center',
            alignData: 'center',
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
            alignHeader: 'center',
            alignData: 'center',
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

    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Autoscaling' : 'Namespace Autoscaling';
    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;

    const selectRows = useCallback(
      (payload: NamespaceAutoscalingSnapshotPayload) =>
        (payload.rows ?? []).map((item: NamespaceAutoscalingSummary) => {
          const scaleTargetRef = parseAutoscalingTarget(item.target, item.targetApiVersion);
          return {
            kind: item.kind,
            kindAlias: item.kind,
            name: item.name,
            namespace: item.namespace,
            clusterId: item.clusterId,
            clusterName: item.clusterName,
            scaleTargetRef,
            target: item.target,
            min: item.min,
            max: item.max,
            current: item.current,
            minReplicas: item.min,
            maxReplicas: item.max,
            currentReplicas: item.current,
            age: item.age,
            ageTimestamp: item.ageTimestamp,
          };
        }),
      []
    );
    const { gridTableProps, favModal, source } = useQueryBackedNamespaceResourceGridTable<
      NamespaceAutoscalingSnapshotPayload,
      AutoscalingData
    >({
      queryTableMode: 'Query Backed Static',
      clusterId: queryClusterId,
      domain: 'namespace-autoscaling',
      label: diagnosticsLabel,
      selectRows,
      viewId: 'namespace-autoscaling',
      namespace,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      diagnosticsLabel,
      showKindDropdown: true,
      showNamespaceFilters: showNamespaceFilter,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    const getContextMenuItems = useCallback(
      (resource: AutoscalingData): ContextMenuItem[] => {
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
          `No autoscaling objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading autoscaling resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          diagnosticsMode="live"
          onRowClick={handleResourceClick}
          tableClassName="ns-autoscaling-table"
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

AutoscalingViewGrid.displayName = 'NsViewAutoscaling';

export default AutoscalingViewGrid;
