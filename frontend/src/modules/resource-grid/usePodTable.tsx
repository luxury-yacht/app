/**
 * frontend/src/modules/resource-grid/usePodTable.tsx
 *
 * The one pod table definition shared by every pods table: the namespace pods
 * table and the object panel's Pods tab. It owns pod row identity, columns,
 * row context-menu actions, and the permission queries for visible pods.
 * Callers own their query scope and render ResourceInventoryTable themselves.
 */

import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import {
  type ResourceGridObjectIdentityAdapter,
  useResourceGridObjectIdentity,
} from '@modules/resource-grid/useResourceGridObjectIdentity';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { formatRestartCount } from '@shared/components/tables/restartCount';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useObjectLink } from '@shared/hooks/useObjectLink';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { podNamespacePermissionTargets, podOwnerReference } from '@shared/utils/podTableModel';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type PermissionSpecList,
  POD_PERMISSIONS,
  queryNamespacesPermissions,
} from '@/core/capabilities';
import type { PodMetricsInfo, PodSnapshotEntry } from '@/core/refresh/types';
import { workloadRowCpuValue, workloadRowMemoryValue } from '@/core/resource-metrics';
import type { KubernetesObjectReference } from '@/types/view-state';

/** Namespace-cell link handlers; the caller decides where a namespace link goes. */
export type PodNamespaceLink = Pick<
  cf.CreateTextColumnOptions<PodSnapshotEntry>,
  'onClick' | 'isInteractive' | 'getClassName'
>;

interface PodObjectLink {
  onClick: (pod: PodSnapshotEntry) => void;
  onAltClick?: (pod: PodSnapshotEntry) => void;
}

export interface UsePodTableOptions {
  /** Cluster for pod rows that omit their own clusterId. */
  fallbackClusterId?: string | null;
  /** Display name attached to object references opened from the table. */
  clusterName?: string | null;
  showNamespaceColumn: boolean;
  namespaceLink?: PodNamespaceLink;
}

export interface PodTable {
  identity: ResourceGridObjectIdentityAdapter<PodSnapshotEntry>;
  columns: GridColumnDefinition<PodSnapshotEntry>[];
  /** Metrics freshness for the CPU/Memory cells; set it from the query payload. */
  metricsRef: React.MutableRefObject<PodMetricsInfo | null>;
  getContextMenuItems: (pod: PodSnapshotEntry) => ContextMenuItem[];
  actionModals: React.ReactNode;
}

const COLUMN_SIZING: cf.ColumnSizingMap = {
  kind: { autoWidth: true },
  name: { autoWidth: true },
  namespace: { autoWidth: true },
  status: { autoWidth: true },
  ready: { autoWidth: true },
  restarts: { autoWidth: true },
  owner: { autoWidth: true },
  node: { autoWidth: true },
  cpu: { width: 200, minWidth: 200 },
  memory: { width: 200, minWidth: 200 },
  age: { autoWidth: true },
};

/** Ready ("ready/total") sorts by ready count, then total; unparsable values sort first. */
const readySortValue = (value?: string | null): number => {
  const match = value ? /^(\d+)\s*\/\s*(\d+)$/.exec(value) : null;
  return match ? Number(match[1]) * 1000000 + Number(match[2]) : -1;
};

const restartsClassName = (pod: PodSnapshotEntry) =>
  (pod.restarts ?? 0) > 0 ? 'status-text warning' : undefined;

