/**
 * frontend/src/shared/components/tables/pageSizeOptions.test.ts
 *
 * Test suite for pageSizeOptions.
 * Pins the single source of truth for table page-size choices.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
  isTablePageSize,
  normalizeTablePageSize,
} from './pageSizeOptions';

describe('pageSizeOptions', () => {
  it('offers the default as one of the selectable options', () => {
    expect(TABLE_PAGE_SIZE_OPTIONS).toContain(DEFAULT_TABLE_PAGE_SIZE);
    expect(DEFAULT_TABLE_PAGE_SIZE).toBe(50);
  });

  it('accepts only values from the options list', () => {
    for (const option of TABLE_PAGE_SIZE_OPTIONS) {
      expect(isTablePageSize(option)).toBe(true);
      expect(normalizeTablePageSize(option)).toBe(option);
    }
  });

  it('normalizes off-list values to the default', () => {
    expect(isTablePageSize(333)).toBe(false);
    expect(normalizeTablePageSize(333)).toBe(DEFAULT_TABLE_PAGE_SIZE);
    expect(normalizeTablePageSize(undefined)).toBe(DEFAULT_TABLE_PAGE_SIZE);
    expect(normalizeTablePageSize(null)).toBe(DEFAULT_TABLE_PAGE_SIZE);
    expect(normalizeTablePageSize('100')).toBe(DEFAULT_TABLE_PAGE_SIZE);
  });
});
