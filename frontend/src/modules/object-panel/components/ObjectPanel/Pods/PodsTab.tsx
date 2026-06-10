/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx
 *
 * Query-backed Pods tab for the object panel. It scopes a typed `pods` query to
 * the panel's workload (`workload:…`) or node (`node:…`) and renders the
 * server-paginated, server-filtered page through the shared resource-inventory
 * table. The query is gated to the active pods tab.
 */

import React, { useCallback, useMemo } from 'react';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
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
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import '../shared.css';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import {
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { useResourceGridObjectIdentity } from '@modules/resource-grid/useResourceGridObjectIdentity';
import { buildObjectPanelPodsScope } from './objectPanelPodsScope';

interface PodsTabProps {
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

// The pods query returns its page as `rows`; everything else (totals, facets)
// rides on the payload for the pagination footer.
const selectPodRows = (payload: PodSnapshotPayload): PodSnapshotEntry[] => payload.rows ?? [];

export const PodsTab: React.FC<PodsTabProps> = ({ isActive }) => {
  const { openWithObject, objectData } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const objectLink = useObjectLink();
  const viewState = useViewState();
  const namespaceContext = useNamespace();
  // Pod CPU/memory ride in the query rows; the banner + per-pod staleness come
  // from the active cluster's metrics availability (mirrors NsViewPods).
  const clusterMetrics = useClusterMetricsAvailability();
  const effectiveMetrics = clusterMetrics ?? null;

  const metricsBanner = useMemo(() => getMetricsBannerInfo(effectiveMetrics), [effectiveMetrics]);
  const metricsLastUpdated = useMemo(
    () =>
      effectiveMetrics?.collectedAt ? new Date(effectiveMetrics.collectedAt * 1000) : undefined,
    [effectiveMetrics?.collectedAt]
  );

  const getPodIdentity = useCallback(
    (pod: PodSnapshotEntry) => ({
      kind: 'Pod',
      name: pod.name,
      namespace: pod.namespace,
      clusterId: pod.clusterId,
      clusterName: pod.clusterName ?? undefined,
    }),
    []
  );
  const podIdentity = useResourceGridObjectIdentity({
    fallbackClusterId: objectData?.clusterId,
    getObject: getPodIdentity,
    openWithObject,
    navigateToView,
  });
  const { ref: podRef, open: openPod, navigate: navigatePod } = podIdentity;
  // Ensure pod navigation keeps the active cluster context for object detail scopes.
  const getPodClusterMeta = useCallback(
    (pod: PodSnapshotEntry) => ({
      clusterId: pod.clusterId ?? undefined,
      clusterName: pod.clusterName ?? undefined,
    }),
    []
  );
  const handlePodOpen = openPod;
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

  // Scope the pods query to the panel's workload/node. Null for objects we
  // cannot scope, which keeps the query gated off (see queryClusterId).
  const podsScope = useMemo(
    () => buildObjectPanelPodsScope(objectData ?? null, objectData?.kind ?? null),
    [objectData]
  );

  // Gate the fetch to when the pods tab is the active panel tab AND a valid pod
  // scope exists. The query-backed wrapper treats a null clusterId as
  // "no fetch + no subscription", so this preserves the previous "only fetch
  // while the pods tab is open" behavior and avoids fanning out to a
  // cluster-wide pods fetch when the object has no resolvable pod scope.
  const queryClusterId = isActive && podsScope ? (objectData?.clusterId ?? null) : null;

  const columns = useMemo<GridColumnDefinition<PodSnapshotEntry>[]>(() => {
    // Match workloads warning styling when restarts are non-zero.
    const getRestartsClassName = (pod: PodSnapshotEntry) =>
      (pod.restarts ?? 0) > 0 ? 'status-text warning' : undefined;

    const base: GridColumnDefinition<PodSnapshotEntry>[] = [
      createKindColumn<PodSnapshotEntry>({
        getKind: () => 'Pod',
        onClick: handlePodOpen,
        onAltClick: navigatePod,
        sortable: false,
      }),
      createTextColumn<PodSnapshotEntry>('name', 'Name', {
        onClick: handlePodOpen,
        onAltClick: navigatePod,
        getClassName: () => 'object-panel-link',
        getTitle: (pod) => pod.name,
      }),
      createTextColumn<PodSnapshotEntry>('status', 'Status', (pod) => pod.status || '—', {
        getClassName: (pod) => backendStatusTextClass(pod.statusPresentation),
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
        getMetricsStale: () => Boolean(effectiveMetrics?.stale),
        getMetricsError: () => effectiveMetrics?.lastError ?? undefined,
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
        getMetricsStale: () => Boolean(effectiveMetrics?.stale),
        getMetricsError: () => effectiveMetrics?.lastError ?? undefined,
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
    effectiveMetrics?.lastError,
    effectiveMetrics?.stale,
    metricsLastUpdated,
    objectData?.clusterId,
    objectLink,
    getPodClusterMeta,
    navigatePod,
  ]);

  const { gridTableProps, favModal, source } = useQueryBackedClusterResourceGridTable<
    PodSnapshotPayload,
    PodSnapshotEntry
  >({
    queryTableMode: 'Query Backed Dynamic',
    clusterId: queryClusterId,
    domain: 'pods',
    label: 'Object Panel Pods',
    baseScope: podsScope ?? undefined,
    selectRows: selectPodRows,
    viewId: 'object-panel-pods',
    columns,
    objectIdentity: podIdentity,
    diagnosticsLabel: 'Object Panel Pods',
    showKindDropdown: false,
    // Object-panel pods are already scoped to one workload/node; the namespace
    // filter UI is not applicable here.
    filterOptions: { isNamespaceScoped: false },
  });

  const objectActions = useObjectActionController({
    context: 'gridtable',
    useDefaultHandlers: false,
    onOpen: (object) => openWithObject(object),
    onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
  });

  return (
    <div className="object-panel-pods">
      {metricsBanner && (
        <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
          <span className="metrics-warning-banner__dot" />
          {metricsBanner.message}
        </div>
      )}
      <div className="object-panel-pods__table">
        <ResourceInventoryTable<PodSnapshotEntry>
          source={source}
          gridTableProps={gridTableProps}
          columns={columns}
          diagnosticsLabel="Object Panel Pods"
          diagnosticsMode="live"
          onRowClick={handlePodOpen}
          enableContextMenu
          getCustomContextMenuItems={(pod) => objectActions.getMenuItems(podRef(pod))}
          tableClassName="gridtable-pods gridtable-pods--namespaced"
          spinnerMessage="Loading pods..."
          updatingMessage="Updating pods..."
          favModal={favModal}
          hideHeader={!isActive}
          emptyMessage="No pods found"
        />
      </div>
      {objectActions.modals}
    </div>
  );
};
