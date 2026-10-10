/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.tsx
 *
 * UI component for NsViewWorkloads.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewWorkloads.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { PodsTable } from '@modules/namespace/components/NsViewPods';
import {
  appendWorkloadTokens,
  type WorkloadData,
} from '@modules/namespace/components/NsViewWorkloads.helpers';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { useClearHiddenRowSelection } from '@modules/resource-grid/useClearHiddenRowSelection';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type {
  GridColumnDefinition,
  GridTableRowDetail,
} from '@shared/components/tables/GridTable.types';
import type { RowDetailToggleOptions } from '@shared/components/tables/rowDetailToggle';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NamespaceWorkloadSnapshotPayload, PodMetricsInfo } from '@/core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { buildWorkloadActionReference } from './workloadActionReference';

interface WorkloadsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
}

interface WorkloadsTableProps extends WorkloadsViewProps {
  clusterId?: string | null;
  /** The highlighted row. */
  selectedWorkloadKey?: string | null;
  /** The row whose pods are open under it. */
  openWorkloadKey?: string | null;
  onWorkloadSelect?: (workload: WorkloadData) => void;
  onWorkloadSelectionClear?: () => void;
  onWorkloadPodsToggle?: (workload: WorkloadData) => void;
  onWorkloadPodsClose?: () => void;
  renderWorkloadPods?: (workload: WorkloadData) => React.ReactNode;
}

/**
 * GridTable of namespace workloads; a workload's pods open under its row.
 */
