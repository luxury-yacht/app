import type React from 'react';
import type { BrowsePageLimit } from '@modules/browse/pagination';
import QueryPaginationControls from '@modules/resource-grid/QueryPaginationControls';

interface CatalogPaginationControlsProps {
  idPrefix: string;
  pageIndex: number;
  pageSize: number;
  visibleItemCount: number;
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

const CatalogPaginationControls: React.FC<CatalogPaginationControlsProps> = (props) => (
  <QueryPaginationControls
    {...props}
    onPageSizeChange={(value) => props.onPageSizeChange(value as BrowsePageLimit)}
  />
);

export default CatalogPaginationControls;