const metricColumn = (
  type: 'cpu' | 'memory',
  metricsRef: React.RefObject<PodMetricsInfo | null>
): GridColumnDefinition<PodSnapshotEntry> => {
  const value = type === 'cpu' ? workloadRowCpuValue : workloadRowMemoryValue;
  return cf.createResourceBarColumn<PodSnapshotEntry>({
    header: type === 'cpu' ? 'CPU' : 'Memory',
    key: type,
    type,
    getUsage: (pod) => value(pod, 'usage'),
    getRequest: (pod) => value(pod, 'request'),
    getLimit: (pod) => value(pod, 'limit'),
    getMetricsStale: () => Boolean(metricsRef.current?.stale),
    getMetricsError: () => metricsRef.current?.lastError || undefined,
    getAnimationKey: (pod) => `pod:${pod.ref.namespace}/${pod.ref.name}:${type}`,
    sortable: true,
    sortValue: (pod) => (type === 'cpu' ? pod.cpuUsageMilli : pod.memoryUsageBytes) ?? 0,
  });
};

interface PodColumnDeps {
  openPod: (pod: PodSnapshotEntry) => void;
  navigatePod?: (pod: PodSnapshotEntry) => void;
  ownerLink: PodObjectLink;
  nodeLink: PodObjectLink;
  hasOwnerReference: (pod: PodSnapshotEntry) => boolean;
  showNamespaceColumn: boolean;
  namespaceLink?: PodNamespaceLink;
  metricsRef: React.RefObject<PodMetricsInfo | null>;
}

const buildPodColumns = (deps: PodColumnDeps): GridColumnDefinition<PodSnapshotEntry>[] => {
  const { openPod, navigatePod, ownerLink, nodeLink, hasOwnerReference, metricsRef } = deps;
  const columns: GridColumnDefinition<PodSnapshotEntry>[] = [
    cf.createKindColumn<PodSnapshotEntry>({
      getKind: () => 'Pod',
      onClick: openPod,
      onAltClick: navigatePod,
      sortable: false,
    }),
    cf.createResourceNameColumn<PodSnapshotEntry>((pod) => pod.ref.name, {
      onClick: openPod,
      onAltClick: navigatePod,
      getTitle: (pod) => pod.ref.name,
      sortValue: (pod) => (pod.ref.name || '').toLowerCase(),
      getClassName: () => 'object-panel-link',
    }),
    cf.createTextColumn<PodSnapshotEntry>('status', 'Status', (pod) => pod.status || '—', {
      getClassName: (pod) => backendStatusTextClass(pod.statusPresentation),
      sortValue: (pod) => (pod.status || '').toLowerCase(),
    }),
    cf.createTextColumn<PodSnapshotEntry>('ready', 'Ready', (pod) => pod.ready || '—', {
      sortValue: (pod) => readySortValue(pod.ready),
      alignHeader: 'center',
      alignData: 'center',
    }),
    cf.createTextColumn<PodSnapshotEntry>(
      'restarts',
      'Restarts',
      (pod) => formatRestartCount(pod.restarts),
      {
        alignHeader: 'center',
        alignData: 'center',
        sortValue: (pod) => pod.restarts ?? 0,
        getTitle: (pod) => `${pod.restarts ?? 0} restarts`,
        getClassName: restartsClassName,
      }
    ),
    cf.createTextColumn<PodSnapshotEntry>('owner', 'Owner', (pod) => pod.ownerName || '—', {
      ...ownerLink,
      sortValue: (pod) => (pod.ownerName || '').toLowerCase(),
      isInteractive: hasOwnerReference,
      getClassName: (pod) => (hasOwnerReference(pod) ? 'object-panel-link' : undefined),
      getTitle: (pod) =>
        pod.ownerKind && pod.ownerName ? `${pod.ownerName} (${pod.ownerKind})` : undefined,
    }),
    cf.createTextColumn<PodSnapshotEntry>('node', 'Node', (pod) => pod.node || '—', {
      ...nodeLink,
      sortValue: (pod) => (pod.node || '').toLowerCase(),
      isInteractive: (pod) => Boolean(pod.node),
      getClassName: (pod) => (pod.node ? 'object-panel-link' : undefined),
    }),
    metricColumn('cpu', metricsRef),
    metricColumn('memory', metricsRef),
    cf.createAgeColumn<PodSnapshotEntry>(),
  ];
  const withNamespace = deps.showNamespaceColumn
    ? cf.withNamespaceColumn(columns, {
        afterColumnKey: 'name',
        accessor: (pod) => pod.ref.namespace || '—',
        sortValue: (pod) => (pod.ref.namespace || '').toLowerCase(),
        ...deps.namespaceLink,
      })
    : columns;
  return cf.withColumnSizing(withNamespace, COLUMN_SIZING);
};

