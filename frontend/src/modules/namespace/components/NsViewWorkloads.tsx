/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.tsx
 *
 * UI component for NsViewWorkloads.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewWorkloads.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import NsViewPods from '@modules/namespace/components/NsViewPods';
import {
  appendWorkloadTokens,
  type WorkloadData,
} from '@modules/namespace/components/NsViewWorkloads.helpers';
import type { PodWorkloadFilterRequest } from '@modules/namespace/components/podOwnerFilter';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import WorkloadsPodsSplit from '@modules/namespace/components/WorkloadsPodsSplit';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CloseIcon } from '@shared/components/icons/SharedIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import { FavoritePaneGroup } from '@ui/favorites/FavToggle';
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

const WORKLOAD_FAVORITE_PANES = ['workloads', 'pods'] as const;
const CLEAR_POD_WORKLOAD_FILTER_REQUEST: PodWorkloadFilterRequest = { type: 'clear' };

interface WorkloadsTableProps extends WorkloadsViewProps {
  clusterId?: string | null;
  selectedWorkloadKey?: string | null;
  onWorkloadSelect?: (workload: WorkloadData) => void;
  onWorkloadSelectionClear?: () => void;
}

/**
 * GridTable component for namespace workloads without nested pod expansion
 */
export const WorkloadsTable: React.FC<WorkloadsTableProps> = React.memo(
  ({
    namespace,
    clusterId,
    showNamespaceColumn = false,
    metrics = null,
    selectedWorkloadKey = null,
    onWorkloadSelect,
    onWorkloadSelectionClear,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const { selectedClusterId } = useKubeconfig();
    const queryClusterId = clusterId ?? selectedClusterId;
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
            { fallbackClusterId: queryClusterId }
          )
        );
      },
      [openWithObject, queryClusterId]
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
            { fallbackClusterId: queryClusterId }
          )
        );
      },
      [navigateToView, queryClusterId]
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
            { fallbackClusterId: queryClusterId }
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
            { fallbackClusterId: queryClusterId }
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
          { fallbackClusterId: queryClusterId }
        ),
      [queryClusterId]
    );

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
    const beforeNamespaceActions = useMemo<IconBarItem[]>(
      () => [
        ...(selectedWorkloadKey && onWorkloadSelectionClear
          ? [
              {
                type: 'action' as const,
                id: 'clear-workload-selection',
                icon: <CloseIcon width={18} height={18} />,
                onClick: onWorkloadSelectionClear,
                title: 'Clear selected workload',
              },
            ]
          : []),
      ],
      [onWorkloadSelectionClear, selectedWorkloadKey]
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
      queryPayload,
    } = useQueryBackedNamespaceResourceGridTable<NamespaceWorkloadSnapshotPayload, WorkloadData>({
      queryTableMode: 'Query Backed Dynamic',
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
        getKind: (row) => row.kind,
        getNamespace: (row) => row.namespace ?? '',
        getSearchText: (row) => getRowSearchValues(row),
      },
      showNamespaceFilters: showNamespaceFilter,
      diagnosticsLabel,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
      filterOptionOverrides:
        beforeNamespaceActions.length > 0 ? { beforeNamespaceActions } : undefined,
      favoritePane: { id: 'workloads', label: 'Workloads' },
    });

    // The base query payload carries the poller freshness block for the usage
    // joined onto the rows at serve.
    useEffect(() => {
      setTableMetricsInfo(queryPayload?.metrics ?? null);
    }, [queryPayload?.metrics]);

    const getContextMenuItems = useCallback(
      (row: WorkloadData): ContextMenuItem[] => {
        return objectActions.getMenuItems(buildWorkloadActionReference(row, queryClusterId));
      },
      [objectActions, queryClusterId]
    );

    const getRowClassName = useCallback(
      (row: WorkloadData) => {
        const classes: string[] = [];
        if (row.kind === 'Pod') {
          classes.push('gridtable-row--pod');
        }
        if (selectedWorkloadKey && keyExtractor(row) === selectedWorkloadKey) {
          classes.push('gridtable-row--selected');
        }
        return classes.join(' ');
      },
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
      <div className="workloads-pods-table-surface">
        <div className="workloads-pods-table-surface__table">
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
            onRowSelectionToggle={onWorkloadSelect}
            getRowClassName={getRowClassName}
            tableClassName="gridtable-workloads"
            enableContextMenu={true}
            getCustomContextMenuItems={getContextMenuItems}
            emptyMessage={emptyMessage}
            enableColumnVisibilityMenu
            allowHorizontalOverflow={true}
          />
        </div>

        {objectActions.modals}
      </div>
    );
  }
);

