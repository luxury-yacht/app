import React from 'react';
import type { RefObject } from 'react';

interface GridTablePaginationProps {
  hasMore: boolean;
  isRequestingMore: boolean;
  showLoadMoreButton: boolean;
  showPaginationStatus: boolean;
  loadMoreLabel: string;
  paginationStatus: string;
  onManualLoadMore: () => void;
  sentinelRef: RefObject<HTMLDivElement | null>;
}

const GridTablePagination: React.FC<GridTablePaginationProps> = ({
  hasMore,
  isRequestingMore,
  showLoadMoreButton,
  showPaginationStatus,
  loadMoreLabel,
  paginationStatus,
  onManualLoadMore,
  sentinelRef,
}) => {
  return (
    <div className="gridtable-pagination">
      <div
        ref={hasMore ? sentinelRef : null}
        className="gridtable-pagination-sentinel"
        aria-hidden="true"
      />
      {showLoadMoreButton && (
        <button
          type="button"
          className="gridtable-pagination-button"
          onClick={onManualLoadMore}
          disabled={!hasMore || isRequestingMore}
        >
          {isRequestingMore ? 'Loading…' : loadMoreLabel}
        </button>
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
