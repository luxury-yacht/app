/**
 * frontend/src/modules/namespace/components/NsViewAutoscaling.tsx
 *
 * UI component for NsViewAutoscaling.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewAutoscaling.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
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
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';

const NAMESPACE_AUTOSCALING_KIND_OPTIONS = ['HorizontalPodAutoscaler'];

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
      showKindDropdown: true,
      showNamespaceFilters: showNamespaceFilter,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
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

        {objectActions.modals}
      </>
    );
  }
);

AutoscalingViewGrid.displayName = 'NsViewAutoscaling';

export default AutoscalingViewGrid;
