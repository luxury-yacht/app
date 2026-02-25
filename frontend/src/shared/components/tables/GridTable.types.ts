/**
 * frontend/src/shared/components/tables/GridTable.types.ts
 *
 * Type definitions for GridTable.types.
 * Defines shared interfaces and payload shapes for the shared components.
 */

import type React from 'react';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type { SearchInputAction } from '@shared/components/inputs/SearchInput';

export type ColumnWidthUnit = 'px' | 'em' | 'rem' | '%';
export type ColumnWidthInput =
  | number
  | `${number}${'px' | 'em' | 'rem' | '%'}` /* explicit unit */
  | 'auto';

export interface ColumnWidthState {
  width: number;
  unit: ColumnWidthUnit;
  raw?: ColumnWidthInput | null;
  rawValue?: number | null;
  autoWidth: boolean;
  source: 'column' | 'table' | 'auto' | 'user';
  updatedAt: number;
}

export interface GridColumnDefinition<T> {
  key: string;
  header: string;
  render: (item: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (item: T) => any;
  className?: string;
  width?: ColumnWidthInput;
  minWidth?: ColumnWidthInput;
  maxWidth?: ColumnWidthInput;
  autoWidth?: boolean;
  flex?: string;
  disableShortcuts?: boolean | ((item: T) => boolean);
}

export interface GridTableVirtualizationOptions {
  enabled?: boolean;
  threshold?: number;
  overscan?: number;
  estimateRowHeight?: number;
  columnWindow?: {
    enabled?: boolean;
    overscanColumns?: number;
    stickyStart?: number;
    stickyEnd?: number;
  };
}

export const GRIDTABLE_VIRTUALIZATION_DEFAULT: GridTableVirtualizationOptions = {
  enabled: true,
  threshold: 120,
  overscan: 6,
  estimateRowHeight: 44,
};

export interface GridTableFilterState {
  search: string;
  kinds: string[];
  namespaces: string[];
}

export interface GridTableFilterAccessors<T> {
  getSearchText?: (row: T) => string | string[] | null | undefined;
  getKind?: (row: T) => string | null | undefined;
  getNamespace?: (row: T) => string | null | undefined;
}

export interface GridTableFilterOptions {
  searchPlaceholder?: string;
  kinds?: string[];
  namespaces?: string[];
  showKindDropdown?: boolean;
  showNamespaceDropdown?: boolean;
  includeClusterScopedSyntheticNamespace?: boolean;
  customActions?: React.ReactNode;
  searchActions?: SearchInputAction[];
}

export interface GridTableFilterConfig<T> {
  enabled: boolean;
  initial?: Partial<GridTableFilterState>;
  value?: GridTableFilterState;
  accessors?: GridTableFilterAccessors<T>;
  options?: GridTableFilterOptions;
  onChange?: (state: GridTableFilterState) => void;
  onReset?: () => void;
}

export interface GridTableProps<T> {
  data: T[];
  columns: GridColumnDefinition<T>[];
  keyExtractor: (item: T, index: number) => string;
  getRowClassName?: (item: T, index: number) => string | undefined | null;
  getRowStyle?: (item: T, index: number) => React.CSSProperties | undefined;
  onRowClick?: (item: T) => void;
  onSort?: (key: string, targetDirection?: 'asc' | 'desc' | null) => void;
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null };
  embedded?: boolean;
  className?: string;
  tableClassName?: string;
  loading?: boolean;
  hideHeader?: boolean;
  enableContextMenu?: boolean;
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[];
  useShortNames?: boolean;
  initialColumnWidths?: Record<string, ColumnWidthInput>;
  columnWidths?: Record<string, ColumnWidthState> | null;
  onColumnWidthsChange?: (widths: Record<string, ColumnWidthState>) => void;
  enableColumnResizing?: boolean;
  columnVisibility?: Record<string, boolean> | null;
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void;
  nonHideableColumns?: string[];
  enableColumnVisibilityMenu?: boolean;
  emptyMessage?: string;
  hasMore?: boolean;
  onRequestMore?: (trigger: 'manual' | 'auto') => void;
  isRequestingMore?: boolean;
  autoLoadMore?: boolean;
  loadMoreLabel?: string;
  showLoadMoreButton?: boolean;
  showPaginationStatus?: boolean;
  virtualization?: GridTableVirtualizationOptions;
  loadingOverlay?: {
    show: boolean;
    message?: string;
  };
  filters?: GridTableFilterConfig<T>;
  allowHorizontalOverflow?: boolean;
}

export interface InternalFilterOptions {
  kinds: DropdownOption[];
  namespaces: DropdownOption[];
  searchPlaceholder?: string;
  customActions?: React.ReactNode;
  searchActions?: SearchInputAction[];
}
