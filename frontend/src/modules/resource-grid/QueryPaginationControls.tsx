/**
 * frontend/src/modules/resource-grid/QueryPaginationControls.tsx
 *
 * Shared cursor pagination controls for query-backed resource tables.
 */

import React, { useMemo } from 'react';
import './QueryPaginationControls.css';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';

interface QueryPaginationControlsProps {
  idPrefix: string;
  pageIndex: number;
  pageSize: number;
  visibleItemCount: number;
  pageSizeOptions: readonly number[];
  totalCount: number;
  totalIsExact: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (value: number) => void;
}

const formatCount = (value: number): string => Math.max(0, value).toLocaleString();

const QueryPaginationControls: React.FC<QueryPaginationControlsProps> = ({
  idPrefix,
  pageIndex,
  pageSize,
  visibleItemCount,
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
  const rangeStart =
    totalCount === 0 || visibleItemCount === 0 ? 0 : (pageIndex - 1) * pageSize + 1;
  const rangeEnd =
    totalCount === 0 || visibleItemCount === 0
      ? 0
      : Math.min((pageIndex - 1) * pageSize + visibleItemCount, Math.max(totalCount, 0));
  const totalLabel =
    totalCount === 0
      ? 'No results'
      : `${approximatePrefix}${formatCount(totalCount)} result${totalCount === 1 ? '' : 's'}`;
  const pageLabel = totalIsExact
    ? `Page ${pageIndex} of ${formatCount(displayPageCount)}`
    : `Page ${pageIndex}`;
  const rangeLabel =
    rangeStart > 0 && rangeEnd >= rangeStart
      ? `Showing ${formatCount(rangeStart)}-${formatCount(rangeEnd)}`
      : 'Showing 0';

  return (
    <div className="query-pagination-controls" aria-label="Table pagination">
      <div className="query-pagination-status" aria-live="polite">
        <span className="query-pagination-page">{pageLabel}</span>
        <span className="query-pagination-range">{rangeLabel}</span>
        <span className="query-pagination-total">{totalLabel}</span>
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
          if (pageSizeOptions.includes(next)) {
            onPageSizeChange(next);
          }
        }}
        renderValue={(value, options) => {
          const selected = options.find((option) => option.value === value);
          return selected?.label ?? 'Rows / page';
        }}
      />
      <div className="query-pagination-buttons">
        <button
          type="button"
          className="query-pagination-button"
          onClick={onPrevious}
          disabled={!hasPrevious || loading}
        >
          Previous
        </button>
        <button
          type="button"
          className="query-pagination-button"
          onClick={onNext}
          disabled={!hasNext || loading}
        >
          {loading ? 'Loading' : 'Next'}
        </button>
      </div>
    </div>
  );
};

export default QueryPaginationControls;
