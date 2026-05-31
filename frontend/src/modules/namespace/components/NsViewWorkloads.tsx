/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.tsx
 *
 * UI component for NsViewWorkloads.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewWorkloads.css';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useShortNames } from '@/hooks/useShortNames';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import React, { useCallback, useMemo, useState } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';
import type { SortConfig } from '@hooks/useTableSort';
import type { NamespaceWorkloadSnapshotPayload, PodMetricsInfo } from '@/core/refresh/types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import {
  WorkloadData,
  appendWorkloadTokens,
} from '@modules/namespace/components/NsViewWorkloads.helpers';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNamespaceResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { buildWorkloadActionReference } from './workloadActionReference';
import { useAllNamespacesTypedQuery } from './useAllNamespacesTypedQuery';

interface WorkloadsViewProps {
  namespace: string;
  data: WorkloadData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
}

/**
 * GridTable component for namespace workloads without nested pod expansion
 */
const WorkloadsViewGrid: React.FC<WorkloadsViewProps> = React.memo(
  ({
    namespace,
    data,
    availableKinds: kindOptions,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
    metrics = null,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const { selectedClusterId } = useKubeconfig();
    // Foreground namespace views should resolve node metrics from the active cluster only.
    const nodesScope = useMemo(
      () => buildClusterScope(selectedClusterId ?? undefined, ''),
      [selectedClusterId]
    );
    const nodesDomain = useRefreshScopedDomain('nodes', nodesScope);
    const metricsInfo = metrics ?? nodesDomain.data?.metrics ?? null;

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
    const [tableState, setTableState] = useState<{
      filters: GridTableFilterState;
      sortConfig: SortConfig | null;
    }>({
      filters: DEFAULT_GRID_TABLE_FILTER_STATE,
      sortConfig: { key: 'name', direction: 'asc' },
    });
    const handleTableStateChange = useCallback(
      (next: { filters: GridTableFilterState; sortConfig: SortConfig | null }) => {
        setTableState((previous) => {
          if (
            previous.sortConfig?.key === next.sortConfig?.key &&
            previous.sortConfig?.direction === next.sortConfig?.direction &&
            JSON.stringify(previous.filters) === JSON.stringify(next.filters)
          ) {
            return previous;
          }
          return next;
        });
      },
      []
    );
    const selectWorkloadRows = useCallback(
      (payload: NamespaceWorkloadSnapshotPayload) => payload.workloads ?? [],
      []
    );
    const allNamespacesQuery = useAllNamespacesTypedQuery<
      NamespaceWorkloadSnapshotPayload,
      WorkloadData
    >({
      enabled: isAllNamespaces,
      clusterId: selectedClusterId,
      domain: 'namespace-workloads',
      label: 'All Namespaces Workloads',
      filters: tableState.filters,
      sortConfig: tableState.sortConfig,
      selectRows: selectWorkloadRows,
    });
    const tableData = isAllNamespaces ? allNamespacesQuery.rows : data;
    const tableLoading = isAllNamespaces ? allNamespacesQuery.loading : loading;
    const tableLoaded = isAllNamespaces ? allNamespacesQuery.loaded : loaded;
    const tableError = isAllNamespaces ? allNamespacesQuery.error : null;

    const getRowSearchValues = useCallback((row: WorkloadData) => {
      const tokens: string[] = [];
      appendWorkloadTokens(tokens, row);
      return tokens;
    }, []);

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<WorkloadData>({
      tableMode: isAllNamespaces ? 'Query Backed Dynamic' : 'Local Complete',
      viewId: 'namespace-workloads',
      namespace,
      data: tableData,
      columns: tableColumns as unknown as GridColumnDefinition<WorkloadData>[],
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      rowIdentity: keyExtractor,
      availableKinds: isAllNamespaces ? allNamespacesQuery.filterOptions.kinds : kindOptions,
      showKindDropdown: true,
      filterAccessors: {
        getKind: (row) => row.kind,
        getNamespace: (row) => row.namespace ?? '',
        getSearchText: (row) => getRowSearchValues(row),
      },
      showNamespaceFilters: showNamespaceFilter,
      diagnosticsLabel:
        namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Workloads' : 'Namespace Workloads',
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
      filterOptionOverrides: isAllNamespaces
        ? {
            ...allNamespacesQuery.filterOptions,
          }
        : undefined,
      onTableStateChange: isAllNamespaces ? handleTableStateChange : undefined,
    });
    const sortedWorkloads = gridTableProps.data;
    const resolvedGridTableProps = useMemo(
      () =>
        isAllNamespaces
          ? {
              ...gridTableProps,
              hasMore: Boolean(allNamespacesQuery.continueToken),
              onRequestMore: () => allNamespacesQuery.loadMore(),
              isRequestingMore: allNamespacesQuery.isRequestingMore,
              loadMoreLabel: 'Next page',
              showLoadMoreButton: true,
              showPaginationStatus: true,
            }
          : gridTableProps,
      [allNamespacesQuery, gridTableProps, isAllNamespaces]
    );

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

    const boundaryLoading =
      Boolean(tableLoading) || !(Boolean(tableLoaded) || sortedWorkloads.length > 0);

    return (
      <>
        {tableError && <div className="namespace-error-message">{tableError}</div>}
        {metricsBanner && (
          <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
            <span className="metrics-warning-banner__dot" />
            {metricsBanner.message}
          </div>
        )}
        <ResourceGridTableView
          gridTableProps={resolvedGridTableProps}
          boundaryLoading={boundaryLoading}
          loaded={Boolean(tableLoaded) || sortedWorkloads.length > 0}
          spinnerMessage="Loading workloads..."
          allowPartial
          favModal={favModal}
          columns={tableColumns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Workloads' : 'Namespace Workloads'
          }
          diagnosticsMode="live"
          loading={tableLoading && sortedWorkloads.length === 0}
          onRowClick={handleWorkloadClick}
          tableClassName="gridtable-workloads"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          emptyMessage={emptyMessage}
          enableColumnVisibilityMenu
          allowHorizontalOverflow={true}
          loadingOverlay={{
            show: Boolean(tableLoading) && sortedWorkloads.length > 0,
            message: 'Updating workloads…',
          }}
        />

        {objectActions.modals}
      </>
    );
  }
);

WorkloadsViewGrid.displayName = 'NsViewWorkloads';

export default WorkloadsViewGrid;
