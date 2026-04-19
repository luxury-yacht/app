/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx
 */

import React, { useCallback, useMemo } from 'react';
import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import {
  applyColumnSizing,
  createAgeColumn,
  createKindColumn,
  createResourceBarColumn,
  createTextColumn,
  upsertNamespaceColumn,
  type ColumnSizingMap,
} from '@shared/components/tables/columnFactories';
import { useTableSort } from '@hooks/useTableSort';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectLink } from '@shared/hooks/useObjectLink';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { getPodStatusSeverity } from '@utils/podStatusSeverity';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import '../shared.css';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { buildCanonicalObjectRowKey, buildObjectReference } from '@shared/utils/objectIdentity';

interface PodsTabProps {
  pods: PodSnapshotEntry[];
  metrics: PodMetricsInfo | null;
  loading: boolean;
  error: string | null;
  isActive: boolean;
}

const COLUMN_SIZING: ColumnSizingMap = {
  kind: { autoWidth: true },
  name: { autoWidth: true },
  status: { autoWidth: true },
  ready: { autoWidth: true },
  restarts: { autoWidth: true },
  owner: { autoWidth: true },
  node: { autoWidth: true },
  namespace: { autoWidth: true },
  cpu: { width: 200, minWidth: 200 },
  memory: { width: 200, minWidth: 200 },
  age: { autoWidth: true },
};

const workloadNameFromOwner = (pod: PodSnapshotEntry) =>
  pod.ownerName ? `${pod.ownerName}${pod.ownerKind ? ` (${pod.ownerKind})` : ''}` : '—';

