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
  ref: CatalogItem['ref'];
  resourceVersion: CatalogItem['resourceVersion'];
  creationTimestamp: CatalogItem['creationTimestamp'];
  scope: CatalogItem['scope'];
  metadata: CatalogItem['metadata'];
  labelsDigest?: CatalogItem['labelsDigest'];
  actionFacts?: CatalogItem['actionFacts'];
  kindDisplay: string;
  namespaceDisplay: string;
  apiDisplay: string;
  age: string;
  ageTimestamp: number;
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
    const kindLabel = getDisplayKind(item.ref.kind, useShortResourceNames);
    const namespaceDisplay = item.ref.namespace ?? '—';
    return {
      ...item,
      metadata: item.metadata,
      kindDisplay: kindLabel,
      namespaceDisplay,
      apiDisplay: `${item.ref.group || 'core'}/${item.ref.version}`,
      age: '—',
      ageTimestamp: created ? created.getTime() : 0,
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
        getKind: (row) => row.ref.kind,
        getDisplayText: (row) => row.kindDisplay,
        sortValue: (row) => row.ref.kind.toLowerCase(),
        onClick: onRowClick,
        onAltClick: (row) => navigateToView(buildRequiredObjectReference(row.ref)),
      }),
      cf.createResourceNameColumn<BrowseTableRow>((row) => row.ref.name, {
        sortable: true,
        onClick: (row) => onRowClick(row),
        onAltClick: (row) => navigateToView(buildRequiredObjectReference(row.ref)),
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn<BrowseTableRow>('api', 'API', (row) => row.apiDisplay, {
        sortable: true,
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
              onNamespaceClick?.(row.ref.namespace ?? null, row.ref.clusterId ?? null),
            isInteractive: (row) => Boolean(row.ref.namespace),
            getTitle: (row) =>
              row.ref.namespace ? `View ${row.ref.namespace} workloads` : undefined,
            getClassName: () => 'object-panel-link',
          }
        )
      );
    }

    baseColumns.push(ageColumn);

    return cf.withAutoWidthColumns(baseColumns);
  }, [showNamespaceColumn, onRowClick, onNamespaceClick, navigateToView]);
}