export function usePodTable({
  fallbackClusterId,
  clusterName,
  showNamespaceColumn,
  namespaceLink,
}: UsePodTableOptions): PodTable {
  const { openWithObject } = useObjectPanel();
  const { available: navigationAvailable, navigateToView } = useNavigateToView();
  const objectLink = useObjectLink();
  const metricsRef = useRef<PodMetricsInfo | null>(null);

  const getPodIdentity = useCallback(
    (pod: PodSnapshotEntry) => ({ ...pod.ref, clusterName: clusterName || undefined }),
    [clusterName]
  );
  const identity = useResourceGridObjectIdentity({
    fallbackClusterId,
    getObject: getPodIdentity,
    openWithObject,
    navigateToView,
  });

  const getOwnerReference = useCallback(
    (pod: PodSnapshotEntry) => podOwnerReference(pod, clusterName),
    [clusterName]
  );
  const getNodeReference = useCallback(
    (pod: PodSnapshotEntry): KubernetesObjectReference | undefined =>
      pod.node
        ? buildRequiredObjectReference(
            {
              kind: 'Node',
              name: pod.node,
              clusterId: pod.ref.clusterId,
              clusterName: clusterName || undefined,
            },
            { fallbackClusterId }
          )
        : undefined,
    [clusterName, fallbackClusterId]
  );

  const columns = useMemo(
    () =>
      buildPodColumns({
        openPod: identity.open,
        // Workspace navigation is unavailable in a native panel window.
        navigatePod: navigationAvailable ? identity.navigate : undefined,
        ownerLink: objectLink(getOwnerReference),
        nodeLink: objectLink(getNodeReference),
        hasOwnerReference: (pod) => Boolean(getOwnerReference(pod)),
        showNamespaceColumn,
        namespaceLink,
        metricsRef,
      }),
    [
      getNodeReference,
      getOwnerReference,
      identity.navigate,
      identity.open,
      namespaceLink,
      navigationAvailable,
      objectLink,
      showNamespaceColumn,
    ]
  );

  const objectActions = useObjectActionController({
    context: 'gridtable',
    onOpen: openWithObject,
    onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
  });
  const { ref: podReference } = identity;
  // Context-menu references carry the row's forwardable-ports fact on top of
  // the shared identity so the action policy can gate Port Forward per pod.
  const getContextMenuItems = useCallback(
    (pod: PodSnapshotEntry) =>
      objectActions.getMenuItems({
        ...podReference(pod),
        portForwardAvailable: pod.portForwardAvailable,
      }),
    [objectActions, podReference]
  );

  return {
    identity,
    columns,
    metricsRef,
    getContextMenuItems,
    actionModals: objectActions.modals,
  };
}

/**
 * Queries pod-action permissions for every (cluster, namespace) pair among the
 * visible pod rows. Node-scoped pods span namespaces that no single namespace
 * query covers; the permission store dedupes repeat and in-flight queries.
 */
export function usePodNamespacePermissions(
  pods: readonly PodSnapshotEntry[],
  fallbackClusterId?: string | null
): void {
  const targets = useMemo(
    () => podNamespacePermissionTargets(pods, fallbackClusterId),
    [pods, fallbackClusterId]
  );
  useEffect(() => {
    if (targets.length === 0) {
      return;
    }
    void queryNamespacesPermissions(targets, {
      specLists: [POD_PERMISSIONS] satisfies PermissionSpecList[],
    });
  }, [targets]);
}
