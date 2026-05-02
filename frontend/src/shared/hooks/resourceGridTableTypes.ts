import type React from 'react';
import type { SortConfig, SortDirection } from '@/hooks/useTableSort';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableFilterConfig,
  GridTableFilterOptions,
  GridTableFilterState,
  GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable';
import type { GridTableFilterPersistenceOptions } from '@shared/components/tables/persistence/gridTablePersistence';

export interface GridTableBindingProps<T> {
  data: T[];
  onSort: (key: string, targetDirection?: SortDirection) => void;
  sortConfig: SortConfig;
  filters?: GridTableFilterConfig<T>;
  virtualization: GridTableVirtualizationOptions;
  columnWidths?: Record<string, ColumnWidthState> | null;
  onColumnWidthsChange?: (widths: Record<string, ColumnWidthState>) => void;
  columnVisibility?: Record<string, boolean> | null;
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void;
  allowHorizontalOverflow?: boolean;
}

export interface ResourceGridTableRow {
  kind?: string | null;
  namespace?: string | null;
}

export interface ResourceGridTableBaseParams<T extends ResourceGridTableRow> {
  viewId: string;
  data: T[];
  columns: GridColumnDefinition<T>[];
  keyExtractor: (item: T, index: number) => string;
  availableKinds?: string[];
  diagnosticsLabel?: string;
  filterAccessors?: GridTableFilterConfig<T>['accessors'];
  leadingFilterActions?: IconBarItem[];
  filterOptions?: GridTableFilterPersistenceOptions;
  kindDropdownBulkActions?: boolean;
  kindDropdownSearchable?: boolean;
  metadataSearch?: ResourceGridMetadataSearchParams<T>;
  persistenceData?: T[];
  rowIdentity?: (item: T, index: number) => string;
  showKindDropdown?: boolean;
  getTrailingFilterActions?: (sortedData: T[]) => IconBarItem[];
  transformSortedData?: (sortedData: T[]) => T[];
}

export interface ResourceGridMetadataSearchParams<T extends ResourceGridTableRow> {
  getDefaultValues: (row: T) => string[];
  getMetadataMaps: (row: T) => (Record<string, string> | undefined)[];
}

export interface ClusterResourceGridTableParams<
  T extends ResourceGridTableRow,
> extends ResourceGridTableBaseParams<T> {
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  showNamespaceFilters?: boolean;
}

export interface NamespaceResourceGridTableParams<
  T extends ResourceGridTableRow,
> extends ResourceGridTableBaseParams<T> {
  namespace: string;
  defaultSort?: SortConfig;
  showNamespaceFilters?: boolean;
}

export interface ObjectPanelResourceGridTableParams<
  T extends ResourceGridTableRow,
> extends ResourceGridTableBaseParams<T> {
  clusterIdentity?: string | null;
  enabled?: boolean;
  defaultSort?: SortConfig;
}

export interface ResourceGridPersistence<T extends ResourceGridTableRow> {
  sortConfig: SortConfig | null;
  setSortConfig: (next: SortConfig) => void;
  columnWidths: Record<string, ColumnWidthState> | null;
  setColumnWidths: (next: Record<string, ColumnWidthState>) => void;
  columnVisibility: Record<string, boolean> | null;
  setColumnVisibility: (next: Record<string, boolean>) => void;
  filters: GridTableFilterState;
  setFilters: NonNullable<GridTableFilterConfig<T>['onChange']>;
  resetState: () => void;
  hydrated: boolean;
}

export interface ResourceGridCommonParams<T extends ResourceGridTableRow> extends Omit<
  ResourceGridTableBaseParams<T>,
  'viewId' | 'filterOptions'
> {
  persistence: ResourceGridPersistence<T>;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  namespace?: string;
  showNamespaceFilters?: boolean;
}

export interface ResourceGridTableResult<T extends ResourceGridTableRow> {
  gridTableProps: GridTableBindingProps<T>;
  favModal: React.ReactNode;
}

export interface QueryResourceGridTableParams<T extends ResourceGridTableRow> {
  data: T[];
  columns: GridColumnDefinition<T>[];
  persistence: ResourceGridPersistence<T>;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  diagnosticsLabel?: string;
  filterAccessors?: GridTableFilterConfig<T>['accessors'];
  filterOptions: GridTableFilterOptions;
  rowIdentity?: (item: T, index: number) => string;
  virtualization?: GridTableVirtualizationOptions;
}
