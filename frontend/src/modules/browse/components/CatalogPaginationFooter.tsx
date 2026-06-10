import type React from 'react';
import type { BrowsePageLimit } from '@modules/browse/pagination';
import type { BrowseCatalogPagination } from '@modules/browse/hooks/useBrowseCatalog';
import QueryPaginationControls from '@modules/resource-grid/QueryPaginationControls';

interface CatalogPaginationFooterProps {
  idPrefix: string;
  /** Rows currently rendered (the footer shows the visible range). */
  visibleItemCount: number;
  pagination: BrowseCatalogPagination;
}

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
    onPageSizeChange={(value) => pagination.setPageLimit(value as BrowsePageLimit)}
  />
);

export default CatalogPaginationFooter;
