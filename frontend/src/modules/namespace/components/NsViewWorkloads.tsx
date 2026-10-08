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
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShowPodsToggle } from '@modules/object-panel/hooks/useShowPodsToggle';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
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
}

/**
 * GridTable component for namespace workloads
 */
const NsViewWorkloads: React.FC<WorkloadsViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const { selectedClusterId, selectedClusterName } = useKubeconfig();
    const { selectedNamespaceClusterId } = useNamespace();
    const queryClusterId = selectedNamespaceClusterId ?? selectedClusterId;
    const [metricsInfo, setMetricsInfo] = useState<PodMetricsInfo | null>(null);
    const showPods = useShowPodsToggle('workloads');

    const handleWorkloadClick = useCallback(
      (workload: WorkloadData) => {
        openWithObject(
          buildRequiredObjectReference(
            { ...workload.ref, clusterName: selectedClusterName },
            { fallbackClusterId: queryClusterId }
          ),
          showPods.openOptions(workload.ref.kind)
        );
      },
      [openWithObject, queryClusterId, selectedClusterName, showPods]
    );
    const viewActions = useMemo(() => [showPods.toggle], [showPods.toggle]);

    const handleWorkloadAltClick = useCallback(
      (workload: WorkloadData) => {
        navigateToView(
          buildRequiredObjectReference(
            { ...workload.ref, clusterName: selectedClusterName },
            { fallbackClusterId: queryClusterId }
          )
        );
      },
      [navigateToView, queryClusterId, selectedClusterName]
    );

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: openWithObject,
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    const keyExtractor = useCallback(
      (row: WorkloadData) =>
        buildRequiredCanonicalObjectRowKey(row.ref, { fallbackClusterId: queryClusterId }),
      [queryClusterId]
    );

    const tableColumns = useWorkloadTableColumns({
      handleWorkloadClick,
      onAltClick: handleWorkloadAltClick,
      showNamespaceColumn,
      useShortResourceNames,
      metrics: metricsInfo,
    });

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const showNamespaceFilter = isAllNamespaces;
    const diagnosticsLabel = isAllNamespaces ? 'All Namespaces Workloads' : 'Namespace Workloads';

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
      supportsCustomMetadataColumns: true,
      clusterId: queryClusterId,
      domain: 'namespace-workloads',
      excludedQueryFacetKeys: RESOURCE_STATUS_QUERY_FACET_KEYS,
      label: diagnosticsLabel,
      selectRows: selectPayloadRows,
      viewId: 'namespace-workloads',
      namespace,
      columns: tableColumns as unknown as GridColumnDefinition<WorkloadData>[],
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      rowIdentity: keyExtractor,
      showKindDropdown: true,
      filterAccessors: {
        getKind: (row) => row.ref.kind,
        getNamespace: (row) => row.ref.namespace ?? '',
        getSearchText: (row) => getRowSearchValues(row),
      },
      showNamespaceFilters: showNamespaceFilter,
      diagnosticsLabel,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
      viewActions,
    });

    // The base query payload carries the poller freshness block for the usage
    // joined onto the rows at serve.
    useEffect(() => {
      setMetricsInfo(queryPayload?.metrics ?? null);
    }, [queryPayload?.metrics]);

    const getContextMenuItems = useCallback(
      (row: WorkloadData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildWorkloadActionReference(row, queryClusterId, selectedClusterName)
        );
      },
      [objectActions, queryClusterId, selectedClusterName]
    );

    // Standalone Pods (no owning controller) are listed with the workloads.
    const getRowClassName = useCallback(
      (row: WorkloadData) => (row.ref.kind === 'Pod' ? 'gridtable-row--pod' : ''),
      []
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
        <ResourceInventoryTable
          source={source}
          gridTableProps={resolvedGridTableProps}
          spinnerMessage="Loading workloads..."
          updatingMessage="Updating workloads…"
          allowPartial
          favModal={favModal}
          columns={tableColumns}
          diagnosticsLabel={diagnosticsLabel}
          diagnosticsMode="live"
          onRowClick={handleWorkloadClick}
          getRowClassName={getRowClassName}
          tableClassName="gridtable-workloads"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          emptyMessage={emptyMessage}
          enableColumnVisibilityMenu
        />

        {objectActions.modals}
      </>
    );
  }
);

NsViewWorkloads.displayName = 'NsViewWorkloads';

export default NsViewWorkloads;
