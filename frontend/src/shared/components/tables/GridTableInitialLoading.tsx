import React from 'react';
import LoadingSpinner from '@shared/components/LoadingSpinner';

interface GridTableInitialLoadingProps {
  embedded: boolean;
  className: string;
  message?: string;
}

const GridTableInitialLoading: React.FC<GridTableInitialLoadingProps> = ({
  embedded,
  className,
  message = 'Loading resources...',
}) => (
  <div
    className={`gridtable-container gridtable-initial-loading ${embedded ? 'embedded' : ''} ${className}`}
  >
    <div className="gridtable-loading-overlay">
      <LoadingSpinner message={message} />
    </div>
  </div>
);

export default GridTableInitialLoading;
