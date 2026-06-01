/**
 * frontend/src/modules/browse/components/CatalogPaginationControls.tsx
 *
 * Compact pagination controls for query-backed catalog tables.
 */

import React, { useMemo } from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type { BrowsePageLimit } from '@modules/browse/hooks/useBrowseCatalog';

interface CatalogPaginationControlsProps {
  idPrefix: string;
  pageIndex: number;
  pageSize: number;
  pageSizeOptions: readonly BrowsePageLimit[];
  totalCount: number;
  totalIsExact: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (value: BrowsePageLimit) => void;
}

const formatCount = (value: number): string => Math.max(0, value).toLocaleString();

const CatalogPaginationControls: React.FC<CatalogPaginationControlsProps> = ({
  idPrefix,
  pageIndex,
  pageSize,
  pageSizeOptions,
  totalCount,
  totalIsExact,
  hasPrevious,
  hasNext,
  loading,
  onPrevious,
  onNext,
  onPageSizeChange,
}) => {
  const pageOptions = useMemo<DropdownOption[]>(
    () =>
      pageSizeOptions.map((value) => ({
        value: String(value),
        label: `${value} / page`,
      })),
    [pageSizeOptions]
  );
  const totalPages = Math.max(1, Math.ceil(Math.max(totalCount, 0) / Math.max(1, pageSize)));
  const displayPageCount = Math.max(pageIndex, totalPages);
  const approximatePrefix = totalIsExact ? '' : '~';
  const totalLabel =
    totalCount === 0
      ? 'No results'
      : `${approximatePrefix}${formatCount(totalCount)} result${totalCount === 1 ? '' : 's'}`;

  return (
    <div className="catalog-pagination-controls" aria-label="Table pagination">
      <div className="catalog-pagination-status" aria-live="polite">
        <span className="catalog-pagination-page">
          Page {pageIndex} of {approximatePrefix}
          {formatCount(displayPageCount)}
        </span>
        <span className="catalog-pagination-total">{totalLabel}</span>
      </div>
      <Dropdown
        id={`${idPrefix}-page-size`}
        name={`${idPrefix}-page-size`}
        size="compact"
        variant="outlined"
        ariaLabel="Rows per page"
        value={String(pageSize)}
        options={pageOptions}
        onChange={(value) => {
          const rawValue = Array.isArray(value) ? value[0] : value;
          const next = Number(rawValue);
          if (pageSizeOptions.includes(next as BrowsePageLimit)) {
            onPageSizeChange(next as BrowsePageLimit);
          }
        }}
        renderValue={(value, options) => {
          const selected = options.find((option) => option.value === value);
          return selected?.label ?? 'Rows / page';
        }}
      />
      <div className="catalog-pagination-buttons">
        <button
          type="button"
          className="catalog-pagination-button"
          onClick={onPrevious}
          disabled={!hasPrevious || loading}
        >
          Previous
        </button>
        <button
          type="button"
          className="catalog-pagination-button"
          onClick={onNext}
          disabled={!hasNext || loading}
        >
          {loading ? 'Loading' : 'Next'}
        </button>
      </div>
    </div>
  );
};

export default CatalogPaginationControls;
