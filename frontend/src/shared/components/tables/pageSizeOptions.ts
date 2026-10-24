/**
 * frontend/src/shared/components/tables/pageSizeOptions.ts
 *
 * Table page-size choices. Every pagination footer dropdown AND the
 * Settings ▸ Display ▸ Tables "Default Page Size" dropdown render from this
 * list. The list is the default-page-size preference's allowed values, owned by
 * the backend preference schema (backend/internal/preferenceschema).
 */

import {
  APP_PREFERENCE_SPECS,
  type AppPreferences,
} from '@/core/settings/appPreferences.generated';

export const TABLE_PAGE_SIZE_OPTIONS = APP_PREFERENCE_SPECS.defaultTablePageSize.intOptions;

export type TablePageSize = AppPreferences['defaultTablePageSize'];

export const DEFAULT_TABLE_PAGE_SIZE: TablePageSize =
  APP_PREFERENCE_SPECS.defaultTablePageSize.defaultValue;

export const isTablePageSize = (value: unknown): value is TablePageSize =>
  TABLE_PAGE_SIZE_OPTIONS.includes(value as TablePageSize);

/** Snap an arbitrary value to the options list; off-list values become the default. */
export const normalizeTablePageSize = (value: unknown): TablePageSize =>
  isTablePageSize(value) ? value : DEFAULT_TABLE_PAGE_SIZE;
