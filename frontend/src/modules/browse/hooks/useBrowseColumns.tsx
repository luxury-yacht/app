/**
 * frontend/src/modules/browse/hooks/useBrowseColumns.tsx
 *
 * Hook for creating column definitions for the Browse table.
 * Supports both cluster-scoped (with namespace column) and namespace-scoped (without) views.
 */

import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { useMemo } from 'react';
import type { CatalogItem } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

/**
 * Row type for the Browse table.
 * Includes all fields needed for both cluster and namespace scoped views.
 */
export type BrowseTableRow = {
  uid: string;
  kind: string;
  kindDisplay: string;
  namespace: string;
  namespaceDisplay: string;
  name: string;
  scope: string;
  resource: string;
  group: string;
  version: string;
  apiDisplay: string;
  statusDisplay: string;
  age: string;
  ageTimestamp: number;
  item: CatalogItem;
};

/**
 * Converts catalog items to table rows.
 *
 * @param items - The catalog items to convert
 * @param useShortResourceNames - Whether to use short resource names for kind display
 */
export const toTableRows = (
  items: CatalogItem[],
  useShortResourceNames: boolean
): BrowseTableRow[] => {
  return items.map((item) => {
    const created = item.creationTimestamp ? new Date(item.creationTimestamp) : undefined;
    const kindLabel = getDisplayKind(item.kind, useShortResourceNames);
    const namespaceDisplay = item.namespace ?? '—';
    return {
      uid: item.uid,
      kind: kindLabel.toLowerCase(),
      kindDisplay: kindLabel,
      namespace: namespaceDisplay.toLowerCase(),
      namespaceDisplay,
      name: item.name,
      scope: item.scope,
      resource: item.resource,
      group: item.group,
      version: item.version,
      apiDisplay: `${item.group || 'core'}/${item.version}`,
      statusDisplay: item.actionFacts?.status?.trim() || '—',
      age: '—',
      ageTimestamp: created ? created.getTime() : 0,
      item,
    };
  });
};

/**
 * Options for the useBrowseColumns hook.
 */
export interface UseBrowseColumnsOptions {
  /** Whether to show the namespace column (false for namespace-scoped views) */
  showNamespaceColumn: boolean;
  /** Callback when a row is clicked to open details */
  onRowClick: (row: BrowseTableRow) => void;
  /** Callback when a namespace cell is clicked (only used when showNamespaceColumn is true) */
  onNamespaceClick?: (namespace: string | null, clusterId: string | null) => void;
}

/**
 * Hook that creates column definitions for the Browse table.
 * Returns memoized columns based on the scope and callbacks.
 */
export function useBrowseColumns({
  showNamespaceColumn,
  onRowClick,
  onNamespaceClick,
}: UseBrowseColumnsOptions): GridColumnDefinition<BrowseTableRow>[] {
  const { navigateToView } = useNavigateToView();

  return useMemo<GridColumnDefinition<BrowseTableRow>[]>(() => {
    const ageColumn = cf.createAgeColumn<BrowseTableRow>('age', 'Age', (row) => row.age);

    const baseColumns: GridColumnDefinition<BrowseTableRow>[] = [
      cf.createKindColumn<BrowseTableRow>({
        key: 'kind',
        getKind: (row) => row.item.kind,
        getDisplayText: (row) => row.kindDisplay,
        sortValue: (row) => row.kind,
        onClick: onRowClick,
        onAltClick: (row) => navigateToView(buildRequiredObjectReference(row.item)),
      }),
      cf.createTextColumn<BrowseTableRow>('name', 'Name', (row) => row.name, {
        sortable: true,
        onClick: (row) => onRowClick(row),
        onAltClick: (row) => navigateToView(buildRequiredObjectReference(row.item)),
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn<BrowseTableRow>('api', 'API', (row) => row.apiDisplay, {
        sortable: false,
      }),
      cf.createTextColumn<BrowseTableRow>('status', 'Status', (row) => row.statusDisplay, {
        sortable: false,
      }),
    ];

    // Add namespace column for cluster-scoped and all-namespaces views
    if (showNamespaceColumn) {
      baseColumns.push(
        cf.createTextColumn<BrowseTableRow>(
          'namespace',
          'Namespace',
          (row) => row.namespaceDisplay,
          {
            sortable: true,
            onClick: (row) =>
              onNamespaceClick?.(row.item.namespace ?? null, row.item.clusterId ?? null),
            isInteractive: (row) => Boolean(row.item.namespace),
            getTitle: (row) =>
              row.item.namespace ? `View ${row.item.namespace} workloads` : undefined,
            getClassName: () => 'object-panel-link',
          }
        )
      );
    }

    baseColumns.push(ageColumn);

    // Apply fixed column sizing to avoid measurement loops
    const sizing: cf.ColumnSizingMap = {
      kind: { width: 160, autoWidth: false },
      name: { width: 320, autoWidth: false },
      api: { width: 180, autoWidth: false },
      status: { width: 140, autoWidth: false },
      ...(showNamespaceColumn ? { namespace: { width: 220, autoWidth: false } } : {}),
      age: { width: 120, autoWidth: false },
    };
    cf.applyColumnSizing(baseColumns, sizing);

    return baseColumns;
  }, [showNamespaceColumn, onRowClick, onNamespaceClick, navigateToView]);
}
