/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.tsx
 *
 * UI component for NsViewWorkloads.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewWorkloads.css';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useShortNames } from '@/hooks/useShortNames';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type {
  NamespaceWorkloadMetricEntry,
  NamespaceWorkloadMetricsSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodMetricsInfo,
} from '@/core/refresh/types';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import {
  WorkloadData,
  appendWorkloadTokens,
} from '@modules/namespace/components/NsViewWorkloads.helpers';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { buildWorkloadActionReference } from './workloadActionReference';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';

interface WorkloadsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
}

const METRIC_NO_DATA = '-';

const workloadMetricRowKey = (row: Pick<WorkloadData, 'kind' | 'namespace' | 'name'>): string =>
  `${row.kind ?? ''}/${row.namespace ?? ''}/${row.name ?? ''}`.toLowerCase();

const mergeWorkloadMetric = (
  row: WorkloadData,
  metric: NamespaceWorkloadMetricEntry | undefined
): WorkloadData => ({
  ...row,
  ready: metric?.ready ?? row.ready,
  cpuUsage: metric?.cpuUsage ?? METRIC_NO_DATA,
  memUsage: metric?.memUsage ?? METRIC_NO_DATA,
});

/**
 * GridTable component for namespace workloads without nested pod expansion
 */
const WorkloadsViewGrid: React.FC<WorkloadsViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false, metrics = null }) => {
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

    const metricsBanner = useMemo(() => getMetricsBannerInfo(metricsInfo), [metricsInfo]);

    const tableColumns = useWorkloadTableColumns({
      handleWorkloadClick,
      onAltClick: handleWorkloadAltClick,
      showNamespaceColumn,
      useShortResourceNames,
      metrics: metricsInfo ?? null,
    });

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const showNamespaceFilter = isAllNamespaces;
    const diagnosticsLabel = isAllNamespaces ? 'All Namespaces Workloads' : 'Namespace Workloads';

    const metricOverlay = useMemo(
      () => ({
        domain: 'namespace-workloads-metrics' as const,
        label: `${diagnosticsLabel} Metrics`,
        selectRows: (payload: unknown) =>
          (payload as NamespaceWorkloadMetricsSnapshotPayload).rows ?? [],
        getBaseRowKey: workloadMetricRowKey,
        getMetricRowKey: (row: unknown) => (row as NamespaceWorkloadMetricEntry).rowKey,
        mergeMetric: (row: WorkloadData, metric: unknown) =>
          mergeWorkloadMetric(row, metric as NamespaceWorkloadMetricEntry | undefined),
      }),
      [diagnosticsLabel]
    );

    const getRowSearchValues = useCallback((row: WorkloadData) => {
      const tokens: string[] = [];
      appendWorkloadTokens(tokens, row);
      return tokens;
    }, []);

    const {
      gridTableProps: resolvedGridTableProps,
      favModal,
      source,
      metricPayload,
    } = useQueryBackedNamespaceResourceGridTable<NamespaceWorkloadSnapshotPayload, WorkloadData>({
      queryTableMode: 'Query Backed Dynamic',
      clusterId: selectedClusterId,
      domain: 'namespace-workloads',
      label: diagnosticsLabel,
      metricOverlay,
      selectRows: selectPayloadRows,
      viewId: 'namespace-workloads',
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

    const workloadMetricsPayload = metricPayload as
      NamespaceWorkloadMetricsSnapshotPayload | null | undefined;
    useEffect(() => {
      setTableMetricsInfo(workloadMetricsPayload?.metrics ?? null);
    }, [workloadMetricsPayload?.metrics]);

    const getContextMenuItems = useCallback(
      (row: WorkloadData): ContextMenuItem[] => {
        return objectActions.getMenuItems(buildWorkloadActionReference(row, selectedClusterId));
      },
      [objectActions, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No workloads found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
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
          spinnerMessage="Loading workloads..."
          updatingMessage="Updating workloads…"
          allowPartial
          favModal={favModal}
          columns={tableColumns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Workloads' : 'Namespace Workloads'
          }
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
