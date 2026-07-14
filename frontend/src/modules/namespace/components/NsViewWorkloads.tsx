/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.tsx
 *
 * UI component for NsViewWorkloads.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewWorkloads.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  appendWorkloadTokens,
  type WorkloadData,
} from '@modules/namespace/components/NsViewWorkloads.helpers';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useMetricsBannerInfo } from '@shared/hooks/useMetricsBannerInfo';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NamespaceWorkloadSnapshotPayload, PodMetricsInfo } from '@/core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { buildWorkloadActionReference } from './workloadActionReference';

interface WorkloadsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
  /** Render the operational lens backed by the workload health predicate. */
  attentionOnly?: boolean;
  metrics?: PodMetricsInfo | null;
}

const NEEDS_ATTENTION_PREDICATES = { health: 'unhealthy' } as const;

/**
 * GridTable component for namespace workloads without nested pod expansion
 */
const WorkloadsViewGrid: React.FC<WorkloadsViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false, attentionOnly = false, metrics = null }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const { selectedClusterId } = useKubeconfig();
    const [tableMetricsInfo, setTableMetricsInfo] = useState<PodMetricsInfo | null>(null);
    const metricsInfo = tableMetricsInfo ?? metrics ?? null;

    const handleWorkloadClick = useCallback(
      (workload: WorkloadData) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: workload.kind,
              name: workload.name,
              namespace: workload.namespace,
              clusterId: workload.clusterId,
              clusterName: workload.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const handleWorkloadAltClick = useCallback(
      (workload: WorkloadData) => {
        navigateToView(
          buildRequiredObjectReference(
            {
              kind: workload.kind,
              name: workload.name,
              namespace: workload.namespace,
              clusterId: workload.clusterId,
              clusterName: workload.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [navigateToView, selectedClusterId]
    );

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: object.kind,
              name: object.name,
              namespace: object.namespace,
              clusterId: object.clusterId,
              clusterName: object.clusterName,
              group: object.group,
              version: object.version,
              resource: object.resource,
              uid: object.uid,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      onOpenObjectMap: (object) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: object.kind,
              name: object.name,
              namespace: object.namespace,
              clusterId: object.clusterId,
              clusterName: object.clusterName,
              group: object.group,
              version: object.version,
              resource: object.resource,
              uid: object.uid,
            },
            { fallbackClusterId: selectedClusterId }
          ),
          { initialTab: 'map' }
        );
      },
    });

    const keyExtractor = useCallback(
      (row: WorkloadData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: row.kind,
            name: row.name,
            namespace: row.namespace,
            clusterId: row.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    const metricsBanner = useMetricsBannerInfo(metricsInfo);

    const tableColumns = useWorkloadTableColumns({
      handleWorkloadClick,
      onAltClick: handleWorkloadAltClick,
      showNamespaceColumn,
      useShortResourceNames,
      metrics: metricsInfo ?? null,
    });

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const showNamespaceFilter = isAllNamespaces;
    const diagnosticsLabel = attentionOnly
      ? isAllNamespaces
        ? 'Cluster Needs Attention'
        : 'Namespace Needs Attention'
      : isAllNamespaces
        ? 'All Namespaces Workloads'
        : 'Namespace Workloads';
    const resolvedViewId = attentionOnly ? 'needs-attention' : 'namespace-workloads';

    const getRowSearchValues = useCallback((row: WorkloadData) => {
      const tokens: string[] = [];
      appendWorkloadTokens(tokens, row);
      return tokens;
    }, []);

    const {
      gridTableProps: resolvedGridTableProps,
      favModal,
      source,
      queryPayload,
    } = useQueryBackedNamespaceResourceGridTable<NamespaceWorkloadSnapshotPayload, WorkloadData>({
      queryTableMode: 'Query Backed Dynamic',
      clusterId: selectedClusterId,
      domain: 'namespace-workloads',
      label: diagnosticsLabel,
      predicates: attentionOnly ? NEEDS_ATTENTION_PREDICATES : undefined,
      selectRows: selectPayloadRows,
      viewId: resolvedViewId,
      namespace,
      columns: tableColumns as unknown as GridColumnDefinition<WorkloadData>[],
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      rowIdentity: keyExtractor,
      showKindDropdown: true,
      filterAccessors: {
        getKind: (row) => row.kind,
        getNamespace: (row) => row.namespace ?? '',
        getSearchText: (row) => getRowSearchValues(row),
      },
      showNamespaceFilters: showNamespaceFilter,
      diagnosticsLabel,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    // The base query payload carries the poller freshness block for the usage
    // joined onto the rows at serve.
    useEffect(() => {
      setTableMetricsInfo(queryPayload?.metrics ?? null);
    }, [queryPayload?.metrics]);

    const getContextMenuItems = useCallback(
      (row: WorkloadData): ContextMenuItem[] => {
        return objectActions.getMenuItems(buildWorkloadActionReference(row, selectedClusterId));
      },
      [objectActions, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () =>
        attentionOnly
          ? 'No workloads need attention'
          : resolveEmptyStateMessage(
              undefined,
              `No workloads found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
            ),
      [attentionOnly, namespace]
    );

    return (
      <>
        {metricsBanner && (
          <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
            <span className="metrics-warning-banner__dot" />
            {metricsBanner.message}
          </div>
        )}
        <ResourceInventoryTable
          source={source}
          gridTableProps={resolvedGridTableProps}
          spinnerMessage={
            attentionOnly ? 'Finding workloads that need attention...' : 'Loading workloads...'
          }
          updatingMessage={attentionOnly ? 'Updating attention view…' : 'Updating workloads…'}
          allowPartial
          favModal={favModal}
          columns={tableColumns}
          diagnosticsLabel={diagnosticsLabel}
          diagnosticsMode="live"
          onRowClick={handleWorkloadClick}
          tableClassName="gridtable-workloads"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          emptyMessage={emptyMessage}
          enableColumnVisibilityMenu
          allowHorizontalOverflow={true}
        />

        {objectActions.modals}
      </>
    );
  }
);

WorkloadsViewGrid.displayName = 'NsViewWorkloads';

export default WorkloadsViewGrid;
