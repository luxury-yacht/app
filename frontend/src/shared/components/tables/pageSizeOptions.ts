/**
 * frontend/src/shared/components/tables/pageSizeOptions.ts
 *
 * The single source of truth for table page-size choices. Every pagination
 * footer dropdown AND the Settings ▸ Display ▸ Tables "Default Page Size"
 * dropdown render from this list — edit it here and both update together.
 */

export const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

export type TablePageSize = (typeof TABLE_PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_TABLE_PAGE_SIZE: TablePageSize = 50;

export const isTablePageSize = (value: unknown): value is TablePageSize =>
  TABLE_PAGE_SIZE_OPTIONS.includes(value as TablePageSize);

/** Snap an arbitrary value to the options list; off-list values become the default. */
export const normalizeTablePageSize = (value: unknown): TablePageSize =>
  isTablePageSize(value) ? value : DEFAULT_TABLE_PAGE_SIZE;
