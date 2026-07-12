/**
 * frontend/src/modules/resource-grid/QueryPaginationControls.tsx
 *
 * Shared cursor pagination controls for query-backed resource tables.
 */

import type React from 'react';
import { useMemo } from 'react';
import './QueryPaginationControls.css';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import { formatShortcut } from '@ui/shortcuts/utils';
import { isMacPlatform } from '@/utils/platform';

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
  /**
   * Numbered page jump (1-based). Rendered only while the total is exact —
   * approximate totals keep first/prev/next only (large-data.md contract).
   */
  onPageJump?: (page: number) => void;
}

const formatCount = (value: number): string => Math.max(0, value).toLocaleString();

const PaginationArrowIcon: React.FC<{ direction: 'previous' | 'next' }> = ({ direction }) => (
  <svg
    className="query-pagination-button-icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
  >
    {direction === 'previous' ? (
      <path d="M10.4 3.2 5.6 8l4.8 4.8-1.2 1.2L4 8l5.2-6z" />
    ) : (
      <path d="m5.6 3.2 4.8 4.8-4.8 4.8 1.2 1.2L12 8 6.8 2z" />
    )}
  </svg>
);

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
  onPageJump,
}) => {
  const pageOptions = useMemo<DropdownOption[]>(
    () =>
      pageSizeOptions.map((value) => ({
        value: String(value),
        label: String(value),
      })),
    [pageSizeOptions]
  );
  const rangeStart =
    totalCount === 0 || visibleItemCount === 0 ? 0 : (pageIndex - 1) * pageSize + 1;
  const rawRangeEnd = (pageIndex - 1) * pageSize + visibleItemCount;
  const rangeEnd =
    totalCount === 0 || visibleItemCount === 0
      ? 0
      : totalIsExact
        ? Math.min(rawRangeEnd, Math.max(totalCount, 0))
        : rawRangeEnd;
  const rangeLabel =
    rangeStart > 0 && rangeEnd >= rangeStart
      ? `${formatCount(rangeStart)}-${formatCount(rangeEnd)}`
      : '0';
  const totalLabel = totalIsExact ? formatCount(totalCount) : `${formatCount(totalCount)}+`;
  const totalPages =
    totalIsExact && pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 0;
  // Numbered jumps need an exact page count; approximate totals keep
  // first/prev/next only (large-data.md contract).
  const showPageJump = Boolean(onPageJump) && totalIsExact && totalPages > 1;
  const pageNavigationModifiers = isMacPlatform() ? { meta: true } : { ctrl: true };
  const previousPageTitle = `Previous page (${formatShortcut('ArrowLeft', pageNavigationModifiers)})`;
  const nextPageTitle = `Next page (${formatShortcut('ArrowRight', pageNavigationModifiers)})`;

  // Commit the page-jump field: parse, clamp to [1, totalPages], and jump only
  // when the target differs from the current page. Both Enter and blur (tab-out)
  // call this, so they can't drift. On an empty/invalid/same-page value it
  // restores the field to the current page rather than leaving a stale number.
  const commitPageJump = (input: HTMLInputElement) => {
    const value = Number(input.value);
    const target =
      Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), totalPages) : null;
    if (target === null || target === pageIndex) {
      input.value = String(pageIndex);
      return;
    }
    onPageJump?.(target);
  };

  return (
    <nav className="query-pagination-controls" aria-label="Table pagination">
      <div className="query-pagination-page-size">
        <span className="query-pagination-page-size-label">Rows per page</span>
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
            return selected?.label ?? String(pageSize);
          }}
        />
      </div>
      <div className="query-pagination-status" aria-live="polite">
        <span className="query-pagination-range">
          {rangeLabel} of {totalLabel}
        </span>
        <span
          className="query-pagination-progress"
          role="status"
          aria-label={loading ? 'Page request in progress' : undefined}
          aria-hidden={loading ? undefined : true}
        />
      </div>
      {/* One navigation cluster: ◀ [page]/total ▶. The editable page number
          lives between the arrows because it IS navigation — keeping it out of
          the status text leaves exactly one "X of Y" fact on the footer. */}
      <div className="query-pagination-buttons">
        <button
          type="button"
          className="query-pagination-button"
          onClick={onPrevious}
          disabled={!hasPrevious || loading}
          aria-label="Previous page"
          title={previousPageTitle}
        >
          <PaginationArrowIcon direction="previous" />
        </button>
        {showPageJump ? (
          <span className="query-pagination-page-jump">
            <input
              key={pageIndex}
              type="number"
              className="query-pagination-page-jump-input"
              defaultValue={pageIndex}
              min={1}
              max={totalPages}
              disabled={loading}
              aria-label={`Page ${pageIndex} of ${totalPages} — edit to jump`}
              title={`Go to page (1 to ${formatCount(totalPages)})`}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitPageJump(event.currentTarget);
                }
              }}
              onBlur={(event) => commitPageJump(event.currentTarget)}
            />
            <span className="query-pagination-page-jump-total">/ {formatCount(totalPages)}</span>
          </span>
        ) : null}
        <button
          type="button"
          className="query-pagination-button"
          onClick={onNext}
          disabled={!hasNext || loading}
          aria-label="Next page"
          title={nextPageTitle}
        >
          <PaginationArrowIcon direction="next" />
        </button>
      </div>
    </nav>
  );
};

export default QueryPaginationControls;
