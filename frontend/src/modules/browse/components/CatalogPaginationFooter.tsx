import type { BrowseCatalogPagination } from '@modules/browse/hooks/useBrowseCatalog';
import QueryPaginationControls from '@modules/resource-grid/QueryPaginationControls';
import type { TablePageSize } from '@shared/components/tables/pageSizeOptions';
import type React from 'react';

interface CatalogPaginationFooterProps {
  idPrefix: string;
  /** Rows currently rendered (the footer shows the visible range). */
  visibleItemCount: number;
  pagination: BrowseCatalogPagination;
}

/**
 * GridTable props that map the modified-arrow shortcuts to catalog page navigation,
 * mirroring the footer buttons' disabled logic. Kept beside the footer for
 * the same reason the footer exists: so the three catalog views cannot drift.
 */
export const catalogPaginationPageKeyProps = (pagination: BrowseCatalogPagination) => {
  const busy = pagination.isRequestingMore || pagination.queryPending;
  return {
    onPagePrevious: pagination.onRequestPrevious,
    onPageNext: pagination.onRequestMore,
    canPagePrevious: pagination.hasPrevious && !busy,
    canPageNext: pagination.hasMore && !busy,
  };
};

/**
 * The one catalog pagination footer. Renders the shared QueryPaginationControls
 * straight from useBrowseCatalog's assembled pagination object so Browse and
 * the two Custom views cannot drift on the footer wiring.
 */
const CatalogPaginationFooter: React.FC<CatalogPaginationFooterProps> = ({
  idPrefix,
  visibleItemCount,
  pagination,
}) => (
  <QueryPaginationControls
    idPrefix={idPrefix}
    pageIndex={pagination.pageIndex}
    pageSize={pagination.pageLimit}
    visibleItemCount={visibleItemCount}
    pageSizeOptions={pagination.pageLimitOptions}
    totalCount={pagination.totalCount}
    totalIsExact={pagination.totalIsExact}
    hasPrevious={pagination.hasPrevious}
    hasNext={pagination.hasMore}
    loading={pagination.isRequestingMore || pagination.queryPending}
    onPrevious={pagination.onRequestPrevious}
    onNext={pagination.onRequestMore}
    onPageSizeChange={(value) => pagination.setPageLimit(value as TablePageSize)}
    onPageJump={pagination.onJumpToPage}
  />
);

export default CatalogPaginationFooter;
