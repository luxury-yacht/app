/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx
 *
 * Query-backed Pods tab for the object panel. It scopes a typed `pods` query to
 * the panel's workload (`workload:…`) or node (`node:…`) and renders the
 * server-paginated, server-filtered page through the shared resource-inventory
 * table. The query is gated to the active pods tab.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
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
import { podRowCpuValue, podRowMemoryValue } from '@/core/resource-metrics';
import type { PodMetricsInfo, PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import {
  POD_PERMISSIONS,
  queryNamespacesPermissions,
  type PermissionSpecList,
} from '@/core/capabilities';
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
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
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

export const PodsTab: React.FC<PodsTabProps> = ({ isActive }) => {
  const { openWithObject, objectData } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const objectLink = useObjectLink();
  const viewState = useViewState();
  const namespaceContext = useNamespace();
  // The banner + per-pod staleness come from the pods query payload's metrics
  // meta, which is scoped to the PANEL OBJECT's cluster (the globally selected
  // cluster can be a different one). The query hook needs `columns`, so the
  // column callbacks read this ref instead of closing over the query result.
  const metricsRef = React.useRef<PodMetricsInfo | null>(null);
  const metricsLastUpdated = useCallback(() => {
    const collectedAt = metricsRef.current?.collectedAt;
    return collectedAt ? new Date(collectedAt * 1000) : undefined;
  }, []);

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
  const { open: openPod, navigate: navigatePod } = podIdentity;
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
        getUsage: (pod) => podRowCpuValue(pod, 'usage'),
        getRequest: (pod) => podRowCpuValue(pod, 'request'),
        getLimit: (pod) => podRowCpuValue(pod, 'limit'),
        getVariant: () => 'compact',
        getMetricsStale: () => Boolean(metricsRef.current?.stale),
        getMetricsError: () => metricsRef.current?.lastError || undefined,
        getMetricsLastUpdated: metricsLastUpdated,
        getAnimationKey: (pod) => `pod:${pod.namespace}/${pod.name}:cpu`,
        getShowEmptyState: () => true,
      }),
      createResourceBarColumn<PodSnapshotEntry>({
        key: 'memory',
        header: 'Memory',
        type: 'memory',
        getUsage: (pod) => podRowMemoryValue(pod, 'usage'),
        getRequest: (pod) => podRowMemoryValue(pod, 'request'),
        getLimit: (pod) => podRowMemoryValue(pod, 'limit'),
        getVariant: () => 'compact',
        getMetricsStale: () => Boolean(metricsRef.current?.stale),
        getMetricsError: () => metricsRef.current?.lastError || undefined,
        getMetricsLastUpdated: metricsLastUpdated,
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
    metricsLastUpdated,
    objectData?.clusterId,
    objectLink,
    getPodClusterMeta,
    navigatePod,
  ]);

  const { gridTableProps, favModal, source, queryPayload } = useQueryBackedClusterResourceGridTable<
    PodSnapshotPayload,
    PodSnapshotEntry
  >({
    queryTableMode: 'Query Backed Dynamic',
    clusterId: queryClusterId,
    domain: 'pods',
    label: 'Object Panel Pods',
    baseScope: podsScope ?? undefined,
    selectRows: selectPayloadRows,
    viewId: 'object-panel-pods',
    columns,
    objectIdentity: podIdentity,
    diagnosticsLabel: 'Object Panel Pods',
    showKindDropdown: false,
    // Object-panel pods are already scoped to one workload/node; the namespace
    // filter UI is not applicable here.
    filterOptions: { isNamespaceScoped: false },
  });

  // Payload-scoped metrics: same snapshot as the rows, same cluster.
  const effectiveMetrics = queryPayload?.metrics ?? null;
  metricsRef.current = effectiveMetrics;
  const metricsBanner = useMemo(() => getMetricsBannerInfo(effectiveMetrics), [effectiveMetrics]);

  // Query pod-action permissions for every (cluster, namespace) pair visible
  // in this tab. Workload-scoped pods share the panel object's namespace, but
  // node-scoped pods span arbitrary namespaces that the panel-level namespace
  // query never covers. Keyed off the visible rows so permissions also
  // self-heal after a permission-store reset; the store's TTL and in-flight
  // dedup keep repeat calls cheap.
  const visiblePermissionTargets = useMemo(() => {
    const seen = new Set<string>();
    const targets: Array<{ namespace: string; clusterId: string }> = [];
    source.rows.forEach((pod) => {
      const podNamespace = pod.namespace?.trim();
      const podClusterId = pod.clusterId?.trim() || objectData?.clusterId?.trim();
      if (!podNamespace || !podClusterId) {
        return;
      }
      const key = `${podClusterId}|${podNamespace.toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      targets.push({ namespace: podNamespace, clusterId: podClusterId });
    });
    return targets;
  }, [source.rows, objectData?.clusterId]);

  useEffect(() => {
    if (visiblePermissionTargets.length === 0) {
      return;
    }
    void queryNamespacesPermissions(visiblePermissionTargets, {
      specLists: [POD_PERMISSIONS] satisfies PermissionSpecList[],
    });
  }, [visiblePermissionTargets]);

  const objectActions = useObjectActionController({
    context: 'gridtable',
    onOpen: (object) => openWithObject(object),
    onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
  });

  // Context-menu references carry row facts (forwardable ports) on top of
  // the shared identity so the action policy can gate Port Forward per pod.
  const getContextMenuItems = useCallback(
    (pod: PodSnapshotEntry) =>
      objectActions.getMenuItems(
        buildRequiredObjectReference(
          getPodIdentity(pod),
          { fallbackClusterId: objectData?.clusterId },
          { portForwardAvailable: pod.portForwardAvailable }
        )
      ),
    [getPodIdentity, objectActions, objectData?.clusterId]
  );

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
          getCustomContextMenuItems={getContextMenuItems}
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
