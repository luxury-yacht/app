/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx
 *
 * Query-backed Pods tab for the object panel. It scopes a typed `pods` query to
 * the panel's workload (`workload:…`) or node (`node:…`) and renders the
 * server-paginated, server-filtered page through the shared pod table. The
 * query is gated to the active pods tab.
 */

import { useOptionalViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import type React from 'react';
import { useMemo } from 'react';
import type { PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import '../shared.css';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import {
  type PodNamespaceLink,
  usePodNamespacePermissions,
  usePodTable,
} from '@modules/resource-grid/usePodTable';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { buildObjectPanelPodsScope } from './objectPanelPodsScope';

interface PodsTabProps {
  isActive: boolean;
}

export const PodsTab: React.FC<PodsTabProps> = ({ isActive }) => {
  const { objectData } = useObjectPanel();
  const viewState = useOptionalViewState();
  const namespaceContext = useNamespace();

  // Namespace links switch the main window to that namespace's Pods view.
  // A native panel window has no view state, so there they stay display-only.
  const namespaceLink = useMemo<PodNamespaceLink>(
    () => ({
      onClick: (pod: PodSnapshotEntry) => {
        if (!pod.ref.namespace || !viewState) {
          return;
        }
        namespaceContext.setSelectedNamespace(pod.ref.namespace, pod.ref.clusterId);
        viewState.onNamespaceSelect(pod.ref.namespace);
        viewState.setActiveNamespaceTab('pods');
      },
      isInteractive: (pod: PodSnapshotEntry) => Boolean(pod.ref.namespace && viewState),
      getClassName: (pod: PodSnapshotEntry) =>
        pod.ref.namespace && viewState ? 'object-panel-link' : undefined,
    }),
    [namespaceContext, viewState]
  );

  // Pod identities, links and metrics staleness are scoped to the PANEL OBJECT's
  // cluster; the globally selected cluster can be a different one.
  const pods = usePodTable({
    fallbackClusterId: objectData?.clusterId,
    clusterName: objectData?.clusterName,
    showNamespaceColumn: true,
    namespaceLink,
  });

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

  const { gridTableProps, source, queryPayload } = useQueryBackedClusterResourceGridTable<
    PodSnapshotPayload,
    PodSnapshotEntry
  >({
    queryTableMode: 'Query Backed Dynamic',
    supportsCustomMetadataColumns: true,
    clusterId: queryClusterId,
    domain: 'pods',
    excludedQueryFacetKeys: RESOURCE_STATUS_QUERY_FACET_KEYS,
    label: 'Object Panel Pods',
    baseScope: podsScope ?? undefined,
    selectRows: selectPayloadRows,
    viewId: 'object-panel-pods',
    columns: pods.columns,
    objectIdentity: pods.identity,
    diagnosticsLabel: 'Object Panel Pods',
    // A favorite saves a main-window view, which this panel table is not.
    showFavoriteToggle: false,
    showKindDropdown: false,
    // Object-panel pods are already scoped to one workload/node; the namespace
    // filter UI is not applicable here.
    filterOptions: { isNamespaceScoped: false },
  });

  // The base query payload carries the poller freshness block for the usage
  // joined onto the rows at serve.
  pods.metricsRef.current = queryPayload?.metrics ?? null;

  // Workload-scoped pods share the panel object's namespace, but node-scoped
  // pods span arbitrary namespaces that the panel-level namespace query never covers.
  usePodNamespacePermissions(source.rows, objectData?.clusterId);

  return (
    <div className="object-panel-pods">
      <div className="object-panel-pods__table">
        <ResourceInventoryTable<PodSnapshotEntry>
          source={source}
          gridTableProps={gridTableProps}
          columns={pods.columns}
          diagnosticsLabel="Object Panel Pods"
          diagnosticsMode="live"
          onRowClick={pods.identity.open}
          enableContextMenu
          getCustomContextMenuItems={pods.getContextMenuItems}
          tableClassName="gridtable-pods gridtable-pods--namespaced"
          spinnerMessage="Loading pods..."
          updatingMessage="Updating pods..."
          hideHeader={!isActive}
          emptyMessage="No pods found"
        />
      </div>
      {pods.actionModals}
    </div>
  );
};
