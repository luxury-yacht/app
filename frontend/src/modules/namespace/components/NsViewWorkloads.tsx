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
import { useOpenRowDetails } from '@modules/resource-grid/useOpenRowDetails';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type {
  GridColumnDefinition,
  GridTableRowDetail,
} from '@shared/components/tables/GridTable.types';
import type { RowDetailToggleOptions } from '@shared/components/tables/rowDetailToggle';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NamespaceWorkloadSnapshotPayload, PodMetricsInfo } from '@/core/refresh/types';
import { usePreference } from '@/core/settings/usePreference';
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
  /** The rows whose pods are open under them. */
  openWorkloadKeys?: readonly string[];
  onWorkloadSelect?: (workload: WorkloadData) => void;
  onWorkloadSelectionClear?: () => void;
  onWorkloadPodsToggle?: (workload: WorkloadData) => void;
  /** Closes these rows' pods. */
  onWorkloadPodsClose?: (rowKeys: readonly string[]) => void;
  renderWorkloadPods?: (workload: WorkloadData) => React.ReactNode;
}

const NO_ROW_KEYS: readonly string[] = [];
const WORKLOADS_VIEW_ID = 'namespace-workloads';

/**
 * GridTable of namespace workloads; a workload's pods open under its row.
 */
const WorkloadsTable: React.FC<WorkloadsTableProps> = React.memo(
  ({
    namespace,
    clusterId,
    showNamespaceColumn = false,
    metrics = null,
    selectedWorkloadKey = null,
    openWorkloadKeys = NO_ROW_KEYS,
    onWorkloadSelect,
    onWorkloadSelectionClear,
    onWorkloadPodsToggle,
    onWorkloadPodsClose,
    renderWorkloadPods,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = usePreference('useShortResourceNames');
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
              isOpen: (row) => openWorkloadKeys.includes(keyExtractor(row)),
              onToggle: onWorkloadPodsToggle,
              getLabel: (row, open) =>
                `${open ? 'Hide' : 'Show'} pods for ${row.ref.name} (${row.ready ?? 'no'} ready)`,
              getText: (row) => row.ready ?? '—',
            }
          : undefined,
      [keyExtractor, onWorkloadPodsToggle, openWorkloadKeys]
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
              openRowKeys: openWorkloadKeys,
              render: renderWorkloadPods,
              getLabel: (row) => `Pods for ${row.ref.name}`,
              getGroupClassName: (row) => getKindColorClass(row.ref.kind),
            }
          : undefined,
      [openWorkloadKeys, renderWorkloadPods]
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
      viewId: WORKLOADS_VIEW_ID,
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

    const selectedWorkloadKeys = useMemo(
      () => (selectedWorkloadKey ? [selectedWorkloadKey] : NO_ROW_KEYS),
      [selectedWorkloadKey]
    );
    useClearHiddenRowSelection({
      selectedKeys: selectedWorkloadKeys,
      source,
      keyExtractor,
      onClear: onWorkloadSelectionClear,
    });
    useClearHiddenRowSelection({
      selectedKeys: openWorkloadKeys,
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
          onRowExpandToggle={onWorkloadPodsToggle}
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

// The highlight lives only in this mounted view and only for the current
// cluster and namespace scope.
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
  const selectionInScope = refInScope(selectedWorkload, selectedClusterId, namespace);
  const scopedSelectedWorkload = selectionInScope ? selectedWorkload : null;

  useEffect(() => {
    if (!selectionInScope) {
      setSelectedWorkload(null);
    }
  }, [selectionInScope]);

  const toReference = useCallback(
    (workload: WorkloadData) =>
      buildRequiredObjectReference(
        { ...workload.ref, clusterName: selectedClusterName },
        { fallbackClusterId: selectedClusterId }
      ),
    [selectedClusterId, selectedClusterName]
  );
  const rowKeyOf = useCallback(
    (ref: ClusterObjectReference) =>
      buildRequiredCanonicalObjectRowKey(ref, { fallbackClusterId: selectedClusterId }),
    [selectedClusterId]
  );
  const {
    openRefs: openWorkloads,
    openKeys: openWorkloadKeys,
    toggle: toggleWorkloadPods,
    close: closeWorkloadPods,
    closeKeys: closeWorkloadPodsByKey,
  } = useOpenRowDetails({
    clusterId: selectedClusterId ?? '',
    viewId: WORKLOADS_VIEW_ID,
    namespace,
    keyOf: rowKeyOf,
  });

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
      toggleWorkloadPods(ref);
    },
    [toReference, toggleWorkloadPods]
  );
  // Each attached table follows its open reference, not the row object, so a
  // workload refresh never rebuilds its query.
  const renderWorkloadPods = useCallback(
    (workload: WorkloadData) => {
      const attachedTo = openWorkloads.get(rowKeyOf(toReference(workload)));
      return attachedTo ? (
        <PodsTable
          namespace={namespace}
          clusterId={selectedClusterId}
          viewId="namespace-workload-pods"
          namespaceLinkView="workloads"
          showNamespaceColumn={showNamespaceColumn}
          metrics={metrics}
          attachedTo={attachedTo}
          onClose={closeWorkloadPods}
        />
      ) : null;
    },
    [
      closeWorkloadPods,
      metrics,
      namespace,
      openWorkloads,
      rowKeyOf,
      selectedClusterId,
      showNamespaceColumn,
      toReference,
    ]
  );

  return (
    <WorkloadsTable
      namespace={namespace}
      clusterId={selectedClusterId}
      showNamespaceColumn={showNamespaceColumn}
      metrics={metrics}
      selectedWorkloadKey={scopedSelectedWorkload ? rowKeyOf(scopedSelectedWorkload) : null}
      openWorkloadKeys={openWorkloadKeys}
      onWorkloadSelect={handleWorkloadSelect}
      onWorkloadSelectionClear={handleWorkloadSelectionClear}
      onWorkloadPodsToggle={handleWorkloadPodsToggle}
      onWorkloadPodsClose={closeWorkloadPodsByKey}
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
