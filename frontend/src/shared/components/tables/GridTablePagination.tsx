/**
 * frontend/src/shared/components/tables/GridTablePagination.tsx
 *
 * UI component for GridTablePagination.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import type { RefObject } from 'react';

interface GridTablePaginationProps {
  hasMore: boolean;
  hasPrevious: boolean;
  isRequestingMore: boolean;
  showLoadMoreButton: boolean;
  showPaginationStatus: boolean;
  loadMoreLabel: string;
  previousPageLabel: string;
  paginationStatus: string;
  paginationControls?: React.ReactNode;
  onManualLoadMore: () => void;
  onManualLoadPrevious: () => void;
  sentinelRef: RefObject<HTMLDivElement | null>;
}

const GridTablePagination: React.FC<GridTablePaginationProps> = ({
  hasMore,
  hasPrevious,
  isRequestingMore,
  showLoadMoreButton,
  showPaginationStatus,
  loadMoreLabel,
  previousPageLabel,
  paginationStatus,
  paginationControls,
  onManualLoadMore,
  onManualLoadPrevious,
  sentinelRef,
}) => {
  return (
    <div className="gridtable-pagination">
      <div
        ref={hasMore ? sentinelRef : null}
        className="gridtable-pagination-sentinel"
        aria-hidden="true"
      />
      {paginationControls}
      {showLoadMoreButton && (
        <div className="gridtable-pagination-buttons">
          <button
            type="button"
            className="gridtable-pagination-button"
            onClick={onManualLoadPrevious}
            disabled={!hasPrevious || isRequestingMore}
          >
            {previousPageLabel}
          </button>
          <button
            type="button"
            className="gridtable-pagination-button"
            onClick={onManualLoadMore}
            disabled={!hasMore || isRequestingMore}
          >
            {isRequestingMore ? 'Loading…' : loadMoreLabel}
          </button>
        </div>
      )}
      {showPaginationStatus && (
        <div className="gridtable-pagination-status" aria-live="polite">
          {paginationStatus}
        </div>
      )}
    </div>
  );
};

export default GridTablePagination;