export const WorkloadsTable: React.FC<WorkloadsTableProps> = React.memo(
  ({
    namespace,
    clusterId,
    showNamespaceColumn = false,
    metrics = null,
    selectedWorkloadKey = null,
    openWorkloadKey = null,
    onWorkloadSelect,
    onWorkloadSelectionClear,
    onWorkloadPodsToggle,
    onWorkloadPodsClose,
    renderWorkloadPods,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const { selectedClusterId, selectedClusterName } = useKubeconfig();
    const queryClusterId = clusterId ?? selectedClusterId;
    const [tableMetricsInfo, setTableMetricsInfo] = useState<PodMetricsInfo | null>(null);
    const metricsInfo = tableMetricsInfo ?? metrics ?? null;

    const handleWorkloadClick = useCallback(
      (workload: WorkloadData) => {
        openWithObject(
          buildRequiredObjectReference(
            { ...workload.ref, clusterName: selectedClusterName },
            { fallbackClusterId: queryClusterId }
          )
        );
      },
      [openWithObject, queryClusterId, selectedClusterName]
    );

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

    const podsToggle = useMemo<RowDetailToggleOptions<WorkloadData> | undefined>(
      () =>
        onWorkloadPodsToggle
          ? {
              getRowKey: keyExtractor,
              isOpen: (row) => keyExtractor(row) === openWorkloadKey,
              onToggle: onWorkloadPodsToggle,
              getLabel: (row, open) =>
                `${open ? 'Hide' : 'Show'} pods for ${row.ref.name} (${row.ready ?? 'no'} ready)`,
              getText: (row) => row.ready ?? '—',
            }
          : undefined,
      [keyExtractor, onWorkloadPodsToggle, openWorkloadKey]
    );

    const tableColumns = useWorkloadTableColumns({
      handleWorkloadClick,
      onAltClick: handleWorkloadAltClick,
      showNamespaceColumn,
      useShortResourceNames,
      podsToggle,
      metrics: metricsInfo ?? null,
    });

    const rowDetail = useMemo<GridTableRowDetail<WorkloadData> | undefined>(
      () =>
        renderWorkloadPods
          ? {
              openRowKey: openWorkloadKey,
              render: renderWorkloadPods,
              getLabel: (row) => `Pods for ${row.ref.name}`,
            }
          : undefined,
      [openWorkloadKey, renderWorkloadPods]
    );

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
    });

    // The base query payload carries the poller freshness block for the usage
    // joined onto the rows at serve.
    useEffect(() => {
      setTableMetricsInfo(queryPayload?.metrics ?? null);
    }, [queryPayload?.metrics]);

    useClearHiddenRowSelection({
      selectedKey: selectedWorkloadKey,
      source,
      keyExtractor,
      onClear: onWorkloadSelectionClear,
    });
    useClearHiddenRowSelection({
      selectedKey: openWorkloadKey,
      source,
      keyExtractor,
      onClear: onWorkloadPodsClose,
    });

    const getContextMenuItems = useCallback(
      (row: WorkloadData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildWorkloadActionReference(row, queryClusterId, selectedClusterName)
        );
      },
      [objectActions, queryClusterId, selectedClusterName]
    );

    const getRowClassName = useCallback((row: WorkloadData) => {
      const classes: string[] = [];
      if (row.ref.kind === 'Pod') {
        classes.push('gridtable-row--pod');
      }
      return classes.join(' ');
    }, []);

    const isRowSelected = useCallback(
      (row: WorkloadData) =>
        Boolean(selectedWorkloadKey && keyExtractor(row) === selectedWorkloadKey),
      [keyExtractor, selectedWorkloadKey]
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
          onRowPointerClick={onWorkloadSelect}
          onRowSelectionToggle={onWorkloadPodsToggle}
          onRowSelectionClear={selectedWorkloadKey ? onWorkloadSelectionClear : undefined}
          getRowClassName={getRowClassName}
          isRowSelected={isRowSelected}
          rowDetail={rowDetail}
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

WorkloadsTable.displayName = 'WorkloadsTable';

interface ScopedWorkloadsViewProps extends WorkloadsViewProps {
  selectedClusterId?: string | null;
}

// Highlight and open pods live only in this mounted view and only for the
// current cluster and namespace scope.
const refInScope = (
  ref: ClusterObjectReference | null,
  clusterId: string | null | undefined,
  namespace: string
) =>
  ref === null ||
  (ref.clusterId === clusterId &&
    (namespace === ALL_NAMESPACES_SCOPE || ref.namespace === namespace));

const ScopedWorkloadsView: React.FC<ScopedWorkloadsViewProps> = ({
  namespace,
  showNamespaceColumn = false,
  metrics = null,
  selectedClusterId,
}) => {
  const { selectedClusterName } = useKubeconfig();
  const [selectedWorkload, setSelectedWorkload] = useState<ClusterObjectReference | null>(null);
  const [openWorkload, setOpenWorkload] = useState<ClusterObjectReference | null>(null);
  const selectionInScope = refInScope(selectedWorkload, selectedClusterId, namespace);
  const openInScope = refInScope(openWorkload, selectedClusterId, namespace);
  const scopedSelectedWorkload = selectionInScope ? selectedWorkload : null;
  const scopedOpenWorkload = openInScope ? openWorkload : null;

  useEffect(() => {
    if (!selectionInScope) {
      setSelectedWorkload(null);
    }
    if (!openInScope) {
      setOpenWorkload(null);
    }
  }, [openInScope, selectionInScope]);

  const toReference = useCallback(
    (workload: WorkloadData) =>
      buildRequiredObjectReference(
        { ...workload.ref, clusterName: selectedClusterName },
        { fallbackClusterId: selectedClusterId }
      ),
    [selectedClusterId, selectedClusterName]
  );
  const keyOf = useCallback(
    (ref: ClusterObjectReference | null) =>
      ref
        ? buildRequiredCanonicalObjectRowKey(ref, { fallbackClusterId: selectedClusterId })
        : null,
    [selectedClusterId]
  );

  const handleWorkloadSelect = useCallback(
    (workload: WorkloadData) => setSelectedWorkload(toReference(workload)),
    [toReference]
  );
  const handleWorkloadSelectionClear = useCallback(() => setSelectedWorkload(null), []);
  // The Pods count and Space open or close a workload's pods and highlight it.
  const handleWorkloadPodsToggle = useCallback(
    (workload: WorkloadData) => {
      const ref = toReference(workload);
      setSelectedWorkload(ref);
      setOpenWorkload((current) => (keyOf(current) === keyOf(ref) ? null : ref));
    },
    [keyOf, toReference]
  );
  const handleWorkloadPodsClose = useCallback(() => setOpenWorkload(null), []);
  // The attached table follows the open reference, not the row object, so a
  // workload refresh never rebuilds its query.
  const renderWorkloadPods = useCallback(
    () =>
      scopedOpenWorkload ? (
        <PodsTable
          namespace={namespace}
          clusterId={selectedClusterId}
          viewId="namespace-workload-pods"
          namespaceLinkView="workloads"
          showNamespaceColumn={showNamespaceColumn}
          metrics={metrics}
          attachedTo={scopedOpenWorkload}
        />
      ) : null,
    [metrics, namespace, scopedOpenWorkload, selectedClusterId, showNamespaceColumn]
  );

  return (
    <WorkloadsTable
      namespace={namespace}
      clusterId={selectedClusterId}
      showNamespaceColumn={showNamespaceColumn}
      metrics={metrics}
      selectedWorkloadKey={keyOf(scopedSelectedWorkload)}
      openWorkloadKey={keyOf(scopedOpenWorkload)}
      onWorkloadSelect={handleWorkloadSelect}
      onWorkloadSelectionClear={handleWorkloadSelectionClear}
      onWorkloadPodsToggle={handleWorkloadPodsToggle}
      onWorkloadPodsClose={handleWorkloadPodsClose}
      renderWorkloadPods={renderWorkloadPods}
    />
  );
};

const NsViewWorkloads: React.FC<WorkloadsViewProps> = (props) => {
  const { selectedClusterId } = useKubeconfig();
  const { selectedNamespaceClusterId } = useNamespace();
  const queryClusterId = selectedNamespaceClusterId ?? selectedClusterId;
  return <ScopedWorkloadsView {...props} selectedClusterId={queryClusterId} />;
};

NsViewWorkloads.displayName = 'NsViewWorkloads';

export default NsViewWorkloads;