export const PodsTab: React.FC<PodsTabProps> = ({ pods, metrics, loading, error, isActive }) => {
  const { openWithObject, objectData } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const objectLink = useObjectLink();
  const viewState = useViewState();
  const namespaceContext = useNamespace();

  const metricsBanner = useMemo(() => getMetricsBannerInfo(metrics ?? null), [metrics]);
  const metricsLastUpdated = useMemo(
    () => (metrics?.collectedAt ? new Date(metrics.collectedAt * 1000) : undefined),
    [metrics?.collectedAt]
  );

  const keyExtractor = useCallback(
    (pod: PodSnapshotEntry) =>
      buildCanonicalObjectRowKey({
        kind: 'Pod',
        name: pod.name,
        namespace: pod.namespace,
        clusterId: pod.clusterId,
      }),
    []
  );
  // Ensure pod navigation keeps the active cluster context for object detail scopes.
  const getPodClusterMeta = useCallback(
    (pod: PodSnapshotEntry) => ({
      clusterId: pod.clusterId ?? undefined,
      clusterName: pod.clusterName ?? undefined,
    }),
    []
  );
  const handlePodOpen = useCallback(
    (pod: PodSnapshotEntry) => {
      openWithObject(
        buildObjectReference({
          kind: 'Pod',
          name: pod.name,
          namespace: pod.namespace,
          ...getPodClusterMeta(pod),
        })
      );
    },
    [getPodClusterMeta, openWithObject]
  );
  const handleNamespaceSelect = useCallback(
    (pod: PodSnapshotEntry) => {
      if (!pod.namespace) {
        return;
      }
      // Route namespace clicks to the sidebar selection instead of the object panel.
      namespaceContext.setSelectedNamespace(pod.namespace, pod.clusterId);
      viewState.onNamespaceSelect(pod.namespace);
      viewState.setActiveNamespaceTab('workloads');
    },
    [namespaceContext, viewState]
  );

  const columns = useMemo<GridColumnDefinition<PodSnapshotEntry>[]>(() => {
    // Match workloads warning styling when restarts are non-zero.
    const getRestartsClassName = (pod: PodSnapshotEntry) =>
      (pod.restarts ?? 0) > 0 ? 'status-badge warning' : undefined;

    const base: GridColumnDefinition<PodSnapshotEntry>[] = [
      createKindColumn<PodSnapshotEntry>({
        getKind: () => 'Pod',
        onClick: handlePodOpen,
        onAltClick: (pod) =>
          navigateToView(
            buildObjectReference({
              kind: 'Pod',
              name: pod.name,
              namespace: pod.namespace,
              clusterId: pod.clusterId,
              clusterName: pod.clusterName,
            })
          ),
        sortable: false,
      }),
      createTextColumn<PodSnapshotEntry>('name', 'Name', {
        onClick: handlePodOpen,
        onAltClick: (pod) =>
          navigateToView(
            buildObjectReference({
              kind: 'Pod',
              name: pod.name,
              namespace: pod.namespace,
              clusterId: pod.clusterId,
              clusterName: pod.clusterName,
            })
          ),
        getClassName: () => 'object-panel-link',
        getTitle: (pod) => pod.name,
      }),
      createTextColumn<PodSnapshotEntry>('status', 'Status', (pod) => pod.status || '—', {
        getClassName: (pod) => {
          const severity = getPodStatusSeverity(pod.status);
          return ['status-badge', severity].join(' ').trim();
        },
      }),
      createTextColumn<PodSnapshotEntry>('ready', 'Ready', (pod) => pod.ready || '—', {
        className: 'text-right',
      }),
      createTextColumn<PodSnapshotEntry>('restarts', 'Restarts', (pod) => pod.restarts ?? 0, {
        className: 'text-right',
        getTitle: (pod) => `${pod.restarts ?? 0} restarts`,
        getClassName: (pod) => getRestartsClassName(pod),
      }),
      createTextColumn<PodSnapshotEntry>('owner', 'Owner', (pod) => workloadNameFromOwner(pod), {
        ...objectLink((pod) =>
          pod.ownerKind && pod.ownerName
            ? buildObjectReference({
                kind: pod.ownerKind,
                name: pod.ownerName,
                namespace: pod.namespace,
                group: resolveBuiltinGroupVersion(pod.ownerKind).group,
                version: resolveBuiltinGroupVersion(pod.ownerKind).version,
                ...getPodClusterMeta(pod),
              })
            : undefined
        ),
        isInteractive: (pod) => Boolean(pod.ownerKind && pod.ownerName),
        getClassName: (pod) => (pod.ownerKind && pod.ownerName ? 'object-panel-link' : undefined),
      }),
      createTextColumn<PodSnapshotEntry>('node', 'Node', (pod) => pod.node || '—', {
        ...objectLink((pod) =>
          pod.node
            ? buildObjectReference({
                kind: 'Node',
                name: pod.node,
                ...getPodClusterMeta(pod),
              })
            : undefined
        ),
        isInteractive: (pod) => Boolean(pod.node),
        getClassName: (pod) => (pod.node ? 'object-panel-link' : undefined),
      }),
    ];

    upsertNamespaceColumn(base, {
      accessor: (pod) => pod.namespace,
      onClick: handleNamespaceSelect,
      isInteractive: (pod) => Boolean(pod.namespace),
      getClassName: () => 'object-panel-link',
    });

    base.push(
      createResourceBarColumn<PodSnapshotEntry>({
        key: 'cpu',
        header: 'CPU',
        type: 'cpu',
        getUsage: (pod) => pod.cpuUsage,
        getRequest: (pod) => pod.cpuRequest,
        getLimit: (pod) => pod.cpuLimit,
        getVariant: () => 'compact',
        getMetricsStale: () => Boolean(metrics?.stale),
        getMetricsError: () => metrics?.lastError ?? undefined,
        getMetricsLastUpdated: () => metricsLastUpdated,
        getAnimationKey: (pod) => `pod:${pod.namespace}/${pod.name}:cpu`,
        getShowEmptyState: () => true,
      }),
      createResourceBarColumn<PodSnapshotEntry>({
        key: 'memory',
        header: 'Memory',
        type: 'memory',
        getUsage: (pod) => pod.memUsage,
        getRequest: (pod) => pod.memRequest,
        getLimit: (pod) => pod.memLimit,
        getVariant: () => 'compact',
        getMetricsStale: () => Boolean(metrics?.stale),
        getMetricsError: () => metrics?.lastError ?? undefined,
        getMetricsLastUpdated: () => metricsLastUpdated,
        getAnimationKey: (pod) => `pod:${pod.namespace}/${pod.name}:memory`,
        getShowEmptyState: () => true,
      }),
      createAgeColumn<PodSnapshotEntry & { age?: string }>(
        'age',
        'Age',
        (pod) => pod.age ?? '—'
      ) as GridColumnDefinition<PodSnapshotEntry>
    );

    applyColumnSizing(base, COLUMN_SIZING);
    return base;
  }, [
    handleNamespaceSelect,
    handlePodOpen,
    metrics?.lastError,
    metrics?.stale,
    metricsLastUpdated,
    navigateToView,
    objectLink,
    getPodClusterMeta,
  ]);

  const {
    sortConfig,
    setSortConfig,
    columnWidths,
    setColumnWidths,
    columnVisibility,
    setColumnVisibility,
    filters,
    setFilters,
    resetState,
  } = useGridTablePersistence<PodSnapshotEntry>({
    viewId: 'object-panel-pods',
    // Use the panel-scoped cluster ID, not the global sidebar selection.
    // Multi-cluster rule (AGENTS.md): persistence is keyed per cluster
    // so column widths/sort don't bleed between clusters. Disable
    // persistence when clusterId is missing rather than falling through
    // to a global storage bucket.
    clusterIdentity: objectData?.clusterId ?? '',
    enabled: Boolean(objectData?.clusterId),
    namespace: null,
    isNamespaceScoped: false,
    columns,
    data: pods,
    keyExtractor,
  });

  const {
    sortedData,
    sortConfig: tableSort,
    handleSort,
  } = useTableSort(pods, undefined, 'asc', {
    columns,
    controlledSort: sortConfig,
    onChange: setSortConfig,
    diagnosticsLabel: 'Object Panel Pods',
  });

  const getSearchTokens = useCallback((pod: PodSnapshotEntry) => {
    const tokens = [pod.name, pod.namespace, pod.node, pod.ownerName, pod.ownerKind];
    return tokens.filter((token): token is string => Boolean(token));
  }, []);

  return (
    <div className="object-panel-pods">
      {error && <div className="namespace-error-message">{error}</div>}
      {metricsBanner && (
        <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
          <span className="metrics-warning-banner__dot" />
          {metricsBanner.message}
        </div>
      )}
      <div className="object-panel-pods__table">
        <ResourceLoadingBoundary
          loading={loading}
          dataLength={sortedData.length}
          hasLoaded={!loading || sortedData.length > 0}
          spinnerMessage="Loading pods..."
        >
          <GridTable<PodSnapshotEntry>
            data={sortedData}
            columns={columns}
            diagnosticsLabel="Object Panel Pods"
            diagnosticsMode="live"
            onSort={handleSort}
            sortConfig={tableSort}
            keyExtractor={keyExtractor}
            onRowClick={handlePodOpen}
            enableContextMenu
            getCustomContextMenuItems={(pod) =>
              buildObjectActionItems({
                object: buildObjectReference({
                  kind: 'Pod',
                  name: pod.name,
                  namespace: pod.namespace,
                  ...getPodClusterMeta(pod),
                }),
                context: 'gridtable',
                handlers: {
                  onOpen: () => handlePodOpen(pod),
                },
                permissions: {},
              })
            }
            tableClassName="gridtable-pods gridtable-pods--namespaced"
            filters={{
              enabled: true,
              value: filters,
              onChange: setFilters,
              onReset: resetState,
              options: {
                searchPlaceholder: 'Search pods',
              },
              accessors: {
                getKind: () => 'Pod',
                getNamespace: (pod) => pod.namespace,
                getSearchText: getSearchTokens,
              },
            }}
            virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            allowHorizontalOverflow={true}
            loading={loading && sortedData.length === 0}
            loadingOverlay={{
              show: loading && sortedData.length > 0,
              message: 'Updating pods…',
            }}
            hideHeader={!isActive}
          />
        </ResourceLoadingBoundary>
      </div>
    </div>
  );
};
