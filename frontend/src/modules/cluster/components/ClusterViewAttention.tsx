import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { useCallback, useMemo } from 'react';
import type { ClusterAttentionFinding, ClusterAttentionSnapshot } from '@/core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import { getDisplayKind } from '@/utils/kindAliasMap';

export default function ClusterViewAttention() {
  const { selectedClusterId } = useKubeconfig();
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const useShortResourceNames = useShortNames();

  const objectReference = useCallback(
    (row: ClusterAttentionFinding) =>
      buildRequiredObjectReference(row.ref, { fallbackClusterId: selectedClusterId }),
    [selectedClusterId]
  );
  const openObject = useCallback(
    (row: ClusterAttentionFinding) => openWithObject(objectReference(row)),
    [objectReference, openWithObject]
  );
  const navigateObject = useCallback(
    (row: ClusterAttentionFinding) => navigateToView(objectReference(row)),
    [navigateToView, objectReference]
  );

  const columns = useMemo<GridColumnDefinition<ClusterAttentionFinding>[]>(() => {
    const result: GridColumnDefinition<ClusterAttentionFinding>[] = [
      cf.createKindColumn<ClusterAttentionFinding>({
        getKind: (row) => row.kind,
        getDisplayText: (row) => getDisplayKind(row.kind, useShortResourceNames),
        onClick: openObject,
        onAltClick: navigateObject,
      }),
      cf.createTextColumn('name', 'Name', (row) => row.name, {
        onClick: openObject,
        onAltClick: navigateObject,
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn('namespace', 'Namespace', (row) => row.namespace || '-'),
      cf.createTextColumn('severity', 'Severity', (row) => row.severity, {
        getClassName: (row) => `status-text ${row.severity}`,
      }),
      cf.createTextColumn('status', 'Status', (row) => row.status || '-'),
      cf.createTextColumn('reason', 'Finding', (row) => row.reasons?.join(' · ') || '-'),
      cf.createAgeColumn<ClusterAttentionFinding>('age', 'Age', (row) => row.age),
    ];
    cf.applyColumnSizing(result, {
      kind: { autoWidth: true },
      name: { width: 220 },
      namespace: { width: 180 },
      severity: { autoWidth: true },
      status: { width: 180 },
      reason: { width: 320 },
      age: { autoWidth: true },
    });
    return result;
  }, [navigateObject, openObject, useShortResourceNames]);

  const keyExtractor = useCallback(
    (row: ClusterAttentionFinding) =>
      buildRequiredCanonicalObjectRowKey(row.ref, { fallbackClusterId: selectedClusterId }),
    [selectedClusterId]
  );
  const { gridTableProps, favModal, source } = useQueryBackedClusterResourceGridTable<
    ClusterAttentionSnapshot,
    ClusterAttentionFinding
  >({
    queryTableMode: 'Query Backed Static',
    clusterId: selectedClusterId,
    domain: 'cluster-attention',
    label: 'Cluster Attention',
    selectRows: selectPayloadRows,
    viewId: 'cluster-attention',
    columns,
    keyExtractor,
    showKindDropdown: true,
    showNamespaceFilters: true,
    defaultSortKey: 'severity',
    defaultSortDirection: 'asc',
    diagnosticsLabel: 'Cluster Attention',
  });

  return (
    <ResourceInventoryTable
      source={source}
      gridTableProps={gridTableProps}
      spinnerMessage="Loading attention findings..."
      favModal={favModal}
      columns={columns}
      diagnosticsLabel="Cluster Attention"
      emptyMessage="No cluster objects need attention"
    />
  );
}