WorkloadsTable.displayName = 'WorkloadsTable';

interface ScopedWorkloadsViewProps extends WorkloadsViewProps {
  selectedClusterId?: string | null;
}

const ScopedWorkloadsView: React.FC<ScopedWorkloadsViewProps> = ({
  namespace,
  showNamespaceColumn = false,
  metrics = null,
  selectedClusterId,
}) => {
  const [selectedWorkload, setSelectedWorkload] = useState<ClusterObjectReference | null>(null);
  const [podFilterRequest, setPodFilterRequest] = useState<PodWorkloadFilterRequest>();
  const [podsCollapsed, setPodsCollapsed] = useState(false);

  // Keep selection provenance across a scope change long enough to remove only
  // its Owner facet from shared persistence. Manual and favorite Owner filters
  // have no selected workload and remain ordinary persisted table state.
  const selectedWorkloadMatchesScope =
    selectedWorkload === null ||
    (selectedWorkload.clusterId === selectedClusterId &&
      (namespace === ALL_NAMESPACES_SCOPE || selectedWorkload.namespace === namespace));
  const scopedSelectedWorkload = selectedWorkloadMatchesScope ? selectedWorkload : null;
  const scopedPodFilterRequest = selectedWorkloadMatchesScope
    ? podFilterRequest
    : CLEAR_POD_WORKLOAD_FILTER_REQUEST;

  useEffect(() => {
    if (selectedWorkloadMatchesScope) {
      return;
    }
    setSelectedWorkload(null);
    setPodFilterRequest(CLEAR_POD_WORKLOAD_FILTER_REQUEST);
    setPodsCollapsed(false);
  }, [selectedWorkloadMatchesScope]);

  const handleWorkloadSelect = useCallback(
    (workload: WorkloadData) => {
      const ref = buildRequiredObjectReference(
        {
          clusterId: workload.clusterId,
          clusterName: workload.clusterName,
          kind: workload.kind,
          namespace: workload.namespace,
          name: workload.name,
        },
        { fallbackClusterId: selectedClusterId }
      );
      setSelectedWorkload(ref);
      setPodFilterRequest({ type: 'set', workload: ref });
      setPodsCollapsed(false);
    },
    [selectedClusterId]
  );

  const selectedWorkloadKey = useMemo(
    () =>
      scopedSelectedWorkload
        ? buildRequiredCanonicalObjectRowKey(scopedSelectedWorkload, {
            fallbackClusterId: selectedClusterId,
          })
        : null,
    [scopedSelectedWorkload, selectedClusterId]
  );
  const handleWorkloadSelectionClear = useCallback(() => {
    setSelectedWorkload(null);
    setPodFilterRequest(CLEAR_POD_WORKLOAD_FILTER_REQUEST);
  }, []);
  return (
    <FavoritePaneGroup primaryPaneId="workloads" expectedPaneIds={WORKLOAD_FAVORITE_PANES}>
      <WorkloadsPodsSplit
        collapsed={podsCollapsed}
        upper={
          <WorkloadsTable
            namespace={namespace}
            clusterId={selectedClusterId}
            showNamespaceColumn={showNamespaceColumn}
            metrics={metrics}
            selectedWorkloadKey={selectedWorkloadKey}
            onWorkloadSelect={handleWorkloadSelect}
            onWorkloadSelectionClear={handleWorkloadSelectionClear}
          />
        }
        lower={
          <NsViewPods
            namespace={namespace}
            showNamespaceColumn={showNamespaceColumn}
            metrics={metrics}
            workloadFilterRequest={scopedPodFilterRequest}
            onWorkloadFilterMismatch={() => {
              setSelectedWorkload(null);
              setPodFilterRequest(undefined);
            }}
            collapsed={podsCollapsed}
            onPodsCollapsedChange={setPodsCollapsed}
          />
        }
      />
    </FavoritePaneGroup>
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
