/**
 * frontend/src/modules/namespace/components/NsViewPods.tsx
 *
 * The namespace Pods view: the shared pod table over the selected namespace
 * (or all namespaces), backed by a typed `pods` namespace query.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { usePodNamespacePermissions, usePodTable } from '@modules/resource-grid/usePodTable';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import React, { useMemo } from 'react';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

interface PodsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace Pods
 */
const NsViewPods: React.FC<PodsViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const namespaceColumnLink = useNamespaceColumnLink<PodSnapshotEntry>('pods');
    const clusterMetrics = useClusterMetricsAvailability();
    const { selectedClusterId, selectedClusterName } = useKubeconfig();
    const { selectedNamespaceClusterId } = useNamespace();
    const queryClusterId = selectedNamespaceClusterId ?? selectedClusterId;

    const pods = usePodTable({
      fallbackClusterId: selectedClusterId,
      clusterName: selectedClusterName,
      showNamespaceColumn,
      namespaceLink: namespaceColumnLink,
    });
    const { columns } = pods;
    const keyExtractor = pods.identity.key;

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel = isAllNamespaces ? 'All Namespaces Pods' : 'Namespace Pods';
    const { gridTableProps, favModal, source, queryPayload } =
      useQueryBackedNamespaceResourceGridTable<PodSnapshotPayload, PodSnapshotEntry>({
        queryTableMode: 'Query Backed Dynamic',
        supportsCustomMetadataColumns: true,
        clusterId: queryClusterId,
        domain: 'pods',
        excludedQueryFacetKeys: RESOURCE_STATUS_QUERY_FACET_KEYS,
        label: diagnosticsLabel,
        selectRows: selectPayloadRows,
        viewId: 'namespace-pods',
        namespace,
        columns,
        keyExtractor,
        defaultSort: { key: 'name', direction: 'asc' },
        diagnosticsLabel,
        rowIdentity: keyExtractor,
        showKindDropdown: false,
        showNamespaceFilters: isAllNamespaces,
        filterOptions: { isNamespaceScoped: !isAllNamespaces },
      });

    // The base query payload carries the poller freshness block for the usage
    // joined onto the rows at serve; the CPU/Memory cells read it from this ref.
    pods.metricsRef.current = queryPayload?.metrics ?? clusterMetrics ?? null;

    // Non-display reads come from the single source of truth (the controller source).
    usePodNamespacePermissions(source.rows, queryClusterId);

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No pods found ${isAllNamespaces ? 'in any namespaces' : 'in this namespace'}`
        ),
      [isAllNamespaces]
    );

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading pods..."
          updatingMessage="Updating pods…"
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          diagnosticsMode="live"
          onRowClick={pods.identity.open}
          tableClassName={`gridtable-pods${showNamespaceColumn ? ' gridtable-pods--namespaced' : ''}`}
          enableContextMenu
          getCustomContextMenuItems={pods.getContextMenuItems}
          emptyMessage={emptyMessage}
        />

        {pods.actionModals}
      </>
    );
  }
);

NsViewPods.displayName = 'NsViewPods';

export default NsViewPods;
