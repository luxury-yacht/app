/**
 * frontend/src/modules/browse/hooks/useBrowseColumns.tsx
 *
 * Hook for creating column definitions for the Browse table.
 * Supports both cluster-scoped (with namespace column) and namespace-scoped (without) views.
 */

import { useMemo } from 'react';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import * as cf from '@shared/components/tables/columnFactories';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { getDisplayKind } from '@/utils/kindAliasMap';
import type { CatalogItem } from '@/core/refresh/types';

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
export const toTableRows = (items: CatalogItem[], useShortResourceNames: boolean): BrowseTableRow[] => {
  return items.map((item) => {
    const created = item.creationTimestamp ? new Date(item.creationTimestamp) : undefined;
    const age = created ? formatAge(created) : '—';
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
      age,
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
  return useMemo<GridColumnDefinition<BrowseTableRow>[]>(() => {
    // Age column with custom render for tooltip
    const ageColumn = cf.createAgeColumn<BrowseTableRow>('age', 'Age', (row) => row.age);
    ageColumn.render = (row) =>
      row.ageTimestamp ? (
        <span title={formatFullDate(new Date(row.ageTimestamp))}>{row.age}</span>
      ) : (
        '—'
      );

    const baseColumns: GridColumnDefinition<BrowseTableRow>[] = [
      cf.createKindColumn<BrowseTableRow>({
        key: 'kind',
        getKind: (row) => row.item.kind,
        getDisplayText: (row) => row.kindDisplay,
        sortValue: (row) => row.kind,
        onClick: onRowClick,
      }),
      cf.createTextColumn<BrowseTableRow>('name', 'Name', (row) => row.name, {
        sortable: true,
        onClick: (row) => onRowClick(row),
        getClassName: () => 'object-panel-link',
      }),
    ];

    // Add namespace column for cluster-scoped and all-namespaces views
    if (showNamespaceColumn) {
      baseColumns.push(
        cf.createTextColumn<BrowseTableRow>('namespace', 'Namespace', (row) => row.namespaceDisplay, {
          sortable: true,
          onClick: (row) => onNamespaceClick?.(row.item.namespace ?? null, row.item.clusterId ?? null),
          isInteractive: (row) => Boolean(row.item.namespace),
          getTitle: (row) =>
            row.item.namespace ? `View ${row.item.namespace} workloads` : undefined,
        })
      );
    }

    baseColumns.push(ageColumn);

    // Apply fixed column sizing to avoid measurement loops
    const sizing: cf.ColumnSizingMap = {
      kind: { width: 160, autoWidth: false },
      name: { width: 320, autoWidth: false },
      ...(showNamespaceColumn ? { namespace: { width: 220, autoWidth: false } } : {}),
      age: { width: 120, autoWidth: false },
    };
    cf.applyColumnSizing(baseColumns, sizing);

    return baseColumns;
  }, [showNamespaceColumn, onRowClick, onNamespaceClick]);
}
