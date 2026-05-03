/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx
 */

import React, { useCallback, useMemo } from 'react';
import GridTable, { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  applyColumnSizing,
  createAgeColumn,
  createKindColumn,
  createResourceBarColumn,
  createTextColumn,
  upsertNamespaceColumn,
  type ColumnSizingMap,
} from '@shared/components/tables/columnFactories';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectLink } from '@shared/hooks/useObjectLink';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { getPodStatusSeverity } from '@utils/podStatusSeverity';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import '../shared.css';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useObjectPanelResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';

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
      buildRequiredCanonicalObjectRowKey(
        {
          kind: 'Pod',
          name: pod.name,
          namespace: pod.namespace,
          clusterId: pod.clusterId,
        },
        { fallbackClusterId: objectData?.clusterId }
      ),
    [objectData?.clusterId]
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
        buildRequiredObjectReference(
          {
            kind: 'Pod',
            name: pod.name,
            namespace: pod.namespace,
            clusterId: pod.clusterId,
            clusterName: pod.clusterName ?? undefined,
          },
          { fallbackClusterId: objectData?.clusterId }
        )
      );
    },
    [objectData?.clusterId, openWithObject]
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
            buildRequiredObjectReference(
              {
                kind: 'Pod',
                name: pod.name,
                namespace: pod.namespace,
                clusterId: pod.clusterId,
                clusterName: pod.clusterName,
              },
              { fallbackClusterId: objectData?.clusterId }
            )
          ),
        sortable: false,
      }),
      createTextColumn<PodSnapshotEntry>('name', 'Name', {
        onClick: handlePodOpen,
        onAltClick: (pod) =>
          navigateToView(
            buildRequiredObjectReference(
              {
                kind: 'Pod',
                name: pod.name,
                namespace: pod.namespace,
                clusterId: pod.clusterId,
                clusterName: pod.clusterName,
              },
              { fallbackClusterId: objectData?.clusterId }
            )
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
            ? buildRequiredRelatedObjectReference(
                {
                  kind: pod.ownerKind,
                  name: pod.ownerName,
                  namespace: pod.namespace,
                  ...getPodClusterMeta(pod),
                },
                { fallbackClusterId: objectData?.clusterId }
              )
            : undefined
        ),
        isInteractive: (pod) => Boolean(pod.ownerKind && pod.ownerName),
        getClassName: (pod) => (pod.ownerKind && pod.ownerName ? 'object-panel-link' : undefined),
      }),
      createTextColumn<PodSnapshotEntry>('node', 'Node', (pod) => pod.node || '—', {
        ...objectLink((pod) =>
          pod.node
            ? buildRequiredObjectReference(
                {
                  kind: 'Node',
                  name: pod.node,
                  clusterId: pod.clusterId,
                  clusterName: pod.clusterName ?? undefined,
                },
                { fallbackClusterId: objectData?.clusterId }
              )
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
    objectData?.clusterId,
    objectLink,
    getPodClusterMeta,
  ]);

  const getSearchTokens = useCallback((pod: PodSnapshotEntry) => {
    const tokens = [pod.name, pod.namespace, pod.node, pod.ownerName, pod.ownerKind];
    return tokens.filter((token): token is string => Boolean(token));
  }, []);

  const { gridTableProps } = useObjectPanelResourceGridTable<PodSnapshotEntry>({
    viewId: 'object-panel-pods',
    clusterIdentity: objectData?.clusterId ?? '',
    enabled: Boolean(objectData?.clusterId),
    data: pods,
    columns,
    keyExtractor,
    defaultSort: { key: 'name', direction: 'asc' },
    rowIdentity: keyExtractor,
    diagnosticsLabel: 'Object Panel Pods',
    filterAccessors: {
      getKind: () => 'Pod',
      getNamespace: (pod) => pod.namespace,
      getSearchText: getSearchTokens,
    },
  });

  const objectActions = useObjectActionController({
    context: 'gridtable',
    useDefaultHandlers: false,
    onOpen: (object) => openWithObject(object),
  });

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
          dataLength={gridTableProps.data.length}
          hasLoaded={!loading || gridTableProps.data.length > 0}
          spinnerMessage="Loading pods..."
        >
          <GridTable<PodSnapshotEntry>
            {...gridTableProps}
            columns={columns}
            diagnosticsLabel="Object Panel Pods"
            diagnosticsMode="live"
            keyExtractor={keyExtractor}
            onRowClick={handlePodOpen}
            enableContextMenu
            getCustomContextMenuItems={(pod) =>
              objectActions.getMenuItems(
                buildRequiredObjectReference(
                  {
                    kind: 'Pod',
                    name: pod.name,
                    namespace: pod.namespace,
                    clusterId: pod.clusterId,
                    clusterName: pod.clusterName ?? undefined,
                  },
                  { fallbackClusterId: objectData?.clusterId }
                )
              )
            }
            tableClassName="gridtable-pods gridtable-pods--namespaced"
            loading={loading && gridTableProps.data.length === 0}
            loadingOverlay={{
              show: loading && gridTableProps.data.length > 0,
              message: 'Updating pods…',
            }}
            hideHeader={!isActive}
          />
        </ResourceLoadingBoundary>
      </div>
      {objectActions.modals}
    </div>
  );
};
