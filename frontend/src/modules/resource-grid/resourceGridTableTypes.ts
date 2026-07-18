/**
 * frontend/src/modules/resource-grid/resourceGridTableTypes.ts
 *
 * Defines shared contracts for resource-grid table adapters and state.
 */

import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableDiagnosticsMode,
  GridTableFilterConfig,
  GridTableFilterOptions,
  GridTableFilterState,
  GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable';
import type { GridTableFilterPersistenceOptions } from '@shared/components/tables/persistence/gridTablePersistence';
import type React from 'react';
import type { SortConfig, SortDirection } from '@/hooks/useTableSort';
import type { ResourceGridObjectIdentityAdapter } from './useResourceGridObjectIdentity';

export interface GridTableBindingProps<T> {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onSort: (key: string, targetDirection?: SortDirection) => void;
  sortConfig: SortConfig;
  filters?: GridTableFilterConfig<T>;
  virtualization: GridTableVirtualizationOptions;
  columnWidths?: Record<string, ColumnWidthState> | null;
  onColumnWidthsChange?: (widths: Record<string, ColumnWidthState>) => void;
  columnVisibility?: Record<string, boolean> | null;
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void;
  allowHorizontalOverflow?: boolean;
  /** Arms the scope-toggle + Copy + Export trio in the filter bar. */
  fetchAllRows?: () => Promise<T[]>;
  /** Default filename offered by the file Export action. */
  exportFilename?: string;
}

export interface ResourceGridTableRow {
  kind?: string | null;
  kindAlias?: string | null;
  name?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  clusterName?: string | null;
  group?: string | null;
  version?: string | null;
}

export type ResourceGridTableMode =
  | 'Local Complete'
  | 'Local Partial'
  | 'Query Backed Static'
  | 'Query Backed Dynamic';

export const isQueryBackedResourceGridTableMode = (mode: ResourceGridTableMode): boolean =>
  mode === 'Query Backed Static' || mode === 'Query Backed Dynamic';

export interface ResourceGridTableBaseParams<T extends ResourceGridTableRow> {
  viewId: string;
  tableMode: ResourceGridTableMode;
  data: T[];
  columns: GridColumnDefinition<T>[];
  keyExtractor?: (item: T, index: number) => string;
  objectIdentity?: ResourceGridObjectIdentityAdapter<T>;
  availableKinds?: string[];
  diagnosticsLabel?: string;
  filterAccessors?: GridTableFilterConfig<T>['accessors'];
  leadingFilterActions?: IconBarItem[];
  filterOptions?: GridTableFilterPersistenceOptions;
  pageSizeOptions?: readonly number[];
  filterOptionOverrides?: Partial<GridTableFilterOptions>;
  metadataSearch?: ResourceGridMetadataSearchParams<T>;
  onTableStateChange?: (state: {
    filters: GridTableFilterState;
    sortConfig: SortConfig | null;
  }) => void;
  persistenceOverride?: ResourceGridPersistence<T>;
  persistenceData?: T[];
  rowIdentity?: (item: T, index: number) => string;
  showKindDropdown?: boolean;
  getTrailingFilterActions?: (sortedData: T[]) => IconBarItem[];
  transformSortedData?: (sortedData: T[]) => T[];
  /** Named route-level favorite pane; omitted for ordinary one-table views. */
  favoritePane?: { id: string; label: string };
}

export interface ResourceGridMetadataSearchParams<T extends ResourceGridTableRow> {
  getDefaultValues: (row: T) => string[];
  getMetadataMaps: (row: T) => (Record<string, string> | undefined)[];
}

export interface ClusterResourceGridTableParams<T extends ResourceGridTableRow>
  extends ResourceGridTableBaseParams<T> {
  // Cluster/namespace resource tables always receive persistence AND a resolved
  // key extractor from their query-backed wrapper, so both are required here
  // (the base hooks no longer own fallbacks for either).
  persistenceOverride: ResourceGridPersistence<T>;
  keyExtractor: (item: T, index: number) => string;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  showNamespaceFilters?: boolean;
}

export interface NamespaceResourceGridTableParams<T extends ResourceGridTableRow>
  extends ResourceGridTableBaseParams<T> {
  persistenceOverride: ResourceGridPersistence<T>;
  keyExtractor: (item: T, index: number) => string;
  namespace: string;
  defaultSort?: SortConfig;
  showNamespaceFilters?: boolean;
}

export interface ObjectPanelResourceGridTableParams<T extends ResourceGridTableRow>
  extends ResourceGridTableBaseParams<T> {
  clusterIdentity?: string | null;
  enabled?: boolean;
  defaultSort?: SortConfig;
}

export interface ResourceGridPersistence<T extends ResourceGridTableRow> {
  sortConfig: SortConfig | null;
  setSortConfig: (next: SortConfig | null) => void;
  columnWidths: Record<string, ColumnWidthState> | null;
  setColumnWidths: (next: Record<string, ColumnWidthState>) => void;
  columnVisibility: Record<string, boolean> | null;
  setColumnVisibility: (next: Record<string, boolean>) => void;
  filters: GridTableFilterState;
  setFilters: NonNullable<GridTableFilterConfig<T>['onChange']>;
  pageSize: number | null;
  setPageSize: (next: number | null) => void;
  resetState: () => void;
  hydrated: boolean;
}

export interface ResourceGridCommonParams<T extends ResourceGridTableRow>
  extends Omit<ResourceGridTableBaseParams<T>, 'viewId' | 'filterOptions'> {
  persistence: ResourceGridPersistence<T>;
  keyExtractor: (item: T, index: number) => string;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  namespace?: string;
  showNamespaceFilters?: boolean;
}

export interface ResourceGridTableResult<T extends ResourceGridTableRow> {
  gridTableProps: GridTableBindingProps<T>;
  favModal: React.ReactNode;
  persistence?: ResourceGridPersistence<T>;
}

export interface ObjectPanelResourceGridTableSurfaceProps<T extends ResourceGridTableRow> {
  gridTableProps: GridTableBindingProps<T>;
  columns: GridColumnDefinition<T>[];
  diagnosticsLabel: string;
  loading: boolean;
  spinnerMessage: string;
  updatingMessage: string;
  diagnosticsMode?: GridTableDiagnosticsMode;
  tableClassName?: string;
  hideHeader?: boolean;
  onRowClick?: (item: T) => void;
  enableContextMenu?: boolean;
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[];
}

export interface QueryResourceGridTableParams<T extends ResourceGridTableRow> {
  tableMode: ResourceGridTableMode;
  data: T[];
  columns: GridColumnDefinition<T>[];
  persistence: ResourceGridPersistence<T>;
  keyExtractor?: (item: T, index: number) => string;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  diagnosticsLabel?: string;
  filterAccessors?: GridTableFilterConfig<T>['accessors'];
  filterOptions: GridTableFilterOptions;
  rowIdentity?: (item: T, index: number) => string;
  virtualization?: GridTableVirtualizationOptions;
  favoritePane?: { id: string; label: string };
}
